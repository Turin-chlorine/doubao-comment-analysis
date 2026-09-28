"""Collect public Doubao reviews without login, scraping bypasses or dependencies.

Usage: python collect.py [--offline]
The collector keeps every HTTP response in data/raw and writes a collection log.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
DATA = ROOT / "data"
APP_ID = "6459478672"
APP_URL = f"https://apps.apple.com/cn/app/id{APP_ID}"
REVIEWS_URL = f"https://apps.apple.com/cn/app/{APP_ID}?see-all=reviews&platform=iphone"
HK_REVIEWS_URL = f"https://apps.apple.com/hk/app/{APP_ID}?see-all=reviews&platform=iphone"
RSS_URL = f"https://itunes.apple.com/cn/rss/customerreviews/page=1/id={APP_ID}/sortby=mostrecent/json"
AGENT = "Mozilla/5.0 (compatible; DoubaoPortfolioResearch/1.0; public pages only)"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch(url: str, filename: str, *, offline: bool = False) -> dict:
    path = RAW / filename
    item = {"url": url, "file": str(path.relative_to(ROOT)).replace("\\", "/")}
    if offline:
        if path.exists():
            raw = path.read_bytes()
            item.update(status="cached", bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                        fetched_at=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"))
        else:
            item.update(status="missing", checked_at=now_iso())
        return item
    try:
        with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=25) as response:
            raw = response.read()
            path.write_bytes(raw)
            item.update(status=response.status, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), fetched_at=now_iso())
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        item.update(status="error", error=str(exc), checked_at=now_iso())
    return item


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain(value: str) -> str:
    parser = Text()
    parser.feed(value)
    return re.sub(r"\s+", " ", html.unescape("".join(parser.parts))).strip()


def appstore_html_records(markup: str, source_url: str = REVIEWS_URL, source: str = "App Store 中国区") -> list[dict]:
    """Extract visible review cards; dialogs repeat cards, so IDs are unique."""
    starts = list(re.finditer(r'<div class="container[^\"]*" aria-labelledby="review-(\d+)-title"', markup))
    records: dict[str, dict] = {}
    for index, match in enumerate(starts):
        review_id = match.group(1)
        if review_id in records:
            continue
        block = markup[match.start() : starts[index + 1].start() if index + 1 < len(starts) else len(markup)]
        title = re.search(r'<h3 id="review-\d+-title"[^>]*>(.*?)</h3>', block, re.S)
        rating = re.search(r'<ol class="stars[^\"]*" aria-label="([1-5])\s*(?:星|粒星|stars?)"', block, re.I)
        date = re.search(r'<time[^>]*datetime="([^"]+)"', block)
        body = re.search(r'<p data-testid="truncate-text"[^>]*>(.*?)</p>', block, re.S)
        if not (title and body):
            continue
        content = plain(body.group(1))
        if not content:
            continue
        records[review_id] = {
            "id": f"appstore-{review_id}",
            "source": source,
            "source_type": "appstore",
            "source_url": source_url + f"#review-{review_id}-title",
            "date": date.group(1)[:10] if date else None,
            "title": plain(title.group(1)),
            "text": content,
            "rating": int(rating.group(1)) if rating else None,
            "version": None,
            "collected_at": now_iso(),
        }
    return list(records.values())


def rss_records(raw: str) -> list[dict]:
    try:
        feed = json.loads(raw).get("feed", {})
    except (ValueError, TypeError):
        return []
    entries = feed.get("entry", [])
    if isinstance(entries, dict):
        entries = [entries]
    result = []
    for entry in entries:
        try:
            review_id = str(entry["id"]["label"])
            content = plain(entry["content"]["label"])
            if not content:
                continue
            result.append({
                "id": f"appstore-{review_id}",
                "source": "App Store 中国区",
                "source_type": "appstore",
                "source_url": entry.get("link", {}).get("attributes", {}).get("href", APP_URL),
                "date": entry.get("updated", {}).get("label", "")[:10] or None,
                "title": entry.get("title", {}).get("label", ""),
                "text": content,
                "rating": int(entry["im:rating"]["label"]),
                "version": entry.get("im:version", {}).get("label"),
                "collected_at": now_iso(),
            })
        except (KeyError, ValueError, TypeError):
            continue
    return result


def clean(records: list[dict], *, days: int = 180, limit: int = 500, reference: datetime | None = None,
          audit: list[dict] | None = None) -> tuple[list[dict], dict]:
    reference = reference or datetime.now(timezone.utc)
    cutoff = (reference - timedelta(days=days)).date()
    seen_ids: set[str] = set()
    seen_texts: set[str] = set()
    result = []
    excluded = {"duplicate": 0, "outside_window": 0, "undated": 0, "empty_or_spam": 0}
    for row in sorted(records, key=lambda r: r.get("date") or "", reverse=True):
        text = re.sub(r"\s+", " ", row.get("text") or "").strip()
        normalized = re.sub(r"[\W_]+", "", text).lower()
        if len(normalized) < 8 or re.search(r"(?i)(加微信|vx[:：]|代开会员|低价充值|私信购买)", text):
            excluded["empty_or_spam"] += 1
            if audit is not None:
                audit.append({"id": row.get("id"), "reason": "empty_or_spam"})
            continue
        try:
            date = datetime.fromisoformat(row["date"]).date()
        except (ValueError, TypeError, KeyError):
            excluded["undated"] += 1
            if audit is not None:
                audit.append({"id": row.get("id"), "reason": "undated"})
            continue
        if date < cutoff or date > reference.date():
            excluded["outside_window"] += 1
            if audit is not None:
                audit.append({"id": row.get("id"), "reason": "outside_window"})
            continue
        if row["id"] in seen_ids or normalized in seen_texts:
            excluded["duplicate"] += 1
            if audit is not None:
                audit.append({"id": row.get("id"), "reason": "duplicate"})
            continue
        seen_ids.add(row["id"])
        seen_texts.add(normalized)
        row = {**row, "text": text}
        result.append(row)
        if len(result) >= limit:
            break
    return result, excluded


def collect(offline: bool = False) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(exist_ok=True)
    log = [
        fetch(REVIEWS_URL, "appstore_reviews_page.html", offline=offline),
        fetch(RSS_URL, "appstore_rss.json", offline=offline),
        fetch(HK_REVIEWS_URL, "appstore_hk_reviews_page.html", offline=offline),
    ]
    successful = {row["file"] for row in log if row["status"] == 200 or row["status"] == "cached"}
    existing_times = [datetime.fromisoformat(row["fetched_at"]) for row in log if row.get("fetched_at")]
    reference = max(existing_times) if offline and existing_times else datetime.now(timezone.utc)
    records = []
    html_path = RAW / "appstore_reviews_page.html"
    if html_path.exists() and "data/raw/appstore_reviews_page.html" in successful:
        rows = appstore_html_records(html_path.read_text(encoding="utf-8", errors="replace"))
        stamp = datetime.fromtimestamp(html_path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        records.extend({**row, "collected_at": stamp} for row in rows)
    rss_path = RAW / "appstore_rss.json"
    if rss_path.exists() and "data/raw/appstore_rss.json" in successful:
        rows = rss_records(rss_path.read_text(encoding="utf-8", errors="replace"))
        stamp = datetime.fromtimestamp(rss_path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        records.extend({**row, "collected_at": stamp} for row in rows)
    hk_path = RAW / "appstore_hk_reviews_page.html"
    hk_non_chinese = 0
    if hk_path.exists() and "data/raw/appstore_hk_reviews_page.html" in successful:
        stamp = datetime.fromtimestamp(hk_path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        for record in appstore_html_records(hk_path.read_text(encoding="utf-8", errors="replace"), HK_REVIEWS_URL, "App Store 香港区"):
            if len(re.findall(r"[\u4e00-\u9fff]", record["text"])) < 20:
                hk_non_chinese += 1
            else:
                records.append({**record, "collected_at": stamp})
    valid, excluded = clean(records, reference=reference)
    excluded["hk_non_chinese"] = hk_non_chinese
    (DATA / "appstore_reviews.json").write_text(json.dumps(valid, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {
        "collected_at": reference.isoformat(timespec="seconds"), "app_id": APP_ID, "window_days": 180,
        "raw_records": len(records), "valid_records": len(valid),
        "excluded": excluded, "requests": log,
        "note": "App Store RSS may return an empty feed. HTML cards are visible public reviews; the page may editorially select and reorder them.",
    }
    (DATA / "collection_log.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="parse saved responses without network")
    args = ap.parse_args()
    print(json.dumps(collect(args.offline), ensure_ascii=False, indent=2))
