// Market data: which coins exist, their prices over time, candles, the gate and the rug filter.
// Sources: the PumpSwap pools themselves (new coins: every pool that trades shows up on a public Solana WebSocket),
// DEX Screener (market cap, liquidity, volume, trades), QuickNode (pool balances on every swap: prices and our own candles),
// pump.fun (descriptions and socials when it answers) and GeckoTerminal (older chart history, in the background only).
import { CFG, GATE, MAX_AGE } from "./config.js";
import { getJSON, sleep, log, b58dec, b58enc, now } from "./util.js";

export const TL = new Map();               // mint -> token
export const FEED = { cand: new Map(), pending: [], page: 0, pages: 13, pumpBlocked: false, lastPrice: 0, lastDisc: 0, gtNext: 0, gtPauseUntil: 0,
  reject: new Map(),          // mint -> time until which discovery skips it (too old, or not on DEX Screener yet)
  pools: new Map(),           // mint -> { pool, bv, qv } from the pool stream, so the price stream can start without a lookup
  viewed: new Map(),          // mint -> last time someone opened its chart (kept live for 10 minutes)
  sample: { at: 0, running: false, pools: 0, fresh: 0, ms: 0, err: "" }, backfilled: 0,
  started: now(), calls: 0, errs: 0, sol: 0, onTick: null, onMeta: null, onCandles: null };

export function makeToken(r) {
  return {
    m: r.m, s: r.s, n: r.n || r.s, born: r.t || 0, px: r.px || null, mc: r.mc || null, supply: r.mc && r.px ? r.mc / r.px : 1e9,
    liq: r.l ?? null, vol: r.v || [0, 0, 0, 0], tx: r.tx || [0, 0, 0, 0], bs: r.bs || [0, 0], ch: r.ch || [0, 0, 0, 0],
    pool: r.p || null, dex: r.dex || null, quote: r.q || "SOL", pa: r.pa || null,
    x: r.x || null, tg: r.tg || null, dc: r.dc || null, w: r.w || null, ds: r.ds || "", logo: r.logo || null,
    C: [], C5: [], CH: [], C5H: [], ticks: [], rugAt: 0, rugWhy: "", gate: true, lastSeen: 0, histAt: 0, hist5At: 0, rpcAt: 0, rpc: null
  };
}

/* ---------- prices over time (same rules as the site) ---------- */
export function idxLE(A, t) { let lo = 0, hi = A.length - 1; if (hi < 0 || t < A[0].t) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m].t <= t) lo = m; else hi = m - 1; } return lo; }
function pathPts(c) { return c.c >= c.o ? [[0, c.o], [0.3, c.l], [0.7, c.h], [1, c.c]] : [[0, c.o], [0.3, c.h], [0.7, c.l], [1, c.c]]; }
function pathAt(c, f) { const P = pathPts(c); for (let k = 1; k < P.length; k++) if (f <= P[k][0]) { const a = P[k - 1], b = P[k]; return a[1] + (b[1] - a[1]) * (f - a[0]) / (b[0] - a[0]); } return c.c; }
export function pAt(tok, t) {
  const K = tok.ticks;
  if (K.length && t >= K[0].t) {
    const i = idxLE(K, t); if (i >= K.length - 1) return K[K.length - 1].p;
    const a = K[i], b = K[i + 1]; return a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t || 1);
  }
  let C = tok.C, span = 60000, i = idxLE(C, t);
  if (i < 0 && tok.C5.length) { C = tok.C5; span = 300000; i = idxLE(C, t); }
  if (i < 0) return null;
  const c = C[i], f = (t - c.t) / span;
  if (f >= 1) return c.c;
  return pathAt(c, f);
}
export function twap(tok, a, b) {
  if (!(b > a)) return pAt(tok, a);
  let s = 0, n = 0; const N = 14;
  for (let i = 0; i <= N; i++) { const p = pAt(tok, a + (b - a) * i / N); if (p != null) { s += p; n++; } }
  return n ? s / n : null;
}
export function firstTime(tok) { let f = Infinity; if (tok.C.length) f = tok.C[0].t; if (tok.C5.length) f = Math.min(f, tok.C5[0].t); if (tok.ticks.length) f = Math.min(f, tok.ticks[0].t); return f; }

