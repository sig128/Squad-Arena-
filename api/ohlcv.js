// Candles for one pool, fetched from GeckoTerminal on Vercel's network (the round server's address is rate-limited there)
// and cached at Vercel's edge for a minute, so many viewers of one coin cost one call.
// GET /api/ohlcv?pool=<pool address>&agg=1|5
module.exports = async (req, res) => {
  const pool = String((req.query && req.query.pool) || "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool)) { res.status(400).json({ error: "Not a pool address." }); return; }
  const agg = String(req.query.agg) === "5" ? 5 : 1, limit = agg === 5 ? 300 : 200;
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=${agg}&limit=${limit}&currency=usd&token=base`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("access-control-allow-origin", "*");
    if (r.ok) res.setHeader("cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=600");
    else res.setHeader("cache-control", "no-store");
    res.status(r.status).send(body);
  } catch (e) {
    res.setHeader("cache-control", "no-store");
    res.status(504).json({ error: "GeckoTerminal didn't answer." });
  }
};
