#!/usr/bin/env python3
"""Fetch Ground News topic pages and write a compact news.json for the dashboard.

Ground News has no public API/RSS; its topic pages embed story data (headline, image,
covering sources with bias ratings) in the server-rendered page. We read a handful of
pages a few times an hour, for one personal dashboard, and link every story back to Ground News.
"""
import json, re, sys, time, urllib.request, datetime

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SECTIONS = [
    # key, label, Ground News pages (merged, de-duplicated)
    ("top",       "Top Stories",       ["https://ground.news/"]),
    ("local",     "Tampa Bay & Pasco", ["https://ground.news/interest/tampa", "https://ground.news/interest/pasco-county"]),
    ("politics",  "US Politics",       ["https://ground.news/interest/us-politics_3c3c3c", "https://ground.news/interest/white-house", "https://ground.news/interest/trump-administration_63c55b"]),
    ("ai",        "AI",                ["https://ground.news/interest/ai"]),
    ("space",     "Space & Launches",  ["https://ground.news/interest/nasa", "https://ground.news/interest/spacex_0e0ca2"]),
    ("lightning", "Lightning",         ["https://ground.news/interest/tampa-bay-lightning"]),
]
LOCAL = re.compile(r"Tampa|Pasco|Hillsborough|Pinellas|Hernando|Polk|Petersburg|Clearwater|Brandon|Lakeland|Wesley Chapel|"
                   r"Land O.? ?Lakes|Dade City|Spring Hill|New Port Richey|Zephyrhills|Brooksville|Sarasota|Bradenton|Florida|Bucs|Buccaneers|Lightning|Rays", re.I)
LEFT = {"farLeft", "left", "leanLeft"}; RIGHT = {"farRight", "right", "leanRight"}; CENTER = {"center"}

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")

def flight_text(html):
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    out = []
    for c in chunks:
        try: out.append(json.loads('"' + c + '"'))
        except Exception: pass
    return "".join(out)

def stories_from(html):
    txt = flight_text(html); dec = json.JSONDecoder(); found = {}
    for m in re.finditer(r'\{"(?:biasSourceCount|id)"', txt):
        try: obj, _ = dec.raw_decode(txt, m.start())
        except Exception: continue
        if isinstance(obj, dict) and obj.get("title") and obj.get("slug") and isinstance(obj.get("sources"), list) and obj.get("start"):
            found.setdefault(obj["id"], obj)
    return list(found.values())

def slim(s):
    bd = s.get("blindspotData") or {}
    l, c, r = bd.get("leftPercent") or 0, bd.get("centerPercent") or 0, bd.get("rightPercent") or 0
    if not (l or c or r):  # fall back to the few sources listed inline
        for src in s.get("sources") or []:
            b = ((src or {}).get("sourceInfo") or {}).get("bias")
            if b in LEFT: l += 1
            elif b in RIGHT: r += 1
            elif b in CENTER: c += 1
    desc = s.get("description") if isinstance(s.get("description"), str) and not s["description"].startswith("$") else ""
    media = s.get("latestMedia") or {}
    img = media.get("url") if not media.get("nsfw") else None
    if img and "b-cdn.net" in img: img += ("&" if "?" in img else "?") + "width=640"
    return {
        "id": s["id"], "title": s.get("generatedHeadline") or s["title"], "url": "https://ground.news/article/" + s["slug"],
        "start": s["start"], "image": img, "sources": s.get("sourceCount") or len(s.get("sources") or []),
        "bias": {"left": l, "center": c, "right": r},
        "place": ((s.get("place") or {}).get("name")), "summary": desc.strip()[:280],
    }

def main(out_path):
    now = datetime.datetime.now(datetime.timezone.utc); seen = set(); sections = []
    for key, label, urls in SECTIONS:
        items = {}
        for u in urls:
            try:
                for s in stories_from(get(u)): items.setdefault(s["id"], s)
            except Exception as e:
                print(f"warn {u}: {e}", file=sys.stderr)
            time.sleep(1.5)
        recent = [s for s in items.values() if (now - datetime.datetime.fromisoformat(s["start"].replace("Z", "+00:00"))).days < 4]
        if key == "local":  # place pages pull in some non-local stories; keep ones that are clearly local
            recent = [s for s in recent if LOCAL.search(((s.get("place") or {}).get("name") or "") + " " + s["title"])]
        recent.sort(key=lambda s: (s.get("sourceCount") or 0, s["start"]), reverse=True)
        picked = [slim(s) for s in recent if s["id"] not in seen][:12]
        seen.update(p["id"] for p in picked)
        picked.sort(key=lambda s: s["start"], reverse=True) if key == "local" else None
        sections.append({"key": key, "label": label, "stories": picked})
        print(f"{key}: {len(items)} found, {len(picked)} kept", file=sys.stderr)
    if sum(len(s["stories"]) for s in sections) == 0:
        sys.exit("no stories extracted; keeping previous news.json")
    json.dump({"generated": now.isoformat(), "sections": sections}, open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "news.json")
