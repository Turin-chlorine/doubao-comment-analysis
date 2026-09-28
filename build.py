"""Build a self-contained, offline HTML report from reviewed source records."""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SOURCE = "应用宝 · 最新评论"

OPPORTUNITIES = [
    {
        "id": "agents", "rank": "01", "title": "让智能体创建与去留都更清楚", "category": "智能体体验",
        "signal": "合并类覆盖智能体下线、查找和创建受阻；主要线索集中在下线与既有内容去留，也有用户称创建或查找不顺。评论只反映感知，官方变化及原因仍需核实。",
        "proposal": "先核实现有入口、创建规则与数据能力；改善查找和创建时的规则说明，并在允许范围内提供资产清单、可用期限、导出或迁移路径及失败说明。不可迁移时给出明确原因。",
        "pain_key": "智能体下线与创建", "impact": "高：涉及长期创作与对话资产，也包含智能体查找和创建受阻",
        "evidence_strength": "较强的主题线索；具体损失和原因未经独立核实，可能有相似文案", "cost": "高（估计：合规、数据结构、跨产品协作）",
        "support": ["yyb-925919820729209472", "yyb-925764698398839232", "yyb-940372500261912064"],
        "counter": ["yyb-930132808545784768"],
        "assumption": "透明说明与可行的数据带走方式，能降低用户对既有创作丢失的担忧。",
        "validation": "先验证功能现状与可迁移范围；小流量比较过渡页任务完成率、成功导出率、重复咨询率与满意度。",
        "risk": "导出可能触及第三方内容、隐私与安全边界；对不可迁移内容不能作承诺。",
    },
    {
        "id": "accuracy", "rank": "02", "title": "让回答更容易被校验", "category": "准确性与理解",
        "signal": "评论提到作业题看错、操作图识别错、回答文不对题；同时也有用户肯定搜题纠错。",
        "proposal": "针对读图、搜题与多轮问答建立高风险错误样本集；在低置信度回答中提示核对原图与来源。",
        "pain_key": "回答准确性与理解", "impact": "高：学习与信息判断可能受误导",
        "evidence_strength": "多条具体任务投诉，但没有原始输入与模型日志", "cost": "中至高（估计：评测集、模型与界面协同）",
        "support": ["yyb-937560501563961984", "yyb-947653547508396416", "yyb-941591223672794816"],
        "counter": ["yyb-936465442718363968"],
        "assumption": "提示核对关键信息并优先修复高频任务错误，可减少错误被直接采信。",
        "validation": "盲测读图与多轮任务正确率；实验观察用户纠错率、二次核对率与任务完成率。",
        "risk": "过量提醒会打断低风险问题；应按任务风险与模型不确定性触发。",
    },
    {
        "id": "memory", "rank": "03", "title": "把新话题的边界说清楚", "category": "连续对话",
        "signal": "多条评论描述对话突然转入新话题、上下文丢失或未得到提示。",
        "proposal": "当会话上下文即将切换时给出可见提示，并让用户选择摘要续聊或重新开始。",
        "pain_key": "会话与记忆中断", "impact": "中：重复解释成本与信任损耗",
        "evidence_strength": "有具体经历描述；需核查版本与触发条件", "cost": "中（估计：状态提示、摘要、埋点）",
        "support": ["yyb-952616796199771648", "yyb-942243590382321024", "yyb-916485916553302656"],
        "counter": ["yyb-897849540443661184"],
        "assumption": "明确提示和可控续聊能减少用户被动重述。",
        "validation": "追踪意外新话题率、重述率、续聊成功率及摘要误导率。",
        "risk": "摘要可能遗漏或误读私密信息；需要可关闭、可编辑和明确保存范围。",
    },
]


