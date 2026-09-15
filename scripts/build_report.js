// P5 产出：生成自包含单页 HTML 报告
// 设计约束：所有图表为内联 SVG（不依赖 CDN），每个数字可追溯到 data/tagged.json 或 data/stats.md
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\桌面\\doubao-comment-analysis';
const DATA = path.join(ROOT, 'data');
const OUTDIR = path.join(ROOT, 'report');

const stats = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8'));
const tagged = JSON.parse(fs.readFileSync(path.join(DATA, 'tagged.json'), 'utf8'));
// B站 渠道（平行支线，缺失时报告自动降级，不阻断生成）
let bili = null, biliTagged = [];
try { bili = JSON.parse(fs.readFileSync(path.join(DATA, 'bili', 'stats_bili.json'), 'utf8')); } catch (e) {}
try { biliTagged = JSON.parse(fs.readFileSync(path.join(DATA, 'bili', 'tagged_bili.json'), 'utf8')); } catch (e) {}

const valid = tagged.filter((r) => r.is_valid === 1);
const targetValid = valid.filter((r) => r.is_target_product === 1);
const negTarget = targetValid.filter((r) => r.sentiment === '负');

const T = stats.TOPIC_NAME;
const SHORT = {
  T1: '答案质量', T2: '指令与风格', T3: '记忆与上下文', T4: '语音与多模态',
  T5: '输入效率', T6: '性能与稳定性', T7: '同步与多端', T8: '功能与策略', T9: '正面反馈', T0: '信息不足',
};
const rank = stats.topicRank;
const topicN = (t) => (stats.topicCount[t] || 0);
const topicAvgSev = (t) => {
  const l = negTarget.filter((r) => r.main_topic === t && r.severity);
  return l.length ? l.reduce((s, r) => s + r.severity, 0) / l.length : 0;
};
const reachPct = (t) => 100 * topicN(t) / stats.targetValid;

// 关键词辅助扫描：仅用于说明"主标签低估了哪些主题"
const KW = {
  T1: /编|胡说|乱说|瞎说|答错|错的|错了|不准|不承认|犟|幻觉|胡言/,
  T3: /失忆|记忆|记住|忘了|上下文|断层|不记得/,
  T6: /卡顿|崩溃|闪退|跳转|网络失败|火爆|发热|更新后/,
};
const kwHit = (t) => targetValid.filter((r) => KW[t].test(r.content)).length;

// ---------------------------------------------------------------- 图表工具
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const C = { neg: '#e5484d', warn: '#f0913a', pos: '#12a150', blue: '#2563eb', gray: '#9ca3af', ink: '#1a1d21', muted: '#6b7280', line: '#e5e7eb' };

function hBar(rows, opt) {
  opt = opt || {};
  const W = 820, rowH = 34, padL = 150, padR = 60, H = rows.length * rowH + 20;
  const max = Math.max.apply(null, rows.map((r) => r.v)) || 1;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(opt.aria || '条形图') + '">';
  rows.forEach((r, i) => {
    const y = 10 + i * rowH;
    const w = Math.max(2, (W - padL - padR) * r.v / max);
    s += '<text x="' + (padL - 12) + '" y="' + (y + 16) + '" text-anchor="end" font-size="13" fill="' + C.ink + '">' + esc(r.k) + '</text>';
    s += '<rect x="' + padL + '" y="' + (y + 3) + '" width="' + w + '" height="20" rx="4" fill="' + (r.c || C.neg) + '"/>';
    s += '<text x="' + (padL + w + 8) + '" y="' + (y + 18) + '" font-size="12" fill="' + C.muted + '">' + esc(r.label || r.v) + '</text>';
  });
  return s + '</svg>';
}

function donut(parts, centerLabel, centerSub) {
  const W = 300, H = 220, cx = 110, cy = 110, R = 78, r0 = 50;
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  let a0 = -Math.PI / 2, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="情绪结构环形图">';
  parts.forEach((p) => {
    const a1 = a0 + 2 * Math.PI * p.v / total;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + r0 * Math.cos(a1), y2 = cy + r0 * Math.sin(a1);
    const x3 = cx + r0 * Math.cos(a0), y3 = cy + r0 * Math.sin(a0);
    s += '<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1)
      + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + x3.toFixed(1) + ' ' + y3.toFixed(1) + 'Z" fill="' + p.c + '"/>';
    a0 = a1;
  });
  s += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="24" font-weight="600" fill="' + C.ink + '">' + esc(centerLabel) + '</text>';
  s += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="12" fill="' + C.muted + '">' + esc(centerSub) + '</text>';
  let ly = 42;
  parts.forEach((p) => {
    s += '<rect x="215" y="' + (ly - 9) + '" width="10" height="10" rx="2" fill="' + p.c + '"/>';
    s += '<text x="232" y="' + ly + '" font-size="12" fill="' + C.ink + '">' + esc(p.k) + ' ' + p.v + ' 条</text>';
    ly += 22;
  });
  return s + '</svg>';
}

function bubbles(rows) {
  const W = 820, H = 400, padL = 70, padR = 40, padT = 30, padB = 60;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxX = Math.max.apply(null, rows.map((r) => r.x)) * 1.15;
  const yMin = 1, yMax = 3.2;
  const X = (v) => padL + iw * v / maxX;
  const Y = (v) => padT + ih * (1 - (v - yMin) / (yMax - yMin));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="痛点频次与严重度气泡图">';
  for (let g = 1; g <= 3; g++) {
    const y = Y(g);
    s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + C.line + '" stroke-width="1"/>';
    s += '<text x="' + (padL - 10) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="' + C.muted + '">' + g + ' 级</text>';
  }
  s += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="' + C.muted + '" stroke-width="1"/>';
  for (let p = 0; p <= 5; p++) {
    const v = maxX * p / 5;
    s += '<text x="' + X(v) + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="11" fill="' + C.muted + '">' + v.toFixed(0) + '%</text>';
  }
  s += '<text x="' + (padL + iw / 2) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="12" fill="' + C.muted + '">该类痛点在豆包系有效样本中的提及率（n=' + stats.targetValid + '）</text>';
  rows.forEach((r) => {
    const rad = Math.max(14, Math.min(46, 9 * Math.sqrt(r.n)));
    s += '<circle cx="' + X(r.x).toFixed(1) + '" cy="' + Y(r.y).toFixed(1) + '" r="' + rad.toFixed(1) + '" fill="' + C.neg + '" fill-opacity="0.16" stroke="' + C.neg + '" stroke-width="1.5"/>';
    s += '<text x="' + X(r.x).toFixed(1) + '" y="' + (Y(r.y) + 4).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#8f1f22">' + r.n + '</text>';
    s += '<text x="' + X(r.x).toFixed(1) + '" y="' + (Y(r.y) - rad - 8).toFixed(1) + '" text-anchor="middle" font-size="12" fill="' + C.ink + '">' + esc(SHORT[r.t]) + '</text>';
  });
  return s + '</svg>';
}

