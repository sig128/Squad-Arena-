// The round engine: the board, each round's field (fixed at the open), the bracket cuts, results, pools, bets and settlement.
// The rules match the site exactly; the server is the one that decides.
import crypto from "node:crypto";
import { CFG, TF, TFK, MKS, MAX_AGE } from "./config.js";
import { TL, pAt, twap, firstTime } from "./market.js";
import { log, now } from "./util.js";

export const G = {
  board: { top: [], bench: [] }, boardSig: "",
  fields: new Map(),          // round key -> { top: [mint], bench: [mint], live, at }
  lcs: new Map(),             // round key -> bracket state
  results: new Map(),         // round key | market -> result
  opens: new Map(),           // round key | mint -> opening price, kept once the opening window has passed
  settled: new Set(),         // round keys paid out
  bets: new Map(),            // bet id -> bet
  followed: new Map(),        // mint -> last join ms: coins with a squad, tracked even when they are off the board
  byPool: new Map(),          // round key | market | currency -> [bet]
  hooks: { field: null, lcs: null, settled: null, bet: null, board: null }
};

export function roundAt(tfk, w) { const tf = TF[tfk], s = Math.floor(w / tf.W) * tf.W; return { tfk, tf, W: tf.W, s, e: s + tf.W, rs: s, key: "L." + tfk + "." + s }; }
export const roundOfKey = key => { const [, tfk, s] = String(key).split("."); return TF[tfk] ? roundAt(tfk, +s) : null; };
const winOf = r => Math.max(5000, r.W * 0.03);

/* ---------- board ---------- */
// never on the board: pump.fun's own PUMP token, and tickers left off on purpose (BOARD_EXCLUDE, default PUMP, ANSEM, KIMCHI)
const PUMP_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
export const BLOCKED = tok => tok.m === PUMP_MINT || CFG.boardExclude.includes(String(tok.s || "").toUpperCase());
export function computeBoard(t) {
  const list = [];
  for (const tok of TL.values()) {
    if (!tok.gate || BLOCKED(tok)) continue;
    if (tok.rugAt && t >= tok.rugAt) continue;
    if (tok.born && t - tok.born > MAX_AGE) continue;
    const p = pAt(tok, t); if (p == null) continue;
    list.push({ tok, mc: p * tok.supply });
  }
  list.sort((a, b) => b.mc - a.mc);
  return { top: list.slice(0, 15).map(x => x.tok), bench: list.slice(15, 25).map(x => x.tok) };
}
export function refreshBoard(t) {
  const b = computeBoard(t), sig = b.top.map(x => x.m).join() + "|" + b.bench.map(x => x.m).join();
  G.board = b;
  if (sig !== G.boardSig) { G.boardSig = sig; if (G.hooks.board) G.hooks.board(b); }
  return b;
}

/* ---------- fields: fixed in the first minute of a round; a round the server joins later is not scored ---------- */
export function ensureFields(w) {
  for (const tfk of TFK) {
    const r = roundAt(tfk, w); if (G.fields.has(r.key)) continue;
    if (!G.board.top.length) continue;
    const f = { top: G.board.top.map(t => t.m), bench: G.board.bench.map(t => t.m), live: w - r.s <= 60000 || CFG.scoreLate, at: w };
    G.fields.set(r.key, f);
    if (G.hooks.field) G.hooks.field(r, f);
    log("info", `round ${r.key} open, ${f.top.length} coins${f.live ? "" : " (joined late: not scored)"}`);
  }
}
export const roundLive = r => { const f = G.fields.get(r.key); return !!(f && f.live); };
export function fieldOf(r, mk) {
  const f = G.fields.get(r.key); if (!f) return [];
  return (mk === "top" ? f.top.concat(f.bench) : f.top).map(m => TL.get(m)).filter(Boolean);
}

