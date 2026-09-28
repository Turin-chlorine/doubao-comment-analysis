"""Select the newest 500 eligible Doubao reviews from Yingyongbao only.

Other storefront collections remain in data/ for provenance but are not candidates.
The window is anchored to the stored response time, never today's rebuild date.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone

from collect import DATA, clean

SOURCE = "应用宝 · 最新评论"
PACKAGE = "com.larus.nova"
MANUAL_EXCLUSIONS = {
    "yyb-925805826934325184": "与 yyb-925827625725755328 为仅有空格差异的长篇近重复文案",
    "yyb-894694607282953856": "仅有“对方正在输入文字”，未描述豆包使用经历",
}


def main() -> dict:
    source_log = json.loads((DATA / "yyb_log.json").read_text(encoding="utf-8"))
    fetched_times = [datetime.fromisoformat(request["fetched_at"])
                     for request in source_log["requests"] if request.get("fetched_at")]
    if not fetched_times:
        raise ValueError("Yingyongbao collection has no dated source response")
    reference = max(fetched_times)
    source_rows = json.loads((DATA / "yyb_reviews.json").read_text(encoding="utf-8"))
    manual_removed, language_removed, candidates = [], [], []
    for row in source_rows:
        if row["id"] in MANUAL_EXCLUSIONS:
            manual_removed.append({"id": row["id"], "reason": MANUAL_EXCLUSIONS[row["id"]]})
            continue
        if len(re.findall(r"[\u4e00-\u9fff]", row["text"])) < 5:
            language_removed.append(row["id"])
            continue
        candidates.append({**row, "source": SOURCE, "source_type": "android"})
    reviews, selection_exclusions = clean(candidates, limit=500, reference=reference)
    selected_ids = {row["id"] for row in reviews}
    not_selected = [{"id": row["id"], "reason": "超过最新 500 条的选样上限"}
                    for row in candidates if row["id"] not in selected_ids]
    if not all(row["id"].startswith("yyb-") and row["source"] == SOURCE for row in reviews):
        raise ValueError("non-Yingyongbao review entered the report sample")
    (DATA / "reviews.json").write_text(json.dumps(reviews, ensure_ascii=False, indent=2), encoding="utf-8")
    log = {
        "curated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_snapshot_at": reference.isoformat(timespec="seconds"),
        "package": PACKAGE, "source": SOURCE, "window_days": 180, "limit": 500,
        "source_precleaned": len(source_rows), "eligible_pool": len(candidates),
        "selected": len(reviews), "selected_dates": {
            "earliest": min((r["date"] for r in reviews), default=None),
            "latest": max((r["date"] for r in reviews), default=None),
        },
        "selected_sources": dict(Counter(r["source"] for r in reviews)),
        "manual_exclusions": manual_removed,
        "non_chinese_excluded_ids": language_removed,
        "selection_exclusions": selection_exclusions,
        "not_selected": not_selected,
        "note": "Only saved Yingyongbao reviews are candidates; other storefront files are research archive, not report data.",
    }
    (DATA / "curation_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    return log


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False, indent=2))