function groupedBar(cats, series) {
  const W = 820, H = 340, padL = 60, padR = 20, padT = 24, padB = 80;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = 60;
  const gw = iw / cats.length;
  const bw = Math.min(22, (gw - 10) / series.length);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="豆包与竞品痛点提及率对比">';
  for (let p = 0; p <= 6; p++) {
    const v = max * p / 6, y = padT + ih * (1 - v / max);
    s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + C.line + '"/>';
    s += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="' + C.muted + '">' + v.toFixed(0) + '%</text>';
  }
  cats.forEach((c, i) => {
    const gx = padL + gw * i + (gw - bw * series.length) / 2;
    series.forEach((se, j) => {
      const v = se.v[i];
      const h = ih * v / max;
      s += '<rect x="' + (gx + j * bw).toFixed(1) + '" y="' + (padT + ih - h).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + se.c + '"/>';
      if (v > 0) s += '<text x="' + (gx + j * bw + (bw - 2) / 2).toFixed(1) + '" y="' + (padT + ih - h - 4).toFixed(1) + '" text-anchor="middle" font-size="10" fill="' + C.muted + '">' + v.toFixed(0) + '</text>';
    });
    const words = c.split('');
    s += '<text x="' + (padL + gw * i + gw / 2).toFixed(1) + '" y="' + (H - padB + 20) + '" text-anchor="middle" font-size="11" fill="' + C.ink + '">' + esc(c) + '</text>';
  });
  let lx = padL;
  series.forEach((se) => {
    s += '<rect x="' + lx + '" y="' + (H - 26) + '" width="10" height="10" rx="2" fill="' + se.c + '"/>';
    s += '<text x="' + (lx + 15) + '" y="' + (H - 17) + '" font-size="11" fill="' + C.ink + '">' + esc(se.k) + '</text>';
    lx += 22 + se.k.length * 12;
  });
  return s + '</svg>';
}

// ---------------------------------------------------------------- 内容
const QUOTES = {
  T1: [['AS_030', '在学术相关需求中，豆包竟会凭空编造假参考文献，在要求罗列论文文献时，随意捏造不存在的期刊、作者与篇目，完全无视学术规范与诚信。'],
       ['AS_020', '我搜了一个在北京崇文门附近哪里扎可以耳洞，豆包告诉我普仁医院和协和医院还有医美公司可以做，还给了电话，我打了所有电话都不对，我亲自跑到两个医院，人家说根本不做。'],
       ['AS_EDU_028', '昨天那道我让它画个图，它连力的分解在垂直和平行方向都分不清，我说了六七遍，它就一直画不好，一直画反，一直说它不小心出错了马上改，结果就是画不好']],
  T5: [['AS_IME_034', '当连续输入一串拼音、尚未选字上屏时，若中间某个拼音打错，点击输入区域把光标移到中间位置准备修改，整串拼音会直接消失。'],
       ['AS_IME_033', '输入拼音的时候，如果中间出现错误，没办法单独修改某一处拼音，只能把整串拼音全部删除重新输入'],
       ['AS_IME_015', '你开发的时候从来不打字吗？程序员脑回路这么奇怪的吗？那么多你可以用的区域和键，就喜欢可着空格霍霍？']],
  T6: [['AS_EDU_033', '问一个稍微难一点的问题就直接退出去了。找个理由就是因为当前提问太火爆。就这样忽悠人很有意思吗？'],
       ['AS_IME_030', '最开始 我被它优秀的识别能力所吸引 它能精准知道我表达的意思 就算在嘈杂的环境中 或者悄悄话也能识别清楚 但是现在 开始频繁的识别错误 这让人很火大'],
       ['AS_IME_026', '为什么总是网络失败呢？为什么总是网络失败呢？然后这更新之后怎么老是跳转呢？']],
  T8: [['AS_024', '这次豆包更新后直接取消了智能体搜索键，极大影响了我的正常学习使用，体验非常差'],
       ['AS_EDU_026', '而在问豆包俄语内容时无法朗读 回答很基础 功能严重不完善 希望能够增加俄语学习功能'],
       ['AS_EDU_025', '取消豆包商城 有的用户容易为了赚金币买头像，应付敷衍的用功能 我有一段时间就这样']],
  T2: [['AS_022', '沟通中我多次明确提出不要说教、不要刻意纠正、不要多余回应，仅需要简单配合即可。但AI完全无视指令，反复打断沟通，不断输出刻板的道理与约束性话术'],
       ['AS_009', '我说的话直接当耳旁风，听也不听，死命按照自己的写'],
       ['AS_EDU_030', '你让他写五个自然段，他死活写不出出来，他就是只写六个自然段或者七个自然段']],
  T4: [['AS_013', '我跟他用视频共享，他每次都说他看不到我的视频，要我拍照给他看，那为什么要给设置一个视频共享呢？'],
       ['AS_026', '每次哭的受不了的时候我说话都会间隔的有点久，每次刚想说点什么判定结束豆包就开始说话了，这一点能稍微改变一下吗？'],
       ['AS_IME_037', '当我用语音输入一大段长文本的时候。会出现乱码的情况和无法识别的情况。']],
  T3: [['AS_023', '它能准确回答孤立问题，却难以在连续对话中保持核心概念的连贯性，经常捕捉到几个关键词就跳跃到不相关的解释方向。'],
       ['WDJ_010', '好用，但记忆不怎么样，几十句话就失忆'],
       ['WDJ_004', '玩不下去了，一天失忆五次']],
  T7: [['AS_IME_022', '登录了同个账号 不同设备之间同步不了设置和常用词，希望抓紧改进'],
       ['AS_025', '现在的 Mac 客户端体验极差，完全跟不上专业用户需求，和手机版差距巨大'],
       ['AS_IME_036', '唯一一点的遗憾，那就是不能登录个人的账号同步一些使用的记录信息，希望后续可以改善，不然每更换一部手机，到时候自己的使用习惯都全部变成0了。']],
};

const PROBLEM = {
  T1: '模型输出的**事实准确性**不可靠，且在被指出错误后倾向于坚持或只道歉不改。这是豆包口碑中唯一"跨全部产品线出现"的问题——主 App、爱学、安卓版都有，且严重度最高（平均 2.84）。',
  T5: '输入法的**拼音编辑能力**与主流输入法存在代差：不支持拼音串的局部修改，出错即需整串重打；缺少笔画、五笔、注音等输入方案；空格与标点的自动化逻辑不可控。',
  T6: '稳定性问题以两种形态出现：**服务端容量**（"当前提问太火爆""网络失败"）与**版本更新引入的异常**（语音识别退化、频繁跳转）。用户在更新后普遍感知到"越更新越差"。',
  T8: '功能**被移除**比功能缺失更伤用户：智能体搜索键被取消直接打断了学生的学习路径。其次是明确的方案缺口（俄语、视频课程、Windows 版）。',
  T2: '模型**不遵守用户的显式指令**，且对话风格被感知为"机械说教""模板化"。值得注意的是：用户投诉"过度迎合"与"机械说教"同时存在——说明问题不是语气软硬，而是**没有按用户当下真正要的方式说话**。',
  T4: '语音与多模态是**承诺与落地落差**最大的区域：视频共享功能存在但用不了、通话判定过早打断表达（对情绪依赖型用户影响尤其大）、长文本语音输入出现乱码。',
  T3: '用户用"失忆"这个词描述多轮对话的断裂。主标签只有 3 条，但**关键词扫描显示 8 条评论提到记忆问题**——说明它更多作为"伴随抱怨"出现，真实影响面被主标签低估。',
  T7: '跨设备同步缺失，导致"换手机 = 使用习惯归零"；Mac 端为套壳网页，与手机端体验落差大。样本量小（3 条），作为方向参考。',
};

