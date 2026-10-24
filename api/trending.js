// Pump.fun's own 24-hour trending board, fetched on Vercel's network (pump.fun answers Railway and Google Cloud with a
// Cloudflare check) and cached at the edge for 15 seconds. The round server reads it from here.
// GET /api/trending
const URL_ = "https://advanced-indexer.pump.fun/boards/trending?tier=web&surface=TRENDING&platform=WEB&limit=150&offset=0&ranking=social&window=24h&hot=label&chains=solana";
module.exports = async (req, res) => {
  try {
    const r = await fetch(URL_, { headers: { accept: "application/json", origin: "https://pump.fun", referer: "https://pump.fun/",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    const json = /^\s*\{/.test(text);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", r.ok && json ? "public, max-age=10, s-maxage=15, stale-while-revalidate=60" : "no-store");
    if (r.ok && json) { res.status(200).send(text); return; }
    res.status(502).json({ error: "pump.fun answered " + r.status + (json ? "" : " with a page, not data"), cf: r.headers.get("cf-mitigated") || null });
  } catch (e) { res.setHeader("cache-control", "no-store"); res.status(504).json({ error: "pump.fun didn't answer: " + e.message }); }
};
