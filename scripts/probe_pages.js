// 探测 App Store 评论页的翻页方式，并批量抓取多页评论
const fs = require('fs');
const path = require('path');
const { session, ROOT } = require('./cdp');

const OUTDIR = path.join(ROOT, 'data', 'appstore_pages');
const LOG = path.join(ROOT, 'scripts', 'pages.log');
const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }

const BASE = 'https://apps.apple.com/cn/app/id6459478672?see-all=reviews&platform=iphone';

function sig(text) {
  const lines = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const i = lines.findIndex((l) => l === '评分及评论');
  return lines.slice(i + 1, i + 8).join('|');
}

session(async (api) => {
  fs.mkdirSync(OUTDIR, { recursive: true });

  // 先看第一页的完整 HTML，用于分析分页链路
  await api.goto(BASE, 9000);
  log('title', await api.evaluate('document.title'));
  const html1 = await api.html();
  fs.writeFileSync(path.join(OUTDIR, 'page_01.html'), html1, 'utf8');
  const t1 = await api.text();
  fs.writeFileSync(path.join(OUTDIR, 'page_01.txt'), t1, 'utf8');
  log('page01 html', html1.length, 'text', t1.length, 'sig', sig(t1).slice(0, 80));

  // 找出页面里所有链接与分页相关元素
  const hrefs = await api.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.getAttribute('href')).filter(Boolean).slice(0,80))`);
  log('HREFS', hrefs);

  // 找出所有可滚动容器
  const scrollables = await api.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('*')).filter(e=>e.scrollHeight>e.clientHeight+100).map(e=>e.tagName+'.'+(e.className||'').toString().slice(0,60)+' h='+e.scrollHeight).slice(0,20))`);
  log('SCROLLABLES', scrollables);

  // 试几种候选翻页 URL
  const candidates = [
    BASE + '&page=2',
    BASE + '&page=3',
    BASE.replace('?see-all=reviews&platform=iphone', '') + '?see-all=reviews&page=2',
  ];
  const prevSig = sig(t1);
  for (let i = 0; i < candidates.length; i++) {
    await api.goto(candidates[i], 8000);
    const t = await api.text();
    const s = sig(t);
    log('CAND', i, 'len', t.length, 'sameAsP1', s === prevSig, 'sig', s.slice(0, 90));
    fs.writeFileSync(path.join(OUTDIR, 'cand_' + i + '.txt'), t, 'utf8');
  }
  log('== probe done ==');
}, { port: 9225, log }).catch((e) => log('ERROR', e && e.stack ? e.stack : e));