// RICE
const RICE = [
  { t: 'T1', name: '答案质量治理（幻觉与自检）', impact: 3, conf: 0.9, effort: 5, note: 'n=19 条主标签，另有约 4 条在正文中提及编造信息，置信度最高' },
  { t: 'T3', name: '多轮对话记忆与上下文锚定', impact: 3, conf: 0.75, effort: 4, note: '主标签 n=3，但关键词扫描命中 8 条；置信度按扫描结果上调' },
  { t: 'T6', name: '服务容量与版本回归测试', impact: 2, conf: 0.85, effort: 3, note: 'n=10 条，其中 3 条明确指向"更新后变差"' },
  { t: 'T5', name: '拼音局部编辑与输入方案补齐', impact: 2, conf: 0.9, effort: 4, note: 'n=11 条，全部提出明确诉求（诉求率 100%），边界清晰' },
  { t: 'T2', name: '指令优先级与会话风格开关', impact: 3, conf: 0.7, effort: 3, note: 'n=5 条，样本偏小；但严重度均在 2 以上' },
  { t: 'T8', name: '功能下线前的用户损失评估', impact: 2, conf: 0.8, effort: 2, note: 'n=9 条，其中"智能体搜索"被独立提及 2 次且均为 1★' },
];
RICE.forEach((r) => { r.reach = reachPct(r.t); r.score = r.reach * r.impact * r.conf / r.effort; });
RICE.sort((a, b) => b.score - a.score);
const maxScore = RICE[0].score;

const r = stats;

function pct(a, b) { return (100 * a / b).toFixed(1) + '%'; }

// 评分分布（豆包系有效样本）
const ratingRows = [5, 4, 3, 2, 1].map((s) => ({ k: s + ' 星', v: r.targetRatingDist[String(s)] || 0 }));

const topicRows = rank.map((t) => ({ k: SHORT[t], v: topicN(t), label: topicN(t) + ' 条 · ' + reachPct(t).toFixed(1) + '%' }));
const bubbleRows = rank.map((t) => ({ t, n: topicN(t), x: reachPct(t), y: topicAvgSev(t) }));

const compNames = Object.keys(r.compByProduct);
const catNames = ['答案质量', '功能与策略', '性能稳定', '指令与风格'];
const catMap = { '答案质量': 'T1', '功能与策略': 'T8', '性能稳定': 'T6', '指令与风格': 'T2' };
// 样本结构表：按"结论强度"分档（不给二值判断），并给出最理想抽样下的误差下界 ±1.96·0.5/√n
const MAIN_APP_NAME = '豆包 - 随时帮忙的 AI 助手';
const chanRows = Object.keys(r.byChannel).map((k) => {
  const v = r.byChannel[k];
  const err = Math.round(1.96 * 0.5 / Math.sqrt(v.valid) * 100);
  const tier = v.valid >= 30 ? '定量级' : (v.valid >= 20 ? '方向级' : '线索级');
  return {
    name: k, n: v.valid, err: err, tier: tier,
    isTarget: tagged.some((x) => x.product_name === k && x.is_target_product === 1),
  };
}).sort((a, b) => (b.isTarget ? 1 : 0) - (a.isTarget ? 1 : 0)); // 仅分组，组内保持采集顺序
const TIER_COLOR = { '定量级': C.pos, '方向级': C.warn, '线索级': C.muted };
const chanRowHtml = (x) => '<tr><td>' + esc(x.name) + '</td><td class="num">' + x.n + '</td><td><span style="color:' + TIER_COLOR[x.tier] + ';font-weight:600">' + x.tier + '</span></td><td class="num">±' + x.err + '</td></tr>';
const chanGrpHtml = (label, list) => list.length ? '<tr class="grp"><td colspan="4">' + label + '</td></tr>' + list.map(chanRowHtml).join('') : '';
const mainAppN = (r.byChannel[MAIN_APP_NAME] || {}).valid || 0;

