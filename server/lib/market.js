// Market data: which coins exist, their prices over time, candles, the gate and the rug filter.
// Sources: pump.fun (new coins), DEX Screener (prices, liquidity, volume), GeckoTerminal (candles), QuickNode (pool balances on every swap).
import { CFG, GATE, MAX_AGE } from "./config.js";
import { getJSON, sleep, log, b58dec, b58enc, now } from "./util.js";

export const TL = new Map();               // mint -> token
export const FEED = { cand: new Map(), pending: [], page: 0, pages: 13, gtPage: 1, pumpBlocked: false, histQ: [], lastPrice: 0, lastDisc: 0, lastHist: 0, gtNext: 0,
  started: now(), calls: 0, errs: 0, sol: 0, onTick: null, onMeta: null, onCandles: null };

export function makeToken(r) {
  return {
    m: r.m, s: r.s, n: r.n || r.s, born: r.t || 0, px: r.px || null, mc: r.mc || null, supply: r.mc && r.px ? r.mc / r.px : 1e9,
    liq: r.l ?? null, vol: r.v || [0, 0, 0, 0], tx: r.tx || [0, 0, 0, 0], bs: r.bs || [0, 0], ch: r.ch || [0, 0, 0, 0],
    pool: r.p || null, dex: r.dex || null, quote: r.q || "SOL", pa: r.pa || null,
    x: r.x || null, tg: r.tg || null, dc: r.dc || null, w: r.w || null, ds: r.ds || "", logo: r.logo || null,
    C: [], C5: [], ticks: [], rugAt: 0, rugWhy: "", gate: true, lastSeen: 0, histAt: 0, hist5At: 0, rpcAt: 0, rpc: null
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

// at most one tick per second per coin; ticks older than 2 h fall back to candles
export function pushTick(tok, t, p) {
  const K = tok.ticks, last = K[K.length - 1];
  if (last && t - last.t < 1000) { last.p = p; last.t = Math.max(last.t, t); }
  else K.push({ t, p });
  if (K.length > 7600) K.splice(0, K.length - 7200);
  if (FEED.onTick) FEED.onTick(tok, t, p);
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
  const best = new Map();
  for (const p of arr || []) {
    if (!p || p.chainId !== "solana" || !p.baseToken || !p.baseToken.address) continue;
    const m = p.baseToken.address, liq = (p.liquidity && p.liquidity.usd) || 0, cur = best.get(m);
    if (!cur || liq > ((cur.liquidity && cur.liquidity.usd) || 0)) best.set(m, p);
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
    if (!tok.born) tok.born = cand.t || p.pairCreatedAt || 0;
    const info = p.info || {};
    (info.socials || []).forEach(s => { if (s.type === "twitter" && !tok.x) tok.x = s.url; if (s.type === "telegram" && !tok.tg) tok.tg = s.url; if (s.type === "discord" && !tok.dc) tok.dc = s.url; });
    if (!tok.w && info.websites && info.websites[0]) tok.w = info.websites[0].url;
    if (info.imageUrl && !tok.logo) tok.logo = info.imageUrl;
    const ageH = Math.max(0.05, (t - (tok.born || t)) / 3600e3), adj = ageH < 24 ? 24 / ageH : 1;
    const pass = tok.liq >= GATE.liq && (tok.mc || 0) / Math.max(1, tok.liq) <= GATE.mcLiq && tok.vol[3] * adj / (tok.mc || 1) >= GATE.turn && tok.tx[3] * adj >= GATE.trades && tok.tx[3] >= GATE.tx24;
    if (tok.lastSeen && tok.gate && !tok.rugAt && (tok.ch[0] <= -80 || tok.liq < GATE.liq * 0.6)) { tok.rugAt = t; tok.rugWhy = tok.ch[0] <= -80 ? "price fell " + Math.round(-tok.ch[0]) + "% in 5 min" : "liquidity fell to " + fmtUsd(tok.liq); log("info", "rug filter: " + tok.s + " " + tok.rugWhy); }
    tok.gate = pass || (tok.gate && !!tok.lastSeen && tok.liq >= GATE.liq);
    // DEX Screener prices are the backbone; the RPC stream adds ticks between them
    pushTick(tok, t, px);
    tok.lastSeen = t;
    if (wasGate !== tok.gate || wasRug !== tok.rugAt) changed.push(tok);
  }
  if (FEED.onMeta) FEED.onMeta([...best.keys()].map(m => TL.get(m)).filter(Boolean), changed);
}
export function applyCandles(tok, list, five) {
  const C = (list || []).map(c => ({ t: c[0] * 1000, o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] })).filter(c => c.c > 0).sort((a, b) => a.t - b.t);
  if (five) { tok.C5 = C; tok.hist5At = now(); } else { tok.C = C; tok.histAt = now(); }
  if (FEED.onCandles) FEED.onCandles(tok, five);
}

/* ---------- jobs ---------- */
export async function jobPrices(mints) {
  if (!mints.length) { FEED.lastPrice = now(); return; }      // nothing to price yet: let discovery run
  for (let i = 0; i < mints.length; i += 30) applyPairs(await fetchJSON("https://api.dexscreener.com/tokens/v1/solana/" + mints.slice(i, i + 30).join(",")), now());
  FEED.lastPrice = now();
}
export async function jobValidate() {
  const batch = FEED.pending.splice(0, 30); if (!batch.length) return;
  applyPairs(await fetchJSON("https://api.dexscreener.com/tokens/v1/solana/" + batch.join(",")), now());
}
// pump.fun first; if it refuses this server three times, GeckoTerminal's PumpSwap pools for 30 minutes, then pump.fun again
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
      if (FEED.pumpFails >= 3) { FEED.pumpBlocked = true; FEED.pumpBlockedAt = t; FEED.pumpFails = 0; log("warn", "pump.fun API unavailable, discovering through GeckoTerminal: " + e.message); }
      return;
    }
  }
  const pg = FEED.gtPage; FEED.gtPage = pg % 5 + 1;
  const j = await fetchJSON(`https://api.geckoterminal.com/api/v2/networks/solana/dexes/pumpswap/pools?page=${pg}&sort=h24_tx_count_desc`);
  for (const p of (j && j.data) || []) {
    const mint = String(p.relationships && p.relationships.base_token && p.relationships.base_token.data && p.relationships.base_token.data.id || "").replace(/^solana_/, ""), ct = Date.parse(p.attributes && p.attributes.pool_created_at);
    if (!mint.endsWith("pump") || !(t - ct <= MAX_AGE)) continue;
    if (!FEED.cand.has(mint)) { FEED.cand.set(mint, { t: ct }); if (!TL.has(mint)) FEED.pending.push(mint); }
  }
}
export async function jobHistory() {
  const it = FEED.histQ.shift(); if (!it) return; const tok = TL.get(it.m); if (!tok || !tok.pool) return;
  FEED.lastHist = now();
  const q = it.five ? "minute?aggregate=5&limit=300" : "minute?aggregate=1&limit=200";
  let j; try { j = await fetchJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${tok.pool}/ohlcv/${q}&currency=usd&token=base`); }
  catch (e) { FEED.lastHist = now() + 8000; throw e; }
  applyCandles(tok, j && j.data && j.data.attributes && j.data.attributes.ohlcv_list, it.five);
}
// candles for one coin on request (a coin page for a coin off the board), cached for 5 minutes
export async function fetchCandles(tok, five) {
  const at = five ? tok.hist5At : tok.histAt;
  if (at && now() - at < 300e3 && (five ? tok.C5 : tok.C).length) return;
  const q = five ? "minute?aggregate=5&limit=300" : "minute?aggregate=1&limit=200";
  const j = await fetchJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${tok.pool}/ohlcv/${q}&currency=usd&token=base`);
  applyCandles(tok, j && j.data && j.data.attributes && j.data.attributes.ohlcv_list, five);
}
// coins on the board get 1-minute candles refreshed every 10 min and 5-minute candles every 30 min (the 24 h rounds need them)
export function queueHistory(list) {
  const t = now();
  for (const tok of list) {
    if (t - tok.histAt > 600e3 && !FEED.histQ.some(x => x.m === tok.m && !x.five)) FEED.histQ.push({ m: tok.m });
    if (t - tok.hist5At > 1800e3 && !FEED.histQ.some(x => x.m === tok.m && x.five)) FEED.histQ.push({ m: tok.m, five: true });
  }
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
    const tok = TL.get(sub.m); if (!tok) return; tok.rpc = tok.rpc || {}; tok.rpc[sub.side] = amt;
    if (tok.rpc.b > 0 && tok.rpc.q > 0 && FEED.sol > 0) {
      const p = tok.rpc.q / tok.rpc.b * FEED.sol, t = now();
      if (tok.px && Math.abs(p / tok.px - 1) > 0.25) return;      // sanity check against the last DEX Screener price
      tok.rpcAt = t; pushTick(tok, t, p);
    }
  };
}
const rpcSub = (account, cb) => new Promise(res => { const id = ++RPC.id; RPC.pend.set(id, res); RPC.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "accountSubscribe", params: [account, { encoding: "jsonParsed", commitment: "processed" }] })); }).then(cb);
export async function rpcWatch(tok) {
  if (!RPC.ws || !RPC.live || RPC.watched.has(tok.m) || !tok.pool || tok.quote !== "SOL" || tok.dex !== "pumpswap") return;
  RPC.watched.add(tok.m);
  try {
    const info = await rpcHttp("getAccountInfo", [tok.pool, { encoding: "base64" }]);
    const data = Buffer.from(info.value.data[0], "base64"), mint = b58dec(tok.m);
    let off = -1; for (let i = 0; i + 32 <= data.length && off < 0; i++) { let ok = true; for (let k = 0; k < 32; k++) if (data[i + k] !== mint[k]) { ok = false; break; } if (ok) off = i; }
    if (off < 0 || off + 160 > data.length) return;
    await rpcSub(b58enc(data.subarray(off + 96, off + 128)), sid => RPC.subs.set(sid, { m: tok.m, side: "b" }));
    await rpcSub(b58enc(data.subarray(off + 128, off + 160)), sid => RPC.subs.set(sid, { m: tok.m, side: "q" }));
  } catch (e) { RPC.watched.delete(tok.m); throw e; }
}
