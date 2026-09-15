# 豆包用户口碑分析 · 从评论抓取到产品改进报告

用评论抓取 + AI 分析替代传统用户访谈，产出一份带数据图表的 HTML 产品改进报告。

**一句话结论**：豆包最大的问题不是"不够智能"，而是"说错了不认账"——答案质量占其负面样本的 28.8%，而 5 款竞品在同一问题上的负面提及率只有 4.2%–9.1%。

## 交付物

| 文件 | 说明 |
|---|---|
| `report/report.html` | **最终报告**（自包含单文件，下载后双击打开；图表为内联 SVG 无外部依赖）。<br>⚠️ GitHub 网页不渲染 `.html`，在线点开只会看到源码——请 `clone` 后本地打开 |
| `data/crawl_log.md` | 采集日志：每个渠道的实际条数与失败原因 |
| `data/taxonomy.md` | 痛点分类体系：8 个主题 + 判定边界 + 正反例 |
| `data/tagged.json` | 全量打标结果（266 条） |
| `data/stats.md` | 量化统计表 |
| `data/sample_coded.md` | 60 条分层样本的开放式编码 |
| `data/selfcheck.md` | 打标自检记录（20 条复核） |
| `data/comments.csv` | 统一格式的原始评论 |
| `data/bili/stats_bili.md` | **B站 渠道交叉验证**：另一群人是否说出同样的问题 |
| `data/bili/relevance_review.md` | B站 相关性人工复核：66 条逐条纳入/排除理由 |
| `annotation/annotate.html` | **人工打标一致性验证工具**（双盲，离线可用，约 15 分钟标完 40 条） |
| `annotation/README.md` | 该验证的操作说明与 Kappa 判读标准 |
| `docs/需求覆盖对照.md` | **原始需求逐条对照**：哪条达到、哪条超出、哪条没做到 |

## 数据

- **266 条真实评论**：豆包系（主 App / 爱学 / 输入法 / 安卓版）112 条 + 5 款竞品 154 条
- 采集时间：2026-09-15，来源：App Store 中国区 + 豌豆荚
- 清洗后有效 185 条（剔除泛化好评/差评、乱码、过短内容）
- **另采 B站 74 条**作为渠道交叉验证（见第 09 节），经人工复核纳入分析 22 条 —— 样本量不足，仅作**定性旁证**，不参与主结论的统计

## 四步流水线

```
P1 采集  →  P2 清洗与开放式编码  →  P3 分类体系  →  P4 全量打标  →  P5 报告
comments.csv   sample_coded.md      taxonomy.md     tagged.json    report.html
                                                    ↑
                        B站 支线：bili_all_raw.json → 人工复核 → tags_bili.txt
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

# B站 渠道支线（可选）
node scripts/fetch_bili.js             # 关键词搜索 + 旧版评论接口
node scripts/probe_reply_api.js        # 探测各评论端点可用性
node scripts/fetch_bili_all.js         # 全量铺开（增量落盘 + 断点续采）
node scripts/build_bili_dataset.js     # 清洗 + 相关性过滤
node scripts/build_bili_analysis.js    # B站 统计 + 跨渠道交叉验证
```

### 打标可信度验证（需人工参与）

```bash
node scripts/build_annotation_kit.js   # 生成 40 条双盲样本 + 标注工具
# → 打开 annotation/annotate.html 人工标注，结果存为 annotation/human_labels.csv
node scripts/compute_kappa.js          # 计算 Cohen's Kappa + 输出分歧清单
```

## 已知局限（报告中已完整说明）

> 与原始需求的逐条核对见 `docs/需求覆盖对照.md`：7 项要求中 5 项完整达成、1 项超出、1 项部分达成（社交媒体）。

1. **渠道单一**：主结论来自 iOS App Store 与豌豆荚。社交媒体渠道经实测**多数被平台风控拦截**——小红书返回 IP 限制（300012）、抖音跳转验证码中间页、贴吧要求滑块验证、知乎返回 403 风控（40362）；黑猫投诉接口需客户端签名。**B站 是唯一探通的社交渠道**，但未登录访客每条视频上限 3 条评论，最终只够做定性旁证（22 条），不足以支撑主结论。
2. **时间偏置**：苹果接口每页只返回 10 条，样本偏向"最新/最有帮助"，不能用于推断长期趋势。B站 样本则集中在 3 天内，是**新品发布的事件切片**。
3. **总量偏小**：豆包系有效样本 79 条，其中主结论所依托的主 App 仅 18 条。报告按"结论强度"分三档标注（定量级 n≥30／方向级 20≤n<30／线索级 n<20），**本批样本无一组达到定量级**；即便按最理想的随机抽样估算，比例估计的 95% 误差也在 ±18 个百分点以上。故本报告只下"排序类"结论（哪个痛点最突出），不下"百分比类"结论。
4. **打标由 AI 单方完成**：自检（`data/selfcheck.md`，20 条两轮重标一致率 98.8%）只能证明标签**稳定**，不能证明**正确**——同一模型两轮打标的一致性天然偏高。为此已备好人工验证工具（`annotation/`，40 条双盲样本 + Cohen's Kappa 计算脚本）；**该验证尚待人工完成，Kappa 数值未出**。在此之前，本报告所有结论都应保留"AI 单方打标"这个前提。

## 技术备注（Windows 环境）

- 控制台 stdout 不便于采集，所有脚本**自行写文件**输出日志（见 `scripts/*.log`）
- 无头浏览器渠道探测封装在 `scripts/cdp.js`（Chrome DevTools Protocol）
- **不要 enable CDP 的 `Page` / `Runtime` 域**：`Page.navigate` 与 `Runtime.evaluate` 并不依赖它们，而部分站点（如贴吧）会推送超大事件，触发 undici `Max decompressed message size exceeded` 并强制断开 WebSocket（code=1006），使该会话后续所有命令全部超时。社交渠道的探测脚本曾因此静默失败且无任何日志
- 探测多个站点时，**每个站点使用独立 Chrome 会话**，避免单站断连污染其余站点
- 采集类脚本的日志一律用 **append** 模式，防止重跑失败覆盖掉上一轮证据
- 各渠道探测的原始请求记录保留在 `data/xhr_*/`；社交渠道实测正文保留在 `data/social_test/`
- **B站 的配额限制（实测）**：未登录访客每条视频只返回 3 条"最热"评论。`x/v2/reply` 的 `pn=2` 返回 0；`x/v2/reply/main` 的 `next=1` 直接 `is_end=true`（尽管 `all_count=10607`）；需登录态的 `x/v2/reply/wbi/main` 返回 `-403`——**wbi 签名（mixin_key + md5）本身实现正确，卡点是登录态而非算法**。累计约 160 次请求后触发 **HTTP 412 风控页**，为 IP 级临时封禁
- **采集脚本必须增量落盘**：一次全量采集在写盘前被强杀，导致已抓到的 160 条评论全部丢失。改为每 5 条 flush 一次 + 记录已完成 ID + 断点续采后，重跑即成幂等
- **本环境后台任务约 120 秒被强杀**：长采集应前台运行并自带时间预算（主动 flush 后退出），或拆成多次调用续采
- 请求间隔需 ≥1.3s：低于此值约 160 次后即触发风控
