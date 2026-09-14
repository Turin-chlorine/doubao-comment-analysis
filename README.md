# 豆包用户口碑分析 · 从评论抓取到产品改进报告

用评论抓取 + AI 分析替代传统用户访谈，产出一份带数据图表的 HTML 产品改进报告。

**一句话结论**：豆包最大的问题不是"不够智能"，而是"说错了不认账"——答案质量占其负面样本的 28.8%，而 5 款竞品在同一问题上的负面提及率只有 4.2%–9.1%。

## 交付物

| 文件 | 说明 |
|---|---|
| `report/report.html` | **最终报告**（自包含单文件，双击打开，图表为内联 SVG 无外部依赖） |
| `data/crawl_log.md` | 采集日志：每个渠道的实际条数与失败原因 |
| `data/taxonomy.md` | 痛点分类体系：8 个主题 + 判定边界 + 正反例 |
| `data/tagged.json` | 全量打标结果（266 条） |
| `data/stats.md` | 量化统计表 |
| `data/sample_coded.md` | 60 条分层样本的开放式编码 |
| `data/selfcheck.md` | 打标自检记录（20 条复核） |
| `data/comments.csv` | 统一格式的原始评论 |

## 数据

- **266 条真实评论**：豆包系（主 App / 爱学 / 输入法 / 安卓版）112 条 + 5 款竞品 154 条
- 采集时间：2026-09-15，来源：App Store 中国区 + 豌豆荚
- 清洗后有效 185 条（剔除泛化好评/差评、乱码、过短内容）

## 四步流水线

```
P1 采集  →  P2 清洗与开放式编码  →  P3 分类体系  →  P4 全量打标  →  P5 报告
comments.csv   sample_coded.md      taxonomy.md     tagged.json    report.html
```

1. **采集**：苹果评论 RSS 接口已失效，改用遗留的 `userReviewsRow` 接口；该接口 `page` 参数不生效，通过遍历 8 个 `sort` 维度横向扩展样本。
2. **清洗**：机械规则（长度、乱码、非中文）+ 人工判定，剔除 30.5%。
3. **编码**：分层抽样 60 条（产品线 × 评分极性），**只贴标签不归类**，标签保留用户原话（"当耳旁风""失忆"）而非产品术语。
4. **打标**：按 8 个主题全量打标，附情绪 / 严重度 / 是否含诉求；20 条独立复核，一致率 98.8%。

## 复现

```bash
node scripts/fetch_appstore_multi.js   # 采集 App Store（8 App × 8 排序）
node scripts/fetch_wandoujia.js        # 采集豌豆荚
node scripts/build_dataset.js          # 合并为 comments.csv
node scripts/build_analysis.js         # 清洗 + 抽样 + 打标校验 + 统计
node scripts/build_report.js           # 生成 report/report.html
```

## 已知局限（报告中已完整说明）

1. **渠道单一**：结论来自 iOS App Store 与豌豆荚，小红书/抖音/知乎/黑猫投诉均因反爬未采集到数据。
2. **时间偏置**：苹果接口每页只返回 10 条，样本偏向"最新/最有帮助"，不能用于推断长期趋势。
3. **总量偏小**：豆包系有效样本 79 条，单产品线多低于 30 条，产品线级结论仅作方向提示。
4. **打标由 AI 单方完成**：自检只能证明标签稳定，不能证明标签正确。如需团队使用，应补充人工打标并计算一致性系数。

## 技术备注（Windows 环境）

- 控制台 stdout 不便于采集，所有脚本**自行写文件**输出日志（见 `scripts/*.log`）
- 无头浏览器渠道探测封装在 `scripts/cdp.js`（Chrome DevTools Protocol）
- 各渠道探测的原始请求记录保留在 `data/xhr_*/`
