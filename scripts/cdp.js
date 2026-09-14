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
  log('cdp page found', String(pageWs).slice(0, 72));

  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  log('ws open');

  let seq = 0;
  const pending = new Map();
  const listeners = [];

  function send(method, params) {
    params = params || {};
    return new Promise((res, rej) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error('TIMEOUT waiting for ' + method + ' (ws state=' + ws.readyState + ')'));
      }, 15000);
      pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
      try { ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); pending.delete(id); rej(e); }
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

  ws.onerror = (e) => log('ws error event', (e && e.message) || '');
  ws.onclose = (e) => log('ws closed', 'code=' + (e && e.code));

  // 不再 enable Page / Runtime 域：这两个域只为「接收事件」而存在，
  // 而 Page.navigate 与 Runtime.evaluate 本身并不依赖 enable。
  // 实测副作用：部分站点会推送超大事件（如巨量 console 输出），触发 undici
  // "Max decompressed message size exceeded" 并强制断开 WebSocket（code=1006），
  // 该会话后续所有命令随即全部超时 —— 这是社交渠道探测静默失败的真正原因。
  log('domains: Page/Runtime enable skipped by design');
  if (opts.network === false) {
    log('  Network.enable skipped (opts.network=false)');
  } else {
    await send('Network.enable', { maxResourceBufferSize: 200 * 1024 * 1024 });
    log('  Network.enable ok');
  }

  const api = {
    send,
    // 注册事件监听，返回取消函数（此前返回的是数组长度，调用 off() 会抛异常）
    on: (fn) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
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
