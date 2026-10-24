// KOLs: known traders' public wallets, their live buys and sells, and which coins they hold.
// The list comes from Solana Tracker (SOLANATRACKER_API_KEY, refreshed twice a day) or KOL_WALLETS ("wallet:name,wallet:name").
// Trades are read straight from the chain: each wallet's transactions arrive over a Solana WebSocket, and every swap is
// decoded from the wallet's own token and SOL balance changes. Holdings follow from those trades.
import { CFG } from "./config.js";
import { getJSON, log, isAddress } from "./util.js";

export const KOL = {
  list: new Map(),          // wallet -> { w, name, x, avatar }
  byMint: new Map(),        // mint -> { trades: [{ t, w, side, amt, sol, px, sig }], hold: Map(wallet -> amount) }
  socks: [], subs: new Map(), seen: new Set(), queue: [], busy: 0,
  stats: { source: "", loadedAt: 0, err: "", trades: 0, notes: 0, fetched: 0, failed: 0, sockets: 0, subscribed: 0 },
  onTrade: null             // (mint, trade) for the live stream
};
const STABLE = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCZ8BpqfBQ4"]);
const DEX = ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"];
const now = () => Date.now();

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
  const s = { ws: null, wallets, retry: 0, pend: new Map(), id: 1 };
  KOL.socks.push(s);
  const open = () => {
    if (!KOL.socks.includes(s)) return;
    try { s.ws = new WebSocket(CFG.kolWs); } catch (e) { KOL.stats.err = "socket: " + e.message; return; }
    s.ws.onopen = () => { s.retry = 0; KOL.stats.sockets = KOL.socks.filter(x => x.ws && x.ws.readyState === 1).length;
      for (const w of s.wallets) { const id = s.id++; s.pend.set(id, w); s.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "logsSubscribe", params: [{ mentions: [w] }, { commitment: "confirmed" }] })); } };
    s.ws.onclose = () => { if (!KOL.socks.includes(s)) return; s.retry++; setTimeout(open, Math.min(60000, 3000 * s.retry)); };
    s.ws.onerror = () => {};
    s.ws.onmessage = ev => {
      let j; try { j = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch (_) { return; }
      if (j.id && s.pend.has(j.id)) { const w = s.pend.get(j.id); s.pend.delete(j.id); if (j.result != null) { KOL.subs.set(j.result, w); KOL.stats.subscribed = KOL.subs.size; } return; }
      if (j.method !== "logsNotification") return;
      const w = KOL.subs.get(j.params && j.params.subscription), v = j.params && j.params.result && j.params.result.value;
      if (!w || !v || v.err || !v.signature) return;
      KOL.stats.notes++;
      const logs = (v.logs || []).join("\n");
      if (!DEX.some(p => logs.includes(p))) return;                                      // swaps only
      if (KOL.seen.has(v.signature + w)) return; KOL.seen.add(v.signature + w);
      if (KOL.seen.size > 50000) KOL.seen = new Set([...KOL.seen].slice(-20000));
      if (KOL.queue.length < 2000) KOL.queue.push({ sig: v.signature, w });
    };
  };
  open();
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
  const tr = { t: x.t, w: x.w, side: x.side, amt: x.amt, sol: x.sol, px: x.px, sig, hold: x.hold };
  st.trades.push(tr); st.trades.sort((a, b) => a.t - b.t); if (st.trades.length > 400) st.trades.splice(0, st.trades.length - 400);
  if (x.hold > 0) st.hold.set(x.w, { amt: x.hold, t: x.t }); else st.hold.delete(x.w);
  KOL.stats.trades++;
  if (KOL.onTrade) KOL.onTrade(x.mint, tr);
}
// two transactions at a time, so the public RPC isn't hammered
export async function kolStep(solUsd) {
  while (KOL.busy < 2 && KOL.queue.length) {
    const job = KOL.queue.shift(); KOL.busy++;
    fetchTx(job.sig).then(tx => { KOL.stats.fetched++; for (const x of decodeSwap(tx, job.w, solUsd())) recordTrade(x, job.sig); })
      .catch(() => { KOL.stats.failed++; })
      .finally(() => { KOL.busy--; });
  }
}

/* ---------- what pages see ---------- */
const who = w => { const k = KOL.list.get(w) || {}; return { w, name: k.name || null, x: k.x || null, avatar: k.avatar || null }; };
export const kolCount = m => { const st = KOL.byMint.get(m); return st ? st.hold.size : 0; };
export function kolOut(m) {
  const st = KOL.byMint.get(m) || { trades: [], hold: new Map() };
  return {
    holders: [...st.hold].sort((a, b) => b[1].t - a[1].t).map(([w, h]) => ({ ...who(w), amt: h.amt, since: h.t })),
    trades: st.trades.slice(-200).map(x => ({ t: x.t, side: x.side, sol: x.sol, px: x.px, amt: x.amt, sig: x.sig, ...who(x.w) }))
  };
}
export const kolWho = who;
// a coin's KOL state for storage, and back
export const kolSave = m => { const st = KOL.byMint.get(m); return st ? { tr: st.trades.slice(-200), h: [...st.hold] } : null; };
export function kolLoad(m, j) {
  if (!j || KOL.byMint.has(m)) return;
  KOL.byMint.set(m, { trades: (j.tr || []).filter(x => x && x.t), hold: new Map((j.h || []).filter(x => Array.isArray(x))) });
}
export function kolPrune(keep) {
  const cut = now() - 75 * 3600e3;
  for (const [m, st] of KOL.byMint) { if (keep.has(m)) continue; if (!st.trades.length || st.trades[st.trades.length - 1].t < cut) KOL.byMint.delete(m); }
}
