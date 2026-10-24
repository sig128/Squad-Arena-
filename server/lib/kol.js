// KOLs: known traders' public wallets, their live buys and sells, and which coins they hold.
// The list comes from Solana Tracker (SOLANATRACKER_API_KEY, refreshed twice a day) or KOL_WALLETS ("wallet:name,wallet:name").
// Live trades come straight from the chain: each wallet's transactions arrive over a Solana WebSocket, and pump.fun and
// PumpSwap swaps are read from the events in the transaction's own logs (no extra request, under a second). Swaps on
// other DEXes are fetched and decoded from the wallet's balance changes. History for a coin comes from Solana Tracker's
// KOL trades (GET /trades/kols/{mint}), on a daily request budget. Holdings follow from those trades.
import { CFG } from "./config.js";
import { getJSON, log, isAddress, b58enc } from "./util.js";

export const KOL = {
  list: new Map(),          // wallet -> { w, name, x, avatar }
  byMint: new Map(),        // mint -> { trades: [{ t, w, side, amt, sol, px, sig }], hold: Map(wallet -> amount) }
  ids: new Map(),           // wallet -> identity for KOLs seen in Solana Tracker history but not in the subscribed list
  pools: new Map(),         // PumpSwap pool -> base mint ("" when the pool isn't paired with SOL)
  socks: [], subs: new Map(), seen: new Set(), queue: [], busy: 0,
  hist: { at: new Map(), deep: new Set(), pending: new Map(), day: "", used: 0, pauseUntil: 0, err: "", added: 0 },
  stats: { source: "", loadedAt: 0, err: "", trades: 0, notes: 0, fast: 0, slow: 0, fetched: 0, failed: 0, sockets: 0, subscribed: 0 },
  onTrade: null,            // (mint, trade) for the live stream
  onHistory: null,          // (mint) when history changed a coin's KOLs
  poolMint: null,           // (pool) -> mint, from the pools the server already knows
  solUsd: () => 0
};
const STABLE = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCZ8BpqfBQ4"]);
const DEX = ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"];
const now = () => Date.now();
const KEEP = 1500;                                  // trades kept per coin

