// B站评论采集 v2：使用 wbi 签名接口 x/v2/reply/wbi/main（支持真实翻页）
// 为什么必须换接口：旧版 x/v2/reply 实测每条视频只返回约 3 条热门评论，
// pn/sort 参数全部失效（total=1133 却只给 3 条），样本量被硬性封顶。
//
// wbi 签名流程：
//   1) /x/web-interface/nav 取 wbi_img.img_url / sub_url，抽出两个 key
//   2) raw = imgKey + subKey，按固定 64 位置换表重排，取前 32 位 = mixin_key
//   3) 业务参数 + wts（秒级时间戳）按 key 排序 → 过滤 [!'()*] → encodeURIComponent
//      → 拼接 mixin_key → md5 = w_rid
// 另外：wbi 接口要求 buvid3 cookie，用 /x/frontend/finger/spi 补齐。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { session, sleep, ROOT } = require('./cdp');

const DIR = path.join(ROOT, 'data', 'bili');
const LOG = path.join(ROOT, 'scripts', 'bili_wbi.log');
const RAW_IN = path.join(DIR, 'bili_raw.json');
const RAW_OUT = path.join(DIR, 'bili_wbi_raw.json');

fs.mkdirSync(DIR, { recursive: true });
function log() {
  const l = Array.prototype.map.call(arguments, String).join(' ');
  try { fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch (e) {}
}

const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

function mixinKey(imgKey, subKey) {
  const raw = imgKey + subKey;
  return MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32);
}

