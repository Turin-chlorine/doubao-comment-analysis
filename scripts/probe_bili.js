// B站评论采集可行性验证
// 思路：先用主站设置 cookie，再在页面上下文里调用公开 API
// 注意：日志用 append；单站点单会话（见 cdp.js 注释）
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const LOG = path.join(ROOT, 'scripts', 'bili.log');
const lines = ['===== RUN ' + new Date().toISOString() + ' ====='];
function log() {
  const l = Array.prototype.map.call(arguments, String).join(' ');
  lines.push(l);
  try { fs.appendFileSync(LOG, '\n' + l, 'utf8'); } catch (e) {}
}

const SEARCH_EXPR = `(async()=>{
  try{
    const u='https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword='+encodeURIComponent('豆包')+'&page=1';
    const r=await fetch(u,{credentials:'include'});
    const j=await r.json();
    const v=(j.data&&j.data.result)||[];
    return JSON.stringify({code:j.code,msg:j.message,n:v.length,v:v.slice(0,6).map(x=>({aid:x.aid,title:String(x.title||'').replace(/<[^>]+>/g,'')}))});
  }catch(e){ return JSON.stringify({error:String(e)}); }
})()`;

const replyExpr = (aid) => `(async()=>{
  try{
    const u='https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=1&ps=20&sort=2';
    const r=await fetch(u,{credentials:'include'});
    const j=await r.json();
    if(j.code!==0) return JSON.stringify({code:j.code,msg:j.message});
    const rp=(j.data&&j.data.replies)||[];
    return JSON.stringify({code:0,n:rp.length,c:rp.map(x=>({m:String(x.content.message||'').slice(0,200),u:x.member.uname,l:x.like}))});
  }catch(e){ return JSON.stringify({error:String(e)}); }
})()`;

(async () => {
  await session(async (api) => {
    // 1) 先访问主站，让浏览器拿到 cookie
    try {
      await api.goto('https://www.bilibili.com', 9000);
      const t = await api.evaluate('document.title');
      log('STEP1 home title:', JSON.stringify(t));
    } catch (e) { log('STEP1 ERR', e.message); }

    // 2) 搜索 API
    let searchRaw = '';
    try { searchRaw = await api.evaluate(SEARCH_EXPR); } catch (e) { log('STEP2 ERR', e.message); }
    log('STEP2 search:', String(searchRaw).slice(0, 900));

    // 3) 取第一个视频的 aid，拉评论
    let aid = null;
    try {
      const j = JSON.parse(String(searchRaw));
      if (j.v && j.v.length) aid = j.v[0].aid;
    } catch (e) {}
    log('STEP3 aid =', String(aid));
    if (aid) {
      let repRaw = '';
      try { repRaw = await api.evaluate(replyExpr(aid)); } catch (e) { log('STEP3 ERR', e.message); }
      log('STEP3 replies:', String(repRaw).slice(0, 1400));
      try {
        fs.mkdirSync(path.join(ROOT, 'data', 'bili'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'data', 'bili', 'probe_replies.json'), String(repRaw), 'utf8');
      } catch (e) {}
    }
    log('== done ==');
  }, { port: 9260, log, network: false }).catch((e) => log('FATAL', e && e.stack ? e.stack : e));
})();