/* ---------- the list ---------- */
export async function loadKols() {
  const manual = String(process.env.KOL_WALLETS || "").split(",").map(s => s.trim()).filter(Boolean)
    .map(s => { const [w, ...n] = s.split(":"); return { w: w.trim(), name: n.join(":").trim() || null, x: null, avatar: null }; }).filter(k => isAddress(k.w));
  const next = new Map(manual.map(k => [k.w, k]));
  if (CFG.solanaTrackerKey) {
    try {
      let cursor = "", pages = 0;
      do {
        const j = await getJSON("https://data.solanatracker.io/v2/pnl/leaderboard/kols/period?period=7d&sort=volume&direction=desc&limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          { headers: { "x-api-key": CFG.solanaTrackerKey }, timeout: 15000 });
        for (const t of (j && j.traders) || []) {
          if (!isAddress(t.wallet) || next.has(t.wallet)) continue;
          const id = t.identity || {};
          if (id.bot || id.exchange || id.pool) continue;
          next.set(t.wallet, { w: t.wallet, name: id.name || null, x: id.twitter ? String(id.twitter).replace(/^@/, "") : null, avatar: id.avatar || null });
        }
        cursor = j && j.pagination && j.pagination.hasMore ? j.pagination.nextCursor : "";
      } while (cursor && ++pages < CFG.kolPages);
      KOL.stats.source = "solana tracker"; KOL.stats.err = "";
    } catch (e) { KOL.stats.err = "solana tracker: " + String(e.message).slice(0, 160); }
  } else if (!manual.length) KOL.stats.err = "no SOLANATRACKER_API_KEY or KOL_WALLETS";
  if (next.size) { KOL.list = next; KOL.stats.loadedAt = now(); resubscribe(); }
  if (manual.length && !KOL.stats.source) KOL.stats.source = "KOL_WALLETS";
  return KOL.list.size;
}

/* ---------- live trades: one logs subscription per wallet, spread over a few sockets ---------- */
function resubscribe() {
  for (const s of KOL.socks) { try { s.ws.close(); } catch (_) {} }
  KOL.socks = []; KOL.subs.clear();
  if (!CFG.kolWs || typeof WebSocket === "undefined") return;
  const wallets = [...KOL.list.keys()];
  for (let i = 0; i < wallets.length; i += CFG.kolPerSocket) openSock(wallets.slice(i, i + CFG.kolPerSocket));
}
function openSock(wallets) {
  const s = { ws: null, wallets, retry: 0, pend: new Map(), id: 1, ids: [] };
  KOL.socks.push(s);
  const open = () => {
    if (!KOL.socks.includes(s)) return;
    try { s.ws = new WebSocket(CFG.kolWs); } catch (e) { KOL.stats.err = "socket: " + e.message; return; }
    s.ws.onopen = () => { s.retry = 0; for (const id of s.ids) KOL.subs.delete(id); s.ids = []; KOL.stats.subscribed = KOL.subs.size; KOL.stats.sockets = KOL.socks.filter(x => x.ws && x.ws.readyState === 1).length;
      for (const w of s.wallets) { const id = s.id++; s.pend.set(id, w); s.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "logsSubscribe", params: [{ mentions: [w] }, { commitment: "confirmed" }] })); } };
    s.ws.onclose = () => { if (!KOL.socks.includes(s)) return; s.retry++; setTimeout(open, Math.min(60000, 3000 * s.retry)); };
    s.ws.onerror = () => {};
    s.ws.onmessage = ev => {
      let j; try { j = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch (_) { return; }
      if (j.id && s.pend.has(j.id)) { const w = s.pend.get(j.id); s.pend.delete(j.id); if (j.result != null) { KOL.subs.set(j.result, w); s.ids.push(j.result); KOL.stats.subscribed = KOL.subs.size; } return; }
      if (j.method !== "logsNotification") return;
      const w = KOL.subs.get(j.params && j.params.subscription), v = j.params && j.params.result && j.params.result.value;
      if (!w || !v || v.err || !v.signature) return;
      KOL.stats.notes++;
      if (KOL.seen.has(v.signature + w)) return;
      const evs = logEvents(v.logs).filter(e => e.user === w);
      if (!evs.length) {
        const logs = (v.logs || []).join("\n");
        if (!DEX.some(p => logs.includes(p))) return;                                    // swaps only
      }
      KOL.seen.add(v.signature + w); if (KOL.seen.size > 50000) KOL.seen = new Set([...KOL.seen].slice(-20000));
      if (evs.length) fromEvents(evs, w, v.signature).catch(() => {});
      else slowQueue(v.signature, w);
    };
  };
  open();
}

/* ---------- swaps read from the program's own events in the logs ---------- */
// PumpSwap BuyEvent / SellEvent and pump.fun TradeEvent, as Anchor writes them ("Program data: <base64>").
const EV_BUY = "67f4521f2cf57777", EV_SELL = "3e2f370aa503dc2a", EV_PUMP = "bddb7fd34ee661ee";
const WSOL = "So11111111111111111111111111111111111111112";
export function logEvents(logs) {
  const out = [];
  for (const l of logs || []) {
    if (typeof l !== "string" || !l.startsWith("Program data: ")) continue;
    const u = Buffer.from(l.slice(14), "base64"); if (u.length < 97) continue;
    const disc = u.subarray(0, 8).toString("hex");
    if ((disc === EV_BUY || disc === EV_SELL) && u.length >= 184)
      out.push({ k: "swap", side: disc === EV_BUY ? "buy" : "sell", ts: Number(u.readBigInt64LE(8)), base: Number(u.readBigUInt64LE(16)), userBase: Number(u.readBigUInt64LE(32)),
        lamports: Number(u.readBigUInt64LE(112)), pool: b58enc(u.subarray(120, 152)), user: b58enc(u.subarray(152, 184)) });
    else if (disc === EV_PUMP)
      out.push({ k: "pump", mint: b58enc(u.subarray(8, 40)), lamports: Number(u.readBigUInt64LE(40)), base: Number(u.readBigUInt64LE(48)), side: u[56] === 1 ? "buy" : "sell",
        user: b58enc(u.subarray(57, 89)), ts: Number(u.readBigInt64LE(89)) });
  }
  return out;
}
// a PumpSwap pool's base mint: from the pools the server tracks, else one account read (cached)
async function poolMint(pool) {
  if (KOL.pools.has(pool)) return KOL.pools.get(pool);
  const known = KOL.poolMint && KOL.poolMint(pool); if (known) { KOL.pools.set(pool, known); return known; }
  const p = [pool, { encoding: "base64", commitment: "confirmed" }];
  let acc = null;
  try { acc = await rpc(CFG.kolRpc, "getAccountInfo", p); }
  catch (_) { if (CFG.quicknode) { try { acc = await rpc(CFG.quicknode.replace(/^wss:/, "https:"), "getAccountInfo", p); } catch (_) { return null; } } else return null; }
  const d = acc && acc.value && Buffer.from(acc.value.data[0], "base64"); if (!d || d.length < 203) return null;
  const base = b58enc(d.subarray(43, 75)), quote = b58enc(d.subarray(75, 107)), m = quote === WSOL ? base : "";
  KOL.pools.set(pool, m); if (KOL.pools.size > 20000) KOL.pools = new Map([...KOL.pools].slice(-10000));
  return m;
}
// pump.fun coins all have 6 decimals; anything else takes the slow path, which reads real decimals
async function fromEvents(evs, w, sig) {
  let slow = false;
  for (const e of evs) {
    const m = e.k === "pump" ? e.mint : await poolMint(e.pool);
    if (m === "") continue;                                                                // not a SOL pair
    if (!m || !/pump$/.test(m) || !(e.base > 0)) { slow = true; continue; }
    const amt = e.base / 1e6, sol = e.lamports / 1e9, usd = KOL.solUsd();
    const hold = e.k === "swap" ? (e.side === "buy" ? e.userBase + e.base : Math.max(0, e.userBase - e.base)) / 1e6 : null;
    KOL.stats.fast++;
    recordTrade({ mint: m, t: (e.ts > 1e9 ? e.ts * 1000 : now()), w, side: e.side, amt, sol: +sol.toFixed(4), px: usd && sol ? sol * usd / amt : null, hold }, sig);
  }
  if (slow) slowQueue(sig, w);
}
function slowQueue(sig, w) {
  KOL.queue.push({ sig, w }); if (KOL.queue.length > 300) KOL.queue.splice(0, KOL.queue.length - 300);   // newest first matters most
}