/* ---------- scoring ---------- */
export function retOf(tok, r, wEnd) {
  if (!tok) return null;
  const win = winOf(r), te = Math.min(wEnd, r.e), ft = firstTime(tok);
  const a0 = Math.max(r.rs, ft === Infinity ? r.rs : ft);
  if (a0 > te - 2000) return null;
  // the opening price is fixed once its window has passed: ticks older than 2 h fall back to candles from another
  // source, and a long round must compare its close with the same prices it opened on
  const ok = r.key + "|" + tok.m; let o = G.opens.get(ok);
  if (o == null) { o = twap(tok, a0, Math.min(a0 + win, te)); if (o && te >= a0 + win) G.opens.set(ok, o); }
  const c = twap(tok, Math.max(a0, te - win), te);
  return o && c ? c / o - 1 : null;
}
function distribute(n, parts) { const b = Math.floor(n / parts), rem = n % parts; return Array.from({ length: parts }, (_, i) => b + (i < rem ? 1 : 0)); }
export function lcs(r, w) {
  if (!roundLive(r)) return null;
  let st = G.lcs.get(r.key);
  if (!st) { const f = fieldOf(r, "lcs"); st = { field: f.map(t => t.m), alive: new Set(f.map(t => t.m)), out: [], cps: [], crash: [], done: 0, winner: null, final: null }; G.lcs.set(r.key, st); }
  let changed = false;
  while (st.done < 5) {
    const k = st.done + 1, tk = r.s + k * r.W / 6; if (tk > w) break;
    for (const m of [...st.alive]) { const tok = TL.get(m); if (!tok || (tok.rugAt && tok.rugAt <= tk)) { st.alive.delete(m); st.out.push({ m, k, why: "rug", R: null }); } }
    for (const tok of G.board.top) if (!st.field.includes(tok.m)) { st.field.push(tok.m); st.alive.add(tok.m); st.crash.push({ m: tok.m, k }); }
    const ranked = [...st.alive].map(m => ({ m, R: retOf(TL.get(m), r, tk) })).sort((a, b) => (b.R ?? -9) - (a.R ?? -9));
    const n = ranked.length, cut = Math.max(0, Math.min(n - 2, distribute(Math.max(0, n - 2), 6 - k)[0]));
    const cutList = cut ? ranked.slice(n - cut) : [];
    cutList.forEach(x => { st.alive.delete(x.m); st.out.push({ m: x.m, k, why: "cut", R: x.R }); });
    st.cps.push({ k, t: tk, cut: cutList.map(x => x.m), ranked });
    st.done = k; changed = true;
  }
  const te = Math.min(w, r.e);
  for (const m of [...st.alive]) { const tok = TL.get(m); if (tok && tok.rugAt && tok.rugAt <= te) { st.alive.delete(m); st.out.push({ m, k: st.done + .5, why: "rug", R: null }); changed = true; } }
  if (w >= r.e && st.done === 5 && !st.final) {
    st.final = [...st.alive].map(m => ({ m, R: retOf(TL.get(m), r, r.e) })).sort((a, b) => (b.R ?? -9) - (a.R ?? -9));
    st.winner = st.final.length ? st.final[0].m : null; changed = true;
  }
  if (changed && G.hooks.lcs) G.hooks.lcs(r, st);
  return st;
}
export const lcsJSON = st => st && ({ field: st.field, alive: [...st.alive], out: st.out, cps: st.cps, crash: st.crash, done: st.done, winner: st.winner, final: st.final });
export function lcsFromJSON(j) { return j ? { ...j, alive: new Set(j.alive || []), out: j.out || [], cps: j.cps || [], crash: j.crash || [] } : null; }
export function attn(tok, tfk, tNow) {
  const ageMin = tok.born ? Math.max(1, (tNow - tok.born) / 60000) : 1e9;
  const [m5, h1, h6, h24] = tok.tx, rate = (n, mins) => n / Math.max(1, Math.min(mins, ageMin));
  let a, b;
  if (tfk === "15m" || tfk === "30m") { a = rate(m5, 5); b = rate(h1, 60); }
  else if (tfk === "1h") { a = rate(h1, 60); b = rate(h6, 360); }
  else { a = rate(h6, 360); b = rate(h24, 1440); }
  return b > 0 ? a / b - 1 : 0;
}
export function hype(r, w) {
  const tNow = now();
  return fieldOf(r, "eff").map(tok => { const R = retOf(tok, r, w), A = attn(tok, r.tfk, tNow); return { tok, R, A, eff: R == null ? null : R / (1 + Math.max(A, -0.9)), bust: R != null && R < 0 && A > 0 ? A * -R : 0 }; });
}
export function resultOf(r, mk) {
  const key = r.key + "|" + mk; let res = G.results.get(key); if (res) return res;
  if (now() < r.e + 1200 || !roundLive(r)) return null;
  const rugged = tok => tok.rugAt && tok.rugAt <= r.rs + r.W;
  if (mk === "top") {
    const st = fieldOf(r, "top").filter(t => !rugged(t)).map(t => ({ m: t.m, R: retOf(t, r, r.e) })).filter(x => x.R != null).sort((a, b) => b.R - a.R);
    if (!st.length) return null;
    res = { winners: [st[0].m], top: st.slice(0, 3), metric: st[0].R };
  } else if (mk === "lcs") {
    const st = lcs(r, r.e + 1); if (!st || !st.winner) return null;
    res = { winners: [st.winner], top: st.final, metric: st.final[0].R };
  } else {
    const h = hype(r, r.e).filter(x => !rugged(x.tok) && x.R != null);
    if (!h.length) return null;
    if (mk === "eff") { h.sort((a, b) => b.eff - a.eff); res = { winners: [h[0].tok.m], top: h.slice(0, 3).map(x => ({ m: x.tok.m, R: x.R, A: x.A, v: x.eff })), metric: h[0].eff }; }
    else { h.sort((a, b) => b.bust - a.bust); res = h[0].bust > 0 ? { winners: [h[0].tok.m], top: h.slice(0, 3).map(x => ({ m: x.tok.m, R: x.R, A: x.A, v: x.bust })), metric: h[0].bust } : { winners: [], refundAll: true, why: "no coin had rising attention and a falling price" }; }
  }
  const body = JSON.stringify({ round: r.key, market: mk, mode: "live", field: fieldOf(r, mk).map(t => t.m), winners: res.winners, top: (res.top || []).map(x => [x.m, x.R == null ? null : +x.R.toFixed(6)]), rake: CFG.rake, seed: CFG.seed });
  res.hash = crypto.createHash("sha256").update(body).digest("hex");
  res.mk = mk; res.key = r.key;
  G.results.set(key, res);
  return res;
}