// at most one tick per second per coin; ticks older than 2 h fall back to our own candles, built from the same prices
export function pushTick(tok, t, p, v = 0) {
  const K = tok.ticks, last = K[K.length - 1];
  if (last && Math.floor(t / 1000) === Math.floor(last.t / 1000)) { last.p = p; last.t = Math.max(last.t, t); }     // one tick per clock second
  else if (!last || t > last.t) K.push({ t, p });
  if (K.length > 7600) K.splice(0, K.length - 7200);
  if (!tok.full) { bump(tok.C, 60000, t, p, v, 1500); bump(tok.C5, 300000, t, p, v, 900); }
  if (FEED.onTick) FEED.onTick(tok, t, p);
}
// own candles: 1-minute for 25 hours, 5-minute for 75 hours. Each opens at the last close, so the chart has no gaps in price
function bump(A, span, t, p, v, keep) {
  const b = Math.floor(t / span) * span, last = A[A.length - 1];
  if (last && last.t === b) { if (p > last.h) last.h = p; if (p < last.l) last.l = p; last.c = p; last.v += v; return; }
  if (last && b < last.t) return;
  const o = last ? last.c : p;
  A.push({ t: b, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v });
  if (A.length > keep) A.splice(0, A.length - keep);
}
// what charts show: our candles, with older background history (if any) in front of them; only finished candles
export function chartC(tok, five, t = now()) {
  const span = five ? 300000 : 60000, own = five ? tok.C5 : tok.C, old = five ? tok.C5H : tok.CH, first = own.length ? own[0].t : Infinity;
  return old.filter(c => c.t < first).concat(own.filter(c => c.t + span <= t));
}

/* ---------- transport: GeckoTerminal allows ~30 calls a minute, so its calls are spaced and backed off ---------- */
// two queues: GeckoTerminal backing off never holds up DEX Screener prices
const chains = { gt: Promise.resolve(), other: Promise.resolve() };
const serial = (k, fn) => { const p = chains[k].then(fn, fn); chains[k] = p.catch(() => {}); return p; };
const isGT = u => u.includes("geckoterminal.com");
const fetchJSON = url => serial(isGT(url) ? "gt" : "other", async () => {
  if (isGT(url)) { const wait = FEED.gtNext - now(); if (wait > 0) await sleep(Math.min(wait, 30000)); }
  try { const j = await getJSON(url); FEED.calls++; if (isGT(url)) FEED.gtNext = now() + 3000; return j; }
  catch (e) { FEED.errs++; FEED.lastErr = { at: now(), msg: String(e.message || e).slice(0, 160) }; if (isGT(url)) FEED.gtNext = now() + (e.status === 429 ? 30000 : 5000); throw e; }
});

