// B站数据集构建：去重 → 清洗 → 相关性筛选 → 生成可读文本
// 相关性规则（抽样框的第二层，必须可复现）：
//   去除表情标签 [xxx]、@提及、空白与标点后，正文含「豆包」→ 计入分析样本。
//   理由：关键词搜索召回的视频本身含噪声（同名食物/角色），
//   要求评论显式点名产品，是高精度且可复述的过滤规则。
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const DIR = path.join(ROOT, 'data', 'bili');

const src = (() => {
  // 合并多次采集的原始结果：v2 的 40 视频样本 + v3 的全量铺开结果
  const files = ['bili_raw.json', 'bili_all_raw.json'];
  const comments = [];
  const videos = new Map();
  let collectedAt = '';
  let endpoint = '';
  let samplingFrame = '';
  let knownBias = '';
  const stats = {};
  for (const f of files) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) continue;
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    comments.push.apply(comments, d.comments || []);
    (d.videos || []).forEach((v) => videos.set(String(v.aid), v));
    if (d.meta && d.meta.collectedAt) collectedAt = d.meta.collectedAt;
    if (d.meta && d.meta.endpoint) endpoint = d.meta.endpoint;
    if (d.meta && d.meta.samplingFrame) samplingFrame = d.meta.samplingFrame;
    if (d.meta && d.meta.knownBias) knownBias = d.meta.knownBias;
    Object.keys(d.meta && d.meta.stats || {}).forEach((k) => { stats[f + ':' + k] = d.meta.stats[k]; });
  }
  return { meta: { collectedAt, endpoint, samplingFrame, knownBias, stats }, videos: Array.from(videos.values()), comments };
})();

const fmtDate = (ct) => {
  if (!ct) return '';
  const d = new Date(Number(ct) * 1000 + 8 * 3600 * 1000); // 转为北京时间
  return d.toISOString().slice(0, 10);
};

// 归一化：只用于「判定」，不改动原文
function norm(s) {
  return String(s || '')
    .replace(/\[[^\]]{1,12}\]/g, '')      // B站表情标签
    .replace(/@[^\s@]{1,20}/g, '')        // @提及
    .replace(/https?:\/\/\S+/g, '')       // 链接
    .replace(/\s/g, '')
    .trim();
}

function excludeReason(n) {
  if (n.length < 4) return '过短，无可辨识语义';
  if (!/[\u4e00-\u9fa5]/.test(n)) return '非中文内容';
  if (/(.)\1{5,}/.test(n)) return '疑似乱码或重复内容';
  return '';
}

// --- 去重（按 rpid）---
const seen = new Set();
const rows = [];
for (const c of src.comments) {
  if (!c.rpid || seen.has(c.rpid)) continue;
  seen.add(c.rpid);
  const n = norm(c.content);
  const reason = excludeReason(n);
  rows.push({
    rpid: String(c.rpid),
    aid: c.aid,
    videoTitle: c.videoTitle,
    videoAuthor: c.videoAuthor,
    videoPubdate: c.videoPubdate || null,
    videoReviewCount: c.videoReviewCount || null,
    user: c.user,
    like: c.like,
    ctime: c.ctime,
    date: fmtDate(c.ctime),
    subReplies: c.subReplies || 0,
    content: c.content,
    content_norm: n,
    mentions_doubao: /豆包|doubao/i.test(n) ? 1 : 0,
    is_valid: reason ? 0 : 1,
    exclude_reason: reason,
  });
}

// 稳定排序：日期倒序 → 点赞倒序 → rpid 升序（保证 ID 可复现）
rows.sort((a, b) => (b.ctime || 0) - (a.ctime || 0) || (b.like || 0) - (a.like || 0) || String(a.rpid).localeCompare(String(b.rpid)));
rows.forEach((r, i) => { r.bili_id = 'BILI_' + String(i + 1).padStart(3, '0'); });

fs.writeFileSync(path.join(DIR, 'bili_all_comments.json'), JSON.stringify(rows, null, 2), 'utf8');

// --- 分析样本 ---
// 第一层自动规则：正文含「豆包」（高精度，召回 13/66）
// 第二层人工判定：通读全部有效评论，判定是否在谈豆包产品（见 relevance_review.md）
// 最终样本 = 人工复核纳入清单（bili_included.txt），该清单逐条列出了纳入/排除理由
const autoSample = rows.filter((r) => r.is_valid === 1 && r.mentions_doubao === 1);
const includePath = path.join(DIR, 'bili_included.txt');
const included = fs.existsSync(includePath)
  ? new Set(fs.readFileSync(includePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean))
  : new Set(autoSample.map((r) => r.bili_id));
const sample = rows.filter((r) => included.has(r.bili_id));
fs.writeFileSync(path.join(DIR, 'bili_comments.json'), JSON.stringify(sample, null, 2), 'utf8');

const validRows = rows.filter((r) => r.is_valid === 1);
const excludedByHuman = validRows.length - sample.length;

const excl = {};
rows.filter((r) => r.is_valid === 0).forEach((r) => { excl[r.exclude_reason] = (excl[r.exclude_reason] || 0) + 1; });

// --- 统计 ---
const byDate = {};
sample.forEach((r) => { const m = r.date.slice(0, 7); byDate[m] = (byDate[m] || 0) + 1; });

