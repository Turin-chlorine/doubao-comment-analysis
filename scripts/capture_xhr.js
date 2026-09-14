// 通用 XHR 抓取器：打开目标页面，记录所有请求，并保存 JSON 响应体
// 用途：让页面自己去调用（含签名/鉴权）接口，我们把真实接口和响应截获下来
const fs = require('fs');
const path = require('path');
const { session, sleep, ROOT } = require('./cdp');

const SITES = {
  heimao: {
    url: 'https://tousu.sina.com.cn/search/?keywords=%E8%B1%86%E5%8C%85',
    waitMs: 10000,
    clickTexts: ['加载更多', '查看更多', '下一页'],
    scrollRounds: 3,
  },
  wdj: {
    url: 'https://www.wandoujia.com/apps/com.larus.nova/comment',
    waitMs: 8000,
    clickTexts: ['查看更多评论', '加载更多', '查看更多', '更多评论', '下一页'],
    scrollRounds: 4,
  },
  bili: {
    url: 'https://search.bilibili.com/all?keyword=%E8%B1%86%E5%8C%85',
    waitMs: 10000,
    clickTexts: [],
    scrollRounds: 3,
  },
  mi: {
    url: 'https://app.mi.com/details?id=com.larus.nova',
    waitMs: 10000,
    clickTexts: ['查看全部评论', '全部评论', '查看更多', '更多'],
    scrollRounds: 5,
  },
  sjqq: {
    url: 'https://sj.qq.com/appdetail/com.larus.nova',
    waitMs: 12000,
    clickTexts: ['全部评论', '查看更多评论', '查看全部', '评论'],
    scrollRounds: 6,
  },
  huawei: {
    url: 'https://appgallery.huawei.com/app/C105372731',
    waitMs: 12000,
    clickTexts: ['全部评论', '查看更多', '更多评论'],
    scrollRounds: 5,
  },
};

const siteKey = process.argv[2] || 'heimao';
const cfg = SITES[siteKey];
const OUTDIR = path.join(ROOT, 'data', 'xhr_' + siteKey);
const LOG = path.join(ROOT, 'scripts', 'xhr_' + siteKey + '.log');

const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }

if (!cfg) { log('unknown site', siteKey); process.exit(1); }

session(async (api) => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const records = [];
  const bodyJobs = [];
  let bodyIdx = 0;

  api.on((msg) => {
    if (msg.method !== 'Network.responseReceived') return;
    const p = msg.params;
    const r = p.response;
    const type = p.type;
    if (type !== 'XHR' && type !== 'Fetch') return;
    const rec = { idx: records.length, url: r.url, status: r.status, mime: r.mimeType, ctype: type };
    records.push(rec);
    if (/json|javascript|text/i.test(r.mimeType || '')) {
      const job = (async () => {
        try {
          const b = await api.send('Network.getResponseBody', { requestId: p.requestId });
          if (!b || !b.body) return;
          if (b.body.length > 4 * 1024 * 1024) { rec.bodySkipped = true; return; }
          const f = path.join(OUTDIR, String(rec.idx).padStart(3, '0') + '.txt');
          fs.writeFileSync(f, b.body, 'utf8');
          rec.bodyFile = path.basename(f);
          rec.bodyLen = b.body.length;
        } catch (e) { rec.bodyError = e.message; }
      })();
      bodyJobs.push(job);
    }
  });

  log('== site', siteKey, 'goto', cfg.url);
  await api.goto(cfg.url, cfg.waitMs);
  log('title', await api.evaluate('document.title'));
  log('url', await api.evaluate('location.href'));

  for (let round = 0; round < cfg.scrollRounds; round++) {
    await api.evaluate(`(() => {
      const s = document.scrollingElement || document.documentElement;
      s.scrollTop = s.scrollHeight;
      document.querySelectorAll('div,section,main,ul').forEach(d => {
        const st = getComputedStyle(d);
        if (d.scrollHeight > d.clientHeight + 150 && (st.overflowY==='auto'||st.overflowY==='scroll')) d.scrollTop = d.scrollHeight;
      });
      return document.body.innerText.length;
    })()`);
    await sleep(2200);
    log('scroll round', round, 'textLen', await api.evaluate('document.body.innerText.length'));
  }

  for (const t of cfg.clickTexts) {
    const clicked = await api.evaluate(`(() => {
      const els = Array.from(document.querySelectorAll('a,button,div,span'));
      const el = els.find(e => (e.innerText||'').trim() === ${JSON.stringify(t)} || (e.innerText||'').trim() === ${JSON.stringify(t + ' >')});
      if (el) { el.click(); return (el.tagName + ':' + (el.innerText||'').trim().slice(0,20)); }
      return null;
    })()`);
    log('click', JSON.stringify(t), '=>', clicked);
    if (clicked) await sleep(3000);
  }

  await sleep(3000);
  await Promise.all(bodyJobs).catch(() => {});

  const text = await api.text();
  fs.writeFileSync(path.join(OUTDIR, 'page.txt'), text || '', 'utf8');
  fs.writeFileSync(path.join(OUTDIR, 'requests.json'), JSON.stringify(records, null, 2), 'utf8');
  log('total xhr/fetch records', records.length, 'pageText', (text || '').length);
  const interesting = records.filter((r) => /comment|search|review|list|api/i.test(r.url));
  log('--- candidate endpoints ---');
  interesting.slice(0, 40).forEach((r) => log('  ', r.status, r.ctype, (r.url || '').slice(0, 200), 'body:', r.bodyFile || '-', r.bodyLen || ''));
  log('== done ==');
}, { port: 9230 + (siteKey.length % 7), log }).catch((e) => log('ERROR', e && e.stack ? e.stack : e));
