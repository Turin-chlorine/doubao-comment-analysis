// 社交媒体渠道可行性测试：贴吧 / 知乎 / B站
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const OUTDIR = path.join(ROOT, 'data', 'social_test');
const LOG = path.join(ROOT, 'scripts', 'social.log');
const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }

const KW = encodeURIComponent('豆包');
process.on('uncaughtException', (e) => log('UNCAUGHT', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => log('UNHANDLED', (e && e.stack) ? e.stack : e));
const TARGETS = [
  { key: 'tieba_list', url: 'https://tieba.baidu.com/f?kw=' + KW + '&ie=utf-8', wait: 10000 },
  { key: 'zhihu_search', url: 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent('豆包 缺点'), wait: 12000 },
  { key: 'bili_search', url: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent('豆包 AI 吐槽'), wait: 12000 },
];

session(async (api) => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  for (const t of TARGETS) {
    const recs = [];
    const off = api.on((msg) => {
      if (msg.method === 'Network.responseReceived' && (msg.params.type === 'XHR' || msg.params.type === 'Fetch')) {
        if (/json/i.test(msg.params.response.mimeType || '')) recs.push({ url: msg.params.response.url, status: msg.params.response.status });
      }
    });

    let err = '';
    try {
      await api.goto(t.url, t.wait);
      await api.evaluate('(() => { const s=document.scrollingElement||document.documentElement; s.scrollTop=s.scrollHeight; return 1; })()');
      await sleep(3000);
    } catch (e) { err = e.message; }

    let title = '', text = '';
    try { title = await api.evaluate('document.title'); } catch (e) {}
    try { text = await api.text(); } catch (e) {}
    fs.writeFileSync(path.join(OUTDIR, t.key + '.txt'), (text || ''), 'utf8');
    log('KEY', t.key, 'title', title, 'textLen', (text || '').length, 'xhrJSON', recs.length, err ? ('ERR ' + err) : '');
    recs.slice(0, 8).forEach((r) => log('   ', r.status, r.url.slice(0, 150)));
    await sleep(1500);
  }
  log('== done ==');
}, { port: 9243, log }).catch((e) => log('ERROR', e && e.stack ? e.stack : e));
