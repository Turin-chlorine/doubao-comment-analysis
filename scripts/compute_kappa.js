/**
 * compute_kappa.js
 * ------------------------------------------------------------------
 * 计算「人工标注」与「AI 标注」的一致性。
 *
 * 输入：
 *   annotation/human_labels.csv   人工标注结果（列：review_id,main_topic,severity）
 *   annotation/answer_key.json    AI 标签答案键
 *   data/tagged.json              用于取评论原文（生成分歧清单）
 *
 * 产出：
 *   annotation/kappa_report.md
 *
 * 指标：
 *   - 主主题一致率 po 与 Cohen's Kappa（名义，10 分类）
 *   - 严重度一致率与二次加权 Kappa（序数 0–3）
 *   - 主题混淆矩阵（AI 视角 × 人工视角）
 *   - 全部分歧条目逐条对照（这是分类体系的修订清单）
 *
 * 注：人工结果未就位时脚本不报错，只生成一份状态说明。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANN = path.join(ROOT, 'annotation');
const DATA = path.join(ROOT, 'data');

const HUMAN_CSV = path.join(ANN, 'human_labels.csv');
const ANSWER_KEY = path.join(ANN, 'answer_key.json');
const TAGGED = path.join(DATA, 'tagged.json');
const REPORT = path.join(ANN, 'kappa_report.md');

const TOPIC_ORDER = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T0'];
const TOPIC_NAME = {
  T1: '答案质量',
  T2: '指令遵循与风格',
  T3: '记忆与连续性',
  T4: '语音与多模态',
  T5: '输入效率',
  T6: '性能与稳定性',
  T7: '账号与多端',
  T8: '功能与策略',
  T9: '非痛点(正面)',
  T0: '信息不足',
};

// ------------------------------------------------------------ CSV 解析

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuote = false;
      } else cell += c;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (c === '\r') {
      // 忽略
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// ------------------------------------------------------------ Kappa

function cohenKappa(pairs, k) {
  // pairs: [[a,b], ...] a/b 为类别下标（0..k-1）
  const n = pairs.length;
  if (!n) return null;
  const O = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const [a, b] of pairs) O[a][b]++;
  const rowS = O.map((r) => r.reduce((s, v) => s + v, 0));
  const colS = Array.from({ length: k }, (_, j) => O.reduce((s, r) => s + r[j], 0));
  let po = 0;
  for (let i = 0; i < k; i++) po += O[i][i];
  po /= n;
  let pe = 0;
  for (let i = 0; i < k; i++) pe += (rowS[i] * colS[i]) / (n * n);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, po, pe, kappa, O, rowS, colS };
}

function weightedKappa(pairs, k) {
  // 二次加权，用于序数变量（严重度 0–3）
  const n = pairs.length;
  if (!n) return null;
  const O = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const [a, b] of pairs) O[a][b]++;
  const rowS = O.map((r) => r.reduce((s, v) => s + v, 0));
  const colS = Array.from({ length: k }, (_, j) => O.reduce((s, r) => s + r[j], 0));
  const w = (i, j) => Math.pow(i - j, 2) / Math.pow(k - 1, 2);
  let obs = 0, exp = 0, exact = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      obs += w(i, j) * O[i][j];
      exp += w(i, j) * (rowS[i] * colS[j]) / n;
      if (i === j) exact += O[i][j];
    }
  }
  const kappa = exp === 0 ? 1 : 1 - obs / exp;
  return { n, kappa, exactRate: exact / n, O };
}

function interpret(k) {
  if (k === null || k === undefined || isNaN(k)) return '—';
  if (k < 0.20) return '轻微（slight）';
  if (k <= 0.40) return '尚可（fair）';
  if (k <= 0.60) return '中等（moderate）';
  if (k <= 0.80) return '显著（substantial）';
  return '几乎完全一致（almost perfect）';
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }
function f3(x) { return x === null || x === undefined ? '—' : x.toFixed(3); }

// ------------------------------------------------------------ 主流程

const out = [];

if (!fs.existsSync(ANSWER_KEY)) {
  console.error('缺少 answer_key.json，请先运行 node scripts/build_annotation_kit.js');
  process.exit(1);
}

const key = JSON.parse(fs.readFileSync(ANSWER_KEY, 'utf8'));
const keyById = new Map(key.labels.map((l) => [l.review_id, l]));

if (!fs.existsSync(HUMAN_CSV)) {
  out.push('# 人工打标一致性验证 · 待人工标注');
  out.push('');
  out.push('> 自动生成于 ' + new Date().toISOString().slice(0, 10) + '　　状态：**尚未收到人工标注结果**');
  out.push('');
  out.push('## 当前状态');
  out.push('');
  out.push('本报告需要 `annotation/human_labels.csv` 才能计算。该文件由人工标注产生，路径有二：');
  out.push('');
  out.push('1. 双击 `annotation/annotate.html`，逐条标注 ' + key.labels.length + ' 条后点「完成并导出」→「复制结果」');
  out.push('2. 或填写 `annotation/sample_blank.csv` 的「主主题」「严重度」两列，另存为 `human_labels.csv`');
  out.push('');
  out.push('## 为什么这一步必须由人来做');
  out.push('');
  out.push('`data/selfcheck.md` 记录的 98.8% 是**同一模型两轮自标**的一致率。');
  out.push('它只能证明标签**稳定**（同样的输入给出同样的输出），不能证明标签**正确**（符合人类对这批评论的共识理解）。');
  out.push('只有引入独立于 AI 的第二位标注者，才能回答"这套分类体系换个人来标，结果一样吗"——');
  out.push('这正是报告结论能否作为团队资产使用的前提。');
  out.push('');
  out.push('## 样本已就位');
  out.push('');
  out.push('| 项目 | 值 |');
  out.push('|---|---|');
  out.push('| 待标注条数 | ' + key.labels.length + ' |');
  out.push('| 抽样方法 | ' + key.meta.sampling + ' |');
  out.push('| 随机种子 | ' + key.meta.seed + '（重跑生成同一批） |');
  out.push('');
  out.push('完成后重新运行 `node scripts/compute_kappa.js` 即可生成本报告的完整版。');
  fs.mkdirSync(ANN, { recursive: true });
  fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
  console.log('human_labels.csv 不存在 —— 已生成待标注状态说明');
  process.exit(0);
}

const humanRows = parseCSV(fs.readFileSync(HUMAN_CSV, 'utf8'));
const header = humanRows[0].map((h) => String(h).trim());
const iId = header.findIndex((h) => /review_id/i.test(h));
const iT = header.findIndex((h) => /main_topic/i.test(h));
const iS = header.findIndex((h) => /severity/i.test(h));
if (iId < 0 || iT < 0) {
  console.error('human_labels.csv 缺少必需列：review_id / main_topic');
  process.exit(1);
}

const human = new Map();
for (let r = 1; r < humanRows.length; r++) {
  const row = humanRows[r];
  const id = String(row[iId] || '').trim();
  if (!id) continue;
  human.set(id, {
    topic: String(row[iT] || '').trim().toUpperCase(),
    sev: iS >= 0 && String(row[iS] || '').trim() !== '' ? Number(String(row[iS]).trim()) : null,
  });
}

// 取原文用于分歧清单
const tagged = JSON.parse(fs.readFileSync(TAGGED, 'utf8'));
const textById = new Map(tagged.map((t) => [t.review_id, t]));

const pairsT = [];
const pairsS = [];
const missing = [];
const invalid = [];
const rows = [];

for (const l of key.labels) {
  const h = human.get(l.review_id);
  if (!h || !h.topic) { missing.push(l.review_id); continue; }
  if (TOPIC_ORDER.indexOf(h.topic) < 0) { invalid.push(l.review_id + '=' + h.topic); continue; }
  const aiT = TOPIC_ORDER.indexOf(l.ai_main_topic);
  const huT = TOPIC_ORDER.indexOf(h.topic);
  pairsT.push([aiT, huT]);
  const t = textById.get(l.review_id) || {};
  rows.push({
    id: l.review_id,
    ai: l.ai_main_topic,
    hu: h.topic,
    aiSev: l.ai_severity,
    huSev: h.sev,
    agree: aiT === huT,
    sevAgree: h.sev !== null && Number(h.sev) === Number(l.ai_severity),
    group: t.process_group || '',
    rating: t.rating,
    content: String(t.content || ''),
  });
  if (h.sev !== null && !isNaN(h.sev)) pairsS.push([Number(l.ai_severity) || 0, h.sev]);
}

const K = TOPIC_ORDER.length;
const kt = cohenKappa(pairsT, K);
const ks = weightedKappa(pairsS, 4);
const sevExact = pairsS.length ? pairsS.filter(([a, b]) => a === b).length / pairsS.length : null;

const disagree = rows.filter((r) => !r.agree);

// ------------------------------------------------------------ 报告

out.push('# 人工打标一致性验证 · 结果');
out.push('');
out.push('> 生成于 ' + new Date().toISOString().slice(0, 10) + '　　脚本：`scripts/compute_kappa.js`');
out.push('> 比对对象：**人工标注**（`annotation/human_labels.csv`）vs **AI 标注**（`annotation/answer_key.json`）');
out.push('');
out.push('## 一、结论');
out.push('');
out.push('| 指标 | 结果 | 判读 |');
out.push('|---|---|---|');
out.push('| 比对样本量 | ' + kt.n + ' / ' + key.labels.length + ' | ' +
  (missing.length ? '未标注 ' + missing.length + ' 条' : '全部完成') + ' |');
out.push('| 主主题一致率 | ' + pct(kt.po) + ' | — |');
out.push('| **主主题 Cohen\'s Kappa** | **' + f3(kt.kappa) + '** | ' + interpret(kt.kappa) + ' |');
out.push('| 严重度一致率（完全一致） | ' + (sevExact === null ? '—' : pct(sevExact)) + ' | — |');
out.push('| 严重度二次加权 Kappa | ' + (ks ? f3(ks.kappa) : '—') + ' | ' + interpret(ks && ks.kappa) + ' |');
out.push('');
if (missing.length) {
  out.push('> 未标注条目（' + missing.length + ' 条）：' + missing.join('、'));
  out.push('');
}
if (invalid.length) {
  out.push('> 非法主题值（' + invalid.length + ' 条）：' + invalid.join('、'));
  out.push('');
}

out.push('## 二、和 AI 自检的对照');
out.push('');
out.push('| 检验 | 方法 | 结果 | 能说明什么 |');
out.push('|---|---|---|---|');
out.push('| AI 自检（`data/selfcheck.md`） | 同一模型两轮独立重标 | 98.8% | 只能证明标签**稳定** |');
out.push('| 本次人工验证 | 独立标注者 vs AI | Kappa ' + f3(kt.kappa) + ' | 标签是否**可被他人复现** |');
out.push('');

// 混淆矩阵
out.push('## 三、主主题混淆矩阵（行=AI，列=人工）');
out.push('');
out.push('| AI \\ 人工 | ' + TOPIC_ORDER.join(' | ') + ' |');
out.push('|' + new Array(K + 1 + 1).join('---|'));
for (let i = 0; i < K; i++) {
  const cells = [];
  for (let j = 0; j < K; j++) {
    const v = kt.O[i][j];
    cells.push(v === 0 ? '·' : (i === j ? '**' + v + '**' : String(v)));
  }
  out.push('| **' + TOPIC_ORDER[i] + ' ' + TOPIC_NAME[TOPIC_ORDER[i]] + '** | ' + cells.join(' | ') + ' |');
}
out.push('');
out.push('> 加粗为对角一致格。离开对角线且数字较大的格子，就是分类体系里最容易混淆的两个主题。');
out.push('');

// 分歧清单
out.push('## 四、分歧清单（' + disagree.length + ' 条）');
out.push('');
if (!disagree.length) {
  out.push('无分歧。');
} else {
  out.push('| # | ID | 产品 | 评分 | AI 判定 | 人工判定 | AI 严重度 | 人工严重度 | 评论原文（截断） |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  disagree.forEach((d, i) => {
    out.push('| ' + (i + 1) + ' | `' + d.id + '` | ' + d.group + ' | ' + d.rating + '★ | ' +
      d.ai + ' ' + TOPIC_NAME[d.ai] + ' | **' + d.hu + ' ' + TOPIC_NAME[d.hu] + '** | ' +
      d.aiSev + ' | ' + (d.huSev === null ? '—' : d.huSev) + ' | ' +
      d.content.replace(/\s+/g, ' ').slice(0, 70).replace(/\|/g, '/') + '… |');
  });
  out.push('');
  out.push('> 这张表比 Kappa 数字更有用：**每一条分歧都是 `taxonomy.md` 需要补一条判定边界的信号**。');
  out.push('> 建议逐条判断是"AI 标错"还是"体系确实有歧义"，前者回写 `tags_raw.txt`，后者补进体系。');
}
out.push('');

// 严重度分歧
const sevDis = rows.filter((r) => r.huSev !== null && Number(r.huSev) !== Number(r.aiSev));
out.push('## 五、严重度分歧（' + sevDis.length + ' 条）');
out.push('');
if (!sevDis.length) {
  out.push('无分歧。');
} else {
  out.push('| ID | AI | 人工 | 差值 | 评论原文（截断） |');
  out.push('|---|---|---|---|---|');
  sevDis.forEach((d) => {
    out.push('| `' + d.id + '` | ' + d.aiSev + ' | ' + d.huSev + ' | ' +
      (d.huSev - d.aiSev > 0 ? '+' : '') + (d.huSev - d.aiSev) + ' | ' +
      d.content.replace(/\s+/g, ' ').slice(0, 60).replace(/\|/g, '/') + '… |');
  });
}
out.push('');

out.push('## 六、怎么用这个结果');
out.push('');
out.push('- **Kappa ≥ 0.61**：分类体系可复现，报告的量化结论可以带上"经人工一致性验证"的前提对外使用。');
out.push('- **Kappa 偏低**：这是**有价值的发现**，不是失败。把第四节的分歧逐条归因（是 AI 标错，还是体系有歧义），修订 `taxonomy.md` 后重跑一轮。');
out.push('- 无论结果如何，都应在 `report.html` 的局限章节**如实写明 Kappa 数值与标注者身份**，不得只写"已做人工验证"。');
out.push('');

fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
console.log('已生成 ' + REPORT);
console.log('主主题一致率 ' + pct(kt.po) + '，Cohen\'s Kappa ' + f3(kt.kappa) + '（' + interpret(kt.kappa) + '）');
console.log('比对 ' + kt.n + ' 条，分歧 ' + disagree.length + ' 条');
