"""Builds the site from app/src into ../index.html (and the Claude artifact page into app/dist/).

    python3 app/build.py

No dependencies. The page is one self-contained HTML file plus config.js, the icons and the banner.
"""
import json, os, re

APP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP)
SRC, DATA = os.path.join(APP, "src"), os.path.join(APP, "data")
LWC = ('<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.9/dist/lightweight-charts.standalone.production.js" '
       'integrity="sha384-6/iv/tWhS2LqjhNmDWcisQfhsuS0IqxtaOo1ZnA8dzgpK1sYsn8Al1icSvt0qirp" crossorigin="anonymous"></script>')
ORDER = ["core.js", "engine.js", "social.js", "ui_arena.js", "ui_markets.js", "ui_squads.js", "chart.js", "ui_modals.js", "live.js", "srv.js", "boot.js"]

# ---------- recorded hour (the replay) and logos ----------
data = json.load(open(os.path.join(DATA, "data.json"), encoding="utf-8"))
oh = {line.split("|")[0]: line for line in open(os.path.join(DATA, "ohlc.txt"), encoding="utf-8").read().splitlines() if line.strip()}
logos = {}
for line in open(os.path.join(DATA, "logos2.txt"), encoding="utf-8").read().splitlines():
    parts = line.split()
    if len(parts) == 3:
        logos[parts[0]] = "data:image/webp;base64," + parts[2]
end, toks = 0, []
for t in data["tokens"]:
    r = {k: t.get(k) for k in ["s", "n", "m", "t", "px", "mc", "l", "v", "tx", "bs", "ch", "p", "dex", "q", "pa", "x", "tg", "dc", "w", "ds"]}
    r["oh"] = oh.get(t["s"])
    if r["oh"]:
        f = r["oh"].split("|")
        last = int(f[3].split(";")[-1].split(",")[0])
        end = max(end, (int(f[1]) + last * 60) * 1000 + 60000)
    toks.append(r)
rec = {"snap": data["snap"], "end": end, "tokens": toks}

js = "\n".join(open(os.path.join(SRC, f), encoding="utf-8").read() for f in ORDER)
js = js.replace("/*REC*/null", json.dumps(rec, ensure_ascii=False, separators=(",", ":")), 1)
js = js.replace("/*LOGOS*/{}", json.dumps(logos, separators=(",", ":")), 1)
script = "(() => {\n\"use strict\";\n" + js + "\n})();"
head = open(os.path.join(SRC, "head.html"), encoding="utf-8").read()
artifact = head + "\n" + LWC + "\n<script>\n" + script.replace("</script", "<\\/script") + "\n</script>\n"
os.makedirs(os.path.join(APP, "dist"), exist_ok=True)
open(os.path.join(APP, "dist", "squad-arena.html"), "w", encoding="utf-8").write(artifact)

# ---------- the site: a proper <head> with share tags and icons ----------
cut = artifact.index("</style>") + len("</style>")
head_part, body_part = artifact[:cut], artifact[cut:]
head_part = re.sub(r"<title>.*?</title>\s*", "", head_part, flags=re.S)
head_part = re.sub(r'<link rel="icon"[^>]*>\s*', "", head_part)
head_part = re.sub(r'<meta name="claude:[^>]*>\s*', "", head_part)
TITLE = "Squad Arena · Fifteen coins enter. One squad wins."
DESC = "Fifteen fresh pump.fun coins race in live rounds. Back the top gainer or the last coin standing, join the coin's squad and push it up the board."
URL = "https://squadarena.fun/"
ALT = "Squad Arena: fifteen pump.fun coins lined up in three chevron stripes, one winner on the tip."
meta = f"""<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{TITLE}</title>
<meta name="description" content="{DESC}">
<link rel="canonical" href="{URL}">
<meta name="theme-color" content="#08080a">
<meta name="color-scheme" content="dark light">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Squad Arena">
<meta property="og:url" content="{URL}">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESC}">
<meta property="og:image" content="{URL}og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{ALT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{TITLE}">
<meta name="twitter:description" content="{DESC}">
<meta name="twitter:image" content="{URL}og.png">
<meta name="twitter:image:alt" content="{ALT}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://esm.sh">
<script src="/config.js"></script>
<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}}body{{margin:0;font:14px system-ui}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>"""
html = '<!doctype html>\n<html lang="en">\n<head>\n' + meta + "\n" + head_part.strip() + "\n</head>\n<body>\n" + body_part.strip() + "\n</body>\n</html>\n"
for secret in ("privy_app_secret", "sb_secret_", "quiknode.pro"):
    assert secret not in html.lower(), "a secret ended up in the page: " + secret
open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8").write(html)
print(f"index.html {len(html):,} bytes · artifact {len(artifact):,} bytes · {sum(1 for t in toks if t['oh'])} recorded coins")
