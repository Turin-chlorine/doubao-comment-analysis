// B站渠道分析：统计 + 与 App Store 主数据集的交叉验证
// 输出：data/bili/stats_bili.md、data/bili/stats_bili.json
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const DATA = path.join(ROOT, 'data');
const BDIR = path.join(DATA, 'bili');

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

const comments = JSON.parse(fs.readFileSync(path.join(BDIR, 'bili_comments.json'), 'utf8'));

// --- 打标结果 ---
const tagPath = path.join(BDIR, 'tags_bili.txt');
const tagLines = fs.readFileSync(tagPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const tags = new Map();
const tagErrors = [];
tagLines.forEach((line) => {
  const p = line.split('|');
  if (p.length !== 6) { tagErrors.push('BAD LINE ' + line); return; }
  tags.set(p[0], { main_topic: p[1], sentiment: p[2], severity: Number(p[3]), has_request: Number(p[4]), mention_competitor: Number(p[5]) });
});

const missing = comments.filter((r) => !tags.has(r.bili_id)).map((r) => r.bili_id);
const extra = Array.from(tags.keys()).filter((k) => !comments.some((r) => r.bili_id === k));

const tagged = comments.map((r) => {
  const t = tags.get(r.bili_id) || {};
  return Object.assign({}, r, {
    main_topic: t.main_topic || 'UNKNOWN',
    sentiment: t.sentiment || 'UNKNOWN',
    severity: t.severity === undefined ? null : t.severity,
    has_request: t.has_request === undefined ? null : t.has_request,
    mention_competitor: t.mention_competitor === undefined ? null : t.mention_competitor,
  });
});
fs.writeFileSync(path.join(BDIR, 'tagged_bili.json'), JSON.stringify(tagged, null, 2), 'utf8');

const cnt = (arr, fn) => arr.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});

const neg = tagged.filter((r) => r.sentiment === '负');
const topicCount = cnt(neg, (r) => r.main_topic);
const topicRank = Object.keys(topicCount).filter((k) => k !== 'T0').sort((a, b) => topicCount[b] - topicCount[a]);
const allTopics = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

