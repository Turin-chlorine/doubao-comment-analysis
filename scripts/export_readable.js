// 导出可读文本，供 AI 阅读与编码
const fs = require('fs');
const path = require('path');
const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const DATA = path.join(ROOT, 'data');

const all = JSON.parse(fs.readFileSync(path.join(DATA, 'comments.json'), 'utf8'));
const target = all.filter((r) => r.is_target_product === 1);
const comp = all.filter((r) => r.is_target_product !== 1);

function fmt(list, maxLen) {
  return list.map((r) => {
    let c = String(r.content || '').replace(/\s+/g, ' ').trim();
    if (maxLen && c.length > maxLen) c = c.slice(0, maxLen) + '…';
    return r.review_id + ' | ' + r.product_name + ' | ' + r.rating + '★ | ' + r.publish_date + ' | ' + (r.title ? ('【' + r.title + '】') : '') + c;
  }).join('\n');
}

target.sort((a, b) => String(b.publish_date).localeCompare(String(a.publish_date)));
comp.sort((a, b) => String(b.publish_date).localeCompare(String(a.publish_date)));

fs.writeFileSync(path.join(DATA, 'read_target.txt'), fmt(target, 0), 'utf8');
fs.writeFileSync(path.join(DATA, 'read_competitor.txt'), fmt(comp, 260), 'utf8');
fs.writeFileSync(path.join(ROOT, 'scripts', 'export.log'), 'target ' + target.length + ' comp ' + comp.length
  + '\ntarget chars ' + fmt(target, 0).length + '\ncomp chars ' + fmt(comp, 260).length, 'utf8');
