/**
 * build_annotation_kit.js
 * ------------------------------------------------------------------
 * 生成「人工打标一致性验证」工具包。
 *
 * 背景：data/selfcheck.md 的结论是——AI 自检只能证明标签「稳定」，
 * 不能证明「正确」。要验证正确性，必须由第三方（人工）对同一批
 * 评论独立打标，再用 Cohen's Kappa 计算人与 AI 的一致性。
 * 本脚本即为此准备工具。
 *
 * 产出（全部写入 annotation/）：
 *   annotate.html      双盲标注工具（不含 AI 标签，可离线双击打开）
 *   sample_blank.csv   空白标注表（供 Excel 手填，与工具二选一）
 *   answer_key.json    AI 标签答案键（**标注者不得打开**）
 *   README.md          使用说明
 *
 * 设计要点：
 * 1. 抽样可复现 —— 固定随机种子，任何人重跑得到同一批 40 条
 * 2. 分层抽样 —— 每个主题至少 3 条，保证少数主题（T7/T0）不被淹没
 * 3. 双盲 —— annotate.html 内嵌的样本 JSON 中不含任何 AI 判定字段
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'annotation');

const SAMPLE_N = 40;
const SEED = 20260915; // 固定种子，保证抽样可复现

// ---------------------------------------------------------------- 工具

// mulberry32：小巧的可播种伪随机数发生器
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// CSV 字段转义
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------------------------------------------------------------- 数据

const TOPICS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T0'];

const TOPIC_META = {
  T1: { name: '答案质量（编造·答错·不认错）', core: '输出的内容对不对' },
  T2: { name: '指令遵循与对话风格', core: '有没有按我说的做、语气对不对' },
  T3: { name: '记忆与上下文连续性', core: '有没有记住前面说过的话' },
  T4: { name: '语音与多模态交互', core: '听、看、画这类非文本通道好不好用' },
  T5: { name: '输入效率与键盘交互', core: '打字、改字、选字这类输入操作顺不顺' },
  T6: { name: '性能与稳定性', core: '卡不卡、崩不崩、更新后有没有变差' },
  T7: { name: '账号同步与多端协同', core: '换设备、换端之后能不能接上' },
  T8: { name: '功能完整性与产品策略', core: '功能被砍、缺失功能、付费与活动' },
  T9: { name: '非痛点（正面反馈）', core: '整体正面、无明显改进诉求' },
  T0: { name: '其他-信息不足', core: '情绪强烈但无法归因，或与产品无关' },
};

const tagged = JSON.parse(fs.readFileSync(path.join(DATA, 'tagged.json'), 'utf8'));
const valid = tagged.filter((r) => r.is_valid === 1);

// ---------------------------------------------------------------- 分层抽样

const rng = mulberry32(SEED);
const picked = [];
const chosenIds = new Set();

// 第一层：每个主题至少 3 条
for (const t of TOPICS) {
  const pool = valid.filter((r) => r.main_topic === t && !chosenIds.has(r.review_id));
  const take = shuffle(pool, rng).slice(0, Math.min(3, pool.length));
  for (const r of take) {
    picked.push(r);
    chosenIds.add(r.review_id);
  }
}

// 第二层：余量随机补足，使样本覆盖更完整的负面长尾
let rest = shuffle(
  valid.filter((r) => !chosenIds.has(r.review_id)),
  rng
);
for (const r of rest) {
  if (picked.length >= SAMPLE_N) break;
  picked.push(r);
  chosenIds.add(r.review_id);
}

// 最终顺序打乱：避免同主题连续出现，干扰标注者的判断节奏
const sample = shuffle(picked, rng).slice(0, SAMPLE_N);

// ---------------------------------------------------------------- 统计信息

const topicDist = {};
for (const r of sample) topicDist[r.main_topic] = (topicDist[r.main_topic] || 0) + 1;
const targetN = sample.filter((r) => r.is_target_product === 1).length;
const negN = sample.filter((r) => r.sentiment === '负').length;

// ---------------------------------------------------------------- 答案键

const answerKey = {
  meta: {
    generated_at: new Date().toISOString().slice(0, 10),
    seed: SEED,
    sample_size: sample.length,
    source_total: tagged.length,
    source_valid: valid.length,
    sampling: '分层随机：每个主题至少 3 条（不足则全取），余量随机补足，固定种子 ' + SEED,
    warning: '本文件含 AI 标签，标注者不得查看，否则一致性验证失效。',
  },
  labels: sample.map((r, i) => ({
    order: i + 1,
    review_id: r.review_id,
    ai_main_topic: r.main_topic,
    ai_severity: r.severity,
  })),
};

// ---------------------------------------------------------------- 空白 CSV

const csvHeader = ['序号', '评论ID', '产品', '评分', '日期', '评论正文', '主主题(T0-T9)', '严重度(0-3)', '备注'];
const csvRows = [csvHeader.join(',')];
sample.forEach((r, i) => {
  csvRows.push(
    [
      i + 1,
      r.review_id,
      r.process_group || r.product_name,
      r.rating,
      r.publish_date,
      r.content,
      '',
      '',
      '',
    ]
      .map(csvCell)
      .join(',')
  );
});

// ---------------------------------------------------------------- HTML 工具

// 传给页面的样本：**只含标注所需字段，不含任何 AI 判定**
const pageSample = sample.map((r, i) => ({
  i: i + 1,
  id: r.review_id,
  p: r.process_group || r.product_name,
  rating: r.rating,
  date: r.publish_date,
  text: r.content,
}));

const topicList = TOPICS.map((t) => ({
  code: t,
  name: TOPIC_META[t].name,
  core: TOPIC_META[t].core,
}));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>人工打标 · 豆包口碑分析一致性验证</title>
<style>
  :root{
    --bg:#f6f7f9; --panel:#ffffff; --ink:#1a1d21; --ink2:#5b6470; --ink3:#8b95a1;
    --line:#e3e6ea; --accent:#c0392b; --accent-soft:#fdf2f0;
    --sel:#1f2937; --ok:#1f7a4d; --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased;line-height:1.6}
  .wrap{max-width:1000px;margin:0 auto;padding:24px 20px 80px}

  header{display:flex;align-items:flex-end;justify-content:space-between;
    gap:16px;flex-wrap:wrap;margin-bottom:18px}
  h1{font-size:19px;margin:0;font-weight:650;letter-spacing:.01em}
  .sub{font-size:13px;color:var(--ink2);margin-top:3px}
  .prog{font-family:var(--mono);font-size:13px;color:var(--ink2);text-align:right}
  .prog b{font-size:20px;color:var(--ink)}
  .bar{height:4px;background:var(--line);border-radius:2px;overflow:hidden;margin:10px 0 20px}
  .bar > i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}

  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:20px 22px;margin-bottom:16px}
  .meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--ink2);margin-bottom:12px}
  .meta span{background:#f1f3f5;border-radius:4px;padding:2px 8px}
  .meta .rating{background:var(--accent-soft);color:var(--accent);font-weight:600}
  .text{font-size:16px;line-height:1.75;white-space:pre-wrap;word-break:break-word;
    padding:14px 16px;background:#fafbfc;border:1px solid var(--line);border-radius:8px;
    min-height:64px}

  h2{font-size:13px;color:var(--ink2);font-weight:600;margin:22px 0 10px;
    text-transform:none;letter-spacing:.02em}
  .topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:8px}
  .t{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;cursor:pointer;
    border:1px solid var(--line);border-radius:8px;background:#fff;transition:.12s;text-align:left}
  .t:hover{border-color:#c8ced6;background:#fafbfc}
  .t .k{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--ink3);
    min-width:22px;padding-top:1px}
  .t .n{font-size:13.5px;font-weight:550;line-height:1.35}
  .t .c{font-size:11.5px;color:var(--ink3);margin-top:2px;line-height:1.35}
  .t.on{border-color:var(--sel);background:var(--sel)}
  .t.on .k,.t.on .n,.t.on .c{color:#fff}
  .t.on .c{opacity:.72}

  .sev{display:flex;gap:8px;flex-wrap:wrap}
  .s{padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:#fff;
    cursor:pointer;font-size:13.5px;transition:.12s}
  .s:hover{border-color:#c8ced6;background:#fafbfc}
  .s b{font-family:var(--mono);margin-right:6px;color:var(--ink3)}
  .s.on{border-color:var(--sel);background:var(--sel);color:#fff}
  .s.on b{color:#fff}

  textarea{width:100%;min-height:56px;padding:10px 12px;border:1px solid var(--line);
    border-radius:8px;font-family:inherit;font-size:13.5px;resize:vertical;background:#fff;color:var(--ink)}
  textarea:focus,.s:focus-visible,.t:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

  .nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
    position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 30%);
    padding:16px 0 6px;margin-top:24px}
  button.btn{padding:9px 16px;border:1px solid var(--line);background:#fff;border-radius:8px;
    cursor:pointer;font-size:13.5px;font-family:inherit;color:var(--ink);transition:.12s}
  button.btn:hover{background:#f1f3f5}
  button.btn.primary{background:var(--sel);color:#fff;border-color:var(--sel)}
  button.btn.primary:hover{opacity:.88}
  button.btn:disabled{opacity:.4;cursor:not-allowed}
  .grow{flex:1}
  .hint{font-size:12px;color:var(--ink3)}
  .kbd{font-family:var(--mono);border:1px solid var(--line);border-bottom-width:2px;
    border-radius:4px;padding:0 4px;font-size:11px;background:#fff}

  details{border:1px solid var(--line);border-radius:8px;background:#fff;padding:0 14px;margin-top:18px}
  details > summary{cursor:pointer;padding:11px 0;font-size:13px;font-weight:600;color:var(--ink2)}
  details .body{padding:0 0 14px;font-size:13px;color:var(--ink2)}
  details .body p{margin:8px 0}
  details code{font-family:var(--mono);font-size:12px;background:#f1f3f5;padding:1px 5px;border-radius:3px}

  .done{display:none;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px}
  .done.show{display:block}
  .done h3{margin:0 0 10px;font-size:16px}
  .checks{font-size:13.5px;color:var(--ink2);margin:12px 0}
  .checks li{margin:4px 0}
  #csvout{width:100%;height:180px;font-family:var(--mono);font-size:12px;margin-top:10px}
  .toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);
    background:var(--sel);color:#fff;padding:10px 18px;border-radius:8px;font-size:13.5px;
    opacity:0;pointer-events:none;transition:.22s}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div>
      <h1>人工打标 · 一致性验证</h1>
      <div class="sub">豆包用户口碑分析 · 请依据分类体系独立判断，不要猜测"别人会怎么标"</div>
    </div>
    <div class="prog">已标注 <b id="pn">0</b> / ${sample.length}</div>
  </header>
  <div class="bar"><i id="pbar"></i></div>

  <div class="card" id="card">
    <div class="meta">
      <span id="mseq">第 1 条</span>
      <span id="mprod">—</span>
      <span class="rating" id="mrate">—</span>
      <span id="mdate">—</span>
      <span style="font-family:var(--mono)" id="mid">—</span>
    </div>
    <div class="text" id="mtext">—</div>

    <h2>主主题（一条评论只选一个最主要的）</h2>
    <div class="topics" id="topics"></div>

    <h2>严重度</h2>
    <div class="sev" id="sevs"></div>

    <h2>备注（可选）</h2>
    <textarea id="note" placeholder="哪一条判定让你犹豫？写下来对后续修订分类体系很有价值。"></textarea>

    <div class="nav">
      <button class="btn" id="prev">&larr; 上一条</button>
      <button class="btn" id="next">下一条 &rarr;</button>
      <button class="btn" id="jump">跳到未标注</button>
      <span class="grow"></span>
      <span class="hint">快捷键 <span class="kbd">1</span>&ndash;<span class="kbd">9</span><span class="kbd">0</span> 选主题 ·
        <span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span><span class="kbd">F</span> 选严重度 ·
        <span class="kbd">&larr;</span><span class="kbd">&rarr;</span> 翻页</span>
      <button class="btn primary" id="finish">完成并导出</button>
    </div>
  </div>

  <div class="done" id="done">
    <h3>标注完成</h3>
    <div class="checks" id="checks"></div>
    <p class="hint">把下面的内容整段复制发给分析方即可（或点"下载 CSV"存成 <code>human_labels.csv</code>）。</p>
    <textarea id="csvout" readonly></textarea>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
      <button class="btn primary" id="copy">复制结果</button>
      <button class="btn" id="dl">下载 CSV</button>
      <button class="btn" id="back">返回继续修改</button>
    </div>
  </div>

  <details>
    <summary>判定边界速查（犹豫时看这里，与 taxonomy.md 一致）</summary>
    <div class="body">
      <p><b>T1 是"听懂了但答错了"，T2 是"没按我说的做"。</b>例：「问问题一直给错误答案」=T1；「我说的话直接当耳旁风」=T2。</p>
      <p><b>更新后体验变差 → T6；更新新增了限制（次数/额度/功能下线）→ T8。</b>判断依据是用户实际失去的是什么：失去可用性归 T6，失去功能归 T8。</p>
      <p><b>功能存在但不好用 → 归对应主题；功能缺失或被砍 → T8。</b></p>
      <p><b>App 间冲突（如接电话听不到声）→ T6，不算 T4。</b></p>
      <p><b>键盘卡顿掉帧 → T6，不算 T5。</b></p>
      <p><b>出现"5★ 但内容是投诉"：按内容归入对应痛点主题，不计 T9。</b></p>
      <p><b>笼统骂"很笨/智障"但没有可归因信息 → T0。</b></p>
      <p><b>跨主题抱怨：取"用户最在意的那一条"作为主主题。</b></p>
    </div>
  </details>

  <details>
    <summary>严重度分级定义</summary>
    <div class="body">
      <p><code>0</code> 无 —— 正面反馈或无实质抱怨（选 T9 时用）。</p>
      <p><code>1</code> 轻度 —— 有不满但明确表示会继续使用，或在提建议。</p>
      <p><code>2</code> 中度 —— 影响正常使用，产生明显困扰，但未表达弃用。</p>
      <p><code>3</code> 重度 —— 已卸载、已弃用、或明确表示"用不下去/不会再用了"。</p>
    </div>
  </details>

</div>

<div class="toast" id="toast"></div>

<script>
var SAMPLE = ${JSON.stringify(pageSample)};
var TOPICS = ${JSON.stringify(topicList)};
var SEVS = [
  {v: 0, label: '无 / 正面'},
  {v: 1, label: '轻度：会继续用'},
  {v: 2, label: '中度：影响使用'},
  {v: 3, label: '重度：弃用'}
];
var KEY = 'doubao-anno-v1';

var state = {};   // review_id -> {topic, sev, note}
var cur = 0;

try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

function rec(i) { return SAMPLE[i]; }
function has(i) {
  var s = state[rec(i).id];
  return !!(s && s.topic);
}
function doneCount() {
  var n = 0;
  for (var i = 0; i < SAMPLE.length; i++) if (has(i)) n++;
  return n;
}

function render() {
  var r = rec(cur);
  var s = state[r.id] || {};
  document.getElementById('mseq').textContent = '第 ' + r.i + ' 条';
  document.getElementById('mprod').textContent = r.p;
  document.getElementById('mrate').textContent = r.rating + '★';
  document.getElementById('mdate').textContent = r.date;
  document.getElementById('mid').textContent = r.id;
  document.getElementById('mtext').textContent = r.text;
  document.getElementById('note').value = s.note || '';
  document.getElementById('prev').disabled = cur === 0;
  document.getElementById('next').disabled = cur === SAMPLE.length - 1;

  var tc = document.getElementById('topics');
  tc.innerHTML = '';
  TOPICS.forEach(function (t, idx) {
    var b = document.createElement('button');
    b.className = 't' + (s.topic === t.code ? ' on' : '');
    b.type = 'button';
    var hk = idx === 9 ? '0' : String(idx + 1);
    b.innerHTML = '<span class="k">' + hk + '</span><span><span class="n">' +
      t.name + '</span><span class="c">' + t.core + '</span></span>';
    b.onclick = function () { setTopic(t.code); };
    tc.appendChild(b);
  });

  var sc = document.getElementById('sevs');
  sc.innerHTML = '';
  SEVS.forEach(function (v) {
    var b = document.createElement('button');
    b.className = 's' + (s.sev === v.v ? ' on' : '');
    b.type = 'button';
    b.innerHTML = '<b>' + v.v + '</b>' + v.label;
    b.onclick = function () { setSev(v.v); };
    sc.appendChild(b);
  });

  var n = doneCount();
  document.getElementById('pn').textContent = n;
  document.getElementById('pbar').style.width = (n / SAMPLE.length * 100) + '%';
}

function setTopic(code) {
  var r = rec(cur);
  var s = state[r.id] || (state[r.id] = {});
  s.topic = code;
  // 选 T9（非痛点）时严重度默认 0；选其他主题时若原为 0 则清掉
  if (code === 'T9' && (s.sev === undefined || s.sev === null)) s.sev = 0;
  if (code !== 'T9' && s.sev === 0) s.sev = undefined;
  save(); render(); autoNext();
  void r;
}

function setSev(v) {
  var s = state[rec(cur).id] || (state[rec(cur).id] = {});
  s.sev = v;
  save(); render(); autoNext();
}

// 标注完整（主题 + 严重度）后自动跳下一条，减少鼠标操作
function autoNext() {
  var s = state[rec(cur).id];
  if (s && s.topic && s.sev !== undefined && s.sev !== null && cur < SAMPLE.length - 1) {
    setTimeout(function () {
      var still = state[rec(cur).id];
      if (still && still.topic && still.sev !== undefined && still.sev !== null) go(cur + 1);
    }, 260);
  }
}

function go(i) { cur = Math.max(0, Math.min(SAMPLE.length - 1, i)); render(); window.scrollTo({top: 0, behavior: 'smooth'}); }

document.getElementById('prev').onclick = function () { go(cur - 1); };
document.getElementById('next').onclick = function () { go(cur + 1); };
document.getElementById('jump').onclick = function () {
  for (var i = 0; i < SAMPLE.length; i++) if (!has(i)) { go(i); return; }
  toast('全部已标注');
};
document.getElementById('note').oninput = function (e) {
  var s = state[rec(cur).id] || (state[rec(cur).id] = {});
  s.note = e.target.value;
  save();
};

document.addEventListener('keydown', function (e) {
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  var k = e.key;
  if (k >= '1' && k <= '9') { setTopic('T' + k); return; }
  if (k === '0') { setTopic('T0'); return; }
  var low = k.toLowerCase();
  if (low === 'a') { setSev(0); return; }
  if (low === 's') { setSev(1); return; }
  if (low === 'd') { setSev(2); return; }
  if (low === 'f') { setSev(3); return; }
  if (k === 'ArrowLeft') { go(cur - 1); return; }
  if (k === 'ArrowRight') { go(cur + 1); return; }
});

function buildCSV() {
  var out = ['review_id,main_topic,severity'];
  SAMPLE.forEach(function (r) {
    var s = state[r.id] || {};
    out.push([r.id, s.topic || '', (s.sev === undefined || s.sev === null) ? '' : s.sev].join(','));
  });
  return out.join('\\n');
}

document.getElementById('finish').onclick = function () {
  var miss = [];
  for (var i = 0; i < SAMPLE.length; i++) if (!has(i)) miss.push(rec(i).id);
  var d = document.getElementById('done');
  var ch = document.getElementById('checks');
  var msg = [];
  if (miss.length) {
    msg.push('<p style="color:#c0392b"><b>还有 ' + miss.length + ' 条未选主主题：</b>' +
      miss.slice(0, 12).join('、') + (miss.length > 12 ? ' 等' : '') + '</p>');
  } else {
    msg.push('<p style="color:#1f7a4d"><b>40 条主主题已全部标注。</b>把下面的结果发回分析方即可计算一致性系数。</p>');
  }
  msg.push('<p style="font-size:12.5px;color:#8b95a1">建议顺手记一下：哪几条你标得最犹豫？这比一致性数字本身更能说明分类体系哪里需要改。</p>');
  ch.innerHTML = msg.join('');
  document.getElementById('csvout').value = buildCSV();
  d.classList.add('show');
  d.scrollIntoView({behavior: 'smooth'});
};
document.getElementById('back').onclick = function () {
  document.getElementById('done').classList.remove('show');
};
document.getElementById('copy').onclick = function () {
  var ta = document.getElementById('csvout');
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(ta.value).then(function () { toast('已复制，直接粘贴发给分析方'); },
      function () { toast(ok ? '已复制' : '复制失败，请手动全选'); });
  } else {
    toast(ok ? '已复制' : '复制失败，请手动全选');
  }
};
document.getElementById('dl').onclick = function () {
  var blob = new Blob([buildCSV()], {type: 'text/csv;charset=utf-8'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'human_labels.csv';
  a.click();
  toast('已下载 human_labels.csv');
};

var tid = null;
function toast(t) {
  var el = document.getElementById('toast');
  el.textContent = t;
  el.classList.add('show');
  if (tid) clearTimeout(tid);
  tid = setTimeout(function () { el.classList.remove('show'); }, 2000);
}

render();
</script>
</body>
</html>
`;

// ---------------------------------------------------------------- 写盘

fs.mkdirSync(OUT, { recursive: true });

fs.writeFileSync(path.join(OUT, 'annotate.html'), html, 'utf8');
fs.writeFileSync(path.join(OUT, 'sample_blank.csv'), '\ufeff' + csvRows.join('\n'), 'utf8');
fs.writeFileSync(path.join(OUT, 'answer_key.json'), JSON.stringify(answerKey, null, 2), 'utf8');

const readme = [
  '# 人工打标一致性验证 · 操作说明',
  '',
  '> 目的：验证 `data/taxonomy.md` 的 8 个主题体系**别人也能标得一样**。',
  '> 目前只有 AI 自检（`data/selfcheck.md`，98.8%），它只能证明标签「稳定」，不能证明「正确」。',
  '',
  '## 一、怎么用（约 15 分钟）',
  '',
  '1. 双击 `annotate.html`（离线可用，不需要联网）',
  '2. 逐条判断 **主主题** + **严重度**；犹豫时展开页面底部的「判定边界速查」',
  '3. 标完点「完成并导出」→「复制结果」，把内容发回即可',
  '',
  '进度会自动存在浏览器本地，关掉再打开不会丢。',
  '',
  '### 注意：请保持「双盲」',
  '',
  '`answer_key.json` 是 AI 的标签答案键，**打开它这个验证就作废了**。',
  '标注时不要回头看 AI 怎么标的，也不要去猜"分析方希望我选哪个"。',
  '',
  '想用 Excel 也可以：填 `sample_blank.csv` 的「主主题(T0-T9)」「严重度(0-3)」两列，',
  '存成 `human_labels.csv`（列名为 `review_id,main_topic,severity`）即可。',
  '',
  '## 二、样本是怎么抽的',
  '',
  '- 来源：`data/tagged.json` 中清洗后有效的评论（共 ' + valid.length + ' 条）',
  '- 方法：**分层随机**——每个主题至少 3 条（不足则全取），余量随机补足至 ' + SAMPLE_N + ' 条',
  '- 随机种子固定为 `' + SEED + '`，因此换台机器重跑 `scripts/build_annotation_kit.js` 得到的**是同一批 40 条**',
  '',
  '本批样本的构成：',
  '',
  '| 维度 | 构成 |',
  '|---|---|',
  '| 豆包系 / 竞品 | ' + targetN + ' / ' + (sample.length - targetN) + ' |',
  '| 负面 / 非负面 | ' + negN + ' / ' + (sample.length - negN) + ' |',
  '| 主题分布 | ' + TOPICS.filter((t) => topicDist[t]).map((t) => t + '×' + topicDist[t]).join('、') + ' |',
  '',
  '## 三、标完之后算什么',
  '',
  '```bash',
  'node scripts/compute_kappa.js        # 读取 human_labels.csv + answer_key.json',
  '```',
  '',
  '产出 `annotation/kappa_report.md`：主主题一致率、**Cohen\'s Kappa**、严重度一致率、',
  '以及所有分歧条目的逐条对照（分歧清单比数字本身更有用——它是分类体系的修订清单）。',
  '',
  '### 怎么读 Kappa（Landis & Koch 1979）',
  '',
  '| Kappa | 解释 |',
  '|---|---|',
  '| < 0.20 | 轻微（slight） |',
  '| 0.21 – 0.40 | 尚可（fair） |',
  '| 0.41 – 0.60 | 中等（moderate） |',
  '| 0.61 – 0.80 | 显著（substantial） |',
  '| 0.81 – 1.00 | 几乎完全一致（almost perfect） |',
  '',
  '> 坦诚提示：如果 Kappa 偏低，**这是有价值的发现，不是失败**。',
  '> 它说明分类体系的某些边界不够清晰——把这些边界写清楚，本身就是产品研究能力的一部分。',
  '> 报告里如实写明 Kappa 值即可，不要为了好看而挑选样本或事后调整标签。',
  '',
].join('\n');

fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8');

// ---------------------------------------------------------------- 日志

const lines = [
  '=== build_annotation_kit ' + new Date().toISOString() + ' ===',
  '源数据：tagged.json 共 ' + tagged.length + ' 条，其中有效 ' + valid.length + ' 条',
  '抽样：分层随机（每主题至少 3 条）+ 余量补足，seed=' + SEED,
  '样本量：' + sample.length,
  '  豆包系 ' + targetN + ' / 竞品 ' + (sample.length - targetN),
  '  负面 ' + negN + ' / 非负面 ' + (sample.length - negN),
  '  主题分布：' + TOPICS.filter((t) => topicDist[t]).map((t) => t + '=' + topicDist[t]).join(', '),
  '产出：annotate.html / sample_blank.csv / answer_key.json / README.md',
  '校验：annotate.html 内嵌 JSON 字段 = [' + Object.keys(pageSample[0]).join(',') + ']（不含 AI 判定字段）',
];
fs.writeFileSync(path.join(__dirname, 'annotation_kit.log'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
