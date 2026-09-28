"""Behavioral checks for the fixed public-source research pipeline."""

import json
import re
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

import build
import collect
import annotate
import curate
import collect_yyb
import collect_google_play


class CollectionTests(unittest.TestCase):
    def test_public_apple_page_is_parsed_without_modal_duplicates(self):
        html = (collect.RAW / "appstore_reviews_page.html").read_text(encoding="utf-8")
        rows = collect.appstore_html_records(html)
        self.assertEqual(len(rows), 10)
        self.assertEqual(len({r["id"] for r in rows}), 10)
        example = next(r for r in rows if r["id"] == "appstore-14069196381")
        self.assertEqual(example["rating"], 1)
        self.assertEqual(example["date"], "2026-05-16")
        self.assertIn("Apple Store充值卡", example["text"])

    def test_hong_kong_rating_and_bilingual_review(self):
        html = (collect.RAW / "appstore_hk_reviews_page.html").read_text(encoding="utf-8")
        rows = collect.appstore_html_records(html, collect.HK_REVIEWS_URL, "App Store 香港区")
        example = next(r for r in rows if r["id"] == "appstore-14054824286")
        self.assertEqual(example["rating"], 5)
        self.assertIn("無法正常打字", example["text"])

    def test_clean_dedup_dates_missing_and_spam(self):
        base = {"id": "a", "date": "2026-06-01", "text": "豆包在连续追问时丢失问题背景", "rating": 1}
        rows = [base, {**base, "id": "b"}, {**base, "id": "c", "date": None},
                {**base, "id": "d", "date": "2025-02-01"},
                {**base, "id": "e", "text": "加微信低价充值会员"}]
        kept, excluded = collect.clean(rows, reference=datetime(2026, 9, 27, tzinfo=timezone.utc))
        self.assertEqual([r["id"] for r in kept], ["a"])
        self.assertEqual(excluded, {"duplicate": 1, "outside_window": 1, "undated": 1, "empty_or_spam": 1})
        audit = []
        collect.clean(rows, reference=datetime(2026, 9, 27, tzinfo=timezone.utc), audit=audit)
        self.assertEqual({x["id"]: x["reason"] for x in audit},
                         {"b": "duplicate", "c": "undated", "d": "outside_window", "e": "empty_or_spam"})

    def test_empty_rss_and_network_failure(self):
        self.assertEqual(collect.rss_records('{"feed":{"title":{"label":"reviews"}}}'), [])
        with tempfile.TemporaryDirectory() as folder, patch.object(collect, "ROOT", Path(folder)), patch.object(collect, "RAW", Path(folder)):
            with patch.object(collect, "urlopen", side_effect=URLError("offline")):
                result = collect.fetch("https://example.com/test", "failure.json")
        self.assertEqual(result["status"], "error")
        self.assertIn("offline", result["error"])

    def test_android_collectors_log_failures_and_reject_empty_payloads(self):
        with self.assertRaises(ValueError):
            collect_yyb.parse_response(b"{}", "2026-09-27T00:00:00+00:00")
        with self.assertRaises(ValueError):
            collect_google_play.parse_page("")
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / "data"
            raw = data / "raw"
            for module, kwargs in ((collect_yyb, {"max_reviews": 1, "page_size": 1}),
                                   (collect_google_play, {"max_reviews": 1})):
                with patch.object(module, "DATA", data), patch.object(module, "RAW", raw), patch.object(module, "urlopen", side_effect=URLError("offline")):
                    result = module.collect(**kwargs)
                self.assertEqual(result["valid_reviews"], 0)
                self.assertEqual(result["requests"][0]["status"], "error")


