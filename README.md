# 项目三｜豆包用户之声：从评论到改进

打开 [index.html](index.html) 即可离线展示这份 AI 产品岗位作品：用户原话 → 痛点归因 → 改进方案 → 验证实验。页面支持评分、场景和痛点筛选、原话索引上下两处翻页与页码跳转、证据抽屉、可点击方案原型、面试模式与打印。翻页不会自动滚动页面。

本版只分析**应用宝豆包主应用的 500 条公开评论**（Android 包名 `com.larus.nova`）。采集快照为 2026-09-27，180 天窗口为 2026-03-31 至 2026-09-27；入选评论日期为 2026-04-06 至 2026-09-26。其他来源文件仅留作研究记录，**不计入报告统计**。单一商店的便利样本不能代表全部豆包用户或全部安卓用户。

## 文件

- `index.html`：内嵌样式、交互和去身份的分析数据，无 CDN 依赖。
- `data/raw/` 与采集日志：公开响应原件、采集时间、状态与校验信息。
- `data/yyb_reviews.json`：应用宝预清洗记录；`data/curation_log.json`：排除与选样记录。
- `data/reviews.json`：最终 500 条标准化记录，含 ID、来源、链接、日期、原文、评分、版本和采集时间。
- `data/annotations.json`：主题初标及核心引文人工复核结果。
- `data/annotations_user_defaults.json`：从浏览器导入并固化为默认值的 147 条用户痛点与情绪修订。
- `METHODOLOGY.md`：研究方法与标注边界；`INTERVIEW.md`：三分钟讲述稿。
- `collect_yyb.py`、`curate.py`、`annotate.py`、`build.py`：可重建流水线。

## 重建与验收

在本目录执行：

```powershell
python collect_yyb.py --offline --max 800
python curate.py
python annotate.py
python build.py
python -m unittest test_pipeline.py
node qa_browser.mjs
```

`--offline` 使用已保存的公开响应，不调用付费模型 API。`annotate.py` 使用当前助手设计的规则批量初标；若新增评论，须先审核清洗结果，再复核新增核心引文和机会点，不能只运行 `build.py` 就视为人工核验。

评论详情中的痛点标签可从报告实际 12 类中多选或清空，情绪判断可改为正向、负向或混合。此版本已将用户浏览器中的 147 条痛点与情绪修订固化在 `data/annotations_user_defaults.json`，重新运行 `annotate.py` 仍会保留。后续页面修改按评论 ID 保存在当前浏览器，刷新后继续生效；痛点统计会重算，卡片和详情即时显示修订，并标明“本地修订统计”。原始评论和引文不变。当前版本不提供一键恢复原始标注；若浏览器禁止本地存储，页面会提示修改无法跨刷新保留。

报告中的痛点频次是 500 条文本内的主题计数，不是独立用户数或故障发生率。方案优先级、成本和预期效果均待验证；智能体政策及实际数据能力尚未独立核实。
