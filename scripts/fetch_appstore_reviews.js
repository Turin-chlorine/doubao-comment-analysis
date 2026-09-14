// 豆包 App Store 中国区评论爬虫
// 入口：苹果遗留接口 itunes.apple.com/WebObjects/MZStore.woa/wa/userReviewsRow
// 该接口返回结构化 JSON（userReviewList），含 评论ID / 正文 / 评分 / 日期 / 昵称 / 标题
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const APP_ID = '6459478672';
const OUT = path.join(ROOT, 'data', 'appstore_reviews.json');
const LOG = path.join(ROOT, 'scripts', 'crawler.log');

const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function buildUrl(page, sort) {
  return 'https://itunes.apple.com/WebObjects/MZStore.woa/wa/userReviewsRow'
    + '?id=' + APP_ID
    + '&displayable-kind=11'
    + '&page=' + page
    + '&sort=' + sort
    + '&appVersion=all';
}

async function fetchPage(page, sort) {
  const res = await fetch(buildUrl(page, sort), {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'X-Apple-Store-Front': '143465-19,29',
      'X-Apple-I-MD-LU': '',
    },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { log('parse-fail', 'page', page, 'sort', sort, 'len', text.length, 'head', text.slice(0, 120)); return []; }
  const list = json.userReviewList || [];
  return list;
}

async function main() {
  log('== crawler start ==', new Date().toISOString());
  const all = new Map();
  const plans = [];
  // sort=4 最新；sort=1 最有帮助
  for (let p = 1; p <= 30; p++) plans.push({ sort: 4, page: p });
  for (let p = 1; p <= 15; p++) plans.push({ sort: 1, page: p });

  for (const plan of plans) {
    let list = [];
    try { list = await fetchPage(plan.page, plan.sort); }
    catch (e) { log('fetch-error', 'sort', plan.sort, 'page', plan.page, e.message); await sleep(800); continue; }

    if (!list.length) {
      log('EMPTY sort', plan.sort, 'page', plan.page, '-> stop this sort');
      // 该排序已翻到底，跳过剩余页
      for (let i = plans.length - 1; i >= 0; i--) {
        if (plans[i].sort === plan.sort && plans[i].page > plan.page) plans.splice(i, 1);
      }
      continue;
    }

    let added = 0;
    for (const r of list) {
      const id = String(r.userReviewId || '');
      if (!id) continue;
      if (!all.has(id)) {
        all.set(id, {
          review_id_internal: id,
          source: 'App Store 中国区',
          sort_channel: plan.sort === 4 ? 'latest' : 'most_helpful',
          page: plan.page,
          title: r.title || '',
          content: r.body || '',
          rating: r.rating,
          publish_date: r.date || '',
          author: r.name || '',
          vote_count: r.voteCount,
          app_version: r.appVersion || (r.version) || '',
        });
        added++;
      }
    }
    log('sort', plan.sort, 'page', plan.page, 'got', list.length, 'new', added, 'total', all.size);
    await sleep(350 + Math.floor(Math.random() * 400));
  }

  const arr = Array.from(all.values());
  arr.sort((a, b) => String(b.publish_date).localeCompare(String(a.publish_date)));
  arr.forEach((r, i) => { r.review_id = 'AS_' + String(i + 1).padStart(3, '0'); });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(arr, null, 2), 'utf8');

  const dates = arr.map((r) => (r.publish_date || '').slice(0, 10)).filter(Boolean).sort();
  log('== TOTAL ==', arr.length);
  log('date range', dates[0], '->', dates[dates.length - 1]);
  const byRating = {};
  arr.forEach((r) => { byRating[r.rating] = (byRating[r.rating] || 0) + 1; });
  log('rating dist', JSON.stringify(byRating));
  log('== crawler done ==');
}

main().catch((e) => log('FATAL', e && e.stack ? e.stack : e));