/* ---------- decoding a swap from the wallet's balance changes ---------- */
async function rpc(url, method, params) {
  const j = await getJSON(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), timeout: 12000 });
  if (j.error) throw Object.assign(new Error(j.error.message || "RPC error"), { status: j.error.code === 429 ? 429 : 500 });
  return j.result;
}
async function fetchTx(sig) {
  const p = [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }];
  for (let i = 0; i < 4; i++) {
    try { const tx = await rpc(CFG.kolRpc, "getTransaction", p); if (tx) return tx; }
    catch (e) { if (CFG.quicknode && (e.status === 429 || i === 2)) { try { const tx = await rpc(CFG.quicknode.replace(/^wss:/, "https:"), "getTransaction", p); if (tx) return tx; } catch (_) {} } }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));                                     // not indexed yet: wait a moment
  }
  return null;
}
export function decodeSwap(tx, w, solUsd) {
  const meta = tx && tx.meta; if (!meta || meta.err) return [];
  const keys = (tx.transaction.message.accountKeys || []).map(k => typeof k === "string" ? k : k.pubkey);
  const wi = keys.indexOf(w);
  let sol = wi >= 0 ? (meta.postBalances[wi] - meta.preBalances[wi]) / 1e9 : 0;
  const bal = new Map();
  const add = (list, sign) => { for (const b of list || []) { if (b.owner !== w) continue; const a = +(b.uiTokenAmount && b.uiTokenAmount.uiAmountString) || 0; const cur = bal.get(b.mint) || { pre: 0, post: 0 }; if (sign < 0) cur.pre += a; else cur.post += a; bal.set(b.mint, cur); } };
  add(meta.preTokenBalances, -1); add(meta.postTokenBalances, 1);
  const ws = bal.get("So11111111111111111111111111111111111111112"); if (ws) sol += ws.post - ws.pre;      // wrapped SOL counts as SOL
  const out = [], t = (tx.blockTime || Math.floor(now() / 1000)) * 1000;
  for (const [mint, b] of bal) {
    if (STABLE.has(mint)) continue;
    const d = b.post - b.pre; if (Math.abs(d) <= 0) continue;
    const side = d > 0 ? "buy" : "sell";
    if ((side === "buy" && sol >= 0) || (side === "sell" && sol <= 0)) continue;               // a transfer, not a trade
    const s = Math.abs(sol);
    out.push({ mint, t, w, side, amt: Math.abs(d), sol: +s.toFixed(4), px: solUsd ? s * solUsd / Math.abs(d) : null, hold: b.post });
  }
  return out;
}
export function recordTrade(x, sig) {
  let st = KOL.byMint.get(x.mint); if (!st) KOL.byMint.set(x.mint, st = { trades: [], hold: new Map() });
  if (st.trades.some(y => y.sig === sig && y.w === x.w)) return;
  // the balance after the trade: exact when the swap reports it, otherwise worked out from what we knew before
  const prev = st.hold.get(x.w), exact = x.hold != null;
  const hold = exact ? x.hold : x.side === "buy" ? (prev ? prev.amt : 0) + x.amt : prev ? Math.max(0, prev.amt - x.amt) : 0;
  const tr = { t: x.t, w: x.w, side: x.side, amt: x.amt, sol: x.sol, px: x.px, sig, hold };
  if (hold > 1e-6) st.hold.set(x.w, { amt: hold, t: x.t, exact }); else st.hold.delete(x.w);
  if (!(x.sol >= CFG.kolDust)) { if (KOL.onHistory) KOL.onHistory(x.mint); return; }                         // dust: the balance counts, the chart skips it
  st.trades.push(tr); st.trades.sort((a, b) => a.t - b.t); if (st.trades.length > KEEP) st.trades.splice(0, st.trades.length - KEEP);
  KOL.stats.trades++;
  if (KOL.onTrade) KOL.onTrade(x.mint, tr);
}
// swaps the logs don't describe (other DEXes): two transactions at a time, newest first, so the public RPC isn't hammered
export async function kolStep(solUsd) {
  KOL.solUsd = solUsd;
  while (KOL.busy < 2 && KOL.queue.length) {
    const job = KOL.queue.pop(); KOL.busy++;
    fetchTx(job.sig).then(tx => { KOL.stats.fetched++; for (const x of decodeSwap(tx, job.w, solUsd())) { KOL.stats.slow++; recordTrade(x, job.sig); } })
      .catch(() => { KOL.stats.failed++; })
      .finally(() => { KOL.busy--; });
  }
}

