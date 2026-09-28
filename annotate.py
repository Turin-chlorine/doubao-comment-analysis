"""AI-designed, auditable first-pass labels for the public-review corpus.

This script does not call a paid model API. Rules are deliberately conservative:
unclear comments remain unclassified. Featured claims are separately reviewed.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"

SCENES = [
    ("智能体与角色", r"智能体|人设|角色|猫箱"),
    ("图像与视频创作", r"图片|照片|生图|画图|绘图|P图|修图|生成视频|制作视频|视频生成"),
    ("连续对话", r"失忆|记忆|上下文|新话题|忘记|不记得|聊天记录|对话记录|多轮"),
    ("学习与问答", r"学习|作业|题目|答题|搜题|考试|回答|答案|查资料"),
    ("情绪陪伴", r"安慰|情绪|陪伴|倾诉|心事|精神寄托"),
    ("语音与输入", r"语音|朗读|声音|录音|输入法|打断|抢话"),
    ("账号与审核", r"登录|游客|权限|违规|封号|误判|拦截|审核|限制|禁言"),
    ("办公与设备", r"Mac|电脑|桌面|办公|文档|闪退|打不开|卡顿"),
]

PAINS = [
    ("智能体下线与创建", r"(?:智能体|角色|人设).{0,45}(?:下线|下架|关停|消失|删除|迁移|停用|没了|不能用|找不到|取消|封禁|恢复)|(?:下线|下架|关停|迁移|删除|取消|恢复).{0,45}(?:智能体|角色|人设)|(?:7月15日|7\.15).{0,80}(?:智能体|角色)"),
    ("回答准确性与理解", r"答错|回答.*(?:错|不对)|错误|不准确|不准|胡说|瞎编|乱讲|文不对题|理解错|听不懂|识别错|说错|不正确|做错|算错|看错题|答非所问"),
    ("会话与记忆中断", r"失忆|新话题|忘了|忘记|不记得|上下文|对话断|聊天断|记忆.{0,12}(?:短|缩|差|不行|没了|断|刷新)|不记得我说"),
    ("图像视频生成受阻", r"无法.{0,9}(?:生成|制作)|生成.{0,12}(?:不了|失败|太短|不出来|太差|模糊|走样|不对|不好看)|图片.{0,12}(?:不对|走样|不能|太差)|视频.{0,12}(?:太短|无法|没法|不行|失败|时长|误判)|照片.{0,12}(?:变形|走样)|生图.{0,9}(?:失败|不行|不了)"),
    ("账号与审核误拦截", r"误判|误拦截|违规.{0,12}(?:误|没|不)|被封|不能登录|无法登录|游客模式|权限.{0,12}(?:限制|禁用|不能)|审核.{0,12}(?:不通过|失败|过不了)"),
    ("稳定性与性能", r"闪退|打不开|卡顿|崩溃|加载不出|进不去|卡住|无法更新|更新不了|经常异常|一直异常|卡bug|严重.{0,5}bug"),
    ("费用与额度", r"额度.{0,12}(?:少|不够|用完|限制)|(?:创作|使用|生成)次数.{0,12}(?:少|不够|限制)|收费|付费|会员|专业版|加钱|要钱|涨价|不免费"),
    ("语音与输入体验", r"语音.{0,12}(?:乱识别|出错|没了|不能|收费|不好|误触发)|声音.{0,12}(?:不对|难听|换|变了)|大喘气|朗读.{0,12}(?:错误|不对|没改)|录音.{0,12}(?:没了|不能|失败)|抢话|打断我|不听人说话"),
    ("回应方式不贴合", r"说教|废话|敷衍|反驳|嘲讽|机械|答非所问|反复重复|一句话重复|只安慰|没有共情|不尊重"),
    # Keep the old discovery/creation complaint trigger exactly; combining labels
    # must not broaden which reviews qualify for this theme.
    ("智能体下线与创建", r"智能体.{0,15}(?:搜索|找不到|不好找|不能创建|创建不了|不好创建)|(?:搜索|找).{0,15}智能体"),
    ("功能冗余或缺失", r"(?:累赘|多余|冗余|重复).{0,12}(?:功能|设计)|(?:功能|设计).{0,12}(?:累赘|多余|冗余|重复)|去掉.{0,8}(?:功能|设计)"),
    ("更新时间间隔", r"几天就更新一次|每次都要更新|用不了几天就得更新|别老是更新|有必要天天更新吗"),
]

COMPLAINT = re.compile(r"但是|不过|就是|希望|建议|问题|不好|不能|无法|太差|不行|少|限制|没了|下线|下架|关停|删除|失败|错误|不准|误判|不满|卡住|闪退|极差|太短|烦|差评|退|改进")
STRONG_NEGATIVE = re.compile(r"极差|非常不满|严重.{0,6}(?:故障|问题|bug)|完全无法|真服了|越来越.{0,6}(?:差|短)|为什么.{0,18}下架|全部.{0,8}下线|没法正常|完全不能")
SENSITIVE = re.compile(r"1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|身份证|住址|家庭住址|姓名[:：]")

# Reviewed against the stored original text, especially every quote used to support
# the three featured opportunities.  These overrides correct rule false positives.
REVIEWED = {
    "yyb-894886768864948032": ("不能改密码，创建智能体又不能有粉丝", ["智能体下线与创建"], "负向"),
    "yyb-950866208039919936": ("累赘的功能去掉", ["功能冗余或缺失"], "混合"),
    "yyb-955217127183507776": ("好用是好用，几天就更新一次", ["更新时间间隔"], "正向"),
    "yyb-930326179311812544": ("每次都要更新，有点不好", ["更新时间间隔"], "负向"),
    "yyb-921466290120458176": ("为什么用不了几天就得更新，重新下载，好麻烦", ["更新时间间隔"], "负向"),
    "yyb-912120594301508992": ("豆包，你别老是更新嘛，我都快找不到自己了", ["更新时间间隔"], "混合"),
    "yyb-911841631314141440": ("有必要天天更新吗？", ["更新时间间隔"], "正向"),
    "yyb-894808969386078592": ("我让豆包给我AI生图，它给我整的根本就不是我想要的", ["图像视频生成受阻"], "负向"),
    "yyb-894798774124441280": ("还行，就是有时候有一点问题就比如错误的地方", [], "混合"),
    "yyb-894474253383007616": ("一点游戏分析都不会，完全不看发的图进行阵容装备分析", ["回答准确性与理解"], "负向"),
    "yyb-894003655028539328": ("要是能微信登录就好了", ["账号与登录限制"], "混合"),
    "yyb-925919820729209472": ("如果贸然关停服务，并且无法导出聊天记录，多年的回忆会直接消失", ["智能体下线与创建"], "负向"),
    "yyb-925764698398839232": ("无一键导出完整对话、记忆同步功能，只能手动复制人设", ["智能体下线与创建"], "负向"),
    "yyb-940372500261912064": ("为什么要下架智能体，本来聊的好好的，结果我刚上线就下架了", ["智能体下线与创建"], "负向"),
    "yyb-930132808545784768": ("豆包的智能体陪伴给予温暖，引导正面思想，且回答问题细致，可信度较高", [], "正向"),
    "yyb-937560501563961984": ("豆包看好几次作业都看错了，而且还听不懂人话", ["回答准确性与理解"], "负向"),
    "yyb-947653547508396416": ("结果他连这张图的过程都没有识别准确，就在那里乱讲", ["回答准确性与理解"], "负向"),
    "yyb-941591223672794816": ("时常回复的文不对题，甚至理解错误，也时常给错资讯", ["回答准确性与理解"], "混合"),
    "yyb-936465442718363968": ("软件不错，搜题方便", [], "正向"),
    "yyb-952616796199771648": ("明明到一种程度就会自动刷新，却不给任何提示", ["会话与记忆中断"], "负向"),
    "yyb-942243590382321024": ("自动出现了聊聊新话题的功能，希望官方能修复一下", ["会话与记忆中断"], "负向"),
    "yyb-916485916553302656": ("但他突然之间就说无法回复你的消息，就开新话题了", ["会话与记忆中断"], "负向"),
    "yyb-897849540443661184": ("很棒！ Ai记忆性超强！不过有时候会连人名都分不清", [], "混合"),
}


def first_pass(review: dict) -> dict:
    text = review["text"]
    rating = review["rating"]
    scenes = [name for name, pattern in SCENES if re.search(pattern, text, re.I)] or ["未明确场景"]
    painful = rating is not None and rating <= 3 or bool(COMPLAINT.search(text))
    pains = []
    for rule_index, (name, pattern) in enumerate(PAINS):
        if not re.search(pattern, text, re.I):
            continue
        if name == "智能体下线与创建" and rule_index == 0:
            pains.append(name)
        elif name == "更新时间间隔":
            pains.append(name)
        elif name == "会话与记忆中断" and "智能体下线与创建" in pains and not re.search(r"失忆|新话题|忘记|不记得|上下文|记忆.{0,8}(?:短|缩|断)", text):
            continue
        elif painful:
            pains.append(name)
    # The two legacy agent rules now share one category; count a review once
    # even when both rules match it.
    pains = list(dict.fromkeys(pains))
    if rating is None:
        sentiment = "正向" if not pains else "混合"
    elif rating <= 2:
        sentiment = "负向"
    elif rating == 3:
        sentiment = "混合"
    elif STRONG_NEGATIVE.search(text):
        sentiment = "负向"
    elif pains:
        sentiment = "混合"
    else:
        sentiment = "正向"
    severity = "高" if any(p in pains for p in ("智能体下线与创建", "账号与审核误拦截", "稳定性与性能")) else "中" if pains else "无"
    excerpt = choose_excerpt(text, pains)
    confidence = "高" if pains and len(excerpt) >= 16 else "中" if len(text) >= 25 else "低"
    analysis = ("文本直接涉及：" + "、".join(pains) + "；该标签是评论自述的主题归类，不等于故障已被独立复现。") if pains else "未命中本研究的现有痛点分类；仍可能含具体建议，保留原文供复核。"
    uncertainty = "缺少原始会话、设备和版本日志；具体原因与当前状态待核验。" if pains else "缺少任务步骤或版本信息，不能仅凭这条评论判断具体原因。"
    if "智能体下线与创建" in pains:
        uncertainty = "这是用户对功能变化的自述；需核查官方变更、法律要求及数据导出可行性。"
    return {"scenes": scenes, "sentiment": sentiment, "pain_points": pains,
            "severity": severity, "excerpt": excerpt, "analysis": analysis,
            "uncertainty": uncertainty, "confidence": confidence, "method": "规则初标"}


def choose_excerpt(text: str, pains: list[str]) -> str:
    clauses = [s.strip() for s in re.split(r"(?<=[。！？!?；;])", text) if s.strip()]
    relevant = []
    if pains:
        patterns = [p for name, p in PAINS if name in pains]
        relevant = [s for s in clauses if any(re.search(p, s, re.I) for p in patterns)]
    candidates = relevant + clauses
    for candidate in candidates:
        if SENSITIVE.search(candidate):
            continue
        excerpt = candidate[:110].strip()
        if excerpt and excerpt in text:
            return excerpt
    return text[:80].strip()


def annotate() -> dict:
    reviews = json.loads((DATA / "reviews.json").read_text(encoding="utf-8"))
    manual = json.loads((DATA / "annotations_manual.json").read_text(encoding="utf-8"))["labels"]
    user_defaults = json.loads((DATA / "annotations_user_defaults.json").read_text(encoding="utf-8"))["labels"]
    labels = {r["id"]: (dict(manual[r["id"]], confidence="高", method="人工复核") if r["id"] in manual else first_pass(r)) for r in reviews}
    for review in reviews:
        if review["id"] not in REVIEWED:
            continue
        excerpt, pains, sentiment = REVIEWED[review["id"]]
        if excerpt not in review["text"]:
            raise ValueError(f"reviewed excerpt does not match source: {review['id']}")
        labels[review["id"]].update(excerpt=excerpt, pain_points=pains,
            sentiment=sentiment, severity="高" if any(p in pains for p in ("智能体下线与创建", "账号与审核误拦截", "稳定性与性能")) else "中" if pains else "无",
            confidence="高", method="人工复核",
            analysis="人工复核原文：" + ("、".join(pains) if pains else "正向或混合体验") + "；评论中的产品状态和原因均未独立核实。")
    allowed_pains = {name for name, _ in PAINS} | {pain for value in labels.values() for pain in value["pain_points"]}
    sentiments = {"正向", "负向", "混合"}
    for review_id, changes in user_defaults.items():
        if review_id not in labels:
            raise ValueError(f"unknown review in user defaults: {review_id}")
        if "pain_points" in changes:
            pains = changes["pain_points"]
            if not isinstance(pains, list) or any(pain not in allowed_pains for pain in pains):
                raise ValueError(f"invalid pain labels in user defaults: {review_id}")
            labels[review_id]["pain_points"] = list(dict.fromkeys(pains))
        if "sentiment" in changes:
            if changes["sentiment"] not in sentiments:
                raise ValueError(f"invalid sentiment in user defaults: {review_id}")
            labels[review_id]["sentiment"] = changes["sentiment"]
        labels[review_id]["method"] = "用户手动修订（已固化为默认）"
    output = {
        "method": "当前助手设计主题规则并批量初标；低信息评论保留未分类。核心结论引用逐条人工复核。用户浏览器的 147 条本地痛点与情绪修订已固化为默认，其余记录为规则初标，不能当作人工逐条确认。无付费模型 API。",
        "reviewed_at": datetime.now(timezone(timedelta(hours=8))).date().isoformat(), "labels": labels,
    }
    (DATA / "annotations.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = Counter(p for v in labels.values() for p in v["pain_points"])
    return {"reviews": len(reviews), "diagnosable": sum(bool(v["pain_points"]) for v in labels.values()),
            "themes": counts, "sentiments": Counter(v["sentiment"] for v in labels.values()),
            "confidence": Counter(v["confidence"] for v in labels.values())}


if __name__ == "__main__":
    print(json.dumps(annotate(), ensure_ascii=False, indent=2))