// 来自主数据集（App Store + 豌豆荚）的对照基准
let mainStats = null;
try { mainStats = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8')); } catch (e) {}

const s = [];
s.push('# B站渠道 · 口碑分析（交叉验证）');
s.push('');
s.push('> 样本：B站 ' + tagged.length + ' 条（关键词搜索命中视频的评论，经清洗与相关性筛选）');
s.push('> 分类依据：`data/taxonomy.md` v1.0（与主分析同一体系，未做任何体系调整）');
s.push('> 生成时间：2026-09-15');
s.push('');

s.push('## 1. 情绪结构');
s.push('');
s.push('| 情绪 | 条数 | 占比 |');
s.push('|---|---|---|');
['负', '中', '正'].forEach((x) => {
  const n = tagged.filter((r) => r.sentiment === x).length;
  s.push('| ' + x + ' | ' + n + ' | ' + (100 * n / tagged.length).toFixed(1) + '% |');
});
s.push('');

s.push('## 2. 负面主题排行（主标签，n=' + neg.length + '）');
s.push('');
s.push('| 排名 | 主题 | 条数 | 占负面比例 | 平均严重度 |');
s.push('|---|---|---|---|---|');
topicRank.forEach((k, i) => {
  const list = neg.filter((r) => r.main_topic === k);
  const sevList = list.filter((r) => r.severity);
  const sev = sevList.length ? sevList.reduce((a, r) => a + r.severity, 0) / sevList.length : 0;
  s.push('| ' + (i + 1) + ' | ' + TOPIC_NAME[k] + ' | ' + list.length + ' | ' + (100 * list.length / neg.length).toFixed(1) + '% | ' + sev.toFixed(2) + ' |');
});
s.push('');
s.push('> 另有 ' + (topicCount['T0'] || 0) + ' 条负面属「其他-信息不足」，未进入排行。');
s.push('');

s.push('## 3. 严重度分布');
s.push('');
s.push('| 严重度 | 含义 | 条数 | 占比 |');
s.push('|---|---|---|---|');
[[3, '导致放弃使用或强烈投诉'], [2, '明显影响使用'], [1, '轻微不满']].forEach(([v, label]) => {
  const n = neg.filter((r) => r.severity === v).length;
  s.push('| ' + v + ' | ' + label + ' | ' + n + ' | ' + (neg.length ? (100 * n / neg.length).toFixed(1) : '0') + '% |');
});
s.push('');

// --- 交叉验证 ---
if (mainStats && mainStats.targetValid) {
  const mainN = mainStats.targetValid;
  s.push('## 4. 与 App Store 主数据集的交叉验证');
  s.push('');
  s.push('对比口径：**负面提及率** = 该主题负面条数 ÷ 该渠道有效样本数。主数据集 n=' + mainN + '（豆包系），B站 n=' + tagged.length + '。');
  s.push('');
  s.push('| 主题 | App Store 主数据集 | B站 | 差值 | 判定 |');
  s.push('|---|---|---|---|---|');
  const mainNeg = mainStats.topicCount || {};
  const rows = allTopics.map((t) => {
    const a = 100 * (mainNeg[t] || 0) / mainN;
    const b = 100 * (neg.filter((r) => r.main_topic === t).length) / (tagged.length || 1);
    return { t, a, b, d: b - a };
  }).sort((x, y) => y.a - x.a);
  rows.forEach((r) => {
    const judge = r.d > 5 ? 'B站更突出' : (r.d < -5 ? 'B站更弱' : '两渠道接近');
    s.push('| ' + TOPIC_NAME[r.t] + ' | ' + r.a.toFixed(1) + '% | ' + r.b.toFixed(1) + '% | ' + (r.d >= 0 ? '+' : '') + r.d.toFixed(1) + 'pt | ' + judge + ' |');
  });
  s.push('');

  // 排名一致性
  const mainRank = (mainStats.topicRank || []).slice(0, 3);
  const biliRank = topicRank.slice(0, 3);
  s.push('### 排名一致性');
  s.push('');
  s.push('- App Store 前三：' + mainRank.map((t) => TOPIC_NAME[t].replace(/（.*?）/g, '')).join(' > '));
  s.push('- B站 前三：' + biliRank.map((t) => TOPIC_NAME[t].replace(/（.*?）/g, '')).join(' > '));
  const inter = mainRank.filter((t) => biliRank.indexOf(t) >= 0);
  s.push('- 交集：' + (inter.length ? inter.map((t) => TOPIC_NAME[t].replace(/（.*?）/g, '')).join('、') : '（无）'));
  s.push('');
}

s.push('## 5. 样本中的原话（可溯源）');
s.push('');
const picks = neg
  .filter((r) => r.main_topic !== 'T0')
  .sort((a, b) => (b.severity || 0) - (a.severity || 0) || (b.like || 0) - (a.like || 0))
  .slice(0, 15);
picks.forEach((r) => {
  s.push('- **' + r.bili_id + '**（' + TOPIC_NAME[r.main_topic].replace(/（.*?）/g, '') + '，赞' + (r.like || 0) + '，' + r.date + '）：「' + String(r.content).replace(/\s+/g, ' ').slice(0, 160) + '」');
});
s.push('');

s.push('## 6. 本渠道能支持什么结论 / 不能支持什么');
s.push('');
s.push('**能支持的（定性旁证）**');
s.push('');
s.push('1. **「答案质量」在完全不同的平台上被用户独立提出** —— B站 4 条答案质量负评中，BILI_055（赞105）与 BILI_073（赞18）分别指向"离谱回答"与"疑似敷衍作答"，与主数据集第一大痛点同源。两个平台、两套人群、两套表达方式指向同一问题，这是对主报告核心结论的**独立旁证**。');
s.push('2. **「功能与策略」的负面在新品/新策略上线期集中爆发** —— 本渠道该主题占负面 46.2%，但成因集中在刚发布的豆包手机助手（收费政策不明、绑定手机、能力边界、App 厂商生态阻力）。这与主数据集里"竞品第一大痛点普遍是功能与策略（18%–42%）"形成呼应：该主题的爆发通常由**策略动作**触发，而非模型能力。');
s.push('');
s.push('**不能支持的**');
s.push('');
s.push('- 任何形如"B站用户最不满 X"的比例性结论 —— 22 条样本、3 天窗口，不具备代表性；');
s.push('- 任何时间趋势；');
s.push('- 与主数据集的强弱对比 —— 样本框、人群、口径三者都不可比，本节的对比表仅用于**观察同一主题在不同场景下是否复现**，不是"哪个渠道问题更严重"。');
s.push('');

s.push('## 7. 打标自检');
s.push('');
s.push('- 覆盖检查：缺失打标 ' + missing.length + ' 条' + (missing.length ? '（' + missing.slice(0, 20).join('、') + '）' : ''));
s.push('- 冗余检查：数据集中不存在的打标 ID ' + extra.length + ' 条');
s.push('- 格式错误行：' + tagErrors.length + ' 行');
s.push('');

s.push('## 8. 本渠道的局限（必须随结论一并阅读）');
s.push('');
s.push('1. **每条视频上限 3 条** —— B站对未登录访客硬性封顶，因此本样本是「高赞评论」而非评论区的代表性抽样；高赞评论偏梗化，可能**低估**普通用户的功能性抱怨。');
s.push('2. **无法翻页** —— `pn=2` 返回 0；`x/v2/reply/main` 的 `next=1` 直接 `is_end=true`；需要登录态的 `wbi/main` 返回 `-403`。本渠道深度不可控，只能靠扩大视频覆盖。');
s.push('3. **时间高度集中，是「事件切片」而非横截面** —— 有效样本全部落在 2026-09-13 ~ 09-15 三天内，且主题高度集中于刚发布的「豆包手机助手」。本渠道反映的是**一次新品发布的舆情**，不是"豆包口碑"的常态分布。**不能用于推断趋势，也不能与主数据集的时间分布对照。**');
s.push('4. **平台人群偏置** —— B站用户以年轻群体为主，与 iOS App Store 用户画像不同，两渠道差异部分来自人群而非产品。');
s.push('5. **口径差异** —— 本渠道无星级评分，无法做评分结构对比。B站评论可被同一用户多次发布，已按 `rpid` 去重，但无法排除同一人多条评论的影响。');
s.push('6. **样本量过小，不足以支撑比例推断** —— 22 条（负面 13 条）的分母太小，单条评论即可造成 ±4.5pt 波动。本渠道的比例数字**仅用于描述这 22 条评论的构成**，不具备统计推断效力，不应与主数据集的百分比并列做强弱判断。');
fs.writeFileSync(path.join(BDIR, 'stats_bili.md'), s.join('\n'), 'utf8');

fs.writeFileSync(path.join(BDIR, 'stats_bili.json'), JSON.stringify({
  n: tagged.length,
  neg: neg.length,
  topicCount,
  topicRank,
  sentiment: cnt(tagged, (r) => r.sentiment),
  severity: { 1: neg.filter((r) => r.severity === 1).length, 2: neg.filter((r) => r.severity === 2).length, 3: neg.filter((r) => r.severity === 3).length },
  TOPIC_NAME,
  missing, extra, tagErrors,
}, null, 2), 'utf8');

fs.writeFileSync(path.join(ROOT, 'scripts', 'bili_analysis.log'),
  'n=' + tagged.length + ' neg=' + neg.length + ' missing=' + missing.length + ' extra=' + extra.length + ' tagErrors=' + tagErrors.length
  + '\ntopicRank=' + topicRank.join(','), 'utf8');