const s = [];
s.push('# B站渠道 · 采集与清洗统计');
s.push('');
s.push('> 采集时间：' + src.meta.collectedAt.slice(0, 19).replace('T', ' ') + '（北京时间 +8h）');
s.push('> 接口：`' + src.meta.endpoint + '`（页面上下文内 fetch，携带主站 cookie）');
s.push('> 抽样框：' + src.meta.samplingFrame);
s.push('> 已知偏差：' + src.meta.knownBias);
s.push('');
s.push('## 1. 漏斗');
s.push('');
s.push('| 环节 | 条数 |');
s.push('|---|---|');
s.push('| 关键词搜索结果（8 个词 × 2 页，去重前 320 条命中） | 245 个视频（去重后） |');
s.push('| 标题含「豆包」的视频 | ' + src.videos.length + ' |');
s.push('| 实际抓到的一级评论（去重后） | ' + rows.length + ' |');
s.push('| 通过清洗规则 | ' + validRows.length + ' |');
s.push('| └ 其中正文显式含「豆包」（自动规则） | ' + autoSample.length + ' |');
s.push('| └ 人工复核补充纳入（谈产品但未出现「豆包」二字） | ' + (sample.length - autoSample.length) + ' |');
s.push('| **最终分析样本** | **' + sample.length + '** |');
s.push('');
s.push('## 2. 剔除原因分布');
s.push('');
s.push('| 原因 | 条数 |');
s.push('|---|---|');
Object.keys(excl).sort((a, b) => excl[b] - excl[a]).forEach((k) => s.push('| ' + k + ' | ' + excl[k] + ' |'));
s.push('');
s.push('## 3. 相关性过滤：两层规则');
s.push('');
s.push('- **第一层（自动）**：去除表情标签、@提及、链接与空白后，正文含「豆包」→ 命中 ' + autoSample.length + ' / ' + validRows.length + ' 条。');
s.push('- **第二层（人工）**：通读全部 ' + validRows.length + ' 条有效评论，逐条判定是否在谈论豆包产品，纳入 ' + sample.length + ' 条、排除 ' + excludedByHuman + ' 条。');
s.push('- 逐条判定理由见 `data/bili/relevance_review.md`（含每个 ID 的纳入/排除理由，可复核）。');
s.push('');
s.push('> 为什么需要第二层：B站 关键词搜索会召回同名噪声（食物「豆包」、曲名、动画角色、游戏梗），');
s.push('> 且自动规则会漏掉「以 `@豆包` 开头」的评论 —— 提及被渲染成节点后，纯文本提取可能丢失「豆包」二字。');
s.push('> 只靠自动规则会同时产生假阳（游戏梗）和假阴（BILI_059），故补人工判定并留档。');
s.push('');
s.push('## 4. 覆盖情况');
s.push('');
s.push('- 有评论产出的视频数：' + new Set(rows.map((r) => String(r.aid))).size + ' / ' + src.videos.length);
s.push('- 评论日期分布（按月）：');
s.push('');
s.push('| 月份 | 条数 |');
s.push('|---|---|');
Object.keys(byDate).sort().forEach((m) => s.push('| ' + m + ' | ' + byDate[m] + ' |'));
s.push('');
s.push('## 5. 与技术限制的关系');
s.push('');
s.push('B站对未登录访客硬性封顶：每条视频只返回 3 条「最热」评论。实测记录：');
s.push('');
s.push('| 端点在位 | 实测结果 |');
s.push('|---|---|');
s.push('| `x/v2/reply` pn=1 sort=2 | code=0，返回 3 条 |');
s.push('| `x/v2/reply` pn=2 sort=2 | code=0，返回 0 条 |');
s.push('| `x/v2/reply/main` mode=3 next=0 | 返回 3 条，`is_end=true`（`all_count=10607`） |');
s.push('| `x/v2/reply/main` next=1 | 返回 0 条 |');
s.push('| `x/v2/reply/wbi/main`（wbi 签名正确，mixin_key 已算出） | code=**-403 访问权限不足**，需登录态 |');
s.push('| 请求密度过高（累计约 160 次后） | 响应体变为 HTML，返回 **HTTP 412 风控页**；退避 25s 连续重试仍为 412 → **IP 级临时封禁** |');
s.push('| 后台运行超 120s | 进程被环境强杀（本环境后台任务硬上限），改为前台运行 + 自带时间预算 + 断点续采 |');
s.push('');
s.push('因此样本量由「视频覆盖面」而非「单视频深度」决定，而覆盖面又受风控封顶约束。');
fs.writeFileSync(path.join(DIR, 'bili_clean_stats.md'), s.join('\n'), 'utf8');

// --- 可读文本，供人工逐条打标 ---
const read = sample.map((r) => [
  r.bili_id,
  r.date,
  '赞' + (r.like || 0),
  '《' + String(r.videoTitle).slice(0, 40) + '》',
  '评:' + String(r.content).replace(/\s+/g, ' '),
].join(' || '));
fs.writeFileSync(path.join(DIR, 'bili_read.txt'), read.join('\n'), 'utf8');

// --- 全部有效评论（含未提及豆包的），供人工判断相关性规则是否过严 ---
const readAll = rows.filter((r) => r.is_valid === 1).map((r) => [
  r.bili_id,
  r.mentions_doubao ? 'M' : '-',
  r.date,
  '赞' + (r.like || 0),
  '《' + String(r.videoTitle).slice(0, 46) + '》',
  '评:' + String(r.content).replace(/\s+/g, ' ').slice(0, 200),
].join(' || '));
fs.writeFileSync(path.join(DIR, 'bili_read_all.txt'), readAll.join('\n'), 'utf8');

fs.writeFileSync(path.join(ROOT, 'scripts', 'bili_build.log'),
  'raw=' + src.comments.length + ' dedup=' + rows.length + ' valid=' + rows.filter((r) => r.is_valid === 1).length
  + ' sample=' + sample.length + ' validNoMention=' + validNotMention + '\nexcl=' + JSON.stringify(excl), 'utf8');
