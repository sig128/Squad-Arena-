/* ================= live data: Claude browser bridge, direct fetch, RPC stream ================= */
S.direct = typeof window.claude === "undefined";      // a self-hosted copy fetches the public APIs itself
const LIVE = { on: false, tab: null, busy: false, calls: 0, errs: 0, streak: 0, lastPrice: 0, lastDisc: 0, page: 0, pages: 13, gtPage: 1,
  cand: new Map(), pending: [], histQ: [], lastHist: 0, lat: [], started: 0, timer: null, priceMs: 15000 };
const liveReady = () => !!MCP || S.direct;
function liveAvailability() {
  if (S.direct) return "This copy fetches DEX Screener and GeckoTerminal directly" + (RPC.url ? " and streams pool balances from your RPC." : ". Add an RPC WebSocket URL to stream prices in under a second.");
  if (MCP) return "Live data runs through the built-in browser of the Claude desktop app, so it works for the page's owner with the page open in the desktop app. Prices refresh about every 15 seconds, and pump.fun is swept for new coins every few minutes. The app asks once before the page uses its browser.";
  return "Live data needs the Claude desktop app: open this page there as its owner and press Go live. A self-hosted copy of this page fetches the same sources directly and can stream prices from your own RPC.";
}
function liveSummary() {
  const age = LIVE.lastPrice ? Math.round((nowW() - LIVE.lastPrice) / 1000) + " s ago" : "pending";
  const lat = LIVE.lat.length ? Math.round(LIVE.lat.reduce((a, b) => a + b, 0) / LIVE.lat.length) + " ms per call" : "";
  return `${TL.size} coins tracked, ${S.board.top.length} on the board. Last price update ${age}. ${LIVE.calls} calls${lat ? ", " + lat : ""}${LIVE.errs ? ", " + LIVE.errs + " errors" : ""}.`;
}
function liveLatency(tok) {
  if (S.srv) { const a = tok.ticks.length ? Math.max(0, Math.round((nowW() - tok.ticks[tok.ticks.length - 1].t) / 1000)) + " s ago" : "pending"; return "Round server · last price " + a + " · " + (tok.rpcAt ? "RPC stream" : "DEX Screener") + " · paint " + (coinUI.paintMs || 0).toFixed(1) + " ms"; }
  if (RPC.live && tok.rpcAt) return "RPC stream · last pool update " + Math.max(0, Math.round(nowW() - tok.rpcAt)) + " ms ago · paint " + (coinUI.paintMs || 0).toFixed(1) + " ms";
  const ago = tok.lastSeen ? Math.round((nowW() - tok.lastSeen) / 1000) + " s ago" : "pending";
  return (S.direct ? "Direct" : "Bridge") + " · DEX Screener price " + ago + " · candles GeckoTerminal · paint " + (coinUI.paintMs || 0).toFixed(1) + " ms";
}