/* ---------- applying DEX Screener pairs ---------- */
const fmtUsd = v => v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
export function applyPairs(arr, t) {
  const best = new Map(), born = new Map();
  for (const p of arr || []) {
    if (!p || p.chainId !== "solana" || !p.baseToken || !p.baseToken.address) continue;
    const m = p.baseToken.address, liq = (p.liquidity && p.liquidity.usd) || 0, cur = best.get(m);
    if (!cur || liq > ((cur.liquidity && cur.liquidity.usd) || 0)) best.set(m, p);
    if (p.pairCreatedAt && !(born.get(m) <= p.pairCreatedAt)) born.set(m, p.pairCreatedAt);     // the first pair is the launch (the bonding curve)
  }
  const changed = [];
  for (const [m, p] of best) {
    const px = +p.priceUsd; if (!(px > 0)) continue;
    const cand = FEED.cand.get(m) || {};
    let tok = TL.get(m);
    if (!tok) { tok = makeToken({ m, s: p.baseToken.symbol, n: p.baseToken.name, t: cand.t || 0, x: cand.x, tg: cand.tg, w: cand.w, ds: cand.ds }); TL.set(m, tok); }
    const wasGate = tok.gate, wasRug = tok.rugAt;
    tok.px = px; tok.mc = +(p.marketCap || p.fdv) || tok.mc; if (tok.mc && px) tok.supply = tok.mc / px;
    const v = p.volume || {}, tx = p.txns || {}, ch = p.priceChange || {}, n = k => tx[k] ? (tx[k].buys || 0) + (tx[k].sells || 0) : 0;
    tok.liq = (p.liquidity && p.liquidity.usd) || 0; tok.vol = [v.m5 || 0, v.h1 || 0, v.h6 || 0, v.h24 || 0]; tok.tx = [n("m5"), n("h1"), n("h6"), n("h24")];
    tok.bs = [tx.h1 ? tx.h1.buys || 0 : 0, tx.h1 ? tx.h1.sells || 0 : 0]; tok.ch = [ch.m5 || 0, ch.h1 || 0, ch.h6 || 0, ch.h24 || 0];
    tok.pool = p.pairAddress || tok.pool; tok.dex = p.dexId || tok.dex; tok.quote = (p.quoteToken && p.quoteToken.symbol) || "SOL"; tok.pa = p.pairCreatedAt || tok.pa;
    tok.qn = +p.priceNative || null; if (tok.quote === "SOL" && tok.qn) FEED.sol = px / tok.qn;
    if (!tok.born || (!cand.t && born.get(m) < tok.born)) tok.born = cand.t || born.get(m) || p.pairCreatedAt || 0;
    const info = p.info || {};
    (info.socials || []).forEach(s => { if (s.type === "twitter" && !tok.x) tok.x = s.url; if (s.type === "telegram" && !tok.tg) tok.tg = s.url; if (s.type === "discord" && !tok.dc) tok.dc = s.url; });
    if (!tok.w && info.websites && info.websites[0]) tok.w = info.websites[0].url;
    if (info.imageUrl && !tok.logo) tok.logo = info.imageUrl;
    const ageH = Math.max(0.05, (t - (tok.born || t)) / 3600e3), adj = ageH < 24 ? 24 / ageH : 1;
    const pass = tok.liq >= GATE.liq && (tok.mc || 0) / Math.max(1, tok.liq) <= GATE.mcLiq && tok.vol[3] * adj / (tok.mc || 1) >= GATE.turn && tok.tx[3] * adj >= GATE.trades && tok.tx[3] >= GATE.tx24;
    if (tok.lastSeen && tok.gate && !tok.rugAt && (tok.ch[0] <= -80 || tok.liq < GATE.liq * 0.6)) { tok.rugAt = t; tok.rugWhy = tok.ch[0] <= -80 ? "price fell " + Math.round(-tok.ch[0]) + "% in 5 min" : "liquidity fell to " + fmtUsd(tok.liq); log("info", "rug filter: " + tok.s + " " + tok.rugWhy); }
    tok.gate = pass || (tok.gate && !!tok.lastSeen && tok.liq >= GATE.liq);
    // DEX Screener prices are the backbone, except for coins the RPC stream watches: those pools report every swap,
    // and DEX Screener's slightly older price in between would make the line zigzag
    if (!(RPC.live && RPC.watched.has(m) && tok.rpcAt)) pushTick(tok, t, px);
    tok.lastSeen = t;
    if (wasGate !== tok.gate || wasRug !== tok.rugAt) changed.push(tok);
  }
  if (FEED.onMeta) FEED.onMeta([...best.keys()].map(m => TL.get(m)).filter(Boolean), changed);
}
// background history from GeckoTerminal: shown on charts before our own candles start, never used for scoring
export function applyCandles(tok, list, five) {
  const C = (list || []).map(c => ({ t: c[0] * 1000, o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] })).filter(c => c.c > 0).sort((a, b) => a.t - b.t);
  if (five) { tok.C5H = C; tok.hist5At = now(); } else { tok.CH = C; tok.histAt = now(); }
  if (FEED.onCandles && C.length) FEED.onCandles(tok, five);
}