def load_report() -> dict:
    reviews = json.loads((DATA / "reviews.json").read_text(encoding="utf-8"))
    annotation_file = json.loads((DATA / "annotations.json").read_text(encoding="utf-8"))
    annotations = annotation_file["labels"]
    if len(reviews) != len({r["id"] for r in reviews}):
        raise ValueError("duplicate review IDs")
    if len(reviews) != 500:
        raise ValueError("this portfolio snapshot must contain 500 reviews")
    if set(annotations) != {r["id"] for r in reviews}:
        raise ValueError("every review must be annotated once")
    items = []
    for review in reviews:
        if review["source"] != SOURCE or review["source_type"] != "android" or not review["id"].startswith("yyb-"):
            raise ValueError(f"non-Yingyongbao source in report: {review['id']}")
        if len(re.findall(r"[\u4e00-\u9fff]", review["text"])) < 5:
            raise ValueError(f"non-Chinese review in report: {review['id']}")
        a = annotations[review["id"]]
        if a["excerpt"] not in review["text"]:
            raise ValueError(f"excerpt not found in original text: {review['id']}")
        if not review["source_url"].startswith("https://"):
            raise ValueError(f"invalid source URL: {review['id']}")
        if review["rating"] not in range(1, 6):
            raise ValueError(f"invalid rating: {review['id']}")
        items.append({k: review[k] for k in ("id", "source", "source_type", "source_url", "date", "title", "rating", "version")}
                     | {k: a[k] for k in ("scenes", "sentiment", "pain_points", "severity", "excerpt", "analysis", "uncertainty", "confidence", "method")})
    ids = {r["id"] for r in reviews}
    source_counts = dict(Counter(r["source"] for r in items))
    sentiment_counts = dict(Counter(r["sentiment"] for r in items))
    scene_counts = dict(Counter(s for r in items for s in r["scenes"]))
    pain_counts = dict(Counter(p for r in items for p in r["pain_points"]))
    app_ratings = dict(Counter(str(r["rating"]) for r in items if r["rating"] is not None))
    opportunities = [{**o, "frequency": f"直接痛点 {pain_counts.get(o['pain_key'], 0)} / {len(items)} 条"} for o in OPPORTUNITIES]
    for o in opportunities:
        if not set(o["support"] + o["counter"]).issubset(ids):
            raise ValueError(f"missing opportunity source: {o['id']}")
    log = json.loads((DATA / "curation_log.json").read_text(encoding="utf-8"))
    as_of = datetime.fromisoformat(log["source_snapshot_at"]).date()
    cutoff = as_of - timedelta(days=log["window_days"])
    if any(not (cutoff.isoformat() <= r["date"] <= as_of.isoformat()) for r in items):
        raise ValueError("review is outside the declared collection window")
    report = {
        "meta": {
            "app": "豆包 - 生活工作 AI 助手", "package": "com.larus.nova", "store": SOURCE,
            "window": f"{cutoff.isoformat()} 至 {as_of.isoformat()}", "as_of": as_of.isoformat(),
            "window_start": cutoff.isoformat(), "window_days": log["window_days"],
            "sample_size": len(items),
            "research_level": "单一商店的探索性研究：公开评论有自选、排序和相似文案偏差；不代表豆包全部用户或全部安卓用户。",
            "annotation_method": annotation_file["method"],
        },
        "counts": {"sources": source_counts, "sentiments": sentiment_counts, "scenes": scene_counts,
                   "pains": pain_counts, "app_ratings": app_ratings},
        "items": items, "opportunities": opportunities,
    }
    return report


def build() -> Path:
    report = load_report()
    template = (ROOT / "template.html").read_text(encoding="utf-8")
    values = {
        "__AS_OF__": report["meta"]["as_of"],
        "__WINDOW_START__": report["meta"]["window_start"],
        "__RESEARCH_MONTH__": datetime.fromisoformat(report["meta"]["as_of"]).strftime("%B %Y").upper(),
        "__YEAR__": report["meta"]["as_of"][:4],
        "__SAMPLE_COUNT__": str(report["meta"]["sample_size"]),
        "__AGENT_COUNT__": str(report["counts"]["pains"].get("智能体下线与创建", 0)),
        "__ACCURACY_COUNT__": str(report["counts"]["pains"].get("回答准确性与理解", 0)),
        "__MEMORY_COUNT__": str(report["counts"]["pains"].get("会话与记忆中断", 0)),
        "__WINDOW_DAYS__": str(report["meta"]["window_days"]),
    }
    for key, value in values.items():
        template = template.replace(key, value)
    payload = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace("&", "\\u0026").replace("\u2028", "\\u2028")
    if template.count("__REPORT_DATA__") != 1:
        raise ValueError("template must contain one data marker")
    output = ROOT / "index.html"
    output.write_text(template.replace("__REPORT_DATA__", payload), encoding="utf-8")
    return output


if __name__ == "__main__":
    print(build())