/* ---------- bets and pools (one pool per round, market and currency) ---------- */
const poolKey = (rk, mk, cur) => rk + "|" + mk + "|" + cur;
export function indexBet(b) {
  G.bets.set(b.id, b);
  const k = poolKey(b.rk, b.mk, b.cur); let a = G.byPool.get(k); if (!a) G.byPool.set(k, a = []);
  if (!a.includes(b)) a.push(b);
}
export function reindexBet(b, oldMint) { /* mint changes keep the same pool; nothing to move */ return b; }
export function pool(r, mk, cur) {
  const sh = new Map(); let P = 0, n = 0; const who = new Set(), seed = CFG.seed[cur] ?? 0;
  for (const t of fieldOf(r, mk)) { sh.set(t.m, seed); P += seed; }
  for (const b of G.byPool.get(poolKey(r.key, mk, cur)) || []) {
    if (b.st === "refund") continue;
    P += b.s; sh.set(b.m, (sh.get(b.m) || 0) + b.s * b.w); n++; who.add(b.uid);
  }
  return { P, sh, n, people: who.size };
}
export function quote(r, mk, m, s, w, cur) {
  const pl = pool(r, mk, cur), mine = pl.sh.get(m) || 0;
  const pay = (pl.P + s) * (1 - CFG.rake) * (s * w) / (mine + s * w);
  return { pay, mult: s > 0 ? pay / s : 0 };
}
export function betState(r, mk, w, m) {
  const el = (w - r.s) / r.W;
  if (!roundLive(r)) return { open: false, why: "The server joined this round partway, so it isn't scored. Betting opens with the next round." };
  if (mk === "lcs") {
    if (w >= r.e - winOf(r)) return { open: false, why: "The final duel is being scored." };
    if (m) { const st = lcs(r, w); if (!st || !st.alive.has(m)) return { open: false, why: "That coin is out of this bracket." }; }
    return { open: true, el, w: 1 / (1 + 2 * el) };
  }
  if (el >= CFG.betWindow) return { open: false, why: "Bets close at 40% of the round." };
  if (m) {
    const tok = TL.get(m); if (!tok) return { open: false, why: "That coin is not in this round's field." };
    if (tok.rugAt && tok.rugAt <= w) return { open: false, why: "That coin was removed by the rug filter." };
    if (!fieldOf(r, mk).some(t => t.m === m)) return { open: false, why: "That coin is not in this round's field." };
  }
  return { open: true, el, w: 1 / (1 + 2 * el) };
}