/* ---------- jobs ---------- */
export async function jobPrices(mints) {
  if (!mints.length) { FEED.lastPrice = now(); return; }      // nothing to price yet: let discovery run
  for (let i = 0; i < mints.length; i += 30) applyPairs(await fetchJSON("https://api.dexscreener.com/tokens/v1/solana/" + mints.slice(i, i + 30).join(",")), now());
  FEED.lastPrice = now();
}
// new candidates: up to 90 at a time (three DEX Screener calls side by side); old coins and unknown ones are skipped for a while
export async function jobValidate() {
  const batches = []; for (let i = 0; i < 3 && FEED.pending.length; i++) batches.push(FEED.pending.splice(0, 30));
  if (!batches.length) return;
  await Promise.all(batches.map(async batch => {
    const arr = await getJSON("https://api.dexscreener.com/tokens/v1/solana/" + batch.join(","));
    FEED.calls++;
    // keep coins launched in the last 72 hours: their first pair (the bonding curve) dates the launch
    const t = now(), first = new Map();
    for (const p of arr || []) { const m = p && p.baseToken && p.baseToken.address; if (m && p.pairCreatedAt && !(first.get(m) <= p.pairCreatedAt)) first.set(m, p.pairCreatedAt); }
    const young = m => { const c = FEED.cand.get(m); return c && c.t ? t - c.t <= MAX_AGE : first.has(m) && t - first.get(m) <= MAX_AGE + 3600e3; };
    applyPairs((arr || []).filter(p => p && p.baseToken && young(p.baseToken.address)), t);
    for (const m of batch) if (!TL.has(m)) FEED.reject.set(m, t + ((arr || []).some(p => p && p.baseToken && p.baseToken.address === m) ? 6 * 3600e3 : 600e3));
  }).map(p => p.catch(e => { FEED.errs++; FEED.lastErr = { at: now(), msg: String(e.message || e).slice(0, 160) }; })));
}
// DEX Screener's latest profiles and boosts: a second source of fresh pump.fun coins that works from any server
const DS_LISTS = ["https://api.dexscreener.com/token-profiles/latest/v1", "https://api.dexscreener.com/token-boosts/latest/v1", "https://api.dexscreener.com/token-boosts/top/v1"];
export async function jobDiscoverDS() {
  FEED.lastDS = now(); FEED.dsI = ((FEED.dsI || 0) + 1) % DS_LISTS.length;
  const arr = await fetchJSON(DS_LISTS[FEED.dsI]);
  for (const x of Array.isArray(arr) ? arr : []) {
    const m = x && x.chainId === "solana" ? String(x.tokenAddress || "") : "";
    if (!m.endsWith("pump") || TL.has(m) || FEED.cand.has(m)) continue;
    FEED.cand.set(m, { t: 0, logo: x.icon || null }); FEED.pending.push(m);
  }
}
// pump.fun's own list adds descriptions and socials when it answers; if it refuses this server three times, it rests 30 minutes
export const pumpOff = () => FEED.pumpBlocked && now() - FEED.pumpBlockedAt < 1800e3;
export async function jobDiscover() {
  const t = now(); FEED.lastDisc = t;
  if (!pumpOff()) {
    try {
      const off = FEED.page * 50; FEED.page = (FEED.page + 1) % FEED.pages;
      const arr = await fetchJSON(`https://frontend-api-v3.pump.fun/coins?offset=${off}&limit=50&sort=market_cap&order=DESC&includeNsfw=false`);
      for (const c of arr || []) {
        if (!c || !c.mint || c.nsfw || c.is_banned || !(t - c.created_timestamp <= MAX_AGE)) continue;
        if (!FEED.cand.has(c.mint)) { FEED.cand.set(c.mint, { t: c.created_timestamp, ds: c.description || "", x: c.twitter || null, tg: c.telegram || null, w: c.website || null, logo: c.image_uri || null }); if (!TL.has(c.mint)) FEED.pending.push(c.mint); }
        else { const tok = TL.get(c.mint); if (tok && !tok.logo && c.image_uri) tok.logo = c.image_uri; }
      }
      return;
    } catch (e) {
      FEED.pumpFails = (FEED.pumpFails || 0) + 1;
      if (FEED.pumpFails >= 3) { FEED.pumpBlocked = true; FEED.pumpBlockedAt = t; FEED.pumpFails = 0; log("warn", "pump.fun API unavailable for 30 minutes: " + e.message); }
      return;
    }
  }
}

