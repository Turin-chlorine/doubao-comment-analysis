// P2 + P4 产出：清洗、分层抽样、全量打标校验与统计
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const DATA = path.join(ROOT, 'data');

const TOPIC_NAME = {
  T1: '答案质量（编造·答错·不认错）',
  T2: '指令遵循与对话风格',
  T3: '记忆与上下文连续性',
  T4: '语音与多模态交互',
  T5: '输入效率与键盘交互',
  T6: '性能与稳定性',
  T7: '账号同步与多端协同',
  T8: '功能完整性与产品策略',
  T9: '非痛点（正面反馈）',
  T0: '其他-信息不足',
};

const PROCESS_GROUP = {
  '豆包 - 随时帮忙的 AI 助手': '豆包主App',
  '豆包爱学（豆包旗下）': '豆包爱学',
  '豆包输入法': '豆包输入法',
  '豆包（安卓版）': '豆包安卓版',
};

const doubao = JSON.parse(fs.readFileSync(path.join(DATA, 'comments.json'), 'utf8'));

// --- 读取打标结果 ---
const tagLines = fs.readFileSync(path.join(DATA, 'tags_raw.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const tags = new Map();
const tagErrors = [];
tagLines.forEach((line) => {
  const p = line.split('|');
  if (p.length !== 6) { tagErrors.push('BAD LINE ' + line); return; }
  tags.set(p[0], { main_topic: p[1], sentiment: p[2], severity: Number(p[3]), has_request: Number(p[4]), mention_competitor: Number(p[5]) });
});

const missing = doubao.filter((r) => !tags.has(r.review_id)).map((r) => r.review_id);
const extra = Array.from(tags.keys()).filter((k) => !doubao.some((r) => r.review_id === k));

// --- 清洗规则 ---
function clean(r) {
  const c = String(r.content || '').trim();
  const noSpace = c.replace(/\s/g, '');
  if (noSpace.length < 6) return '过短，无可辨识语义';
  if (!/[\u4e00-\u9fa5]/.test(c)) return '非中文内容';
  if (/(.)\1{5,}/.test(noSpace)) return '疑似乱码或重复内容';
  if (noSpace.length < 15 && (r.rating === 4 || r.rating === 5)) return '泛化好评，无信息量';
  if (noSpace.length < 15 && r.rating === 1) return '泛化差评，无信息量';
  return '';
}

// --- 组装 tagged ---
const tagged = doubao.map((r) => {
  const t = tags.get(r.review_id) || {};
  const reason = clean(r);
  return {
    review_id: r.review_id,
    product_name: r.product_name,
    process_group: PROCESS_GROUP[r.product_name] || '竞品',
    is_target_product: r.is_target_product,
    source: r.source,
    rating: r.rating,
    publish_date: r.publish_date,
    month: String(r.publish_date || '').slice(0, 7),
    content: r.content,
    is_valid: reason ? 0 : 1,
    exclude_reason: reason,
    main_topic: t.main_topic || 'UNKNOWN',
    sentiment: t.sentiment || 'UNKNOWN',
    severity: t.severity === undefined ? null : t.severity,
    has_request: t.has_request === undefined ? null : t.has_request,
    mention_competitor: t.mention_competitor === undefined ? null : t.mention_competitor,
  };
});

fs.writeFileSync(path.join(DATA, 'tagged.json'), JSON.stringify(tagged, null, 2), 'utf8');

const valid = tagged.filter((r) => r.is_valid === 1);
const targetValid = valid.filter((r) => r.is_target_product === 1);
const compValid = valid.filter((r) => r.is_target_product !== 1);

// comments_clean.csv：新增 is_valid / exclude_reason 两列
const cleanCols = ['review_id', 'source', 'product_name', 'rating', 'publish_date', 'is_valid', 'exclude_reason', 'main_topic', 'sentiment', 'severity', 'content'];
const cleanCsv = [cleanCols.join(',')].concat(tagged.map((r) => cleanCols.map((c) => '"' + String(r[c] === null || r[c] === undefined ? '' : r[c]).replace(/"/g, '""').replace(/\r?\n/g, ' \\n ') + '"').join(','))).join('\r\n');
fs.writeFileSync(path.join(DATA, 'comments_clean.csv'), '\ufeff' + cleanCsv, 'utf8');

// --- 清洗统计 ---
const exclReasons = {};
tagged.filter((r) => r.is_valid === 0).forEach((r) => { exclReasons[r.exclude_reason] = (exclReasons[r.exclude_reason] || 0) + 1; });
const byChannel = {};
tagged.forEach((r) => {
  byChannel[r.product_name] = byChannel[r.product_name] || { total: 0, valid: 0 };
  byChannel[r.product_name].total++;
  if (r.is_valid) byChannel[r.product_name].valid++;
});

const cleanStats = [];
cleanStats.push('# 清洗与有效样本统计（P2 产出）');
cleanStats.push('');
cleanStats.push('> 数据源：`data/comments.csv`（266 条原始评论，采集日期 2026-09-15）');
cleanStats.push('');
cleanStats.push('## 清洗结果');
cleanStats.push('');
cleanStats.push('- 原始条数：**' + tagged.length + '**');
cleanStats.push('- 有效条数：**' + valid.length + '**');
cleanStats.push('- 剔除条数：**' + (tagged.length - valid.length) + '**（占 ' + (100 * (tagged.length - valid.length) / tagged.length).toFixed(1) + '%）');
cleanStats.push('');
cleanStats.push('### 剔除原因分布');
cleanStats.push('');
cleanStats.push('| 剔除原因 | 条数 |');
cleanStats.push('|---|---|');
Object.keys(exclReasons).sort((a, b) => exclReasons[b] - exclReasons[a]).forEach((k) => cleanStats.push('| ' + k + ' | ' + exclReasons[k] + ' |'));
cleanStats.push('');
cleanStats.push('### 各产品有效条数');
cleanStats.push('');
cleanStats.push('| 产品 | 原始 | 有效 | 有效率 | 备注 |');
cleanStats.push('|---|---|---|---|---|');
Object.keys(byChannel).forEach((k) => {
  const v = byChannel[k];
  const rate = (100 * v.valid / v.total).toFixed(1) + '%';
  const note = (v.valid < 30 && r0(k)) ? '样本不足 30 条，该产品结论仅供参考' : '';
  cleanStats.push('| ' + k + ' | ' + v.total + ' | ' + v.valid + ' | ' + rate + ' | ' + note + ' |');
});

function r0(k) { return k !== '豆包 - 随时帮忙的 AI 助手'; }

fs.writeFileSync(path.join(DATA, 'clean_stats.md'), cleanStats.join('\n'), 'utf8');

// --- 分层抽样 60 条 ---
const strata = new Map();
targetValid.forEach((r) => {
  const pol = r.rating <= 2 ? '1-2星' : (r.rating === 3 ? '3星' : '4-5星');
  const key = r.process_group + '|' + pol;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push(r);
});
strata.forEach((v) => v.sort((a, b) => a.review_id.localeCompare(b.review_id)));

const picked = [];
const keys = Array.from(strata.keys()).sort();
keys.forEach((k) => { if (strata.get(k).length) picked.push(strata.get(k).shift()); });
let cursor = 0;
while (picked.length < 60) {
  let progressed = false;
  for (const k of keys) {
    if (picked.length >= 60) break;
    const rest = strata.get(k);
    if (rest.length) { picked.push(rest.shift()); progressed = true; }
  }
  if (!progressed) break;
  cursor++;
}

const sampleLines = picked.map((r) => [r.review_id, r.process_group, r.rating + '★', r.publish_date, r.content.replace(/\s+/g, ' ').slice(0, 200)].join(' || '));
fs.writeFileSync(path.join(DATA, 'sample60.txt'), sampleLines.join('\n'), 'utf8');

// --- 统计 ---
const cnt = (arr, fn) => arr.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
const negTarget = targetValid.filter((r) => r.sentiment === '负');
const topicCount = cnt(negTarget, (r) => r.main_topic);
const topicRank = Object.keys(topicCount).filter((k) => k !== 'T0').sort((a, b) => topicCount[b] - topicCount[a]);

const stats = [];
stats.push('# 豆包用户口碑 · 量化统计（P4 产出）');
stats.push('');
stats.push('> 输入：`data/tagged.json`　有效样本 ' + valid.length + ' 条（豆包系 ' + targetValid.length + ' 条 / 竞品 ' + compValid.length + ' 条）');
stats.push('> 生成时间：2026-09-15　全部分类依据 `data/taxonomy.md` v1.0');
stats.push('');
stats.push('## 1. 总体口碑结构');
stats.push('');
stats.push('| 情绪 | 豆包系条数 | 占比 | 竞品条数 | 占比 |');
stats.push('|---|---|---|---|---|');
['负', '中', '正'].forEach((s) => {
  const a = targetValid.filter((r) => r.sentiment === s).length;
  const b = compValid.filter((r) => r.sentiment === s).length;
  stats.push('| ' + s + ' | ' + a + ' | ' + (100 * a / targetValid.length).toFixed(1) + '% | ' + b + ' | ' + (100 * b / compValid.length).toFixed(1) + '% |');
});
stats.push('');
stats.push('## 2. 豆包系痛点排行（按主标签计，n=' + negTarget.length + '）');
stats.push('');
stats.push('| 排名 | 主题 | 条数 | 占负面比例 | 占全部有效样本 | 平均严重度 | 含明确诉求比例 |');
stats.push('|---|---|---|---|---|---|---|');
topicRank.forEach((k, i) => {
  const list = negTarget.filter((r) => r.main_topic === k);
  const sev = list.filter((r) => r.severity).reduce((s, r) => s + r.severity, 0) / (list.filter((r) => r.severity).length || 1);
  const req = list.filter((r) => r.has_request === 1).length;
  stats.push('| ' + (i + 1) + ' | ' + TOPIC_NAME[k] + ' | ' + list.length + ' | ' + (100 * list.length / negTarget.length).toFixed(1) + '% | ' + (100 * list.length / targetValid.length).toFixed(1) + '% | ' + sev.toFixed(2) + ' | ' + (100 * req / list.length).toFixed(0) + '% |');
});
stats.push('');
const t0n = topicCount['T0'] || 0;
stats.push('> 另有 ' + t0n + ' 条负面评论属于「其他-信息不足」（纯情绪表达，无法归因），未进入排行。');
stats.push('');
stats.push('## 3. 产品线 × 痛点交叉');
stats.push('');
const groups = ['豆包主App', '豆包爱学', '豆包输入法', '豆包安卓版'];
const allTopics = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
stats.push('| 产品线 | 有效样本 | ' + allTopics.map((t) => t).join(' | ') + ' |');
stats.push('|---|---|' + allTopics.map(() => '---').join('|') + '|');
groups.forEach((g) => {
  const gv = targetValid.filter((r) => r.process_group === g);
  if (!gv.length) return;
  const cells = allTopics.map((t) => {
    const n = gv.filter((r) => r.main_topic === t).length;
    return n ? n + '（' + (100 * n / gv.length).toFixed(0) + '%）' : '-';
  });
  stats.push('| ' + g + ' | ' + gv.length + ' | ' + cells.join(' | ') + ' |');
});
stats.push('');
stats.push('T1=答案质量　T2=指令与风格　T3=记忆上下文　T4=语音多模态　T5=输入效率　T6=性能稳定　T7=同步多端　T8=功能与策略');
stats.push('');
stats.push('## 4. 严重度分布（豆包系负面）');
stats.push('');
stats.push('| 严重度 | 含义 | 条数 | 占比 |');
stats.push('|---|---|---|---|');
[[3, '导致放弃使用或强烈投诉'], [2, '明显影响使用'], [1, '轻微不满']].forEach(([s, label]) => {
  const n = negTarget.filter((r) => r.severity === s).length;
  stats.push('| ' + s + ' | ' + label + ' | ' + n + ' | ' + (100 * n / negTarget.length).toFixed(1) + '% |');
});
stats.push('');
stats.push('## 5. 月度分布（按发布日期）');
stats.push('');
const byMonth = cnt(targetValid, (r) => r.month);
stats.push('| 月份 | 豆包系有效条数 |');
stats.push('|---|---|');
Object.keys(byMonth).sort().forEach((m) => stats.push('| ' + m + ' | ' + byMonth[m] + ' |'));
stats.push('');
stats.push('> **局限说明**：本次采集依赖苹果评论接口的第 1 页（每个排序维度返回 10 条），样本在时间上是"近期偏置"的，**不能用于推断真实的时间趋势**。上表仅反映本次样本的日期分布。');
stats.push('');
stats.push('## 6. 竞品对照：同一体系下的痛点分布');
stats.push('');
stats.push('| 产品 | 有效样本 | 负面占比 | 第一大痛点 | 第二大痛点 | 第三大痛点 |');
stats.push('|---|---|---|---|---|---|');
const comps = Object.keys(cnt(compValid, (r) => r.product_name));
comps.forEach((p) => {
  const pv = compValid.filter((r) => r.product_name === p);
  const pn = pv.filter((r) => r.sentiment === '负');
  const tc = cnt(pn, (r) => r.main_topic);
  const top = Object.keys(tc).filter((k) => k !== 'T0').sort((a, b) => tc[b] - tc[a]).slice(0, 3);
  const fmtTop = (k) => k ? (TOPIC_NAME[k].replace(/（.*?）/g, '') + '（' + tc[k] + '）') : '-';
  stats.push('| ' + p + ' | ' + pv.length + ' | ' + (100 * pn.length / pv.length).toFixed(0) + '% | ' + fmtTop(top[0]) + ' | ' + fmtTop(top[1]) + ' | ' + fmtTop(top[2]) + ' |');
});
stats.push('');
stats.push('### 豆包系 vs 竞品：各主题负面提及率对比（负面条数 / 该产品有效样本）');
stats.push('');
stats.push('| 主题 | 豆包系 | ' + comps.map((p) => p.split(' ')[0]).join(' | ') + ' |');
stats.push('|---|---|' + comps.map(() => '---').join('|') + '|');
allTopics.forEach((t) => {
  const d = negTarget.filter((r) => r.main_topic === t).length / targetValid.length;
  const cells = comps.map((p) => {
    const pv = compValid.filter((r) => r.product_name === p);
    const n = pv.filter((r) => r.main_topic === t && r.sentiment === '负').length;
    return (100 * n / pv.length).toFixed(0) + '%';
  });
  stats.push('| ' + TOPIC_NAME[t] + ' | ' + (100 * d).toFixed(0) + '% | ' + cells.join(' | ') + ' |');
});
stats.push('');
stats.push('## 7. 竞品被提及情况');
stats.push('');
const mc = targetValid.filter((r) => r.mention_competitor === 1);
stats.push('- 豆包系有效评论中，**' + mc.length + ' 条（' + (100 * mc.length / targetValid.length).toFixed(1) + '%）主动提到了竞品**');
stats.push('- 涉及的评论 ID：' + mc.map((r) => r.review_id).join('、'));
stats.push('- 被提及的竞品：Gemini / Copilot（AS_020）、DeepSeek（AS_002）、夸克AI（AS_002）、千问输入法（AS_IME_025）、微信输入法（AS_IME_026）、搜狗/微软双拼（AS_IME_028）');
stats.push('');
stats.push('## 8. 打标自检');
stats.push('');
stats.push('- 覆盖检查：缺失打标的评论 ' + missing.length + ' 条' + (missing.length ? '（' + missing.join('、') + '）' : ''));
stats.push('- 冗余检查：数据集中不存在的打标 ID ' + extra.length + ' 条' + (extra.length ? '（' + extra.join('、') + '）' : ''));
stats.push('- 格式错误行：' + tagErrors.length + ' 行');
stats.push('- 抽样复核：随机抽取 20 条重打比对，见 `data/selfcheck.md`');

fs.writeFileSync(path.join(DATA, 'stats.md'), stats.join('\n'), 'utf8');

// 供报告生成使用
fs.writeFileSync(path.join(DATA, 'stats.json'), JSON.stringify({
  total: tagged.length,
  valid: valid.length,
  invalid: tagged.length - valid.length,
  targetValid: targetValid.length,
  compValid: compValid.length,
  topicCount, topicRank, TOPIC_NAME, exclReasons, byChannel,
  monthCount: byMonth,
  sentiment: {
    target: cnt(targetValid, (r) => r.sentiment),
    comp: cnt(compValid, (r) => r.sentiment),
  },
  severity: { 1: negTarget.filter((r) => r.severity === 1).length, 2: negTarget.filter((r) => r.severity === 2).length, 3: negTarget.filter((r) => r.severity === 3).length },
  groupTopic: groups.reduce((m, g) => { const gv = targetValid.filter((r) => r.process_group === g); m[g] = { n: gv.length, topic: cnt(gv, (r) => r.main_topic) }; return m; }, {}),
  ratingDist: cnt(tagged, (r) => r.rating),
  targetRatingDist: cnt(targetValid, (r) => r.rating),
  compByProduct: comps.reduce((m, p) => { const pv = compValid.filter((r) => r.product_name === p); const pn = pv.filter((r) => r.sentiment === '负'); m[p] = { n: pv.length, neg: pn.length, topic: cnt(pn, (r) => r.main_topic) }; return m; }, {}),
  mentionCompetitor: mc.map((r) => r.review_id),
  missing, extra, tagErrors,
}, null, 2), 'utf8');

fs.writeFileSync(path.join(ROOT, 'scripts', 'analysis.log'),
  'missing ' + missing.length + ' extra ' + extra.length + ' tagErrors ' + tagErrors.length
  + '\nvalid ' + valid.length + ' targetValid ' + targetValid.length
  + '\nsample60 ' + picked.length
  + '\ntopicRank ' + topicRank.join(',')
  + '\nexcl ' + JSON.stringify(exclReasons), 'utf8');
