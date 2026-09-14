// App Store 多 App / 多排序变体采集
// 目的：1) 用不同 sort 参数榨出更多豆包评论  2) 同一接口采集竞品评论用于对照
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const OUT = path.join(ROOT, 'data', 'appstore_multi.json');
const LOG = path.join(ROOT, 'scripts', 'appstore_multi.log');

const logs = [];
function log() { logs.push(Array.prototype.map.call(arguments, String).join(' ')); try { fs.writeFileSync(LOG, logs.join('\n'), 'utf8'); } catch (e) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const APPS = [
  { key: 'doubao', label: '豆包 - 随时帮忙的 AI 助手', id: '6459478672', isTarget: true },
  { key: 'doubao_edu', label: '豆包爱学（豆包旗下）', id: '6469102455', isTarget: true },
  { key: 'doubao_ime', label: '豆包输入法', id: '6752316550', isTarget: true },
  { key: 'deepseek', label: 'DeepSeek - AI 智能助手', id: '6737597349', isTarget: false },
  { key: 'qwen', label: '千问 - 阿里AI助手', id: '6466733523', isTarget: false },
  { key: 'kimi', label: 'Kimi', id: '6474233312', isTarget: false },
  { key: 'yuanbao', label: '元宝-腾讯全能AI助手', id: '6480446430', isTarget: false },
  { key: 'wenxin', label: '文心 - 百度旗下全能AI助手', id: '6446882473', isTarget: false },
];

const SORTS = [1, 2, 3, 4, 5, 6, 7, 8];

async function fetchRows(appId, sort, page) {
  const url = 'https://itunes.apple.com/WebObjects/MZStore.woa/wa/userReviewsRow'
    + '?id=' + appId + '&displayable-kind=11&page=' + page + '&sort=' + sort + '&appVersion=all';
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'X-Apple-Store-Front': '143465-19,29' },
  });
  const text = await res.text();
  try { return JSON.parse(text).userReviewList || []; } catch (e) { return []; }
}

async function main() {
  log('== start ==', new Date().toISOString());
  const result = {};

  for (const app of APPS) {
    const map = new Map();
    for (const sort of SORTS) {
      let list = [];
      try { list = await fetchRows(app.id, sort, 1); } catch (e) { log('err', app.key, sort, e.message); }
      let added = 0;
      for (const r of list) {
        const id = String(r.userReviewId || '');
        if (id && !map.has(id)) {
          map.set(id, {
            review_id_internal: id,
            app_key: app.key,
            app_label: app.label,
            app_id: app.id,
            is_target_product: app.isTarget,
            sort_channel: sort,
            title: r.title || '',
            content: r.body || '',
            rating: r.rating,
            publish_date: r.date || '',
            author: r.name || '',
            vote_count: r.voteCount,
          });
          added++;
        }
      }
      log('app', app.key, 'sort', sort, 'got', list.length, 'new', added, 'total', map.size);
      await sleep(300);
    }
    result[app.key] = Array.from(map.values());
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  Object.keys(result).forEach((k) => {
    const arr = result[k];
    const d = arr.map((r) => (r.publish_date || '').slice(0, 10)).filter(Boolean).sort();
    log('SUMMARY', k, arr.length, d[0] || '-', '->', d[d.length - 1] || '-');
  });
  log('== done ==');
}

main().catch((e) => log('FATAL', e && e.stack ? e.stack : e));
