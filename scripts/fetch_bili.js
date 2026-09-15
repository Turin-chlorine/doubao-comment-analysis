// B站评论正式采集
// 设计要点：
//  1) 每次 evaluate 只发一个 HTTP 请求 —— cdp.js 的 send() 有 15s 超时，
//     把多次 fetch 塞进一个页面脚本会必然超时。
//  2) 抽样框 = 关键词搜索命中的视频（标题含"豆包"）下的一级评论。
//     评论级相关性规则（去除表情标签后正文含"豆包"）在下一步清洗时执行，
//     本脚本只负责尽可能完整地取回原始评论，不去重、不过滤。
//  3) 所有结果落盘，日志 append，不依赖控制台输出。
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const DIR = path.join(ROOT, 'data', 'bili');
const LOG = path.join(ROOT, 'scripts', 'bili_fetch.log');
const RAW = path.join(DIR, 'bili_raw.json');

fs.mkdirSync(DIR, { recursive: true });

function log() {
  const l = Array.prototype.map.call(arguments, String).join(' ');
  try { fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch (e) {}
}

// 关键词：前 3 个是泛入口，后 5 个是「痛点导向」——用痛点词搜索是刻意的，
// 因为本次研究问题是找用户不满，泛入口召回率高但信噪比低。
const KEYWORDS = [
  '豆包AI',
  '豆包 智能助手',
  '豆包 评测',
  '豆包 难用',
  '豆包 缺点',
  '豆包 收费',
  '豆包 下架',
  '豆包 输入法',
];
const SEARCH_PAGES = [1, 2];
// 每个视频拉取策略：(sort, pn) 组合。sort=2 热度 / sort=0 时间
const REPLY_TASKS = [
  [2, 1], [2, 2], [2, 3],
  [0, 1],
];
const MAX_VIDEOS = 40;
const PS = 20;

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

const searchExpr = (kw, page) => `(async()=>{
  try{
    const u='https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword='+encodeURIComponent(${JSON.stringify(kw)})+'&page=${page}';
    const r=await fetch(u,{credentials:'include'});
    const j=await r.json();
    const v=(j.data&&j.data.result)||[];
    return JSON.stringify({code:j.code,msg:j.message||'',num:j.data&&j.data.numResults,n:v.length,
      v:v.map(x=>({aid:x.aid,bvid:x.bvid,title:x.title,author:x.author,play:x.play,review:x.review,pubdate:x.pubdate}))});
  }catch(e){ return JSON.stringify({error:String(e)}); }
})()`;

const replyExpr = (aid, sort, pn) => `(async()=>{
  try{
    const u='https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=${pn}&ps=${PS}&sort=${sort}';
    const r=await fetch(u,{credentials:'include'});
    const j=await r.json();
    if(j.code!==0) return JSON.stringify({code:j.code,msg:j.message||''});
    const d=j.data||{};
    const rp=d.replies||[];
    return JSON.stringify({code:0,n:rp.length,total:d.page&&d.page.count,
      c:rp.map(x=>({rpid:x.rpid,ctime:x.ctime,like:x.like,u:(x.member&&x.member.uname)||'',sub:x.rcount||0,m:(x.content&&x.content.message)||''}))});
  }catch(e){ return JSON.stringify({error:String(e)}); }
})()`;

(async () => {
  log('');
  log('===== RUN ' + new Date().toISOString() + ' =====');
  const videos = new Map();   // aid -> video
  const comments = [];        // 原始评论
  const seenRpid = new Set();
  const stats = { searchCalls: 0, searchErrors: 0, replyCalls: 0, replyErrors: 0, dupRpid: 0 };

  await session(async (api, slog) => {
    // STEP 1 拿 cookie
    try {
      await api.goto('https://www.bilibili.com', 9000);
      const t = await api.evaluate('document.title');
      log('STEP1 home:', JSON.stringify(t));
    } catch (e) { log('STEP1 ERR', e.message); }

    // STEP 2 搜索
    for (const kw of KEYWORDS) {
      for (const page of SEARCH_PAGES) {
        stats.searchCalls++;
        let raw = '';
        try { raw = await api.evaluate(searchExpr(kw, page)); }
        catch (e) { stats.searchErrors++; log('  SEARCH ERR', kw, 'p' + page, e.message); await sleep(1200); continue; }
        let j = null;
        try { j = JSON.parse(String(raw)); } catch (e) {}
        if (!j || j.code !== 0) {
          stats.searchErrors++;
          log('  SEARCH non-ok', kw, 'p' + page, 'code=' + (j && j.code), 'msg=' + (j && (j.msg || j.error)));
          await sleep(1200);
          continue;
        }
        let added = 0;
        for (const v of j.v || []) {
          if (!v.aid) continue;
          if (!videos.has(v.aid)) {
            videos.set(v.aid, {
              aid: v.aid, bvid: v.bvid || '', title: stripHtml(v.title),
              author: v.author || '', play: v.play, review: v.review,
              pubdate: v.pubdate || 0, keywords: [],
            });
            added++;
          }
          const rec = videos.get(v.aid);
          if (rec.keywords.indexOf(kw) < 0) rec.keywords.push(kw);
        }
        log('  SEARCH ok', kw, 'p' + page, 'returned=' + j.n, 'new=' + added, 'pool=' + videos.size);
        await sleep(1100);
      }
    }

    // STEP 3 视频筛选：标题含「豆包」
    let allVideos = Array.from(videos.values());
    const matched = allVideos.filter((v) => /豆包/.test(v.title));
    matched.sort((a, b) => (b.pubdate || 0) - (a.pubdate || 0));
    const targets = matched.slice(0, MAX_VIDEOS);
    log('STEP3 videos: pool=' + allVideos.length + ' title-match=' + matched.length + ' taking=' + targets.length);

    // STEP 4 逐视频拉评论
    for (let i = 0; i < targets.length; i++) {
      const v = targets[i];
      let got = 0;
      for (const [sort, pn] of REPLY_TASKS) {
        stats.replyCalls++;
        let raw = '';
        try { raw = await api.evaluate(replyExpr(v.aid, sort, pn)); }
        catch (e) { stats.replyErrors++; log('    REPLY ERR', v.aid, 'sort' + sort, 'pn' + pn, e.message); await sleep(1000); continue; }
        let j = null;
        try { j = JSON.parse(String(raw)); } catch (e) {}
        if (!j || j.code !== 0) {
          stats.replyErrors++;
          log('    REPLY non-ok', v.aid, 'sort' + sort, 'pn' + pn, 'code=' + (j && j.code), 'msg=' + (j && (j.msg || j.error)));
          await sleep(1000);
          continue;
        }
        let dup = 0;
        for (const c of j.c || []) {
          if (!c.rpid || seenRpid.has(c.rpid)) { dup++; stats.dupRpid++; continue; }
          seenRpid.add(c.rpid);
          comments.push({
            rpid: c.rpid, aid: v.aid, videoTitle: v.title, videoAuthor: v.author,
            user: c.u, like: c.like, ctime: c.ctime, subReplies: c.sub,
            content: c.m, viaSort: sort, viaPn: pn,
          });
        }
        got += (j.c || []).length - dup;
        log('    REPLY ok', v.aid, 'sort' + sort, 'pn' + pn, 'n=' + j.n, 'total=' + j.total, 'new=' + ((j.c || []).length - dup), 'dup=' + dup);
        await sleep(800);
      }
      log('  video ' + (i + 1) + '/' + targets.length + ' aid=' + v.aid + ' cum_comments=' + comments.length + ' | ' + v.title.slice(0, 60));
      await sleep(400);
    }

    log('== collect done ==');
  }, { port: 9262, log, network: false }).catch((e) => log('FATAL', e && e.stack ? e.stack : String(e)));

  const out = {
    meta: {
      platform: 'bilibili',
      collectedAt: new Date().toISOString(),
      keywords: KEYWORDS,
      searchPages: SEARCH_PAGES,
      replyTasks: REPLY_TASKS,
      samplingFrame: '关键词搜索命中的视频（标题含"豆包"）下的一级评论',
      stats,
    },
    videos: Array.from(videos.values()).filter((v) => /豆包/.test(v.title)),
    comments,
  };
  try {
    fs.writeFileSync(RAW, JSON.stringify(out, null, 2), 'utf8');
    log('WROTE ' + RAW + ' videos=' + out.videos.length + ' comments=' + comments.length);
  } catch (e) { log('WRITE ERR', e.message); }
  log('===== END ' + new Date().toISOString() + ' =====');
})();