/* ---------- transport ---------- */
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
async function bridge(tool, input) {
  const t0 = performance.now();
  try { const r = await MCP.callTool("host:claude_browser", tool, input, { cache: false }); LIVE.calls++; LIVE.lat.push(performance.now() - t0); if (LIVE.lat.length > 30) LIVE.lat.shift(); return r; }
  catch (e) { LIVE.errs++; throw e; }
}
const textOf = r => { if (!r) return ""; if (typeof r.payload === "string") return r.payload; const b = (r.content || []).find(c => c && c.type === "text"); return b ? b.text : ""; };
function bodyJSON(text) {
  let s = String(text || ""); const i = s.indexOf("\n---\n"); if (i >= 0) s = s.slice(i + 5);
  if (/\n\n\[truncated/.test(s)) throw new Error("truncated");
  const k = s.indexOf("\n\nTab Context:"); if (k >= 0) s = s.slice(0, k);
  return JSON.parse(s.trim());
}
async function viaBridge(url) {
  if (!LIVE.tab) { const r = await bridge("preview_start", { url }); const mt = /tabId[:\s]+"?([\w-]+)/.exec(textOf(r)); LIVE.tab = mt ? mt[1] : null; await sleep(1100); }
  else await bridge("navigate", { url, tabId: LIVE.tab });
  const read = () => bridge("get_page_text", LIVE.tab ? { tabId: LIVE.tab, max_chars: 900000 } : { max_chars: 900000 });
  try { return bodyJSON(textOf(await read())); } catch (_) { await sleep(800); return bodyJSON(textOf(await read())); }
}
async function viaFetch(url) { const t0 = performance.now(); const r = await fetch(url, { cache: "no-store" }); LIVE.calls++; LIVE.lat.push(performance.now() - t0); if (LIVE.lat.length > 30) LIVE.lat.shift(); if (!r.ok) { LIVE.errs++; throw new Error("HTTP " + r.status); } return r.json(); }
// GeckoTerminal rate-limits bursts (its 429s arrive without CORS headers, as "Failed to fetch"): space calls and back off
let gtNext = 0;
const isGT = u => u.includes("geckoterminal.com");
const getJSON = url => serial(async () => {
  if (isGT(url)) { const wait = gtNext - Date.now(); if (wait > 3000) throw Object.assign(new Error("GeckoTerminal is rate-limiting, retrying shortly"), { code: "gt_backoff" }); if (wait > 0) await sleep(wait); }
  try { const r = await (S.direct ? viaFetch(url) : viaBridge(url)); if (isGT(url)) gtNext = Date.now() + 2600; return r; }
  catch (e) { if (isGT(url)) gtNext = Date.now() + 30000; throw e; }
});
function bridgeError(e) {
  const c = e && e.code;
  if (c === "server_not_connected") return "The browser bridge only answers inside the Claude desktop app, for the page's owner. Open this page there to go live.";
  if (c === "not_in_manifest" || c === "approval_required" || c === "cancelled" || c === "consent_required") return "The desktop app's browser wasn't allowed for this page. Press Go live again and allow it.";
  if (c === "blocked_by_policy") return "Your organization's policy blocks the browser bridge for this page.";
  if (e && e.message === "truncated") return "A data page came back cut short. Try again.";
  return (e && e.message) || "The live sources didn't answer.";
}

/* ---------- applying data ---------- */
function applyPairs(arr, now) {
  const best = new Map();
  for (const p of arr || []) {
    if (!p || p.chainId !== "solana" || !p.baseToken || !p.baseToken.address) continue;
    const m = p.baseToken.address, liq = (p.liquidity && p.liquidity.usd) || 0, cur = best.get(m);
    if (!cur || liq > ((cur.liquidity && cur.liquidity.usd) || 0)) best.set(m, p);
  }
  for (const [m, p] of best) {
    const px = +p.priceUsd; if (!(px > 0)) continue;
    const cand = LIVE.cand.get(m) || {}, rec = REC.tokens.find(r => r.m === m);
    let tok = TL.get(m);
    if (!tok) { tok = makeToken({ m, s: p.baseToken.symbol, n: p.baseToken.name, t: cand.t || (rec && rec.t) || 0, x: rec && rec.x, tg: rec && rec.tg, w: rec && rec.w, ds: (rec && rec.ds) || cand.ds }); TL.set(m, tok); }
    tok.px = px; tok.mc = +(p.marketCap || p.fdv) || tok.mc; if (tok.mc && px) tok.supply = tok.mc / px;
    const v = p.volume || {}, tx = p.txns || {}, ch = p.priceChange || {}, n = k => tx[k] ? (tx[k].buys || 0) + (tx[k].sells || 0) : 0;
    tok.liq = (p.liquidity && p.liquidity.usd) || 0; tok.vol = [v.m5 || 0, v.h1 || 0, v.h6 || 0, v.h24 || 0]; tok.tx = [n("m5"), n("h1"), n("h6"), n("h24")];
    tok.bs = [tx.h1 ? tx.h1.buys || 0 : 0, tx.h1 ? tx.h1.sells || 0 : 0]; tok.ch = [ch.m5 || 0, ch.h1 || 0, ch.h6 || 0, ch.h24 || 0];
    tok.pool = p.pairAddress || tok.pool; tok.dex = p.dexId || tok.dex; tok.quote = (p.quoteToken && p.quoteToken.symbol) || "SOL"; tok.pa = p.pairCreatedAt || tok.pa;
    tok.qn = +p.priceNative || null; if (tok.quote === "SOL" && tok.qn) RPC.sol = px / tok.qn;
    if (!tok.born) tok.born = cand.t || p.pairCreatedAt || 0;
    const info = p.info || {}; (info.socials || []).forEach(s => { if (s.type === "twitter" && !tok.x) tok.x = s.url; if (s.type === "telegram" && !tok.tg) tok.tg = s.url; if (s.type === "discord" && !tok.dc) tok.dc = s.url; });
    if (!tok.w && info.websites && info.websites[0]) tok.w = info.websites[0].url;
    if (!tok.x && cand.x) tok.x = cand.x; if (!tok.tg && cand.tg) tok.tg = cand.tg; if (!tok.w && cand.w) tok.w = cand.w;
    const ageH = Math.max(0.05, (now - (tok.born || now)) / 3600e3), adj = ageH < 24 ? 24 / ageH : 1;
    const pass = tok.liq >= GATE.liq && (tok.mc || 0) / Math.max(1, tok.liq) <= GATE.mcLiq && tok.vol[3] * adj / (tok.mc || 1) >= GATE.turn && tok.tx[3] * adj >= GATE.trades && tok.tx[3] >= GATE.tx24;
    if (tok.lastSeen && tok.gate && !tok.rugAt && (tok.ch[0] <= -80 || tok.liq < GATE.liq * 0.6)) { tok.rugAt = now; tok.rugWhy = tok.ch[0] <= -80 ? "price fell " + Math.round(-tok.ch[0]) + "% in 5 min" : "liquidity fell to " + fmtUsd(tok.liq); }
    tok.gate = pass || (tok.gate && !!tok.lastSeen && tok.liq >= GATE.liq);
    tok.ticks.push({ t: now, p: px }); if (tok.ticks.length > 5000) tok.ticks.splice(0, 1000);
    tok.lastSeen = now; tok.firstT = firstTime(tok);
  }
}
function applyCandles(tok, list, five) {
  const C = (list || []).map(c => ({ t: c[0] * 1000, o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] })).filter(c => c.c > 0).sort((a, b) => a.t - b.t);
  if (five) tok.C5 = C; else tok.C = C;
  tok.firstT = firstTime(tok); tok.histAt = nowW(); dirty.all = true;
}

/* ---------- jobs ---------- */
async function jobPrices() {
  const ms = S.board.top.concat(S.board.bench).map(t => t.m); if (S.coin && !ms.includes(S.coin) && TL.has(S.coin)) ms.push(S.coin);
  if (!ms.length) return;
  for (let i = 0; i < ms.length; i += 30) applyPairs(await getJSON("https://api.dexscreener.com/tokens/v1/solana/" + ms.slice(i, i + 30).join(",")), nowW());
  LIVE.lastPrice = nowW();
}
async function jobValidate() {
  const batch = LIVE.pending.splice(0, 30); if (!batch.length) return;
  applyPairs(await getJSON("https://api.dexscreener.com/tokens/v1/solana/" + batch.join(",")), nowW());
}
async function jobDiscover() {
  const now = nowW(); LIVE.lastDisc = now;
  if (!(S.direct && LIVE.pumpBlocked)) {
    try {
      const off = LIVE.page * 50; LIVE.page = (LIVE.page + 1) % LIVE.pages;
      const arr = await getJSON(`https://frontend-api-v3.pump.fun/coins?offset=${off}&limit=50&sort=market_cap&order=DESC&includeNsfw=false`);
      for (const c of arr || []) {
        if (!c || !c.mint || c.nsfw || c.is_banned || !(now - c.created_timestamp <= MAX_AGE)) continue;
        if (!LIVE.cand.has(c.mint)) { LIVE.cand.set(c.mint, { t: c.created_timestamp, ds: c.description || "", x: c.twitter || null, tg: c.telegram || null, w: c.website || null }); if (!TL.has(c.mint)) LIVE.pending.push(c.mint); }
      }
      return;
    } catch (e) { if (!S.direct) throw e; LIVE.pumpBlocked = true; }
  }
  {
    const pg = LIVE.gtPage; LIVE.gtPage = pg % 5 + 1;   // pump.fun blocks cross-site reads: fall back to PumpSwap pools on GeckoTerminal
    const j = await getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/dexes/pumpswap/pools?page=${pg}&sort=h24_tx_count_desc`);
    for (const p of (j && j.data) || []) {
      const mint = String(p.relationships && p.relationships.base_token && p.relationships.base_token.data && p.relationships.base_token.data.id || "").replace(/^solana_/, ""), t = Date.parse(p.attributes && p.attributes.pool_created_at);
      if (!mint.endsWith("pump") || !(now - t <= MAX_AGE)) continue;
      if (!LIVE.cand.has(mint)) { LIVE.cand.set(mint, { t }); if (!TL.has(mint)) LIVE.pending.push(mint); }
    }
  }
}
async function jobHistory() {
  const it = LIVE.histQ.shift(); if (!it) return; const tok = TL.get(it.m); if (!tok || !tok.pool) return;
  LIVE.lastHist = nowW();
  let j; try { j = await getJSON(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${tok.pool}/ohlcv/${it.five ? "minute?aggregate=5&limit=300" : "minute?aggregate=1&limit=200"}&currency=usd&token=base`); }
  catch (e) { LIVE.histQ.push(it); LIVE.lastHist = nowW() + 8000; throw e; }
  applyCandles(tok, j && j.data && j.data.attributes && j.data.attributes.ohlcv_list, it.five);
}
function queueHistory() {
  if (S.srv) return;
  const want = S.board.top.concat(S.board.bench); if (S.coin && TL.has(S.coin)) want.unshift(TL.get(S.coin));
  for (const tok of want) {
    if (!tok.C.length && !LIVE.histQ.some(x => x.m === tok.m && !x.five)) LIVE.histQ.push({ m: tok.m });
    const wantFive = S.tf === "24h" || (S.view === "coin" && S.coin === tok.m && coinUI.iv >= 15);
    if (wantFive && !tok.C5.length && !LIVE.histQ.some(x => x.m === tok.m && x.five)) LIVE.histQ.push({ m: tok.m, five: true });
  }
}
async function liveStep() {
  if (!LIVE.on || LIVE.busy) return; LIVE.busy = true;
  const now = nowW(); let job = "";
  try {
    if (now - LIVE.lastPrice > LIVE.priceMs) { job = "price"; await jobPrices(); LIVE.streak = 0; }
    else if (LIVE.pending.length) { job = "validate"; await jobValidate(); }
    else if (now - LIVE.lastDisc > (S.direct ? 20000 : 22000)) { job = "discover"; await jobDiscover(); }
    else { queueHistory(); if (LIVE.histQ.length && now - LIVE.lastHist > (S.direct ? 3000 : 3500)) { job = "history"; await jobHistory(); } }
  } catch (e) {
    if (job === "price") { LIVE.streak++; LIVE.lastPrice = nowW() - LIVE.priceMs + 5000; }
    if (LIVE.streak >= 4 || ["server_not_connected", "not_in_manifest", "blocked_by_policy", "not_granted"].includes(e && e.code)) stopLive(bridgeError(e));
  } finally { LIVE.busy = false; }
  if (RPC.live) for (const t of S.board.top) if (!RPC.watched.has(t.m)) { rpcWatch(t).catch(() => {}); break; }
}
async function goLive() {
  if (S.srv) return;
  if (!liveReady()) throw new Error(liveAvailability());
  if (LIVE.on) return;
  LIVE.priceMs = S.direct ? 4000 : 15000;
  wire("Live", "Connecting to pump.fun, DEX Screener and GeckoTerminal…");
  try {
    for (const r of REC.tokens) if (!LIVE.cand.has(r.m)) LIVE.cand.set(r.m, { t: r.t, ds: r.ds, x: r.x, tg: r.tg, w: r.w });
    LIVE.pending = REC.tokens.map(r => r.m);
    await jobValidate();
  } catch (e) { throw new Error(bridgeError(e)); }
  for (let i = 0; i < (S.direct ? 2 : 4); i++) {
    try { await jobDiscover(); }
    catch (e) { if (["server_not_connected", "not_in_manifest", "blocked_by_policy", "not_granted"].includes(e && e.code)) throw new Error(bridgeError(e)); break; }
  }
  try { while (LIVE.pending.length) await jobValidate(); } catch (_) {}
  const b = computeBoard(nowW(), TL);
  if (b.top.length < 3) throw new Error("Not enough coins passed the filters yet. Try again in a minute.");
  LIVE.on = true; LIVE.started = nowW(); LIVE.lastPrice = nowW(); LIVE.lastDisc = nowW();
  S.mode = S.direct ? "direct" : "live"; T = TL; resetMemos();
  if (!S.direct || true) store.set("live", 1);
  renderTf(); renderMode(); tick(true);
  queueHistory(); clearInterval(LIVE.timer); LIVE.timer = setInterval(liveStep, 1000);
  if (S.direct && RPC.url) rpcStart();
  wire("Live", `Live: ${b.top.length} coins on the board from ${TL.size} checked. Rounds now follow the clock. Prices every ${Math.round(LIVE.priceMs / 1000)} s.`, true);
  notice("Live data on");
}
function stopLive(why) {
  if (!LIVE.on && S.mode === "replay") return;
  LIVE.on = false; clearInterval(LIVE.timer); rpcStop();
  S.mode = "replay"; T = TR; resetMemos(); store.set("live", 0);
  if (S.tf === "24h") { S.tf = "15m"; store.set("tf", S.tf); }
  renderTf(); renderMode(); tick(true);
  wire("Replay", esc(why || "Back to the replay."), true);
}
function resetMemos() { S.fields.clear(); S.lcsMemo.clear(); S.results.clear(); boardMemo.clear(); S.prevTop = null; S.seenRound = {}; S.lastLead = null; slotOf.clear(); dirty.all = true; mkBuiltFor = ""; sqSig = ""; }