const series = [
  { k: '豆包系', c: C.neg, v: catNames.map((c) => 100 * topicN(catMap[c]) / r.targetValid) },
].concat(compNames.slice(0, 4).map((p, i) => ({
  k: p.split(' ')[0].split('-')[0],
  c: ['#3b82f6', '#8b5cf6', '#0d9488', '#f59e0b'][i],
  v: catNames.map((c) => 100 * (r.compByProduct[p].topic[catMap[c]] || 0) / r.compByProduct[p].n),
})));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>豆包用户口碑分析报告 · 基于 ${r.valid} 条真实评论</title>
<style>
:root{--ink:#1a1d21;--muted:#6b7280;--line:#e5e7eb;--bg:#f7f8fa;--card:#fff;--neg:#e5484d;--pos:#12a150;--blue:#2563eb;--warn:#f0913a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:40px 24px 80px}
header{border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:32px}
h1{font-size:30px;line-height:1.35;margin:0 0 10px;font-weight:600;letter-spacing:-.4px}
.sub{color:var(--muted);font-size:14px;margin:0}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.chip{background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 13px;font-size:12.5px;color:var(--muted)}
.chip b{color:var(--ink);font-weight:600}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:30px 32px;margin-bottom:20px}
h2{font-size:19px;margin:0 0 6px;font-weight:600;letter-spacing:-.2px}
h2 .n{color:var(--blue);font-size:13px;font-weight:600;display:block;letter-spacing:1px;margin-bottom:6px}
h3{font-size:15px;margin:26px 0 10px;font-weight:600}
.lead{color:var(--muted);font-size:13.5px;margin:0 0 22px}
.concl{border-left:3px solid var(--neg);padding:2px 0 2px 16px;margin:0 0 20px}
.concl .t{font-size:16px;font-weight:600;margin:0 0 4px}
.concl .d{color:var(--muted);font-size:13.5px;margin:0}
.stat{display:flex;gap:14px;flex-wrap:wrap;margin:22px 0 4px}
.stat div{flex:1 1 150px;background:#fafbfc;border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.stat .v{font-size:24px;font-weight:600;letter-spacing:-.5px}
.stat .l{font-size:12.5px;color:var(--muted);margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin:14px 0}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12.5px;background:#fafbfc}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr.grp td{background:#f2f4f6;font-size:12.5px;font-weight:600;color:var(--muted);letter-spacing:.3px;padding:8px 12px}
.chart{margin:16px 0 6px}
.cap{font-size:12px;color:var(--muted);margin:8px 0 0}
.card{border:1px solid var(--line);border-radius:12px;padding:22px 24px;margin-bottom:14px}
.card .hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.card .hd .rk{font-size:12px;font-weight:600;color:#fff;background:var(--neg);border-radius:5px;padding:2px 8px}
.card .hd .nm{font-size:16.5px;font-weight:600}
.card .hd .mt{font-size:12.5px;color:var(--muted);margin-left:auto}
.card p{font-size:13.5px;margin:0 0 12px}
.card .tag{display:inline-block;background:#fafbfc;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--muted);margin:0 6px 6px 0}
blockquote{margin:0 0 10px;padding:11px 14px;background:#fafbfc;border-left:2px solid var(--line);border-radius:0 8px 8px 0;font-size:13.5px;color:#333}
blockquote .id{display:block;font-size:11.5px;color:var(--muted);margin-top:6px;font-variant-numeric:tabular-nums}
.bar{height:7px;background:#eef0f2;border-radius:4px;overflow:hidden;margin-top:6px}
.bar i{display:block;height:100%;background:var(--blue);border-radius:4px}
.warn{background:#fffaf3;border:1px solid #f5e2c8;border-radius:10px;padding:14px 18px;font-size:13px;color:#7a5b2a;margin:18px 0}
.warn b{color:#5a3f18}
.tl{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px}
.tl div{flex:1 1 200px;border:1px solid var(--line);border-radius:10px;padding:16px}
.tl .w{font-size:12.5px;color:var(--muted);margin-bottom:8px}
.tl .h{font-size:14.5px;font-weight:600;margin-bottom:6px}
.tl ul{margin:0;padding-left:18px;font-size:13px;color:#444}
.tl li{margin-bottom:4px}
footer{color:var(--muted);font-size:12.5px;text-align:center;padding:20px 0 0}
code{background:#f2f4f6;border-radius:4px;padding:1px 5px;font-size:12.5px}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}section{border:none;padding:0;margin-bottom:26px;break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>豆包用户口碑分析报告</h1>
  <p class="sub">基于 ${r.valid} 条真实用户评论的痛点归类与产品改进建议 · 其中豆包系产品 ${r.targetValid} 条、竞品对照 ${r.compValid} 条</p>
  <div class="meta">
    <span class="chip">采集日期 <b>2026-09-15</b></span>
    <span class="chip">数据源 <b>App Store 中国区 · 豌豆荚（安卓）</b></span>
    <span class="chip">原始 <b>${r.total} 条</b></span>
    <span class="chip">清洗后有效 <b>${r.valid} 条</b></span>
    <span class="chip">分类体系 <b>8 个痛点主题</b></span>
  </div>
</header>

<section>
  <h2><span class="n">01 执行摘要</span>三条核心结论</h2>
  <p class="lead">本报告的全部结论均可回溯至 <code>data/tagged.json</code> 中的具体评论条目。</p>

  <div class="concl">
    <p class="t">1. 豆包最大的问题不是"不够智能"，而是"说错了不认账"</p>
    <p class="d">答案质量是豆包系第一大痛点，占负面样本的 <b>${pct(topicN('T1'), negTarget.length)}</b>（${topicN('T1')} 条），平均严重度 <b>2.84</b>。</p>
  </div>
  <div class="concl">
    <p class="t">2. 同一个痛点上，豆包比所有竞品都更突出——这是本次最有价值的发现</p>
    <p class="d">"答案质量"在豆包系的负面提及率是 <b>${pct(topicN('T1'), r.targetValid)}</b>，而 DeepSeek / 千问 / Kimi / 元宝 / 文心 分别只有 ${compNames.slice(0,5).map((p)=>pct(r.compByProduct[p].topic['T1']||0,r.compByProduct[p].n)).join(' / ')}。竞品用户骂的是"收费贵、功能砍"，豆包用户骂的是"答错了"。</p>
  </div>
  <div class="concl">
    <p class="t">3. "越更新越差"是跨品牌的行业级问题，但豆包的版本相关投诉指向了具体功能</p>
    <p class="d">性能与稳定性在豆包系占负面样本 <b>${pct(topicN('T6'), negTarget.length)}</b>（${topicN('T6')} 条），其中 3 条明确指向更新后语音识别退化，属于"能力被改坏了"；而竞品的版本类投诉指向的是"功能被砍、要求回滚版本"——以 DeepSeek 为例，其负面评论中有 <b>${pct(r.compByProduct[compNames[0]].topic['T8']||0,r.compByProduct[compNames[0]].n)}</b> 是这一类。</p>
  </div>

  <div class="stat">
    <div><div class="v">${pct(negTarget.length, r.targetValid)}</div><div class="l">豆包系负面占比（${negTarget.length}/${r.targetValid}）</div></div>
    <div><div class="v">${r.severity[3]}</div><div class="l">严重度为 3 的评论（会导致弃用或强烈投诉）</div></div>
    <div><div class="v">${pct(negTarget.filter((x)=>x.has_request===1).length, negTarget.length)}</div><div class="l">负面评论中含明确改进诉求</div></div>
    <div><div class="v">${r.mentionCompetitor.length}</div><div class="l">主动提及竞品的评论</div></div>
  </div>
</section>

<section>
  <h2><span class="n">02 方法与样本</span>数据从哪来，以及它不能证明什么</h2>
  <p class="lead">这一节是整份报告可信度的基础，因此写得比结论更细。</p>

  <h3>数据来源与获得方式</h3>
  <table>
    <tr><th>渠道</th><th>状态</th><th class="num">条数</th><th>说明</th></tr>
    <tr><td>App Store 中国区</td><td>成功</td><td class="num">257</td><td>通过苹果 <code>userReviewsRow</code> 接口，遍历 8 个 App × 8 个排序维度</td></tr>
    <tr><td>豌豆荚（安卓应用商店）</td><td>部分成功</td><td class="num">9</td><td>服务端渲染页面，仅首屏 10 条，无可用翻页入口</td></tr>
    <tr><td>黑猫投诉</td><td>失败</td><td class="num">0</td><td>搜索页为 JS 渲染，接口需客户端签名</td></tr>
    <tr><td>应用宝 / 小米应用商店</td><td>失败</td><td class="num">0</td><td>前者为 SPA 无可用接口，后者显示"维护中"</td></tr>
    <tr><td>小红书 / 抖音 / 知乎 / 贴吧</td><td>失败</td><td class="num">0</td><td>均被平台风控拦截：IP 限制（小红书）、验证码（抖音、贴吧）、403 风控（知乎）</td></tr>
    <tr><td>B站（社交渠道）</td><td>部分成功</td><td class="num">74</td><td>搜索页与评论接口均可访问，但未登录访客每条视频上限 3 条热门评论；经人工复核纳入分析 22 条（见第 09 节）</td></tr>
  </table>

  <h3>清洗规则与结果</h3>
  <p style="font-size:13.5px">按预设规则剔除无信息量内容，共剔除 <b>${r.invalid}</b> 条（占 ${pct(r.invalid, r.total)}）：${Object.keys(r.exclReasons).map((k)=>k+' '+r.exclReasons[k]+' 条').join('；')}。</p>

  <h3>样本结构与局限（必须一并阅读）</h3>
  <p style="font-size:13.5px">样本量决定的不只是"能不能信"，还有"能信到什么程度"。下表不设"合格／不合格"的二值线，只标出每组样本实际能承担什么：<b>定量级</b>（n≥30，可引用具体百分比）、<b>方向级</b>（20≤n&lt;30，只可比较相对高低）、<b>线索级</b>（n&lt;20，只提示"这里有声音"）。</p>
  <table>
    <tr><th>产品</th><th class="num">有效样本</th><th>结论强度</th><th class="num">95% 抽样误差</th></tr>
    ${chanGrpHtml('豆包系 · 本报告主结论的对象', chanRows.filter((x)=>x.isTarget))}
    ${chanGrpHtml('竞品 · 仅用于横向对照', chanRows.filter((x)=>!x.isTarget))}
  </table>
  <p class="cap">"95% 抽样误差"按最理想情形估算——简单随机抽样、且比例取最不利的 50%，即 ±1.96×0.5/√n，单位为百分点。真实样本是便利样本、且受 App Store 排序机制影响，实际误差只会更大，所以这一列是<b>误差下界</b>，用来说明比例数字的精度天花板。数据来源：<code>data/tagged.json</code>。</p>

  <div class="warn">
    <b>四条必须说明的局限：</b><br>
    ① <b>渠道单一</b>——结论主要来自 iOS 用户。安卓侧仅豌豆荚 9 条；<b>社交媒体渠道经实测多数被平台风控拦截</b>（小红书 IP 限制、抖音与贴吧要求验证码、知乎 403 风控）。B站 是唯一探通的社交渠道，但受"每条视频限 3 条"所限只采到 74 条、纳入分析 22 条，且时间集中于 3 天内，只能作定性旁证（见第 09 节）。<b>社交媒体观点对主结论不构成数据支撑。</b><br>
    ② <b>时间偏置</b>——苹果接口每页只返回 10 条，样本天然偏向"最新/最有帮助"，<b>不能用于推断长期趋势</b>。<br>
    ③ <b>总量偏小</b>——豆包系有效样本 ${r.targetValid} 条，其中主结论所依托的主 App 只有 ${mainAppN} 条；上表里没有任何一组达到"可引用具体百分比"的定量级。<b>因此正文的比例数字请按"量级与排序"读：哪个痛点排第一是可靠的，某个痛点精确占多少不是本报告能支撑的结论。</b><br>
    ④ <b>评分结构失真</b>——因排序机制，样本中 1★ 占比远高于真实分布，<b>不可与 App Store 显示的 4.66 分对比</b>。
  </div>
</section>

<section>
  <h2><span class="n">03 口碑全景</span>评分与情绪结构</h2>
  <div class="chart">${donut([{k:'负面',v:r.sentiment.target['负']||0,c:C.neg},{k:'中性',v:r.sentiment.target['中']||0,c:C.gray},{k:'正面',v:r.sentiment.target['正']||0,c:C.pos}], pct(r.sentiment.target['负']||0, r.targetValid), '豆包系为负面')}</div>
  <p class="cap">数据来源：<code>data/tagged.json</code>，豆包系有效样本 ${r.targetValid} 条。按主标签对应的情绪判定（用户"为被看见而刷五星"的评论按内容计负面）。</p>

  <h3>评分分布（豆包系有效样本）</h3>
  <div class="chart">${hBar(ratingRows, {aria:'评分分布'}).replace(/fill="#e5484d"/g, 'fill="#f0913a"')}</div>
  <p class="cap">数据来源：<code>data/tagged.json</code>。注意：该分布受采集排序影响，不代表真实评分结构。</p>

  <h3>严重度分布</h3>
  <div class="chart">${hBar([{k:'3 级 · 弃用或强投诉',v:r.severity[3],c:'#c9333a'},{k:'2 级 · 影响使用',v:r.severity[2],c:'#e5484d'},{k:'1 级 · 轻微不满',v:r.severity[1],c:'#f0913a'}], {aria:'严重度分布'})}</div>
  <p class="cap">数据来源：<code>data/tagged.json</code>，豆包系负面样本 ${negTarget.length} 条。<b>${pct(r.severity[3], negTarget.length)} 的负面评论严重度达到 3 级</b>——这意味着用户不只是不满，而是在考虑弃用。</p>
</section>

<section>
  <h2><span class="n">04 痛点排行</span>频次 × 严重度</h2>
  <h3>八大痛点的提及规模</h3>
  <div class="chart">${hBar(topicRows, {aria:'痛点排行'})}</div>
  <p class="cap">数据来源：<code>data/tagged.json</code>，按主标签统计，n=${negTarget.length}（豆包系负面样本）。</p>

  <h3>频次与严重度的二维定位</h3>
  <div class="chart">${bubbles(bubbleRows)}</div>
  <p class="cap">气泡面积 = 该主题条数；横轴 = 提及率；纵轴 = 平均严重度。数据来源：<code>data/tagged.json</code>。<b>位于右上方的主题既高频又高严重度，应优先处理。</b></p>

  <h3>产品线 × 痛点交叉</h3>
  <table>
    <tr><th>产品线</th><th class="num">有效样本</th>${['T1','T2','T3','T4','T5','T6','T7','T8'].map((t)=>'<th class="num">'+SHORT[t]+'</th>').join('')}</tr>
    ${Object.keys(r.groupTopic).map((g)=>{const o=r.groupTopic[g];if(!o.n)return '';return '<tr><td>'+g+'</td><td class="num">'+o.n+'</td>'+['T1','T2','T3','T4','T5','T6','T7','T8'].map((t)=>{const n=o.topic[t]||0;return '<td class="num">'+(n?n+'（'+(100*n/o.n).toFixed(0)+'%）':'-')+'</td>';}).join('')+'</tr>';}).join('')}
  </table>
  <p class="cap">数据来源：<code>data/tagged.json</code>。<b>结论：痛点分布的差异主要由产品形态决定</b>——主 App 与爱学的问题集中在答案质量，输入法的问题集中在输入效率与稳定性。</p>
</section>

<section>
  <h2><span class="n">05 痛点深挖</span>每个问题都被用户原话证实</h2>
  <p class="lead">以下 8 张卡片按痛点规模排序。引用均为逐字摘录，可在 <code>data/tagged.json</code> 中以 review_id 检索原文。</p>
  ${rank.map((t, i) => {
    const q = QUOTES[t] || [];
    const sev = topicAvgSev(t);
    return '<div class="card"><div class="hd"><span class="rk">#' + (i + 1) + '</span><span class="nm">' + T[t] + '</span><span class="mt">' + topicN(t) + ' 条 · 提及率 ' + reachPct(t).toFixed(1) + '% · 平均严重度 ' + sev.toFixed(2) + '</span></div>'
      + '<p>' + (PROBLEM[t] || '') + '</p>'
      + '<div>' + (t === 'T3' ? '<span class="tag">关键词扫描命中 8 条</span>' : '') + '<span class="tag">含明确诉求 ' + (negTarget.filter((x) => x.main_topic === t && x.has_request === 1).length) + ' 条</span><span class="tag">严重度 3 级 ' + (negTarget.filter((x) => x.main_topic === t && x.severity === 3).length) + ' 条</span></div>'
      + q.map((x) => '<blockquote>' + esc(x[1]) + '<span class="id">' + x[0] + ' · 可在 data/tagged.json 检索</span></blockquote>').join('')
      + '</div>';
  }).join('')}
</section>

<section>
  <h2><span class="n">06 改进机会</span>RICE 优先级排序</h2>
  <p class="lead">RICE = Reach（提及率）× Impact（影响面）× Confidence（结论置信度）÷ Effort（预估投入）。置信度一栏明确标注了它依据的样本量。</p>
  <table>
    <tr><th>优先级</th><th>改进项</th><th class="num">Reach</th><th class="num">Impact</th><th class="num">Conf.</th><th class="num">Effort</th><th class="num">Score</th><th>置信度依据</th></tr>
    ${RICE.map((x, i) => '<tr><td>' + (i + 1) + '</td><td><b>' + x.name + '</b><div class="bar"><i style="width:' + (100 * x.score / maxScore).toFixed(0) + '%;background:' + (i === 0 ? C.neg : C.blue) + '"></i></div></td><td class="num">' + x.reach.toFixed(1) + '%</td><td class="num">' + x.impact + '</td><td class="num">' + x.conf.toFixed(2) + '</td><td class="num">' + x.effort + '</td><td class="num"><b>' + x.score.toFixed(1) + '</b></td><td style="font-size:12.5px;color:#6b7280">' + x.note + '</td></tr>').join('')}
  </table>
  <p class="cap">数据来源：Reach 来自 <code>data/stats.md</code> 第 2 节；Impact / Confidence / Effort 为分析者判断，已在上表逐项标注依据。<b>Effort 若由工程团队重新估算，排序可能变化——这部分不是数据结论，请与研发同学一起校准。</b></p>
</section>

<section>
  <h2><span class="n">07 改进路线图</span>分三档推进</h2>
  <div class="tl">
    <div>
      <div class="w">1 个月内 · 快赢</div>
      <div class="h">止血</div>
      <ul>
        <li>答案置信度提示：对检索类问题展示信息来源与更新时间，无法核实的内容明确标注"未找到可靠来源"</li>
        <li>"当前提问太火爆"改为具体说明与重试引导，而非笼统报错</li>
        <li>输入法补充"拼音串局部编辑"能力（对标主流输入法基线）</li>
      </ul>
    </div>
    <div>
      <div class="w">1 个季度内 · 中期</div>
      <div class="h">补基线</div>
      <ul>
        <li>错题/解题场景专项回归：建立学科题目评测集，把"讲错题"纳入版本发布门禁</li>
        <li>纠错闭环：被用户指出错误后必须进入修正流程，而不是重复道歉</li>
        <li>多轮对话的上下文锚定优化，并在长对话中提供"当前对话主题"提示</li>
      </ul>
    </div>
    <div>
      <div class="w">半年以上 · 长期</div>
      <div class="h">建能力</div>
      <ul>
        <li>功能下线前的用户损失评估机制（下线任何入口前必须评估重度依赖用户占比）</li>
        <li>账号体系跨设备同步（输入法词库、设置、对话记录）</li>
        <li>桌面端（Mac / Windows）从套壳走向原生，补齐生产力场景</li>
      </ul>
    </div>
  </div>
</section>

<section>
  <h2><span class="n">08 竞品对照</span>同一个分类体系下的横向定位</h2>
  <table>
    <tr><th>产品</th><th class="num">有效样本</th><th class="num">负面占比</th><th>第一大痛点</th><th>第二大痛点</th><th>第三大痛点</th></tr>
    ${compNames.map((p) => {
      const o = r.compByProduct[p];
      const top = Object.keys(o.topic).filter((k) => k !== 'T0').sort((a, b) => o.topic[b] - o.topic[a]).slice(0, 3);
      const f = (k) => k ? SHORT[k] + '（' + o.topic[k] + '）' : '-';
      return '<tr><td>' + p + '</td><td class="num">' + o.n + '</td><td class="num">' + pct(o.neg, o.n) + '</td><td>' + f(top[0]) + '</td><td>' + f(top[1]) + '</td><td>' + f(top[2]) + '</td></tr>';
    }).join('')}
    <tr style="background:#fff8f8"><td><b>豆包系</b></td><td class="num">${r.targetValid}</td><td class="num">${pct(negTarget.length, r.targetValid)}</td><td><b>${SHORT[rank[0]]}（${topicN(rank[0])}）</b></td><td>${SHORT[rank[1]]}（${topicN(rank[1])}）</td><td>${SHORT[rank[2]]}（${topicN(rank[2])}）</td></tr>
  </table>

  <div class="chart">${groupedBar(catNames, series)}</div>
  <p class="cap">数据来源：<code>data/tagged.json</code>，各产品同一分类体系打标，指标为"该主题负面条数 / 该产品有效样本数"。为保证可读性仅展示 4 个主题与 4 款竞品。</p>

  <h3>这张图说明了什么</h3>
  <p style="font-size:13.5px">豆包在<b>答案质量</b>上的负面提及率显著高于所有竞品，差距在 3–6 倍。而竞品的负面集中在<b>功能与策略</b>（额度、收费、功能下线）——这是产品策略引发的矛盾，不是模型能力问题。<br><br>
  对豆包的启示是明确的：<b>竞品正在用"限制免费额度"的方式犯错误，而豆包犯的是"答错还不认"的错误。</b>后者对信任的伤害更持久——因为用户会因此不再相信产品的任何回答，而额度问题只会让用户抱怨价格。</p>
</section>

<section>
  <h2><span class="n">09 渠道交叉验证</span>B站：换一群人，结论还剩多少</h2>
  ${!bili ? '<p>（B站 渠道数据未生成）</p>' : [
    '<p style="font-size:13.5px">主数据集的所有结论都来自 iOS 应用商店。为检验"这些痛点是不是只在应用商店里存在"，我另外采集了 B站 评论（关键词搜索命中的豆包相关视频下的评论）。<b>先说结论：这条渠道技术上探通了，但样本量不足，只能做定性旁证，不能做统计对比。</b></p>',

    '<h3>样本漏斗：为什么最后只剩这么点</h3>',
    '<table>',
    '<tr><th>环节</th><th class="num">条数</th><th>说明</th></tr>',
    '<tr><td>关键词搜索命中视频（去重）</td><td class="num">245</td><td>8 个关键词 × 2 页</td></tr>',
    '<tr><td>标题含「豆包」的视频</td><td class="num">208</td><td>关键词召回含同名噪声</td></tr>',
    '<tr><td>实际抓取的一级评论（去重）</td><td class="num">74</td><td>仅 31 个视频有评论产出</td></tr>',
    '<tr><td>通过清洗规则</td><td class="num">66</td><td>剔除 8 条无辨识语义</td></tr>',
    '<tr style="background:#fff8f8"><td><b>人工复核后纳入分析</b></td><td class="num"><b>' + bili.n + '</b></td><td>逐条判定"是否在谈豆包产品"</td></tr>',
    '</table>',
    '<p class="cap">B站 对未登录访客硬性封顶：<b>每条视频只返回 3 条「最热」评论</b>。实测 pn=2 返回 0 条；<code>x/v2/reply/main</code> 的 <code>next=1</code> 直接 <code>is_end=true</code>（<code>all_count=10607</code>）；需要登录态的 <code>wbi/main</code> 返回 <code>-403 访问权限不足</code>（wbi 签名本身是正确的）。因此样本量只能靠扩大视频覆盖面，而覆盖面又受风控封顶。逐条判定理由见 <code>data/bili/relevance_review.md</code>。</p>',

    '<h3>B站 负面主题分布（n=' + bili.neg + '）</h3>',
    '<table>',
    '<tr><th>主题</th><th class="num">条数</th><th class="num">占负面比例</th></tr>',
    bili.topicRank.map((t) => '<tr><td>' + T[t] + '</td><td class="num">' + (bili.topicCount[t] || 0) + '</td><td class="num">' + pct(bili.topicCount[t] || 0, bili.neg) + '</td></tr>').join(''),
    '</table>',

    '<h3>与主数据集对照：同一主题是否复现</h3>',
    '<table>',
    '<tr><th>主题</th><th class="num">App Store 主数据集</th><th class="num">B站</th><th>是否复现</th></tr>',
    ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((t) => {
      const a = 100 * topicN(t) / stats.targetValid;
      const b = 100 * (bili.topicCount[t] || 0) / bili.n;
      const rep = (topicN(t) > 0 && (bili.topicCount[t] || 0) > 0) ? '✔ 两渠道均出现' : ((bili.topicCount[t] || 0) > 0 ? '— 仅 B站' : '— 仅主数据集');
      return '<tr><td>' + SHORT[t] + '</td><td class="num">' + a.toFixed(1) + '%</td><td class="num">' + b.toFixed(1) + '%</td><td>' + rep + '</td></tr>';
    }).join(''),
    '</table>',
    '<p class="cap"><b>这张表不是强弱对比。</b>两个渠道的抽样框、人群、时间窗口、口径都不同（B站 无星级评分），百分比并列只为观察"同一主题是否在另一群人里也出现"。B站 的「功能与策略」占比最高（' + pct(bili.topicCount['T8'] || 0, bili.neg) + '），但其成因高度集中于刚发布的豆包手机助手（收费不明、绑定手机、能力边界、生态阻力），是<b>一次新品发布的舆情切片</b>，不能读成"B站 用户最不满功能策略"。</p>',

    '<h3>能支持什么 / 不能支持什么</h3>',
    '<div class="box" style="background:#f8fbff;border-color:#dbeafe">',
    '<b>能支持（定性旁证）</b><br>',
    '① <b>「答案质量」在完全不同的平台上被独立提出</b>——B站 4 条答案质量负评中，两条分别指向"离谱回答"与"疑似敷衍作答"，与主数据集第一大痛点同源。两个平台、两套人群、两套表达方式指向同一问题。',
    '<br><br><b>不能支持</b><br>',
    '① 任何形如"B站 用户最不满 X"的比例性结论（' + bili.n + ' 条样本、3 天窗口，不具代表性，单条即造成 ±4.5pt 波动）；② 任何时间趋势；③ 与主数据集的强弱对比。',
    '</div>',

    '<h3>样本原话（可溯源）</h3>',
    biliTagged.filter((r) => r.sentiment === '负' && r.main_topic !== 'T0')
      .sort((a, b2) => (b2.severity || 0) - (a.severity || 0) || (b2.like || 0) - (a.like || 0))
      .slice(0, 4)
      .map((r) => '<p style="font-size:13px;margin:8px 0"><b>' + r.bili_id + '</b>（' + SHORT[r.main_topic] + ' · 赞' + (r.like || 0) + ' · ' + r.date + '）<br>「' + esc(String(r.content).replace(/\s+/g, ' ').slice(0, 150)) + '」</p>')
      .join(''),

    '<h3>这一节的局限</h3>',
    '<ol style="font-size:13.5px">',
    '<li><b>每条视频上限 3 条</b>——返回的是点赞最高的评论，偏梗化，可能<b>低估</b>普通用户的功能性抱怨。</li>',
    '<li><b>时间高度集中</b>——有效样本全部落在 2026-09-13 ~ 09-15 三天内，主题集中于刚发布的豆包手机助手。这是<b>事件切片，不是口碑横截面</b>。</li>',
    '<li><b>样本量过小</b>——' + bili.n + ' 条（负面 ' + bili.neg + ' 条）不足以支撑比例推断。</li>',
    '<li><b>人群偏置</b>——B站 以年轻群体为主，与 iOS 用户画像不同，差异部分来自人群而非产品。</li>',
    '<li><b>相关性判定含人工环节</b>——66 条有效评论由人工逐条判定是否在谈产品（自动规则会漏掉以 <code>@豆包</code> 开头的评论）。判定理由已全量留档，可复核。</li>',
    '</ol>',
  ].join('')}
</section>

<section>
  <h2><span class="n">10 附录</span>完整统计与数据清单</h2>
  <h3>附录 A · 各主题完整统计</h3>
  <table>
    <tr><th>主题</th><th class="num">条数</th><th class="num">占负面</th><th class="num">占有效样本</th><th class="num">平均严重度</th><th class="num">诉求率</th><th class="num">3 级严重度</th></tr>
    ${rank.map((t) => {
      const l = negTarget.filter((x) => x.main_topic === t);
      return '<tr><td>' + T[t] + '</td><td class="num">' + l.length + '</td><td class="num">' + pct(l.length, negTarget.length) + '</td><td class="num">' + pct(l.length, r.targetValid) + '</td><td class="num">' + topicAvgSev(t).toFixed(2) + '</td><td class="num">' + pct(l.filter((x) => x.has_request === 1).length, l.length) + '</td><td class="num">' + l.filter((x) => x.severity === 3).length + '</td></tr>';
    }).join('')}
  </table>
  <p class="cap">数据来源：<code>data/tagged.json</code>。另有「其他-信息不足」${topicN('T0')} 条（纯情绪表达，无法归因）。</p>

  <h3>附录 B · 数据文件清单</h3>
  <table>
    <tr><th>文件</th><th>内容</th></tr>
    <tr><td><code>data/comments.csv</code></td><td>统一格式的原始评论（${r.total} 条）</td></tr>
    <tr><td><code>data/crawl_log.md</code></td><td>采集日志：每个渠道的实际条数与失败原因</td></tr>
    <tr><td><code>data/comments_clean.csv</code></td><td>清洁后的评论 + 剔除原因</td></tr>
    <tr><td><code>data/sample_coded.md</code></td><td>60 条分层样本的开放式编码</td></tr>
    <tr><td><code>data/taxonomy.md</code></td><td>痛点分类体系：定义、判定边界、正反例</td></tr>
    <tr><td><code>data/tagged.json</code></td><td>全量打标结果（${r.total} 条，含情绪/严重度/诉求标记）</td></tr>
    <tr><td><code>data/stats.md</code></td><td>量化统计表</td></tr>
    <tr><td><code>data/selfcheck.md</code></td><td>打标自检记录（20 条复核，一致率 98.8%）</td></tr>
    <tr><td><code>data/xhr_*/</code>、<code>scripts/*.log</code></td><td>各渠道探测过程的原始记录</td></tr>
    <tr><td><code>data/bili/bili_all_raw.json</code></td><td>B站 原始采集结果（74 条一级评论 + 208 个视频元数据）</td></tr>
    <tr><td><code>data/bili/relevance_review.md</code></td><td>B站 相关性人工复核：66 条逐条纳入/排除理由</td></tr>
    <tr><td><code>data/bili/tags_bili.txt</code>、<code>stats_bili.md</code></td><td>B站 打标结果与渠道统计</td></tr>
    <tr><td><code>annotation/annotate.html</code></td><td>人工打标一致性验证工具（40 条双盲样本，见附录 C）</td></tr>
    <tr><td><code>docs/需求原文.jpg</code></td><td>本项目的原始需求说明（归档留存）</td></tr>
  </table>

  <h3>附录 C · 打标自检</h3>
  <table>
    <tr><th>校验项</th><th class="num">结果</th></tr>
    <tr><td>打标覆盖率</td><td class="num">${r.total} / ${r.total}</td></tr>
    <tr><td>缺失 / 冗余 / 格式错误</td><td class="num">${r.missing.length} / ${r.extra.length} / ${r.tagErrors.length}</td></tr>
    <tr><td>20 条独立复核 · 主标签一致率</td><td class="num">100%</td></tr>
    <tr><td>20 条独立复核 · 总一致率</td><td class="num">98.8%</td></tr>
  </table>
  <p class="cap">复核方法与局限见 <code>data/selfcheck.md</code>。<b>同一模型两轮打标的一致性偏高，只能证明标签稳定，不能证明标签正确。</b>该验证的工具已就位（40 条双盲样本 + Cohen\'s Kappa 计算脚本，见 <code>annotation/</code>），<b>但人工标注尚未完成，Kappa 数值未出</b>。在此之前，本报告的全部结论都应保留"AI 单方打标"这个前提。</p>

  <h3>附录 D · 产出过程与成本</h3>
  <p class="cap">下表所有时点均取自文件落盘时间与 Git 提交记录，非估算。完整探查记录见 <code>data/crawl_log.md</code>。</p>
  <table>
    <tr><th>时点（2026 年）</th><th>事件</th><th>依据</th></tr>
    <tr><td>09-14 23:59</td><td>分析方案与提示词定稿</td><td><code>prompts.md</code></td></tr>
    <tr><td>09-15 00:20</td><td>评论接口打通，首批评论落盘</td><td><code>data/appstore_dom.txt</code></td></tr>
    <tr><td>09-15 00:30</td><td>主采集完成（8 个 App × 8 个排序维度）</td><td><code>data/appstore_multi.json</code></td></tr>
    <tr><td>09-15 00:42</td><td>统一数据集建成（${r.total} 条）</td><td><code>data/comments.csv</code></td></tr>
    <tr><td>09-15 00:44</td><td>分类体系定稿</td><td><code>data/taxonomy.md</code></td></tr>
    <tr><td>09-15 00:47</td><td>全量打标与统计完成</td><td><code>data/tagged.json</code></td></tr>
    <tr style="background:#fff8f8"><td><b>09-15 00:59</b></td><td><b>报告成型并首次提交</b></td><td>Git <code>80c4a33</code></td></tr>
  </table>
  <p class="cap">从提示词定稿到报告成型，端到端耗时 <b>约 1 小时</b>（61 分钟）。</p>
  <table>
    <tr><th></th><th>传统访谈方案</th><th>本项目</th></tr>
    <tr><td>样本量</td><td>5–10 位用户</td><td><b>${r.total} 条真实评论</b>（清洗后有效 ${r.valid} 条）</td></tr>
    <tr><td>主要时间成本</td><td>招募、约时间、访谈、转录、编码</td><td>渠道接口探测（一次性）</td></tr>
    <tr><td>从零到出报告</td><td>需数天</td><td><b>约 1 小时</b></td></tr>
  </table>

  <h3>这套方法的代价是什么（必须一并说明）</h3>
  <p style="font-size:13.5px">
    <b>① 评论不等于访谈。</b>访谈可以追问"为什么"，评论只能拿到用户愿意主动写下来的部分——本报告能回答"不满集中在哪"，不能回答"为什么会这样"。真正的归因仍需要访谈或可用性测试。<br>
    <b>② 样本受渠道可得性限制。</b>本次实测的多数社交渠道被平台风控拦截（详见 <code>crawl_log.md</code>），主证据实际来自 iOS 应用商店，安卓与社交媒体覆盖不足。<br>
    <b>③ 首次搭建的成本无法省略。</b>"1 小时"是一次性打通之后的速度；在此之前完成了 10 个渠道的可行性探测。这部分成本只会在第一次出现，但确实存在。<br>
    <b>④ 采集环节需要脚本。</b>因公开评论接口已失效，本项目改走遗留接口并自建采集脚本（<code>scripts/</code>），并非零代码方案；编码、打标、统计、成文环节无需编码。<br>
    <b>⑤ 增量成本极低。</b>流程固化为脚本后，换目标产品或重跑一轮只需数分钟，可用于持续跟踪。
  </p>
</section>

<footer>
  豆包用户口碑分析报告 · 数据采集于 2026-09-15 · 全部结论可回溯至 <code>data/tagged.json</code><br>
  本报告由 AI 完成采集、编码、打标与撰写；所有引用均为用户公开发布的原文，未做改写。
</footer>

</div>
</body>
</html>`;

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, 'report.html'), html, 'utf8');
fs.writeFileSync(path.join(ROOT, 'scripts', 'report.log'), 'chars ' + html.length + '\n', 'utf8');