/* ---------- a coin's KOL history from Solana Tracker ---------- */
// One request returns the last 250 KOL trades on the coin. An open coin page asks at most every KOL_HISTORY_EVERY
// (3 minutes), and the server never makes more than KOL_HISTORY_DAILY requests a day (5,000 by default).
export function kolHistory(m) {
  const h = KOL.hist, t = now(), day = new Date(t).toISOString().slice(0, 10);
  if (!CFG.solanaTrackerKey || !isAddress(m)) return null;
  if (h.pending.has(m)) return h.pending.get(m);
  if (h.day !== day) { h.day = day; h.used = 0; }
  if (t - (h.at.get(m) || 0) < CFG.kolHistEvery || t < h.pauseUntil || h.used >= CFG.kolHistDaily) return null;
  // the first look at a coin goes back up to KOL_HISTORY_PAGES pages (250 trades each); refreshes take the newest page
  const deep = !h.deep.has(m); h.at.set(m, t);
  const p = (async () => {
    const all = []; let cursor = "", pages = 0;
    try {
      do {
        h.used++; pages++;
        const j = await getJSON(`https://data.solanatracker.io/trades/kols/${m}?limit=250&hideArb=true` + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          { headers: { "x-api-key": CFG.solanaTrackerKey }, timeout: 8000 });
        const list = (j && j.trades) || []; all.push(...list);
        const oldest = list.length ? list[list.length - 1].time : 0;
        cursor = j && j.hasNextPage && j.nextCursor && oldest > t - 72 * 3600e3 ? j.nextCursor : "";
      } while (cursor && deep && pages < CFG.kolHistPages && h.used < CFG.kolHistDaily);
      h.err = ""; if (deep) h.deep.add(m); mergeHistory(m, all); return true;
    } catch (e) {
      if (all.length) mergeHistory(m, all);
      h.err = String(e.message || e).slice(0, 160); h.at.set(m, now() - CFG.kolHistEvery + 120e3);                // try this coin again in 2 minutes
      if ([401, 402, 403, 429].includes(e.status)) h.pauseUntil = now() + 30 * 60e3;                              // out of requests or a bad key: back off
      return false;
    } finally { h.pending.delete(m); }
  })();
  h.pending.set(m, p); return p;
}
export const kolHistBudget = () => ({ used: KOL.hist.used, daily: CFG.kolHistDaily, coins: KOL.hist.at.size, added: KOL.hist.added, err: KOL.hist.err, pausedFor: Math.max(0, Math.round((KOL.hist.pauseUntil - now()) / 1000)) });
// board coins: first time as soon as they show up, then every KOL_HISTORY_BOARD_EVERY, while under 60% of the day's budget
// (the rest is kept for coin pages people open)
export const kolHistDue = m => !!CFG.solanaTrackerKey && now() - (KOL.hist.at.get(m) || 0) >= CFG.kolHistBoardEvery && KOL.hist.used < CFG.kolHistDaily * 0.6 && now() >= KOL.hist.pauseUntil;
function mergeHistory(m, list) {
  let st = KOL.byMint.get(m); if (!st) KOL.byMint.set(m, st = { trades: [], hold: new Map() });
  const have = new Set(st.trades.map(x => x.sig + x.w)), net = new Map(); let added = 0;
  for (const x of list) {
    if (!x || !isAddress(x.wallet) || !x.tx || !(x.time > 0)) continue;
    const id = x.identity;
    if (id && !KOL.list.has(x.wallet)) KOL.ids.set(x.wallet, { name: id.name || null, x: id.twitter ? String(id.twitter).replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "").replace(/^@/, "") : null, avatar: id.avatar || null });
    const side = x.type === "sell" ? "sell" : "buy", amt = +x.amount || 0;
    const n = net.get(x.wallet) || { buy: 0, sell: 0, last: 0 }; n[side] += amt; n.last = Math.max(n.last, x.time); net.set(x.wallet, n);
    if (have.has(x.tx + x.wallet) || !(+x.volumeSol >= CFG.kolDust)) continue; have.add(x.tx + x.wallet); added++;
    st.trades.push({ t: x.time, w: x.wallet, side, amt, sol: +(+x.volumeSol || 0).toFixed(4), px: +x.priceUsd || null, sig: x.tx });
  }
  st.trades.sort((a, b) => a.t - b.t); if (st.trades.length > KEEP) st.trades.splice(0, st.trades.length - KEEP);
  // holders: bought more than they sold in that history, unless the live stream has a newer exact balance
  for (const [w, n] of net) {
    const cur = st.hold.get(w); if (cur && cur.exact && cur.t >= n.last) continue;
    const left = n.buy - n.sell;
    if (left > n.buy * 0.02) st.hold.set(w, { amt: left, t: n.last, exact: false }); else st.hold.delete(w);
  }
  KOL.hist.added += added;
  if (KOL.onHistory) KOL.onHistory(m);
}

