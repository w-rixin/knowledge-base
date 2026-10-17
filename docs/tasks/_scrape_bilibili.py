"""抓取 B 站视频 BV1xvosBREbr 的全部评论（含楼中楼）。
   产物: ./_bilibili_comments.json"""
import urllib.request, urllib.parse, json, time, sys

OID = 116447653201527
BVID = "BV1xvosBREbr"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": f"https://www.bilibili.com/video/{BVID}/",
    "Origin": "https://www.bilibili.com",
}


def http_get(url):
    req = urllib.request.Request(url)
    for k, v in HEADERS.items():
        req.add_header(k, v)
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def fetch_main_page(next_offset):
    """主评论分页（cursor 模式）。next_offset 为空表示第一页。"""
    pagination = json.dumps({"offset": next_offset}) if next_offset else ""
    params = {
        "oid": str(OID),
        "type": "1",
        "mode": "3",
        "plat": "1",
        "web_location": "1315875",
        "pagination_str": pagination,
    }
    url = "https://api.bilibili.com/x/v2/reply/main?" + urllib.parse.urlencode(params)
    return http_get(url)


def fetch_subreplies(root_rpid, pn):
    """获取某个主评论的楼中楼。pn 从 1 开始。"""
    params = {
        "type": "1",
        "oid": str(OID),
        "root": str(root_rpid),
        "ps": "10",
        "pn": str(pn),
    }
    url = "https://api.bilibili.com/x/v2/reply/reply?" + urllib.parse.urlencode(params)
    return http_get(url)


def main():
    all_main = []
    next_offset = ""
    page_idx = 0
    while True:
        page_idx += 1
        try:
            data = fetch_main_page(next_offset)
        except Exception as e:
            print(f"[main p{page_idx}] error: {e}", file=sys.stderr)
            break
        if data.get("code") != 0:
            print(f"[main p{page_idx}] code={data.get('code')} msg={data.get('message')}", file=sys.stderr)
            break
        d = data["data"]
        # 第一页带置顶
        if page_idx == 1 and d.get("top_replies"):
            for r in d["top_replies"]:
                r["_is_top"] = True
                all_main.append(r)
        for r in d.get("replies") or []:
            r["_is_top"] = False
            all_main.append(r)
        cursor = d.get("cursor", {})
        is_end = cursor.get("is_end")
        all_count = cursor.get("all_count")
        next_offset = cursor.get("pagination_reply", {}).get("next_offset", "")
        print(f"[main p{page_idx}] +{len(d.get('replies') or [])} → 累计 {len(all_main)} / {all_count}", file=sys.stderr)
        if is_end or not next_offset:
            break
        time.sleep(0.6)
        if page_idx > 60:
            print("[main] 达到安全上限 60 页，停止", file=sys.stderr)
            break

    # 抓取楼中楼（rcount > 0 的楼层）
    for i, r in enumerate(all_main):
        rcount = r.get("rcount", 0)
        if rcount == 0:
            continue
        rpid = r["rpid"]
        sub_all = []
        for pn in range(1, 50):
            try:
                sd = fetch_subreplies(rpid, pn)
            except Exception as e:
                print(f"[sub {rpid} p{pn}] error: {e}", file=sys.stderr)
                break
            if sd.get("code") != 0:
                break
            replies = sd["data"].get("replies") or []
            sub_all.extend(replies)
            if len(replies) < 10:
                break
            time.sleep(0.4)
        r["_subreplies"] = sub_all
        print(f"[sub {i+1}/{len(all_main)}] rpid={rpid} → {len(sub_all)} 条", file=sys.stderr)
        time.sleep(0.3)

    # 精简字段
    def slim(r):
        return {
            "rpid": r["rpid"],
            "uname": r["member"]["uname"],
            "like": r.get("like", 0),
            "ctime": r.get("ctime"),
            "is_top": r.get("_is_top", False),
            "rcount": r.get("rcount", 0),
            "message": r["content"]["message"],
            "subreplies": [
                {
                    "rpid": s["rpid"],
                    "uname": s["member"]["uname"],
                    "like": s.get("like", 0),
                    "ctime": s.get("ctime"),
                    "message": s["content"]["message"],
                }
                for s in r.get("_subreplies", [])
            ],
        }

    output = {
        "video": {"bvid": BVID, "oid": OID},
        "total_main": len(all_main),
        "total_with_subs": sum(1 + len(r.get("_subreplies", [])) for r in all_main),
        "main_replies": [slim(r) for r in all_main],
    }
    out_path = "E:/my/桌面软件tauri/knowledge_base/docs/tasks/_bilibili_comments.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nDONE: 主评论 {len(all_main)} 条, 含楼中楼合计 {output['total_with_subs']} 条", file=sys.stderr)
    print(f"Saved to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
