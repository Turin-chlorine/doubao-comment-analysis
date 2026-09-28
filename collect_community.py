"""Find public V2EX Doubao discussions, then save original topic/reply JSON.

Search results only discover URLs. The evidence always comes from V2EX itself.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

from collect import DATA, RAW, AGENT, clean, now_iso, plain

QUERIES = [
    '豆包 AI 助手 体验 site:v2ex.com/t/ -输入法 -手机',
    '豆包 对话 使用 问题 site:v2ex.com/t/ -输入法',
    '豆包 回答 体验 site:v2ex.com/t/ -输入法',
    '豆包 app 使用 site:v2ex.com/t/ -输入法',
]
KNOWN = [
    {"topic_id": "1240773", "title": "好奇想了解豆包、GPT 语音实时对话是如何做的", "url": "https://www.v2ex.com/t/1240773"},
    {"topic_id": "1222504", "title": "豆包 seed 2.1 pro，豆包任务模式", "url": "https://www.v2ex.com/t/1222504"},
    {"topic_id": "1118065", "title": "字节豆包体验反馈", "url": "https://www.v2ex.com/t/1118065"},
]


def download(url: str, path: Path) -> dict:
    item = {"url": url, "file": str(path.relative_to(DATA.parent)).replace("\\", "/"), "fetched_at": now_iso()}
    try:
        with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=25) as response:
            body = response.read()
            path.write_bytes(body)
            item.update(status=response.status, bytes=len(body))
    except Exception as exc:
        item.update(status="error", error=str(exc))
    return item


class Results(HTMLParser):
    def __init__(self):
        super().__init__()
        self.matches = []
        self.active = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and "result__a" in attrs.get("class", ""):
            self.active = {"href": attrs.get("href", ""), "title": ""}

    def handle_data(self, value):
        if self.active is not None:
            self.active["title"] += value

    def handle_endtag(self, tag):
        if tag == "a" and self.active is not None:
            self.matches.append(self.active)
            self.active = None


def discover() -> tuple[list[dict], list[dict]]:
    found = {row["topic_id"]: row for row in KNOWN}
    log = []
    for index, query in enumerate(QUERIES, 1):
        url = "https://html.duckduckgo.com/html/?q=" + quote(query)
        path = RAW / f"ddg_query_{index}.html"
        log.append(download(url, path))
        if not path.exists():
            continue
        parser = Results()
        parser.feed(path.read_text(encoding="utf-8", errors="replace"))
        for result in parser.matches:
            outer = urlparse(result["href"])
            target = parse_qs(outer.query).get("uddg", [result["href"]])[0]
            match = re.search(r"(?:www|staging)\.v2ex\.com/t/(\d+)", unquote(target))
            if not match:
                continue
            title = result["title"].strip()
            if "豆包" not in title or any(x in title for x in ("输入法", "豆包手机", "API", "接口")):
                continue
            found[match.group(1)] = {"topic_id": match.group(1), "title": title, "url": f"https://www.v2ex.com/t/{match.group(1)}"}
        time.sleep(0.4)
    return list(found.values())[:20], log


def collect() -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    topics, log = discover()
    (DATA / "community_candidates.json").write_text(json.dumps(topics, ensure_ascii=False, indent=2), encoding="utf-8")
    raw_posts = []
    for candidate in topics:
        tid = candidate["topic_id"]
        topic_file = RAW / f"v2ex_topic_{tid}.json"
        replies_file = RAW / f"v2ex_replies_{tid}.json"
        log.append(download(f"https://www.v2ex.com/api/topics/show.json?id={tid}", topic_file))
        time.sleep(0.4)
        log.append(download(f"https://www.v2ex.com/api/replies/show.json?topic_id={tid}", replies_file))
        time.sleep(0.4)
        for kind, path in (("topic", topic_file), ("reply", replies_file)):
            if not path.exists():
                continue
            try:
                posts = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                continue
            for post in posts if isinstance(posts, list) else []:
                body = plain(post.get("content_rendered") or post.get("content") or "")
                date = datetime.fromtimestamp(post.get("created", 0), timezone.utc).date().isoformat() if post.get("created") else None
                raw_posts.append({
                    "id": f"v2ex-{post['id']}", "source": "V2EX 公开讨论", "source_type": "community",
                    "source_url": candidate["url"] + (f"#reply{post['id']}" if kind == "reply" else ""),
                    "date": date, "title": candidate["title"] if kind == "topic" else "回复：" + candidate["title"],
                    "text": body, "rating": None, "version": None, "collected_at": now_iso(),
                    "topic_id": tid, "post_kind": kind,
                })
    # Candidate relevance is reviewed separately; no search snippet is counted as a user comment.
    candidate_posts, excluded = clean(raw_posts)
    (DATA / "community_review_queue.json").write_text(json.dumps(candidate_posts, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"collected_at": now_iso(), "topics": len(topics), "raw_posts": len(raw_posts), "within_window": len(candidate_posts), "excluded": excluded, "requests": log}
    (DATA / "community_log.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(collect(), ensure_ascii=False, indent=2))