/* ---------- RPC stream (self-hosted copies) ---------- */
const RPC = { url: (window.SA_CONFIG && window.SA_CONFIG.rpc) || store.get("rpc", ""), ws: null, live: false, sol: 0, id: 1, pend: new Map(), subs: new Map(), watched: new Set() };
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58dec(s) { const bytes = [0]; for (const ch of s) { let c = B58.indexOf(ch); if (c < 0) throw new Error("bad base58"); for (let j = 0; j < bytes.length; j++) { c += bytes[j] * 58; bytes[j] = c & 255; c >>= 8; } while (c) { bytes.push(c & 255); c >>= 8; } } for (const ch of s) { if (ch === "1") bytes.push(0); else break; } return Uint8Array.from(bytes.reverse()); }
function b58enc(u8) {
  const d = [0];
  for (const b of u8) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ""; for (let k = 0; k < u8.length && u8[k] === 0; k++) s += "1";
  if (u8.every(x => x === 0)) return s;
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
async function rpcHttp(method, params) {
  const url = RPC.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message || "RPC error"); return j.result;
}
function rpcStart() {
  if (!RPC.url || RPC.ws) return;
  try { RPC.ws = new WebSocket(RPC.url.replace(/^https:/, "wss:").replace(/^http:/, "ws:")); } catch (_) { RPC.ws = null; return; }
  RPC.ws.onopen = () => { RPC.live = true; wire("RPC", "Streaming pool balances from your RPC. Prices update on every swap."); S.board.top.forEach(t => rpcWatch(t).catch(() => {})); };
  RPC.ws.onclose = () => { RPC.live = false; RPC.ws = null; RPC.subs.clear(); RPC.watched.clear(); if (LIVE.on) setTimeout(rpcStart, 3000); };
  RPC.ws.onmessage = ev => {
    let j; try { j = JSON.parse(ev.data); } catch (_) { return; }
    if (j.id && RPC.pend.has(j.id)) { const f = RPC.pend.get(j.id); RPC.pend.delete(j.id); f(j.result); return; }
    if (j.method !== "accountNotification") return;
    const sub = RPC.subs.get(j.params && j.params.subscription); if (!sub) return;
    const info = j.params.result && j.params.result.value && j.params.result.value.data && j.params.result.value.data.parsed && j.params.result.value.data.parsed.info;
    const amt = info && info.tokenAmount && +info.tokenAmount.uiAmountString; if (!(amt >= 0)) return;
    const tok = TL.get(sub.m); if (!tok) return; tok.rpc = tok.rpc || {}; tok.rpc[sub.side] = amt;
    if (tok.rpc.b > 0 && tok.rpc.q > 0 && RPC.sol > 0) { const p = tok.rpc.q / tok.rpc.b * RPC.sol, now = nowW();
      if (tok.px && Math.abs(p / tok.px - 1) > 0.25) return;   // sanity check against the last DEX Screener price
      tok.ticks.push({ t: now, p }); tok.rpcAt = now; if (tok.ticks.length > 8000) tok.ticks.splice(0, 2000); dirty.coin = dirty.race = true; }
  };
}
function rpcStop() { try { if (RPC.ws) RPC.ws.close(); } catch (_) {} RPC.ws = null; RPC.live = false; }
function rpcSub(account, cb) { return new Promise(res => { const id = ++RPC.id; RPC.pend.set(id, res); RPC.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "accountSubscribe", params: [account, { encoding: "jsonParsed", commitment: "processed" }] })); }).then(cb); }
async function rpcWatch(tok) {
  if (!RPC.ws || RPC.watched.has(tok.m) || !tok.pool || tok.quote !== "SOL" || tok.dex !== "pumpswap") return;
  RPC.watched.add(tok.m);
  const info = await rpcHttp("getAccountInfo", [tok.pool, { encoding: "base64" }]);
  const data = Uint8Array.from(atob(info.value.data[0]), c => c.charCodeAt(0)), mint = b58dec(tok.m);
  let off = -1; for (let i = 0; i + 32 <= data.length && off < 0; i++) { let ok = true; for (let k = 0; k < 32; k++) if (data[i + k] !== mint[k]) { ok = false; break; } if (ok) off = i; }
  if (off < 0 || off + 160 > data.length) return;
  const baseVault = b58enc(data.slice(off + 96, off + 128)), quoteVault = b58enc(data.slice(off + 128, off + 160));
  await rpcSub(baseVault, sid => RPC.subs.set(sid, { m: tok.m, side: "b" }));
  await rpcSub(quoteVault, sid => RPC.subs.set(sid, { m: tok.m, side: "q" }));
}
