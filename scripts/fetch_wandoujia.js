// 豌豆荚（安卓应用商店）豆包评论爬虫
// 页面结构：li.normal-li -> span.name / p.cmt-content / p.cmt-time / span.cmt-recommend
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const OUT = path.join(ROOT, 'data', 'wandoujia_reviews.json');
const LOG = path.join(ROOT, 'scripts', 'wandoujia.log');
const BASE = 'https://www.wandoujia.com/apps/com.larus.nova/comment?page=';

const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function stripTags(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pick(block, re) {
  const m = block.match(re);
  return m ? stripTags(m[1]) : '';
}

function parsePage(html) {
  const out = [];
  const liRe = /<li class="normal-li">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const b = m[1];
    const content = pick(b, /<p class="cmt-content">\s*<span>([\s\S]*?)<\/span>/);
    if (!content) continue;
    const timeRaw = pick(b, /<p class="cmt-time">\s*([\d]{4}-[\d]{2}-[\d]{2} [\d]{2}:[\d]{2})/);
    const idMatch = b.match(/data-commentId="(\d+)"/);
    out.push({
      source: '豌豆荚（安卓）',
      comment_id: idMatch ? idMatch[1] : '',
      title: '',
      content,
      rating: /cmt-recommend">([^<]*)</.test(b) ? (/cmt-recommend">([^<]*)</.exec(b)[1] === '推荐' ? 5 : 1) : null,
      recommend_raw: pick(b, /<span class="cmt-recommend">([^<]*)<\/span>/),
      praise: Number(pick(b, /<span class="praise[^>]*>(\d+)<\/span>/) || 0),
      publish_date: timeRaw,
      author: pick(b, /<span class="name">([\s\S]*?)<\/span>/),
      location: pick(b, /<span class="cmt-ip">([^<]*)<\/span>/),
    });
  }
  return out;
}

async function main() {
  log('== wandoujia start ==', new Date().toISOString());
  const all = new Map();
  let emptyStreak = 0;

  for (let p = 1; p <= 15; p++) {
    let html = '';
    try {
      const res = await fetch(BASE + p, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      const buf = Buffer.from(await res.arrayBuffer());
      html = new TextDecoder('utf-8').decode(buf);
    } catch (e) { log('fetch-error page', p, e.message); continue; }

    const items = parsePage(html);
    let added = 0;
    for (const it of items) {
      const key = it.comment_id || (it.author + '|' + it.publish_date + '|' + it.content.slice(0, 30));
      if (!all.has(key)) { all.set(key, it); added++; }
    }
    log('page', p, 'htmlLen', html.length, 'parsed', items.length, 'new', added, 'total', all.size);
    if (items.length === 0) { emptyStreak++; if (emptyStreak >= 2) { log('two empty pages, stop'); break; } }
    else emptyStreak = 0;
    await sleep(500);
  }

  const arr = Array.from(all.values());
  arr.sort((a, b) => String(b.publish_date).localeCompare(String(a.publish_date)));
  arr.forEach((r, i) => { r.review_id = 'WDJ_' + String(i + 1).padStart(3, '0'); });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(arr, null, 2), 'utf8');

  const d = arr.map((r) => r.publish_date).filter(Boolean).sort();
  log('== TOTAL ==', arr.length);
  log('date range', d[0], '->', d[d.length - 1]);
  log('== wandoujia done ==');
}

main().catch((e) => log('FATAL', e && e.stack ? e.stack : e));
