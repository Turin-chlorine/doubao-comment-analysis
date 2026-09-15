// B站评论采集 v3.1：legacy 端点全量铺开（增量落盘 + 断点续采 + 限流退避）
//
// v3.0 的失败教训：脚本在写盘前崩溃 → 已抓到的 160 条全部丢失。
// 修正：每采 5 个视频就 flush 一次，并把「已采 aid」记录在文件里，重跑自动跳过。
//
// 实测边界（必须如实写入报告）：
//   B站对未登录访客硬性封顶，每条视频只返回 3 条「最热」一级评论。
//   pn=2 → 0 条；x/v2/reply/main next=1 → is_end（all=10607）；wbi/main → -403 需登录。
//   因此样本量由「视频覆盖面」决定。
// 另一实测坑：请求过密时 B站 返回 HTML（而非 JSON），即风控拦截 —— 需退避重试。
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const DIR = path.join(ROOT, 'data', 'bili');
const LOG = path.join(ROOT, 'scripts', 'bili_all.log');
const RAW_IN = path.join(DIR, 'bili_raw.json');
const RAW_OUT = path.join(DIR, 'bili_all_raw.json');

function log() {
  const l = Array.prototype.map.call(arguments, String).join(' ');
  try { fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch (e) {}
}

const NAP_MS = 1400;         // 请求间隔（v3.0 用 550ms，约 160 次后被限流）
const BLOCK_NAP_MS = 12000;  // 命中风控后的退避
const MAX_RETRY = 2;
// 本环境实测：后台任务约 120s 被强杀。改为前台运行 + 自带时间预算，
// 预算内主动 flush 并退出，下次调用凭「已完成 aid 列表」续采。
const BUDGET_MS = Number(process.env.BILI_BUDGET_MS || 230000);

const replyExpr = (aid, sort) => `(async()=>{try{
  const u='https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=1&ps=20&sort=${sort}';
  const r=await fetch(u,{credentials:'include'});
  const t=await r.text();
  if(t.charAt(0)!=='{') return JSON.stringify({blocked:true,http:r.status,len:t.length});
  const j=JSON.parse(t);
  if(j.code!==0) return JSON.stringify({code:j.code,msg:j.message||''});
  const d=j.data||{};
  const rp=d.replies||[];
  return JSON.stringify({code:0,n:rp.length,total:d.page&&d.page.count,
    c:rp.map(x=>({rpid:x.rpid,ctime:x.ctime,like:x.like,u:(x.member&&x.member.uname)||'',sub:x.rcount||0,m:(x.content&&x.content.message)||''}))});
}catch(e){return JSON.stringify({error:String(e)})}})()`;

// 读已有进度
let store = { meta: {}, videos: [], comments: [] };
const done = new Set();
if (fs.existsSync(RAW_OUT)) {
  try {
    store = JSON.parse(fs.readFileSync(RAW_OUT, 'utf8'));
    store.comments.forEach((c) => done.add(String(c.aid)));
  } catch (e) {}
}

function flush(note) {
  try {
    store.meta = {
      platform: 'bilibili',
      endpoint: 'x/v2/reply (legacy, 未登录)',
      collectedAt: new Date().toISOString(),
      samplingFrame: '关键词搜索命中的、标题含"豆包"的视频，各取其最热 3 条一级评论',
      knownBias: '未登录访客每条视频上限 3 条，且返回的是点赞最高的评论 —— 样本偏「高赞观点/梗」，不代表该视频评论区的代表性分布',
      rateLimitNote: '请求过密时 B站 返回 HTML 页面（风控），已通过退避重试规避',
      note: note || '',
    };
    fs.writeFileSync(RAW_OUT, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) { log('FLUSH ERR', e.message); }
}

(async () => {
  log('');
  log('===== RUN v3.1 ' + new Date().toISOString() + ' =====');
  const src = JSON.parse(fs.readFileSync(RAW_IN, 'utf8'));
  const targets = src.videos;
  store.videos = targets;
  log('targets=' + targets.length + ' alreadyDone=' + done.size + ' existingComments=' + store.comments.length);

  const seenRpid = new Set(store.comments.map((c) => String(c.rpid)));
  let blockedCount = 0, okCount = 0, emptyCount = 0;
  const t0 = Date.now();

  await session(async (api) => {
    try { await api.goto('https://www.bilibili.com', 8000); } catch (e) { log('GOTO ERR', e.message); }

    // 预检：先单发一个请求，若已被 IP 级封禁（412）就直接退出，不浪费预算
    try {
      const pre = JSON.parse(String(await api.evaluate(replyExpr(targets[0].aid, 2))));
      if (pre.blocked) { log('PREFLIGHT BLOCKED http=' + pre.http + ' → 本次不采集，稍后重试'); return; }
      log('PREFLIGHT ok n=' + pre.n);
      for (const c of pre.c || []) {
        if (!c.rpid || seenRpid.has(String(c.rpid))) continue;
        seenRpid.add(String(c.rpid));
        store.comments.push({
          rpid: c.rpid, aid: targets[0].aid, videoTitle: targets[0].title, videoAuthor: targets[0].author,
          videoPubdate: targets[0].pubdate, videoReviewCount: targets[0].review,
          user: c.u, like: c.like, ctime: c.ctime, subReplies: c.sub, content: c.m, viaSort: 2,
        });
      }
      done.add(String(targets[0].aid));
      okCount++;
    } catch (e) { log('PREFLIGHT ERR', e.message); }

    for (let i = 0; i < targets.length; i++) {
      const v = targets[i];
      if (done.has(String(v.aid))) continue;
      if (Date.now() - t0 > BUDGET_MS) { log('BUDGET reached at ' + (i + 1) + '/' + targets.length + ' → 主动退出，可续采'); break; }

      let ok = false;
      for (let attempt = 0; attempt <= MAX_RETRY && !ok; attempt++) {
        let raw = '';
        try { raw = await api.evaluate(replyExpr(v.aid, 2)); }
        catch (e) { log('  ERR', v.aid, 'try' + attempt, e.message); await sleep(NAP_MS); continue; }

        let j = null;
        try { j = JSON.parse(String(raw)); } catch (e) {}

        if (j && j.blocked) {
          blockedCount++;
          log('  BLOCKED', v.aid, 'try' + attempt, 'http=' + j.http, 'len=' + j.len, '→ backoff ' + BLOCK_NAP_MS + 'ms');
          flush('blocked at ' + blockedCount + ' times');
          await sleep(BLOCK_NAP_MS);
          continue;
        }
        if (!j || j.code !== 0) {
          if (j && j.code === -404) { emptyCount++; log('  non-ok', v.aid, 'code=-404 (视频不存在/已删除)'); }
          else log('  non-ok', v.aid, 'code=' + (j && j.code), 'msg=' + (j && (j.msg || j.error)));
          ok = true; // 不重试业务错误
          break;
        }
        for (const c of j.c || []) {
          if (!c.rpid || seenRpid.has(String(c.rpid))) continue;
          seenRpid.add(String(c.rpid));
          store.comments.push({
            rpid: c.rpid, aid: v.aid, videoTitle: v.title, videoAuthor: v.author,
            videoPubdate: v.pubdate, videoReviewCount: v.review,
            user: c.u, like: c.like, ctime: c.ctime, subReplies: c.sub,
            content: c.m, viaSort: 2,
          });
        }
        okCount++;
        ok = true;
      }
      done.add(String(v.aid));

      if (i % 5 === 0) {
        flush();
        log('  progress ' + (i + 1) + '/' + targets.length + ' comments=' + store.comments.length + ' ok=' + okCount + ' blocked=' + blockedCount + ' empty=' + emptyCount);
      }
      await sleep(NAP_MS);
    }
    log('== done ==');
  }, { port: 9270, log, network: false }).catch((e) => log('FATAL', e && e.stack ? e.stack : String(e)));

  flush('final');
  log('WROTE ' + RAW_OUT + ' comments=' + store.comments.length + ' videosDone=' + done.size + ' ok=' + okCount + ' blocked=' + blockedCount + ' empty=' + emptyCount);
  log('===== END =====');
})();
