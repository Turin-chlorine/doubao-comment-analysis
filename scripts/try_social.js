// 社交媒体渠道可行性测试：贴吧 / 知乎 / B站 / 抖音 / 小红书
//
// 历史教训（2026-09-15 修复）：
//  1) 日志必须 append —— 早前用覆盖写，重跑失败把上一轮证据抹掉了
//  2) 每个站点必须用【独立 Chrome 会话】—— 只要有一个站点把 WebSocket 压断
//     （undici "Max decompressed message size exceeded"，code=1006），
//     同一会话内后续所有站点都会以 ws state=3 超时，造成"全部失败"的假象
//  3) 不 enable Page/Runtime 域（见 cdp.js 注释）
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const OUTDIR = path.join(ROOT, 'data', 'social_test');
const LOG = path.join(ROOT, 'scripts', 'social.log');
const logs = ['===== RUN ' + new Date().toISOString() + ' ====='];
function log() {
  const line = Array.prototype.map.call(arguments, String).join(' ');
  logs.push(line);
  try { fs.appendFileSync(LOG, '\n' + line, 'utf8'); } catch (e) {}
}

const KW = encodeURIComponent('豆包');
process.on('uncaughtException', (e) => log('UNCAUGHT', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => log('UNHANDLED', (e && e.stack) ? e.stack : e));

const TARGETS = [
  { key: 'tieba_list', name: '百度贴吧', url: 'https://tieba.baidu.com/f?kw=' + KW + '&ie=utf-8', wait: 10000 },
  { key: 'zhihu_search', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent('豆包 缺点'), wait: 12000 },
  { key: 'bili_search', name: 'B站', url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('豆包 AI 吐槽'), wait: 12000 },
  { key: 'douyin_search', name: '抖音', url: 'https://www.douyin.com/search/' + KW, wait: 12000 },
  { key: 'xhs_search', name: '小红书', url: 'https://www.xiaohongshu.com/search_result?keyword=' + KW, wait: 12000 },
];

const RES_EXPR = 'JSON.stringify(performance.getEntriesByType("resource").map(r=>r.name)'
  + '.filter(n=>/api|json|graphql|search|captcha|passport|login/i.test(n)).slice(0,8))';

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  let port = 9250;

  for (const t of TARGETS) {
    let err = '', title = '', text = '', ress = '';
    const p = port++;

    // 每个站点独立 Chrome 实例，保证互不污染
    try {
      await session(async (api) => {
        try {
          await api.goto(t.url, t.wait);
          await api.evaluate('(() => { const s=document.scrollingElement||document.documentElement; s.scrollTop=s.scrollHeight; return 1; })()');
          await sleep(3000);
        } catch (e) { err = e.message; }
        try { title = await api.evaluate('document.title'); } catch (e) { if (!err) err = e.message; }
        try { text = await api.evaluate('(document.body ? document.body.innerText : "").slice(0, 6000)'); } catch (e) {}
        try { ress = await api.evaluate(RES_EXPR); } catch (e) {}
      }, { port: p, log, network: false });
    } catch (e) { err = err || ('session-fail: ' + e.message); }

    fs.writeFileSync(path.join(OUTDIR, t.key + '.txt'), (text || ''), 'utf8');
    log('KEY', t.key, '| name', t.name, '| title', JSON.stringify(title), '| textLen', (text || '').length, err ? ('| ERR ' + err) : '');
    log('    head:', JSON.stringify(String(text || '').replace(/\s+/g, ' ').slice(0, 180)));
    log('    req:', String(ress).slice(0, 400));
    await sleep(800);
  }
  log('== done ==');
})()
  .then(() => log('EXIT OK'))
  .catch((e) => log('ERROR', e && e.stack ? e.stack : e));
