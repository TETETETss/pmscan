import json
d=json.load(open("data/wallets.json"))
s=open("tpl.html").read().replace("__DATA__",json.dumps(d,separators=(",",":")).replace("</","<\\/")).replace("__NC__",f"{d['n_cands']:,}")
open("pub/index.html","w").write(s)