/* ---------- settlement ---------- */
// returns [{ bet, status, payout, why }] for every open bet the round decides now
export function decide(r, w) {
  const out = [], f = G.fields.get(r.key), ended = w >= r.e + 5000;
  for (const mk of MKS) for (const cur of ["tSOL", "SOL"]) {
    const list = (G.byPool.get(poolKey(r.key, mk, cur)) || []).filter(b => b.st === "open"); if (!list.length) continue;
    // a coin removed by the rug filter refunds its bets right away
    for (const b of list) { const tok = TL.get(b.m); if (tok && tok.rugAt && tok.rugAt <= Math.min(w, r.e)) out.push({ bet: b, status: "refund", payout: 0, why: "rug" }); }
    if (!ended) continue;
    const still = list.filter(b => !out.some(o => o.bet === b));
    if (!f || !f.live) { still.forEach(b => out.push({ bet: b, status: "refund", payout: 0, why: "round not scored" })); continue; }
    const res = resultOf(r, mk);
    if (!res) { if (w >= r.e + 120000) still.forEach(b => out.push({ bet: b, status: "refund", payout: 0, why: "no result" })); continue; }
    if (res.refundAll) { still.forEach(b => out.push({ bet: b, status: "refund", payout: 0, why: res.why })); continue; }
    // pool without this round's refunds
    const refunded = new Set(out.filter(o => o.status === "refund").map(o => o.bet.id));
    const pl = pool(r, mk, cur); for (const id of refunded) { const b = G.bets.get(id); if (b && b.rk === r.key && b.mk === mk && b.cur === cur) { pl.P -= b.s; pl.sh.set(b.m, (pl.sh.get(b.m) || 0) - b.s * b.w); } }
    const tot = res.winners.reduce((a, m) => a + (pl.sh.get(m) || 0), 0);
    // no house seed and nobody backed a winner: the pool goes back to everyone who bet
    if (!(tot > 0)) { still.forEach(b => out.push({ bet: b, status: "refund", payout: 0, why: "nobody backed the winner" })); continue; }
    for (const b of still) {
      if (res.winners.includes(b.m)) out.push({ bet: b, status: "won", payout: +(pl.P * (1 - CFG.rake) * (b.s * b.w) / (tot || 1)).toFixed(9), why: null, receipt: res.hash });
      else out.push({ bet: b, status: "lost", payout: 0, why: null, receipt: res.hash });
    }
  }
  return out;
}
export function roundsWithOpenBets() {
  const keys = new Set(); for (const b of G.bets.values()) if (b.st === "open") keys.add(b.rk);
  return [...keys].map(roundOfKey).filter(Boolean);
}

/* ---------- what the site needs to draw a round the same way ---------- */
export function roundState(r, w) {
  const f = G.fields.get(r.key); if (!f) return null;
  const st = r.tfk ? lcs(r, w) : null;
  const pools = {};
  for (const mk of MKS) for (const cur of ["tSOL", "SOL"]) { const pl = pool(r, mk, cur); if (pl.n) pools[mk + "|" + cur] = { P: +pl.P.toFixed(9), sh: Object.fromEntries([...pl.sh].map(([m, v]) => [m, +v.toFixed(9)])), n: pl.n, people: pl.people }; }
  return { key: r.key, tfk: r.tfk, s: r.s, e: r.e, field: { top: f.top, bench: f.bench }, live: f.live, lcs: lcsJSON(st), pools };
}
