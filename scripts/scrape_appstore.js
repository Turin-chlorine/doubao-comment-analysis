// 通过 Chrome DevTools Protocol 抓取 App Store 评论
// 设计要点：所有输出由脚本自己写入文件，不依赖控制台 stdout
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const CHROME = 'C:\\Users\\10279\\.agent-browser\\browsers\\chrome-153.0.8010.36\\chrome.exe';
const PORT = 9223;
const PROFILE = 'C:\\Users\\10279\\.agent-browser\\tmp_prof2';
const TARGET_URL = 'https://apps.apple.com/cn/app/id6459478672?see-all=reviews&platform=iphone';

const LOG = path.join(ROOT, 'scripts', 'scrape.log');
const OUT_JSON = path.join(ROOT, 'data', 'appstore_api_raw.json');
const OUT_DOM = path.join(ROOT, 'data', 'appstore_dom.txt');

const logs = [];
function log() {
  logs.push(Array.prototype.map.call(arguments, String).join(' '));
  try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws = null;
let chrome = null;

async function main() {
  log('== start ==', new Date().toISOString(), 'node', process.version, 'WebSocket:', typeof WebSocket);
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

  chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--lang=zh-CN',
    'about:blank',
  ], { stdio: 'ignore' });
  log('chrome spawned pid', chrome.pid);

  let pageWs = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { pageWs = page.webSocketDebuggerUrl; log('cdp page found at attempt', i); break; }
    } catch (e) {}
    await sleep(500);
  }
  if (!pageWs) { log('FATAL: no cdp page'); return; }

  ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
  log('ws connected');

  let seq = 0;
  const pending = new Map();
  const captured = [];
  const inflight = [];

  function send(method, params) {
    params = params || {};
    return new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
      else p.res(msg.result);
      return;
    }
    if (msg.method === 'Network.responseReceived') {
      const resp = msg.params.response;
      if (/amp-api|reviews/i.test(resp.url) && /json/i.test(resp.mimeType || '')) {
        const rid = msg.params.requestId;
        const job = (async () => {
          try {
            const b = await send('Network.getResponseBody', { requestId: rid });
            captured.push({ url: resp.url, status: resp.status, body: b.body });
            log('captured', resp.status, resp.url.slice(0, 150), 'bytes', b.body.length);
          } catch (e) {
            log('body-fail', resp.url.slice(0, 150), e.message);
          }
        })();
        inflight.push(job);
      }
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable', { maxResourceBufferSize: 100 * 1024 * 1024 });

  log('navigating to target');
  await send('Page.navigate', { url: TARGET_URL });
  await sleep(9000);

  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : undefined;
  }

  log('title:', await evaluate('document.title'));
  log('url:', await evaluate('location.href'));

  const scrollExpr = `(() => {
    let scrolled = 0;
    const s = document.scrollingElement || document.documentElement;
    s.scrollTop = s.scrollHeight; scrolled++;
    document.querySelectorAll('div,section,main').forEach(d => {
      const st = getComputedStyle(d);
      if (d.scrollHeight > d.clientHeight + 200 && (st.overflowY === 'auto' || st.overflowY === 'scroll')) {
        d.scrollTop = d.scrollHeight; scrolled++;
      }
    });
    return scrolled + '|' + document.body.innerText.length;
  })()`;

  for (let i = 0; i < 40; i++) {
    let info = '';
    try { info = await evaluate(scrollExpr); } catch (e) { info = 'err:' + e.message; }
    log('scroll round', i, info);
    await sleep(1500);
  }

  await Promise.all(inflight).catch(() => {});
  await sleep(1500);

  try {
    const text = await evaluate('document.body.innerText');
    fs.writeFileSync(OUT_DOM, text || '', 'utf8');
    log('dom text length', (text || '').length);
  } catch (e) { log('dom extract fail', e.message); }

  fs.writeFileSync(OUT_JSON, JSON.stringify(captured, null, 2), 'utf8');
  log('captured responses:', captured.length);

  const finalUrl = await evaluate('location.href');
  log('final url', finalUrl);
  log('== done ==');
}

main()
  .catch((e) => { log('ERROR', e && e.stack ? e.stack : e); })
  .finally(async () => {
    try { if (ws) ws.close(); } catch (e) {}
    try { if (chrome) chrome.kill(); } catch (e) {}
    log('== exited ==');
  });
