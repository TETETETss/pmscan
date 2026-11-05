import json, time, math, os, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
API = "https://data-api.polymarket.com/v2"
NOW = time.time()
def get(url, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(url, headers={"User-Agent": "pmscan/1.0"})
            return json.load(urllib.request.urlopen(r, timeout=25))
        except Exception as e:
            if i == tries - 1: return None
            time.sleep(1.5 * (i + 1))
CATS = ["politics","sports","crypto","weather","mentions","culture","economics","tech","finance"]
EXAMPLES = {"0xa2cd4ccda9a1f95949df7a3355c4c2daa0642ba0":"midterms trader","0xeb1b3ef2729ab7be83e1337ec81f24467c7f87c0":"weather trader",
            "0x2005d16a84ceefa912d4e380cd32e7ff827875ea":"RN1","0x731a241767938bb23d1b2fac4c9cd2f3cea9033f":"CoinTrick"}
names, lbcat = {}, {}
def lb(period, cat=None, pages=1):
    out, cur = [], None
    for _ in range(pages):
        q = {"timePeriod": period, "orderBy": "PNL", "limit": 100}
        if cat: q["category"] = cat
        if cur: q["cursor"] = cur
        d = get(API + "/leaderboard?" + urllib.parse.urlencode(q))
        if not d: break
        out += d["data"]; cur = d["pagination"].get("next_cursor")
        if not cur: break
    return period, cat, out
jobs = [(p, None, 3) for p in ["DAY","WEEK","MONTH","ALL"]] + [(p, c, 1) for p in ["WEEK","MONTH"] for c in CATS]
cands = set(EXAMPLES)
with ThreadPoolExecutor(12) as ex:
    for period, cat, rows in ex.map(lambda j: lb(*j), jobs):
        for r in rows:
            w = r["user_id"].lower(); cands.add(w)
            if r.get("user_name") and not r["user_name"].startswith("0x"): names[w] = r["user_name"]
            if cat and period == "MONTH": lbcat.setdefault(w, {})[cat] = r["pnl"]
# big recent trades
cur = None
for _ in range(15):
    d = get(API + "/trades?limit=500" + (f"&cursor={cur}" if cur else ""))
    if not d: break
    for t in d["data"]:
        if t["size"] * t["price"] >= 3000: cands.add(t["proxy_wallet"].lower())
    cur = d["pagination"].get("next_cursor")
    if not cur: break
print("candidates", len(cands), file=sys.stderr)
KW = [("weather",["temperature","weather","rain","snow","hurricane","°"]),("crypto",["bitcoin","btc","eth","ethereum","solana","xrp","crypto","updown","up-or-down","doge"]),
      ("mentions",["say ","mention","said","tweet"]),("sports",["vs.","nfl","nba","mlb","nhl","ufc","fc ","league","champions","win on","match","spread","o/u","game"]),
      ("politics",["election","senate","house","governor","trump","president","midterm","democrat","republican","mayor","vote"]),
      ("economics",["fed ","rate","cpi","inflation","gdp","jobs","unemployment"]),("finance",["stock","s&p","nasdaq","earnings","price of"]),("culture",["movie","album","oscar","grammy","box office","song"])]
def cat_of(p):
    s = (p.get("title","") + " " + p.get("slug","")).lower()
    for c, ks in KW:
        if any(k in s for k in ks): return c
    return "other"
def wallet(w):
    pnl = get(f"{API}/user-pnl?user={w}&interval=all&fidelity=1d")
    if not pnl: return None
    pts = pnl["data"]["points"]
    if len(pts) < 2: return None
    closed = (get(f"{API}/positions?user={w}&limit=100&status=CLOSED&sort_by=TOTAL_PNL") or {}).get("data", [])
    opn = (get(f"{API}/positions?user={w}&limit=100&status=OPEN&sort_by=TOTAL_PNL") or {}).get("data", [])
    return w, pts, closed, opn
def at(pts, ts):
    v = pts[0]["economic_pnl"] or 0
    for p in pts:
        if p["timestamp"] <= ts: v = p["economic_pnl"] or 0
        else: break
    return v
res = []
with ThreadPoolExecutor(16) as ex:
    for r in ex.map(wallet, sorted(cands)):
        if r: res.append(r)
print("fetched", len(res), file=sys.stderr)
def fm(x):
    a = abs(x); s = "-" if x < 0 else ""
    return s + ("$%.1fM" % (a/1e6) if a >= 1e6 else "$%.0fK" % (a/1e3) if a >= 1e3 else "$%.0f" % a)
out = []
for w, pts, closed, opn in res:
    last = pts[-1]; P = last["economic_pnl"] or 0
    first_ts = pts[0]["timestamp"]; age = (NOW - first_ts) / 86400
    p24 = P - at(pts, NOW - 86400 * 1.5) if len(pts) > 1 else 0
    # daily fidelity: use previous point as 24h
    p24 = P - (pts[-2]["economic_pnl"] or 0)
    p7, p30 = P - at(pts, NOW - 7*86400), P - at(pts, NOW - 30*86400)
    base30 = at(pts, NOW - 30*86400) if age > 30 else 0
    vol = last.get("volume_usdc") or 0; tc = last.get("trade_count") or 0
    roi = P / vol * 100 if vol else 0
    curve = [p["economic_pnl"] or 0 for p in pts]
    # smoothness
    diffs = [b - a for a, b in zip(curve, curve[1:])][-90:]
    upfrac = sum(1 for d in diffs if d > 0) / max(1, len(diffs))
    peak, mdd = -1e18, 0
    for v in curve[-180:]:
        peak = max(peak, v); mdd = max(mdd, peak - v)
    ddpct = mdd / max(abs(peak), 1) * 100
    allpos = closed + opn
    wins = [p for p in closed if p["total_pnl"] > 0]; winrate = len(wins) / len(closed) * 100 if closed else 0
    cm = {}
    for p in allpos:
        if p["total_pnl"] > 0: c = cat_of(p); cm[c] = cm.get(c, 0) + p["total_pnl"]
    for c, v in (lbcat.get(w) or {}).items():
        cm[c] = max(cm.get(c, 0), v)
    tot = sum(cm.values()) or 1
    topc = max(cm, key=cm.get) if cm else "other"; share = cm.get(topc, 0) / tot * 100
    best = None
    for p in allpos:
        cost = p["avg_price"] * p["total_size"]
        if cost <= 0 or p["total_pnl"] <= 0: continue
        mult = (cost + p["total_pnl"]) / cost
        if not best or p["total_pnl"] > best["pnl"]:
            best = dict(t=p["title"], s=p.get("event_slug") or p["slug"], o=p["outcome"], ep=round(p["avg_price"], 4), cost=round(cost), pnl=round(p["total_pnl"]), x=round(mult, 1), ic=p.get("icon",""))
    moon = None
    for p in allpos:
        cost = p["avg_price"] * p["total_size"]
        if cost <= 0 or p["total_pnl"] < 5000: continue
        mult = (cost + p["total_pnl"]) / cost
        if mult >= 50 and (not moon or p["total_pnl"] > moon["pnl"]):
            moon = dict(t=p["title"], s=p.get("event_slug") or p["slug"], o=p["outcome"], ep=round(p["avg_price"], 4), cost=round(cost), pnl=round(p["total_pnl"]), x=round(mult), ic=p.get("icon",""))
    maxcost = max([p["avg_price"] * p["total_size"] for p in allpos] or [0])
    npos = len(allpos)
    tags, why = {}, {}
    if p24 >= 50000 or p7 >= 150000:
        tags["hot"] = min(100, 40 + 12 * math.log10(max(p24, p7 / 3, 1) / 5000) * 3)
        why["hot"] = f"{fm(p24)} in 24h, {fm(p7)} in 7d" if p24 >= 50000 else f"{fm(p7)} in the last 7 days"
    if share >= 70 and topc != "other" and P >= 10000 and roi >= 3 and cm.get(topc, 0) >= 10000:
        tags["spec"] = min(100, share * 0.6 + min(40, roi * 2))
        why["spec"] = f"{share:.0f}% of PnL from {topc}, {roi:.0f}% ROI on volume"
    startb = max(abs(base30), 300)
    if p30 >= 20000 and (p30 / startb >= 10) and (age <= 60 or abs(base30) < 5000):
        m = (P if age <= 30 else p30) / max(startb, 1)
        tags["rocket"] = min(100, 40 + 15 * math.log10(max(m, 1)))
        why["rocket"] = f"{fm(curve[0] if age<=30 else base30)} → {fm(P)} in {min(age,30):.0f} days"
    if moon:
        tags["moon"] = min(100, 40 + 15 * math.log10(moon["x"]) + 5 * math.log10(moon["pnl"] / 1000))
        why["moon"] = f"{fm(moon['cost'])} → {fm(moon['cost']+moon['pnl'])} ({moon['x']}x) at {moon['ep']*100:.1f}¢"
    if age >= 30 and tc >= 5000 and P >= 50000 and upfrac >= 0.6 and ddpct <= 20:
        tags["bot"] = min(100, 30 + 20 * math.log10(tc / 1000) + upfrac * 30 + (20 - ddpct))
        why["bot"] = f"{tc:,} trades, up {upfrac*100:.0f}% of days, {ddpct:.0f}% max drawdown"
    if age <= 30 and maxcost >= 25000 and npos <= 40:
        tags["fresh"] = min(100, 40 + 15 * math.log10(maxcost / 10000) + (40 - npos))
        why["fresh"] = f"{age:.0f} days old, {fm(maxcost)} biggest bet across {npos} positions"
    if not tags: continue
    score = max(tags.values()) + 8 * (len(tags) - 1)
    # sparkline: last 90 points sampled to 40
    c = curve[-120:]; step = max(1, len(c) // 40); sp = [round(v) for v in c[::step]] + [round(c[-1])]
    out.append(dict(w=w, n=names.get(w, ""), tags={k: round(v) for k, v in tags.items()}, why=why, sc=round(score),
        P=round(P), p24=round(p24), p7=round(p7), p30=round(p30), roi=round(roi, 1), wr=round(winrate), vol=round(vol), tc=tc,
        age=round(age), first=first_ts, cat=topc, share=round(share), cm={k: round(v) for k, v in cm.items()}, best=best, moon=moon, sp=sp))
out.sort(key=lambda x: -x["sc"])
sel = {}
for t in ["hot","spec","rocket","moon","bot","fresh"]:
    for x in sorted([x for x in out if t in x["tags"]], key=lambda x: -x["tags"][t])[:40]: sel[x["w"]] = x
for x in out:
    if len(sel) >= 200: break
    sel.setdefault(x["w"], x)
keep = sorted(sel.values(), key=lambda x: -x["sc"])
for w in EXAMPLES:  # keep examples if flagged
    if w not in {x["w"] for x in keep}:
        keep += [x for x in out if x["w"] == w]
hp = "data/history.json"
hist = json.load(open(hp)) if os.path.exists(hp) else {}
for x in keep:
    h = hist.setdefault(x["w"], {"first": int(NOW), "tags": {}})
    for t in x["tags"]: h["tags"].setdefault(t, int(NOW))
    x["ff"] = h["first"]
json.dump(hist, open(hp + ".new", "w"))
json.dump(dict(updated=int(NOW), n_cands=len(cands), wallets=keep), open("data/wallets.json.new", "w"), separators=(",", ":"))
from collections import Counter
print("flagged", len(out), "kept", len(keep), Counter(t for x in keep for t in x["tags"]), file=sys.stderr)
for w, l in EXAMPLES.items():
    m = [x for x in out if x["w"] == w]; print(l, m[0]["tags"] if m else "not flagged", m[0]["why"] if m else "", file=sys.stderr)