/* ---------- what pages see ---------- */
const who = w => { const k = KOL.list.get(w) || KOL.ids.get(w) || {}; return { w, name: k.name || null, x: k.x || null, avatar: k.avatar || null }; };
export const kolCount = m => { const st = KOL.byMint.get(m); return st ? st.hold.size : 0; };
export function kolOut(m) {
  const st = KOL.byMint.get(m) || { trades: [], hold: new Map() };
  return {
    holders: [...st.hold].sort((a, b) => b[1].t - a[1].t).map(([w, h]) => ({ ...who(w), amt: h.amt, since: h.t })),
    trades: st.trades.slice(-800).map(x => ({ t: x.t, w: x.w, side: x.side, sol: x.sol, px: x.px && +x.px.toPrecision(6), amt: x.amt && +x.amt.toPrecision(6), sig: x.sig })),
    who: Object.fromEntries([...new Set(st.trades.slice(-800).map(x => x.w))].map(w => { const k = who(w); return [w, { name: k.name, x: k.x, avatar: k.avatar }]; }))
  };
}
export const kolWho = who;
// a coin's KOL state for storage, and back
export const kolSave = m => { const st = KOL.byMint.get(m); return st ? { tr: st.trades.slice(-800), h: [...st.hold] } : null; };
export function kolLoad(m, j) {
  if (!j || KOL.byMint.has(m)) return;
  KOL.byMint.set(m, { trades: (j.tr || []).filter(x => x && x.t && x.sol >= CFG.kolDust), hold: new Map((j.h || []).filter(x => Array.isArray(x))) });
}
export function kolPrune(keep) {
  const cut = now() - 75 * 3600e3;
  for (const [m, st] of KOL.byMint) { if (keep.has(m)) continue; if (!st.trades.length || st.trades[st.trades.length - 1].t < cut) KOL.byMint.delete(m); }
}
