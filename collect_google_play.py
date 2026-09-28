"""Collect public Google Play reviews for the Doubao Android app.

Uses the same unauthenticated Play Store UI review request as the public page.
Stops on access errors, saves each raw page, and requires no third-party modules.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from collect import DATA, RAW, clean, now_iso, plain

PACKAGE = "com.larus.nova"
URL = "https://play.google.com/_/PlayStoreUi/data/batchexecute?hl=zh_CN&gl=CN"
APP_URL = f"https://play.google.com/store/apps/details?id={PACKAGE}&hl=zh_CN&gl=CN"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"


def request_body(count: int, token: str | None = None) -> bytes:
    params = [2, 2, [count], None, [None, None, None, None, None, None, None, None, None]]
    if token is not None:
        params.insert(4, token)
    inner = [None, params, [PACKAGE, 7]]
    outer = [[["oCPfdb", json.dumps(inner, ensure_ascii=False, separators=(",", ":")), None, "generic"]]]
    return urlencode({"f.req": json.dumps(outer, ensure_ascii=False, separators=(",", ":"))}).encode("utf-8")


def parse_page(raw: str) -> tuple[list[list], str | None]:
    if "\n\n" not in raw:
        raise ValueError("missing batchexecute payload")
    frame = json.loads(raw.split("\n\n", 1)[1])
    message = next((row for row in frame if isinstance(row, list) and len(row) > 2 and row[0] == "wrb.fr" and row[1] == "oCPfdb"), None)
    if not message or not isinstance(message[2], str):
        raise ValueError("missing public review response")
    result = json.loads(message[2])
    rows = result[0] if result and isinstance(result[0], list) else []
    token = None
    try:
        candidate = result[-2][-1]
        if isinstance(candidate, str):
            token = candidate
    except (IndexError, TypeError):
        pass
    return rows, token


def normalize(rows: list[list], collected_at: str) -> list[dict]:
    result = []
    for row in rows:
        try:
            review_id = str(row[0])
            text = plain(row[4] or "")
            rating = int(row[2])
            date = datetime.fromtimestamp(row[5][0], timezone.utc).date().isoformat()
            version = row[10] if len(row) > 10 and isinstance(row[10], str) else None
        except (IndexError, TypeError, ValueError, OverflowError):
            continue
        if not (review_id and text and 1 <= rating <= 5):
            continue
        # Locale and storefront do not guarantee Chinese language.
        if len(re.findall(r"[\u4e00-\u9fff]", text)) < 5:
            continue
        result.append({
            "id": f"googleplay-{review_id}", "source": "Google Play · 中文评论",
            "source_type": "android", "source_url": APP_URL + "&reviewId=" + review_id,
            "date": date, "title": "Google Play 用户评论", "text": text,
            "rating": rating, "version": version, "collected_at": collected_at,
        })
    return result


def collect(max_reviews: int = 500, offline: bool = False) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    log = []
    all_rows = []
    token = None
    seen_tokens = set()
    for page in range(1, 11):
        path = RAW / f"google_play_reviews_{page:02d}.txt"
        if offline:
            if not path.exists():
                break
            raw = path.read_bytes()
            status = "cached"
        else:
            try:
                req = Request(URL, data=request_body(min(100, max_reviews - len(all_rows)), token), headers={
                    "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "Origin": "https://play.google.com", "Referer": APP_URL,
                })
                with urlopen(req, timeout=30) as response:
                    raw = response.read()
                    status = response.status
                    path.write_bytes(raw)
            except (HTTPError, URLError, TimeoutError, OSError) as exc:
                log.append({"page": page, "status": "error", "error": str(exc), "checked_at": now_iso()})
                break
        stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        entry = {"page": page, "url": URL, "file": str(path.relative_to(DATA.parent)).replace("\\", "/"),
                 "status": status, "fetched_at": stamp, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        try:
            rows, next_token = parse_page(raw.decode("utf-8", errors="replace"))
            entry["raw_reviews"] = len(rows)
        except (ValueError, TypeError) as exc:
            entry["parse_error"] = str(exc)
            log.append(entry)
            break
        log.append(entry)
        all_rows.extend(normalize(rows, stamp))
        if len(all_rows) >= max_reviews or not next_token or next_token in seen_tokens or not rows:
            break
        seen_tokens.add(next_token)
        token = next_token
        if not offline:
            time.sleep(0.7)
    valid, excluded = clean(all_rows, limit=max_reviews)
    (DATA / "google_play_reviews.json").write_text(json.dumps(valid, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"collected_at": now_iso(), "package": PACKAGE, "raw_chinese_reviews": len(all_rows),
              "valid_reviews": len(valid), "excluded": excluded, "requests": log}
    (DATA / "google_play_log.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--max", type=int, default=500)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    print(json.dumps(collect(args.max, args.offline), ensure_ascii=False, indent=2))