class ReportTests(unittest.TestCase):
    def test_counts_recompute_from_verified_reviews(self):
        report = build.load_report()
        items = report["items"]
        self.assertEqual(report["meta"]["sample_size"], 500)
        self.assertEqual(report["counts"]["sources"], {"应用宝 · 最新评论": 500})
        self.assertEqual(len({x["id"] for x in items}), 500)
        self.assertTrue(all(x["id"].startswith("yyb-") and x["source_type"] == "android" for x in items))
        self.assertTrue(all(report["meta"]["window_start"] <= x["date"] <= report["meta"]["as_of"] for x in items))
        self.assertEqual(report["counts"]["app_ratings"], dict(__import__("collections").Counter(str(x["rating"]) for x in items if x["rating"] is not None)))
        self.assertTrue(all(x["rating"] in range(1, 6) for x in items))
        expected_pains = __import__("collections").Counter(p for item in items for p in item["pain_points"])
        self.assertEqual(report["counts"]["pains"], dict(expected_pains))
        self.assertEqual(len(report["counts"]["pains"]), 12)
        self.assertTrue(all(len(x["pain_points"]) == len(set(x["pain_points"])) for x in items))
        self.assertFalse({"智能体下线与去留", "智能体查找与创建"} & set(report["counts"]["pains"]))
        by_id = {x["id"]: x for x in items}
        self.assertEqual(by_id["yyb-894886768864948032"]["pain_points"], ["智能体下线与创建"])
        self.assertEqual(by_id["yyb-894003655028539328"]["pain_points"], ["账号与登录限制"])
        user_defaults = json.loads((build.DATA / "annotations_user_defaults.json").read_text(encoding="utf-8"))["labels"]
        for review_id, changes in user_defaults.items():
            for field in ("pain_points", "sentiment"):
                if field in changes:
                    self.assertEqual(by_id[review_id][field], changes[field])
            self.assertEqual(by_id[review_id]["method"], "用户手动修订（已固化为默认）")
        self.assertEqual(by_id["yyb-955217127183507776"]["pain_points"], ["稳定性与性能", "更新时间间隔"])
        self.assertEqual(by_id["yyb-950866208039919936"]["sentiment"], "负向")
        for review_id in ("yyb-955217127183507776", "yyb-930326179311812544", "yyb-921466290120458176", "yyb-912120594301508992", "yyb-911841631314141440"):
            self.assertIn("更新时间间隔", by_id[review_id]["pain_points"])
        self.assertNotIn("更新时间间隔", by_id["yyb-932340988354510528"]["pain_points"])
        self.assertNotIn("更新时间间隔", by_id["yyb-896225484727598784"]["pain_points"])
        self.assertGreater(sum(len(x["pain_points"]) > 1 for x in items), 0)
        original = {x["id"]: x for x in json.loads((build.DATA / "reviews.json").read_text(encoding="utf-8"))}
        self.assertTrue(all(x["excerpt"] in original[x["id"]]["text"] and len(re.findall(r"[\u4e00-\u9fff]", original[x["id"]]["text"])) >= 5 for x in items))

    def test_curation_is_reproducible_and_exclusions_are_logged(self):
        source_log = json.loads((build.DATA / "yyb_log.json").read_text(encoding="utf-8"))
        self.assertEqual(len(source_log["excluded_items"]), sum(source_log["excluded"].values()))
        self.assertEqual(source_log["reference_at"], "2026-09-27T13:15:49+00:00")
        with tempfile.TemporaryDirectory() as folder, patch.object(curate, "DATA", Path(folder)):
            for name in ("yyb_log.json", "yyb_reviews.json"):
                (Path(folder) / name).write_bytes((build.DATA / name).read_bytes())
            log = curate.main()
            selected = json.loads((Path(folder) / "reviews.json").read_text(encoding="utf-8"))
        self.assertEqual(log["source_precleaned"], 517)
        self.assertEqual(log["eligible_pool"], 512)
        self.assertEqual(log["selected"], 500)
        self.assertEqual(len(selected), 500)
        self.assertEqual(len(log["manual_exclusions"]), 2)
        self.assertEqual(len(log["non_chinese_excluded_ids"]), 3)
        self.assertEqual(len(log["not_selected"]), 12)
        self.assertTrue(all(x["reason"] == "超过最新 500 条的选样上限" for x in log["not_selected"]))

    def test_featured_quotes_are_reviewed_and_supported(self):
        report = build.load_report()
        by_id = {x["id"]: x for x in report["items"]}
        for opportunity in report["opportunities"]:
            for review_id in opportunity["support"] + opportunity["counter"]:
                self.assertIn(by_id[review_id]["method"], {"人工复核", "用户手动修订（已固化为默认）"})
        self.assertEqual(annotate.first_pass({"text": "好用好用好用好用", "rating": None})["pain_points"], [])

    def test_embedded_report_is_offline_and_contains_only_checked_quotes(self):
        path = build.build()
        html = path.read_text(encoding="utf-8")
        match = re.search(r'<script type="application/json" id="report-data">(.*?)</script>', html, re.S)
        self.assertIsNotNone(match)
        payload = json.loads(match.group(1))
        self.assertEqual(len(payload["items"]), 500)
        self.assertEqual(payload["counts"]["sources"], {"应用宝 · 最新评论": 500})
        self.assertEqual(payload["counts"]["pains"]["更新时间间隔"], sum("更新时间间隔" in item["pain_points"] for item in payload["items"]))
        self.assertNotIn('id="sourceFilter"', html)
        self.assertNotIn('id="sourceBars"', html)
        self.assertTrue(all("text" not in item for item in payload["items"]))
        self.assertNotRegex(html, r'<(?:script|link)[^>]+(?:src|href)="https?://')
        self.assertNotIn("__REPORT_DATA__", html)


if __name__ == "__main__":
    unittest.main()
