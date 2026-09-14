// 查询竞品 App 的 App Store ID
const fs = require('fs');
const path = require('path');
const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const OUT = path.join(ROOT, 'scripts', 'app_lookup.txt');

const TERMS = ['Kimi', '腾讯元宝', '文心一言', '通义千问', '智谱清言', '讯飞星火'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

(async () => {
  const lines = [];
  for (const t of TERMS) {
    try {
      const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(t) + '&country=cn&entity=software&limit=5';
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const j = await res.json();
      const rows = (j.results || []).map((r) => r.trackName + ' | id=' + r.trackId + ' | rating=' + Math.round(r.averageUserRating * 100) / 100 + ' | n=' + r.userRatingCount);
      lines.push('QUERY ' + t);
      rows.forEach((r) => lines.push('   ' + r));
    } catch (e) { lines.push('QUERY ' + t + ' ERROR ' + e.message); }
  }
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
})();