function wbiSign(params, mixin) {
  const wts = Math.floor(Date.now() / 1000);
  const p = Object.assign({}, params, { wts });
  const sorted = Object.keys(p).sort();
  const q = sorted
    .map((k) => {
      const v = String(p[k]).replace(/[!'()*]/g, '');
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    })
    .join('&');
  const w_rid = crypto.createHash('md5').update(q + mixin).digest('hex');
  return { q, w_rid, wts };
}

const keyFromUrl = (u) => String(u || '').split('/').pop().split('.')[0];

// ---- 页面内脚本（每次只发一个请求，避免 15s CDP 超时）----
const EXPR_SPI = `(async()=>{try{
  const r=await fetch('https://api.bilibili.com/x/frontend/finger/spi',{credentials:'include'});
  const j=await r.json();
  const b3=j.data&&j.data.b_3, b4=j.data&&j.data.b_4;
  if(b3) document.cookie='buvid3='+b3+'; domain=.bilibili.com; path=/';
  if(b4) document.cookie='buvid4='+b4+'; domain=.bilibili.com; path=/';
  return JSON.stringify({code:j.code,b3:!!b3,b4:!!b4});
}catch(e){return JSON.stringify({error:String(e)})}})()`;

const EXPR_NAV = `(async()=>{try{
  const r=await fetch('https://api.bilibili.com/x/web-interface/nav',{credentials:'include'});
  const j=await r.json();
  const w=j.data&&j.data.wbi_img;
  return JSON.stringify({code:j.code,img:w&&w.img_url,sub:w&&w.sub_url});
}catch(e){return JSON.stringify({error:String(e)})}})()`;

function exprReplies(oid, mode, next, signed) {
  const url = 'https://api.bilibili.com/x/v2/reply/wbi/main?oid=' + oid +
    '&type=1&mode=' + mode + '&next=' + next + '&ps=20&plat=1&web_location=1315875&' +
    signed.q + '&w_rid=' + signed.w_rid;
  return `(async()=>{try{
    const r=await fetch(${JSON.stringify(url)},{credentials:'include'});
    const j=await r.json();
    if(j.code!==0) return JSON.stringify({code:j.code,msg:j.message||''});
    const d=j.data||{};
    const rp=d.replies||[];
    const cur=d.cursor||{};
    return JSON.stringify({code:0,n:rp.length,isEnd:!!cur.is_end,next:cur.next,total:cur.all_count,
      c:rp.map(x=>({rpid:x.rpid,ctime:x.ctime,like:x.like,u:(x.member&&x.member.uname)||'',sub:x.rcount||0,
        m:(x.content&&x.content.message)||'',level:(x.member&&x.member.level_info&&x.member.level_info.current_level)}))});
  }catch(e){return JSON.stringify({error:String(e)})}})()`;
}

// 选片：优先评论数多的视频（评论数=可采样本量上限）
const MAX_VIDEOS = 25;
const MAX_PAGES = 6;
const MODES = [3, 2]; // 3=热度 2=时间

(async () => {
  log('');
  log('===== RUN wbi ' + new Date().toISOString() + ' =====');
  const src = JSON.parse(fs.readFileSync(RAW_IN, 'utf8'));
  const byReview = src.videos
    .slice()
    .sort((a, b) => Number(b.review || 0) - Number(a.review || 0))
    .slice(0, MAX_VIDEOS);
  log('targets=' + byReview.length + ' (按评论数降序取自 title-match=' + src.videos.length + ')');

  const comments = [];
  const seen = new Set();
  const stats = { calls: 0, errs: 0, dup: 0, pagesUsed: 0, signOk: false };
  let mixin = null;

  await session(async (api) => {
    try { await api.goto('https://www.bilibili.com', 8000); } catch (e) { log('GOTO ERR', e.message); }

    let r1 = '';
    try { r1 = await api.evaluate(EXPR_SPI); } catch (e) { log('SPI ERR', e.message); }
    log('SPI:', String(r1).slice(0, 200));

    let r2 = '';
    try { r2 = await api.evaluate(EXPR_NAV); } catch (e) { log('NAV ERR', e.message); }
    log('NAV:', String(r2).slice(0, 300));
    try {
      const j = JSON.parse(String(r2));
      const ik = keyFromUrl(j.img), sk = keyFromUrl(j.sub);
      log('wbi keys: img=' + ik + ' sub=' + sk);
      if (ik && sk) { mixin = mixinKey(ik, sk); log('mixin_key=' + mixin); }
    } catch (e) { log('KEY ERR', e.message); }

    if (!mixin) { log('FATAL no mixin key'); return; }

    for (let vi = 0; vi < byReview.length; vi++) {
      const v = byReview[vi];
      let got = 0;
      for (const mode of MODES) {
        let next = 0;
        for (let page = 0; page < MAX_PAGES; page++) {
          const signed = wbiSign({ oid: v.aid, type: 1, mode, next, ps: 20, plat: 1, web_location: 1315875 }, mixin);
          stats.calls++;
          let raw = '';
          try { raw = await api.evaluate(exprReplies(v.aid, mode, next, signed)); }
          catch (e) { stats.errs++; log('    ERR', v.aid, 'm' + mode, 'next' + next, e.message); await sleep(900); break; }
          let j = null;
          try { j = JSON.parse(String(raw)); } catch (e) {}
          if (!j || j.code !== 0) {
            stats.errs++;
            log('    non-ok', v.aid, 'm' + mode, 'next' + next, 'code=' + (j && j.code), 'msg=' + (j && (j.msg || j.error)));
            if (j && j.code === 0) stats.signOk = true;
            await sleep(900);
            break;
          }
          stats.signOk = true;
          stats.pagesUsed++;
          let dup = 0;
          for (const c of j.c || []) {
            if (!c.rpid || seen.has(c.rpid)) { dup++; stats.dup++; continue; }
            seen.add(c.rpid);
            comments.push({
              rpid: c.rpid, aid: v.aid, videoTitle: v.title, videoAuthor: v.author,
              user: c.u, like: c.like, ctime: c.ctime, subReplies: c.sub, level: c.level,
              content: c.m, viaMode: mode, viaNext: next,
            });
          }
          const isNew = (j.c || []).length - dup;
          got += isNew;
          log('    ok', v.aid, 'm' + mode, 'next' + next, 'n=' + j.n, 'new=' + isNew, 'dup=' + dup, 'total=' + j.total, 'isEnd=' + j.isEnd);
          if (j.isEnd || !j.n || !isNew) break;
          next = j.next;
          await sleep(750);
        }
      }
      log('  video ' + (vi + 1) + '/' + byReview.length + ' aid=' + v.aid + ' review=' + v.review + ' got=' + got + ' cum=' + comments.length + ' | ' + v.title.slice(0, 55));
      await sleep(350);
    }
    log('== done ==');
  }, { port: 9264, log, network: false }).catch((e) => log('FATAL', e && e.stack ? e.stack : String(e)));

  const out = {
    meta: {
      platform: 'bilibili', endpoint: 'x/v2/reply/wbi/main', collectedAt: new Date().toISOString(),
      modes: MODES, maxPagesPerMode: MAX_PAGES, ps: 20,
      samplingFrame: '按评论数降序选取的 title 含"豆包" 的视频，其一级评论（热度+时间两个排序，逐页翻取）',
      stats,
    },
    videos: byReview,
    comments,
  };
  try {
    fs.writeFileSync(RAW_OUT, JSON.stringify(out, null, 2), 'utf8');
    log('WROTE ' + RAW_OUT + ' videos=' + byReview.length + ' comments=' + comments.length + ' signOk=' + stats.signOk);
  } catch (e) { log('WRITE ERR', e.message); }
  log('===== END ' + new Date().toISOString() + ' =====');
})();
