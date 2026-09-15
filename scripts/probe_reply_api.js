// 探测 B站评论端点：寻找「无需登录 + 支持翻页」的组合
// 背景：legacy x/v2/reply 不用登录但只回 3 条热门；wbi/main 能翻页但要登录（-403）
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const LOG = path.join(ROOT, 'scripts', 'bili_api_probe.log');
function log() {
  const l = Array.prototype.map.call(arguments, String).join(' ');
  try { fs.appendFileSync(LOG, l + '\n', 'utf8'); } catch (e) {}
}

const AID = 117047925350126; // 豆包输入法太坏了（评论数 10607，价值最高的目标之一）

const mk = (label, url) => ({ label, url });

const TESTS = [
  mk('legacy pn=1 sort=2', `https://api.bilibili.com/x/v2/reply?type=1&oid=${AID}&pn=1&ps=20&sort=2`),
  mk('legacy pn=2 sort=2', `https://api.bilibili.com/x/v2/reply?type=1&oid=${AID}&pn=2&ps=20&sort=2`),
  mk('main mode3 next0', `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${AID}&mode=3&next=0&ps=20`),
  mk('main mode3 next1', `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${AID}&mode=3&next=1&ps=20`),
  mk('main mode2 next1', `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${AID}&mode=2&next=1&ps=20&plat=1`),
  mk('main mode1 next1', `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${AID}&mode=1&next=1&ps=20&plat=1`),
];

// 在页面上下文里 fetch，并把「拿到的正文样例」一并带回，便于判断是真数据还是空壳
const expr = (url) => `(async()=>{try{
  const r=await fetch(${JSON.stringify(url)},{credentials:'include',headers:{'Referer':'https://www.bilibili.com/'}});
  const j=await r.json();
  const d=j.data||{};
  const rp=d.replies||[];
  const cur=d.cursor||{};
  return JSON.stringify({code:j.code,msg:j.message||'',n:rp.length,isEnd:cur.is_end,next:cur.next,all:cur.all_count,
    c:rp.slice(0,3).map(x=>({m:String((x.content&&x.content.message)||'').slice(0,80),l:x.like}))});
}catch(e){return JSON.stringify({error:String(e)})}})()`;

(async () => {
  log('');
  log('===== API PROBE ' + new Date().toISOString() + ' aid=' + AID + ' =====');
  const results = [];
  await session(async (api) => {
    try { await api.goto('https://www.bilibili.com', 8000); } catch (e) { log('GOTO ERR', e.message); }
    for (const t of TESTS) {
      let raw = '';
      try { raw = await api.evaluate(expr(t.url)); } catch (e) { raw = JSON.stringify({ error: e.message }); }
      log(t.label + ' => ' + String(raw).slice(0, 700));
      results.push({ label: t.label, url: t.url, raw: String(raw).slice(0, 4000) });
      await sleep(900);
    }
    log('== probe done ==');
  }, { port: 9266, log, network: false }).catch((e) => log('FATAL', e && e.stack ? e.stack : String(e)));

  fs.writeFileSync(path.join(ROOT, 'data', 'bili', 'api_probe.json'), JSON.stringify(results, null, 2), 'utf8');
  log('===== END =====');
})();
