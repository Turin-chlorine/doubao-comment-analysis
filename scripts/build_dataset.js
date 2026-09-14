// P1 产出：把各渠道原始数据合并为统一数据集
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const DATA = path.join(ROOT, 'data');
const COLLECT_DATE = '2026-09-15';

const KEY_PREFIX = {
  doubao: 'AS',
  doubao_edu: 'AS_EDU',
  doubao_ime: 'AS_IME',
  deepseek: 'AS_DS',
  qwen: 'AS_QW',
  kimi: 'AS_KM',
  yuanbao: 'AS_YB',
  wenxin: 'AS_WX',
};

function loadJSON(f) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return null; }
}

function csvCell(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, ' \\n ') + '"';
}

const rows = [];

// --- App Store 系列 ---
const multi = loadJSON('appstore_multi.json') || {};
for (const key of Object.keys(multi)) {
  const prefix = KEY_PREFIX[key] || ('AS_' + key.toUpperCase());
  const arr = multi[key].slice().sort((a, b) => String(b.publish_date).localeCompare(String(a.publish_date)));
  arr.forEach((r, i) => {
    rows.push({
      review_id: prefix + '_' + String(i + 1).padStart(3, '0'),
      source: 'App Store 中国区',
      product_name: r.app_label,
      is_target_product: r.is_target_product ? 1 : 0,
      collect_date: COLLECT_DATE,
      publish_date: String(r.publish_date || '').slice(0, 10),
      rating: r.rating === undefined || r.rating === null ? 'NA' : r.rating,
      author: r.author || '',
      title: r.title || '',
      content: String(r.content || '').replace(/\s+$/, ''),
      app_version: r.app_version || 'NA',
      device: 'iPhone/iOS',
      url: 'https://apps.apple.com/cn/app/id' + r.app_id,
      note: 'Apple 遗留评论接口 userReviewsRow（sort=' + r.sort_channel + '，page=1）',
      _raw_id: r.review_id_internal,
    });
  });
}

// --- 豌豆荚（安卓） ---
const wdj = loadJSON('wandoujia_reviews.json') || [];
wdj.sort((a, b) => String(b.publish_date).localeCompare(String(a.publish_date)));
wdj.forEach((r, i) => {
  rows.push({
    review_id: 'WDJ_' + String(i + 1).padStart(3, '0'),
    source: '豌豆荚（安卓应用商店）',
    product_name: '豆包（安卓版）',
    is_target_product: 1,
    collect_date: COLLECT_DATE,
    publish_date: String(r.publish_date || '').slice(0, 10),
    rating: r.recommend_raw === '推荐' ? 5 : 1,
    author: r.author || '',
    title: '',
    content: String(r.content || '').replace(/\s+$/, ''),
    app_version: 'NA',
    device: 'Android',
    url: 'https://www.wandoujia.com/apps/com.larus.nova/comment',
    note: '页面服务端渲染，仅首屏 10 条；用户仅可选"推荐/不推荐"，评分按 5/1 折算',
    _raw_id: r.comment_id,
  });
});

// 去重（同源同内容）
const seen = new Set();
const dedup = [];
for (const r of rows) {
  const k = r.source + '|' + r.content.slice(0, 60);
  if (seen.has(k)) continue;
  seen.add(k);
  dedup.push(r);
}

const cols = ['review_id', 'source', 'product_name', 'is_target_product', 'collect_date', 'publish_date', 'rating', 'author', 'title', 'content', 'app_version', 'device', 'url', 'note'];
const csv = [cols.join(',')].concat(dedup.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\r\n');
fs.writeFileSync(path.join(DATA, 'comments.csv'), '\ufeff' + csv, 'utf8');
fs.writeFileSync(path.join(DATA, 'comments.json'), JSON.stringify(dedup, null, 2), 'utf8');

// 统计
const lines = [];
lines.push('TOTAL ' + dedup.length);
const bySrc = {};
const byProd = {};
const byRating = {};
dedup.forEach((r) => {
  bySrc[r.source] = (bySrc[r.source] || 0) + 1;
  byProd[r.product_name] = (byProd[r.product_name] || 0) + 1;
  byRating[r.rating] = (byRating[r.rating] || 0) + 1;
});
lines.push('BY SOURCE ' + JSON.stringify(bySrc, null, 1));
lines.push('BY PRODUCT ' + JSON.stringify(byProd, null, 1));
lines.push('BY RATING ' + JSON.stringify(byRating, null, 1));
const target = dedup.filter((r) => r.is_target_product === 1);
lines.push('TARGET PRODUCT REVIEWS ' + target.length);
fs.writeFileSync(path.join(ROOT, 'scripts', 'dataset.log'), lines.join('\n'), 'utf8');
