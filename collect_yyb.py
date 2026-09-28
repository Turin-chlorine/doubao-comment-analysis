"""Collect public recent 豆包 reviews from 应用宝's own review list.

The request mirrors the unauthenticated "最新" tab of the public product page.
Raw responses are saved; no login, private token, CAPTCHA, or bypass is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from collect import DATA, RAW, clean, now_iso, plain

URL = "https://yybadaccess.3g.qq.com/v2/dc_pcyyb_official"
PAGE_URL = "https://sj.qq.com/appdetail/com.larus.nova/review"
APP_ID = "54330344"
PACKAGE = "com.larus.nova"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"


def request_body(page: int, size: int) -> bytes:
    guid = uuid.uuid4().hex
    params = {
        "AppID": APP_ID, "TagType": "10000", "SortType": "commentListByTime",
        "PhoneGUID": guid, "UserID": "", "StartPage": page, "PageSize": size,
        "BeginTime": 0, "EndTime": 0, "Version": 1,
    }
    body = {
        "head": {
            "cmd": "dc_pcyyb_official", "authInfo": {"businessId": "AuthName"},
            "deviceInfo": {"platformType": 1, "platform": 3},
            "userInfo": {"guid": guid}, "expSceneIds": "", "hostAppInfo": {"scene": "review"},
        },
        "body": {
            "bid": "yybhome", "offset": 0, "size": size, "preview": False,
            "listS": {"region": {"repStr": ["CN"]},
                      "req_json": {"repStr": [json.dumps(params, ensure_ascii=False, separators=(",", ":"))]}},
            "layout": "YYB_HOME_GAME_REVIEW_COMMENT_LIST",
        },
    }
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def parse_response(raw: bytes, fetched_at: str) -> list[dict]:
    body = json.loads(raw)
    if body.get("ret") != 0:
        raise ValueError(f"upstream returned {body.get('ret')}: {body.get('msg')}")
    components = body.get("data", {}).get("components", [])
    card = next((c for c in components if c.get("cardId") == "YYB_HOME_GAME_REVIEW_COMMENT_LIST"), None)
    if card is None:
        raise ValueError("review list missing from response")
    result = []
    for item in card.get("data", {}).get("itemData", []):
        review = item.get("comment") or {}
        try:
            rid = str(review["commentID"])
            text = plain(review["content"])
            score = int(review["mulDimensionScore"]["total"])
            date = datetime.fromtimestamp(int(review["createTime"]), timezone.utc).date().isoformat()
        except (KeyError, ValueError, TypeError, OverflowError):
            continue
        if not text or score not in range(1, 6):
            continue
        result.append({
            "id": f"yyb-{rid}", "source": "应用宝 · 最新评论", "source_type": "android",
            "source_url": PAGE_URL, "date": date, "title": "应用宝用户评论", "text": text,
            "rating": score, "version": None, "collected_at": fetched_at,
        })
    return result


def collect(max_reviews: int = 500, page_size: int = 50, offline: bool = False) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    log = []
    all_records = []
    seen_first_ids = set()
    for page in range((max_reviews + page_size - 1) // page_size):
        path = RAW / f"yyb_reviews_{page + 1:02d}.json"
        if offline:
            if not path.exists():
                break
            raw = path.read_bytes()
            status = "cached"
        else:
            try:
                req = Request(URL, data=request_body(page, min(page_size, max_reviews - len(all_records))), headers={
                    "User-Agent": USER_AGENT, "Content-Type": "application/json;charset=UTF-8",
                    "Origin": "https://sj.qq.com", "Referer": PAGE_URL,
                })
                with urlopen(req, timeout=30) as response:
                    raw = response.read()
                    status = response.status
                    path.write_bytes(raw)
            except (HTTPError, URLError, TimeoutError, OSError) as exc:
                log.append({"page": page + 1, "status": "error", "error": str(exc), "checked_at": now_iso()})
                break
        stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        entry = {"page": page + 1, "url": URL, "file": str(path.relative_to(DATA.parent)).replace("\\", "/"),
                 "status": status, "fetched_at": stamp, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        try:
            rows = parse_response(raw, stamp)
        except (ValueError, TypeError) as exc:
            entry["parse_error"] = str(exc)
            log.append(entry)
            break
        entry["records"] = len(rows)
        log.append(entry)
        if not rows or rows[0]["id"] in seen_first_ids:
            break
        seen_first_ids.add(rows[0]["id"])
        all_records.extend(rows)
        if len(rows) < min(page_size, max_reviews - len(all_records) + len(rows)):
            break
        if len(all_records) >= max_reviews:
            break
        if not offline:
            time.sleep(0.7)
    source_times = [datetime.fromisoformat(entry["fetched_at"]) for entry in log if entry.get("fetched_at")]
    reference = max(source_times) if source_times else datetime.now(timezone.utc)
    excluded_items = []
    valid, excluded = clean(all_records, limit=max_reviews, reference=reference, audit=excluded_items)
    (DATA / "yyb_reviews.json").write_text(json.dumps(valid, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"collected_at": now_iso(), "app_id": APP_ID, "package": PACKAGE, "raw_reviews": len(all_records),
              "valid_reviews": len(valid), "excluded": excluded, "excluded_items": excluded_items,
              "reference_at": reference.isoformat(timespec="seconds"), "requests": log}
    (DATA / "yyb_log.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=500)
    ap.add_argument("--page-size", type=int, default=50)
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    print(json.dumps(collect(args.max, args.page_size, args.offline), ensure_ascii=False, indent=2))
