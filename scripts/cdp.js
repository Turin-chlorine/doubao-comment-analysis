// 可复用的 CDP 会话封装：驱动无头 Chrome，输出全部由调用方写文件
// 目的：绕开控制台输出通道的限制，并避免 agent-browser 常驻进程带来的句柄问题
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const CHROME = 'C:\\Users\\10279\\.agent-browser\\browsers\\chrome-153.0.8010.36\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(handler, opts) {
  opts = opts || {};
  const port = opts.port || 9224;
  const profile = opts.profile || 'C:\\Users\\10279\\.agent-browser\\tmp_prof_' + port;
  const log = opts.log || (() => {});

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--lang=zh-CN',
    'about:blank',
  ], { stdio: 'ignore' });
  log('chrome pid', chrome.pid);

  let pageWs = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { pageWs = page.webSocketDebuggerUrl; break; }
    } catch (e) {}
    await sleep(500);
  }
  if (!pageWs) { chrome.kill(); throw new Error('no cdp page'); }

  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });

  let seq = 0;
  const pending = new Map();
  const listeners = [];

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
    listeners.forEach((fn) => { try { fn(msg); } catch (e) {} });
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable', { maxResourceBufferSize: 200 * 1024 * 1024 });

  const api = {
    send,
    on: (fn) => listeners.push(fn),
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('eval-exception: ' + JSON.stringify(r.exceptionDetails.text || ''));
      return r && r.result ? r.result.value : undefined;
    },
    async goto(url, waitMs) {
      await send('Page.navigate', { url });
      await sleep(waitMs === undefined ? 6000 : waitMs);
      return api.evaluate('location.href');
    },
    async text() { return api.evaluate('document.body ? document.body.innerText : ""'); },
    async html() { return api.evaluate('document.documentElement.outerHTML'); },
    setUA(ua) { return send('Network.setUserAgentOverride', { userAgent: ua }); },
  };

  try {
    return await handler(api, log);
  } finally {
    try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
  }
}

module.exports = { session, sleep, ROOT };