/* ---------- discovery from the chain: every PumpSwap pool that trades during a short listen ---------- */
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", POOL_TAG = "hQrXeCntzbV", WSOL = "So11111111111111111111111111111111111111112";
// tries each WebSocket in DISCOVERY_WS (comma-separated) in turn; one that delivers nothing is skipped next time
export function samplePools(ms) {
  const urls = CFG.discoveryWs.split(",").map(x => x.trim()).filter(Boolean);
  if (FEED.sample.running || !urls.length || typeof WebSocket === "undefined") return Promise.resolve(0);
  const url = urls[(FEED.sample.ix || 0) % urls.length];
  FEED.sample.running = true; const seen = new Map(), t0 = now(); let live = 0, opened = false, msgs = 0, sub = null;
  return new Promise(resolve => {
    let ws, done = false;
    const finish = err => {
      if (done) return; done = true; clearTimeout(timer); try { ws && ws.close(); } catch (_) {}
      const t = now(); let fresh = 0;
      for (const [m, info] of [...seen.entries()].sort((a, b) => b[1].n - a[1].n)) {
        FEED.pools.set(m, info);
        const tok = TL.get(m);
        if (tok) { if (t - (tok.lastSeen || 0) > 600e3 && !FEED.pending.includes(m)) FEED.pending.push(m); continue; }      // re-check coins that may have grown
        if ((FEED.reject.get(m) || 0) > t || FEED.pending.includes(m)) continue;
        FEED.pending.push(m); fresh++;
      }
      if (FEED.pools.size > 20000) FEED.pools = new Map([...FEED.pools].slice(-10000));
      if (FEED.reject.size > 50000) for (const [m, until] of FEED.reject) if (until < t) FEED.reject.delete(m);
      if (!seen.size) FEED.sample.ix = (FEED.sample.ix || 0) + 1;
      Object.assign(FEED.sample, { at: t, running: false, pools: seen.size, fresh: fresh + live, ms: t - t0, err: err || (seen.size ? "" : `nothing from ${url.replace(/^wss?:\/\//, "").split("/")[0]} (opened ${opened}, subscription ${sub}, ${msgs} messages)`) });
      resolve(fresh + live);
    };
    const timer = setTimeout(() => finish(), ms);
    try { ws = new WebSocket(url); } catch (e) { return finish("could not open: " + e.message); }
    ws.onopen = () => (opened = true) && ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "programSubscribe", params: [PUMPSWAP, { encoding: "base64", commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: POOL_TAG } }, { memcmp: { offset: 75, bytes: WSOL } }] }] }));
    ws.onerror = () => finish("connection error");
    ws.onclose = () => finish(seen.size ? "" : "closed early");
    ws.onmessage = ev => {
      msgs++;
      let j; try { j = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch (_) { return; }
      if (j.id === 1) { if (j.error) return finish("refused: " + (j.error.message || "error")); sub = j.result; return; }
      if (j.method !== "programNotification") return;
      const v = j.params && j.params.result && j.params.result.value; if (!v || !v.account || !v.account.data) return;
      const d = Buffer.from(v.account.data[0], "base64"); if (d.length < 203) return;
      const m = b58enc(d.subarray(43, 75)); if (!m.endsWith("pump")) return;
      const s = seen.get(m); if (s) { s.n++; return; }
      const info = { pool: v.pubkey, bv: b58enc(d.subarray(139, 171)), qv: b58enc(d.subarray(171, 203)), n: 1 };
      seen.set(m, info); FEED.pools.set(m, info);
      // check a coin we haven't seen the moment its pool trades, instead of waiting for the listen to end
      if (!TL.has(m) && !((FEED.reject.get(m) || 0) > now()) && !FEED.pending.includes(m)) { FEED.pending.push(m); live++; }
    };
  });
}
// background history: one GeckoTerminal fill per coin, for the stretch before the server started watching it.
// Nothing waits on it; a refusal pauses it for two minutes.
export async function jobBackfill(tok) {
  const five = !!tok.histAt; if (five) tok.hist5At = 1; else tok.histAt = 1;
  const q = five ? "minute?aggregate=5&limit=300" : "minute?aggregate=1&limit=200";
  let j;
  try { j = await fetchJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${tok.pool}/ohlcv/${q}&currency=usd&token=base`); }
  catch (e) { if (e.status === 429) { if (five) tok.hist5At = 0; else tok.histAt = 0; } throw e; }      // rate limited: try again later; anything else: give up on this coin
  applyCandles(tok, j && j.data && j.data.attributes && j.data.attributes.ohlcv_list, five);
  FEED.backfilled++;
}
export function prune(keep) {
  const t = now();
  for (const [m, tok] of TL) {
    if (keep.has(m)) continue;
    const old = tok.born && t - tok.born > MAX_AGE + 3600e3, stale = tok.lastSeen && t - tok.lastSeen > 3 * 3600e3;
    if (old || stale) { TL.delete(m); RPC.watched.delete(m); }
  }
}

/* ---------- QuickNode stream: pool vault balances → price on every swap ---------- */
export const RPC = { ws: null, live: false, id: 1, pend: new Map(), subs: new Map(), watched: new Set(), retry: 0 };
async function rpcHttp(method, params) {
  const url = CFG.quicknode.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const j = await getJSON(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (j.error) throw new Error(j.error.message || "RPC error"); return j.result;
}
export function rpcStart(onUp) {
  if (!CFG.quicknode || RPC.ws || typeof WebSocket === "undefined") return;
  try { RPC.ws = new WebSocket(CFG.quicknode.replace(/^https:/, "wss:").replace(/^http:/, "ws:")); } catch (e) { RPC.ws = null; log("warn", "RPC stream failed to open: " + e.message); return; }
  RPC.ws.onopen = () => { RPC.live = true; RPC.retry = 0; log("info", "RPC stream connected"); if (onUp) onUp(); };
  RPC.ws.onclose = () => { RPC.live = false; RPC.ws = null; RPC.subs.clear(); RPC.watched.clear(); RPC.retry++; setTimeout(() => rpcStart(onUp), Math.min(30000, 2000 * RPC.retry)); };
  RPC.ws.onerror = () => {};
  RPC.ws.onmessage = ev => {
    let j; try { j = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch (_) { return; }
    if (j.id && RPC.pend.has(j.id)) { const f = RPC.pend.get(j.id); RPC.pend.delete(j.id); f(j.result); return; }
    if (j.method !== "accountNotification") return;
    const sub = RPC.subs.get(j.params && j.params.subscription); if (!sub) return;
    const info = j.params.result && j.params.result.value && j.params.result.value.data && j.params.result.value.data.parsed && j.params.result.value.data.parsed.info;
    const amt = info && info.tokenAmount && +info.tokenAmount.uiAmountString; if (!(amt >= 0)) return;
    const tok = TL.get(sub.m); if (!tok) return; const R = tok.rpc = tok.rpc || {};
    const slot = (j.params.result.context && j.params.result.context.slot) || 0;
    if (sub.side === "q" && R.q > 0) R.vol = (R.vol || 0) + Math.abs(amt - R.q);              // SOL in or out of the pool = trade size
    R[sub.side] = amt; R[sub.side + "s"] = slot;
    // a swap moves both vaults in the same slot: price only once both sides have caught up, so it never flickers mid-swap
    if (R.b > 0 && R.q > 0 && FEED.sol > 0 && R.bs === R.qs) {
      const p = R.q / R.b * FEED.sol, t = now();
      if (tok.px && Math.abs(p / tok.px - 1) > 0.25 && !(tok.rpcAt && t - tok.rpcAt < 60000)) return;   // sanity check against DEX Screener until the stream is established
      tok.rpcAt = t; pushTick(tok, t, p, (R.vol || 0) * FEED.sol); R.vol = 0;
    }
  };
}
const rpcSub = (account, cb) => new Promise(res => { const id = ++RPC.id; RPC.pend.set(id, res); RPC.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "accountSubscribe", params: [account, { encoding: "jsonParsed", commitment: "processed" }] })); }).then(cb);
export async function rpcWatch(tok) {
  if (!RPC.ws || !RPC.live || RPC.watched.has(tok.m) || !tok.pool || tok.quote !== "SOL" || tok.dex !== "pumpswap") return;
  RPC.watched.add(tok.m);
  try {
    const known = FEED.pools.get(tok.m);
    if (known && known.pool === tok.pool) {
      await rpcSub(known.bv, sid => RPC.subs.set(sid, { m: tok.m, side: "b" }));
      await rpcSub(known.qv, sid => RPC.subs.set(sid, { m: tok.m, side: "q" }));
      return;
    }
    const info = await rpcHttp("getAccountInfo", [tok.pool, { encoding: "base64" }]);
    const data = Buffer.from(info.value.data[0], "base64"), mint = b58dec(tok.m);
    let off = -1; for (let i = 0; i + 32 <= data.length && off < 0; i++) { let ok = true; for (let k = 0; k < 32; k++) if (data[i + k] !== mint[k]) { ok = false; break; } if (ok) off = i; }
    if (off < 0 || off + 160 > data.length) return;
    await rpcSub(b58enc(data.subarray(off + 96, off + 128)), sid => RPC.subs.set(sid, { m: tok.m, side: "b" }));
    await rpcSub(b58enc(data.subarray(off + 128, off + 160)), sid => RPC.subs.set(sid, { m: tok.m, side: "q" }));
  } catch (e) { RPC.watched.delete(tok.m); throw e; }
}
