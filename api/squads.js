// pump.fun's squad competition (the Squad Invitational and later ones), fetched on Vercel's network and cached at the
// edge for 30 seconds, so every viewer and the round server share one call. Only competition reads are allowed through.
// GET /api/squads                       the live squad competition: details and the top 100 squads
// GET /api/squads?c=<id>                one competition
// GET /api/squads?c=<id>&e=<entry id>   one squad: members, positions
// GET /api/squads?c=<id>&e=<id>&h=1     one squad's best coins (highlights)
const API = "https://frontend-api-v3.pump.fun";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD = { accept: "application/json", origin: "https://pump.fun", referer: "https://pump.fun/",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" };
const LIVE = "f0f80f25-3b5c-4996-8750-7940f6950965";        // the Squad Invitational (26 Oct – 9 Nov 2026)
module.exports = async (req, res) => {
  const q = req.query || {}, c = String(q.c || LIVE), e = q.e ? String(q.e) : "";
  if (!UUID.test(c) || (e && !UUID.test(e))) { res.status(400).json({ error: "Not a competition or squad id." }); return; }
  const path = `/competitions/${c}` + (e ? `/entries/${e}` + (q.h ? "/highlights?limit=10" : "") : "");
  try {
    const r = await fetch(API + path, { headers: HEAD, signal: AbortSignal.timeout(8000) });
    const text = await r.text(), json = /^\s*[{[]/.test(text);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", r.ok && json ? "public, max-age=15, s-maxage=30, stale-while-revalidate=300" : "no-store");
    if (r.ok && json) { res.status(200).send(text); return; }
    res.status(502).json({ error: "pump.fun answered " + r.status + (json ? "" : " with a page, not data"), cf: r.headers.get("cf-mitigated") || null });
  } catch (err) { res.setHeader("cache-control", "no-store"); res.status(504).json({ error: "pump.fun didn't answer: " + err.message }); }
};
