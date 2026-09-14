// 黑猫投诉二次尝试：先访问首页暖 Cookie，再进搜索页，并记录全部 XHR
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const OUTDIR = path.join(ROOT, 'data', 'heimao');
const LOG = path.join(ROOT, 'scripts', 'heimao.log');
const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }

const KW = encodeURIComponent('豆包');

session(async (api) => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const records = [];
  const jobs = [];
  api.on((msg) => {
    if (msg.method !== 'Network.responseReceived') return;
    const p = msg.params;
    if (p.type !== 'XHR' && p.type !== 'Fetch') return;
    const rec = { idx: records.length, url: p.response.url, status: p.response.status, mime: p.response.mimeType };
    records.push(rec);
    if (/json/i.test(p.response.mimeType || '')) {
      jobs.push((async () => {
        try {
          const b = await api.send('Network.getResponseBody', { requestId: p.requestId });
          if (b && b.body) {
            const f = 'body_' + String(rec.idx).padStart(3, '0') + '.json';
            fs.writeFileSync(path.join(OUTDIR, f), b.body, 'utf8');
            rec.bodyFile = f; rec.bodyLen = b.body.length;
          }
        } catch (e) { rec.err = e.message; }
      })());
    }
  });

  log('== warm up homepage ==');
  await api.goto('https://tousu.sina.com.cn/', 9000);
  log('home title', await api.evaluate('document.title'), 'textLen', await api.evaluate('document.body.innerText.length'));
  log('cookies', await api.evaluate('document.cookie'));

  log('== search page ==');
  await api.goto('https://tousu.sina.com.cn/search/?keywords=' + KW, 14000);
  log('title', await api.evaluate('document.title'));
  log('textLen', await api.evaluate('document.body.innerText.length'));

  for (let i = 0; i < 4; i++) {
    await api.evaluate('(() => { const s=document.scrollingElement||document.documentElement; s.scrollTop=s.scrollHeight; return 1; })()');
    await sleep(2500);
    log('scroll', i, 'textLen', await api.evaluate('document.body.innerText.length'));
  }

  await sleep(3000);
  await Promise.all(jobs).catch(() => {});

  const text = await api.text();
  fs.writeFileSync(path.join(OUTDIR, 'page.txt'), text || '', 'utf8');
  fs.writeFileSync(path.join(OUTDIR, 'requests.json'), JSON.stringify(records, null, 2), 'utf8');
  log('xhr count', records.length);
  records.slice(0, 30).forEach((r) => log('  ', r.status, (r.url || '').slice(0, 170), r.bodyFile || '-', r.bodyLen || ''));
  log('== done ==');
}, { port: 9241, log }).catch((e) => log('ERROR', e && e.stack ? e.stack : e));
