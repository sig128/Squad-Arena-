// Squad Arena round server. Runs 24/7 (Railway): watches the coins, opens and scores every round, takes bets,
// pays out, and streams the arena to every open page.
import { CFG, TF, TFK, MKS, CURRENCIES, checkConfig } from "./lib/config.js";
import { log, now } from "./lib/util.js";
import { DB } from "./lib/db.js";
import { STORE, storeInit, storeSave, storeLoad } from "./lib/store.js";
import { TL, FEED, RPC, jobPrices, jobValidate, jobDiscover, jobDiscoverDS, jobBackfill, jobMeta, jobDesc, samplePools, chartC, prune, rpcStart, rpcWatch, pumpOff } from "./lib/market.js";
import { G, roundAt, roundOfKey, refreshBoard, ensureFields, lcs, lcsJSON, lcsFromJSON, resultOf, decide, roundsWithOpenBets, indexBet, roundState, runningRounds, retOf, fieldOf } from "./lib/game.js";
import { SOC, betIn, joinSquad, pushDoc, allDocs, peopleOut } from "./lib/social.js";
import { emit, online } from "./lib/hub.js";
import { makeServer } from "./lib/api.js";
import { initMoney, moneyInfo, scanDeposits, recoverWithdrawals, MONEY } from "./lib/money.js";
import { startReplay } from "./lib/replay.js";
import { PF, pfStep, pfSave, pfLoad, pfHealth, pfCoinMeta } from "./lib/pfsquads.js";
import { KOL, loadKols, kolStep, kolCount, kolWho, kolPrune, kolHistory, kolHistDue, kolHistBudget } from "./lib/kol.js";
import { BLOCKED } from "./lib/game.js";
import { MAX_AGE, GATE } from "./lib/config.js";

const STARTED = now();
const r6 = v => v == null ? null : +(+v).toPrecision(7);
const candleOut = c => [c.t, r6(c.o), r6(c.h), r6(c.l), r6(c.c), Math.round(c.v || 0)];
function tokOut(tok, full = true) {
  const o = { m: tok.m, s: tok.s, n: tok.n, born: tok.born, supply: tok.supply, px: r6(tok.px), mc: tok.mc, liq: tok.liq, vol: tok.vol, tx: tok.tx, bs: tok.bs, ch: tok.ch,
    pool: tok.pool, dex: tok.dex, quote: tok.quote, pa: tok.pa, x: tok.x, tg: tok.tg, dc: tok.dc, w: tok.w, ds: (tok.ds || "").slice(0, 360), logo: tok.logo,
    gate: tok.gate, rugAt: tok.rugAt, rugWhy: tok.rugWhy, flag: tok.flagWhy || "", rpc: !!tok.rpcAt, kol: kolCount(tok.m), holders: tok.holders || null };
  if (full) {
    const t = now();
    o.C = chartC(tok, false, t).slice(-150).map(candleOut);
    o.C5 = chartC(tok, true, t).filter(c => c.t >= t - 26 * 3600e3).map(candleOut);
    o.ticks = tok.ticks.filter(k => k.t >= t - 20 * 60e3).map(k => k.h != null && (k.h !== k.p || k.l !== k.p) ? [k.t, r6(k.p), r6(k.h), r6(k.l)] : [k.t, r6(k.p)]);
  }
  return o;
}
// coins the site needs: the board, everything in a running round's field, and coins with open bets
function keepSet(t) {
  const keep = new Set([...G.board.top, ...G.board.bench].map(x => x.m));
  for (const tfk of TFK) for (const r of runningRounds(tfk, t)) { const f = G.fields.get(r.key); if (f) { f.top.forEach(m => keep.add(m)); f.bench.forEach(m => keep.add(m)); } }
  for (const b of G.bets.values()) if (b.st === "open") keep.add(b.m);
  // coins with a squad, most recently joined first
  [...G.followed].sort((a, b) => b[1] - a[1]).slice(0, 300).forEach(([m]) => keep.add(m));
  // the trending list
  for (const m of TREND.list) keep.add(m);
  // coins someone has open on a coin page right now
  for (const [m, at] of FEED.viewed) { if (t - at < 600e3) keep.add(m); else FEED.viewed.delete(m); }
  return keep;
}
function snapshot() {
  const t = now(), keep = keepSet(t);
  const rounds = {}, results = {};
  // every running round and the one that just ended
  for (const tfk of TFK) for (const r of [...runningRounds(tfk, t), roundAt(tfk, t - TF[tfk].W)]) {
    const st = roundState(r, t); if (st) rounds[r.key] = st;
    for (const mk of MKS) { const res = G.results.get(r.key + "|" + mk); if (res) results[r.key + "|" + mk] = res; }
  }
  return {
    v: 1, now: t, started: STARTED,
    cfg: { kols: KOL.list.size, boardMinAge: CFG.boardMinAge, rake: CFG.rake, seed: CFG.seed, betWindow: CFG.betWindow, minStake: CFG.minStake, maxStake: CFG.maxStake, currencies: CURRENCIES(), startBalance: CFG.startBalance, money: moneyInfo(), rpc: RPC.live },
    board: { top: G.board.top.map(x => x.m), bench: G.board.bench.map(x => x.m) }, trending: TREND.list,
    tokens: [...keep].map(m => TL.get(m)).filter(Boolean).map(tok => tokOut(tok)),
    rounds, results, docs: allDocs(), people: peopleOut()
  };
}
// which kind of Supabase key the server holds, and for which project (never the key itself)
function keyInfo() {
  const k = CFG.supabaseKey || "", u = CFG.supabaseUrl || "";
  let host = ""; try { host = new URL(u).host; } catch (_) { host = u ? "not a URL" : ""; }
  const kind = !k ? "missing" : /^sb_secret_/.test(k) ? "secret key" : /^sb_publishable_/.test(k) ? "publishable key (the wrong one: use the secret key)" : /^eyJ/.test(k) ? "legacy JWT key" : "not a Supabase key";
  return { kind, length: k.length, project: host };
}
// the database answers? (a one-row read every minute)
const DBH = { ok: null, err: "", at: 0, missing: null, schemaAt: 0 };
const NEED = ["profiles", "rounds", "bets", "squad_members", "proofs", "proof_marks", "chat", "ledger", "deposits", "withdrawals", "candles",
  "rpc/place_bet", "rpc/settle_bet", "rpc/use_streak_pass", "rpc/topup_practice", "rpc/credit_deposit", "rpc/request_withdrawal", "rpc/finish_withdrawal"];
async function dbPing() {
  try { await DB.ping(); DBH.ok = true; DBH.err = ""; } catch (e) { DBH.ok = false; DBH.err = String(e.message || e).slice(0, 200); log("error", "database: " + DBH.err); }
  DBH.at = now();
  // every 10 minutes: anything from supabase/schema.sql the database lacks
  if (DBH.ok && now() - DBH.schemaAt > 600e3) {
    DBH.schemaAt = now();
    try { const p = await DB.schema(); if (p) { const have = new Set(p.map(x => x.replace(/^\//, ""))); DBH.missing = NEED.filter(x => !have.has(x)); if (DBH.missing.length) log("warn", "database is missing: " + DBH.missing.join(", ") + " (run supabase/schema.sql)"); } }
    catch (e) { DBH.missing = ["could not read the schema: " + String(e.message).slice(0, 120)]; }
  }
}
setInterval(dbPing, 60000); setTimeout(dbPing, 3000);
function health() {
  return { ok: true, time: now(), up: Math.round((now() - STARTED) / 1000), feed: CFG.feed, coins: TL.size, board: G.board.top.length, rpc: RPC.live, rpcCoins: RPC.watched.size,
    db: DB.kind, dbOk: DBH.ok, dbErr: DBH.err || undefined, dbAt: DBH.at, dbKey: keyInfo(), dbMissing: DBH.missing, bets: { open: [...G.bets.values()].filter(b => b.st === "open").length, loaded: G.bets.size }, money: moneyInfo(), treasurySol: MONEY.treasuryLamports == null ? null : MONEY.treasuryLamports / 1e9, calls: FEED.calls, errors: FEED.errs, lastError: FEED.lastErr || null, lastPrice: FEED.lastPrice,
    discovery: { pools: FEED.sample.pools, fresh: FEED.sample.fresh, ago: FEED.sample.at ? Math.round((now() - FEED.sample.at) / 1000) : null, err: FEED.sample.err, pending: FEED.pending.length, pumpfun: !pumpOff() },
    kols: { list: KOL.list.size, ...KOL.stats, coins: KOL.byMint.size, queue: KOL.queue.length, history: kolHistBudget() }, trending: TREND.list.length,
    pf: pfHealth(),
    // coins the scam filter keeps off the board, biggest first
    scam: [...TL.values()].filter(x => x.flag).sort((a, b) => (b.mc || 0) - (a.mc || 0)).slice(0, 30).map(x => ({ s: x.s, m: x.m, mc: Math.round(x.mc || 0), why: x.flagWhy })),
    charts: { withHistory: [...TL.values()].filter(x => x.C.length > 1).length, backfilled: FEED.backfilled, backfill: CFG.gtBackfill, gtPausedFor: Math.max(0, Math.round((FEED.gtPauseUntil - now()) / 1000)),
      stored: { on: STORE.on, saved: STORE.saved, loaded: STORE.loaded, err: STORE.err } } };
}

/* ---------- live stream batching ---------- */
const tickBuf = new Map(); let metaDirty = new Set(), sentTok = new Set();

/* ---------- trending: young coins ranked by recent trading, the way trending boards rank them ---------- */
// Recent volume counts most (5 min and 1 h), the day's volume a little; every KOL holding the coin adds 12% (up to 25 KOLs).
// Coins on PUMP/ANSEM/KIMCHI, older than 72 h, rugged, with under $5k liquidity or stale numbers are left out.
const TREND = { list: [], sig: "", at: 0 };
function trendStep() {
  const t = now(), rows = [];
  for (const tok of TL.values()) {
    if (BLOCKED(tok) || tok.flag || !(tok.px > 0) || tok.full) continue;
    if (tok.born && t - tok.born > MAX_AGE) continue;
    if (tok.rugAt && tok.rugAt <= t) continue;
    if ((tok.liq || 0) < 5000 || !tok.lastSeen || t - tok.lastSeen > 30 * 60e3) continue;
    if ((tok.mc || 0) / Math.max(1, tok.liq) > GATE.mcLiq) continue;                       // a market cap the pool can't back: fake-cap clones
    const [v5, v1, v6, v24] = tok.vol || [0, 0, 0, 0], k = kolCount(tok.m);
    let s = (v5 * 6 + v1 * 4 + v6 * 0.6 + v24 * 0.15) * (1 + 0.12 * Math.min(k, 25));
    if ((tok.ch || [])[1] < -40) s *= 0.5;                                                   // falling apart this hour
    rows.push([tok.m, s]);
  }
  TREND.list = rows.sort((a, b) => b[1] - a[1]).slice(0, 30).map(x => x[0]); TREND.at = t;
  const sig = TREND.list.join();
  if (sig !== TREND.sig) { TREND.sig = sig; emit("trending", TREND.list); }
}
setInterval(trendStep, 10000);
// a KOL trade on a coin pages are showing goes out at once (it also changes the coin's KOL count)
KOL.onTrade = (m, tr) => { metaDirty.add(m); if (keepNow().has(m)) emit("kol", { m, tr: { t: tr.t, side: tr.side, sol: tr.sol, px: tr.px, amt: tr.amt, sig: tr.sig, hold: tr.hold, ...kolWho(tr.w) } }); };
FEED.onTick = tok => { const k = tok.ticks[tok.ticks.length - 1]; if (k) tickBuf.set(tok.m, k.h !== k.p || k.l !== k.p ? [tok.m, k.t, r6(k.p), r6(k.h), r6(k.l)] : [tok.m, k.t, r6(k.p)]); };
KOL.onHistory = m => { metaDirty.add(m); };
PF.onUpdate = (list, t) => emit("pf", { t, list });
// PumpSwap pool -> coin, from the pools discovery already knows (KOL swaps name the pool, not the coin)
let poolIx = { n: -1, at: 0, map: new Map() };
KOL.poolMint = pool => {
  if (poolIx.n !== FEED.pools.size || now() - poolIx.at > 30000) { poolIx = { n: FEED.pools.size, at: now(), map: new Map() }; for (const [m, x] of FEED.pools) if (x && x.pool) poolIx.map.set(x.pool, m); }
  return poolIx.map.get(pool) || null;
};
// board, on-deck and trending coins get their KOL history as they show up, then every 15 minutes (within the daily budget)
function kolHistStep() {
  const want = [...new Set([...G.board.top.map(x => x.m), ...G.board.bench.map(x => x.m), ...TREND.list])];
  for (const m of want.filter(kolHistDue).slice(0, 2)) kolHistory(m);
}
FEED.onMeta = list => { for (const tok of list) metaDirty.add(tok.m); };
FEED.onCandles = (tok, five) => { if (sentTok.has(tok.m)) emit("candles", { m: tok.m, five: !!five, C: (five ? chartC(tok, true).filter(c => c.t >= now() - 26 * 3600e3) : chartC(tok, false).slice(-150)).map(candleOut) }); };
// every finished 1-minute candle goes out once, so open pages keep their charts current without reloading
const sentC = new Map();
setInterval(() => {
  const t = now(), list = [];
  for (const m of keepSet(t)) {
    const tok = TL.get(m); if (!tok || !sentTok.has(m)) continue;
    const C = tok.C, last = sentC.get(m) || 0;
    for (let i = Math.max(0, C.length - 3); i < C.length; i++) { const c = C[i]; if (c.t > last && c.t + 60000 <= t) { list.push([m, candleOut(c)]); sentC.set(m, c.t); } }
  }
  if (sentC.size > 5000) sentC.clear();
  if (list.length) emit("candle", list);
}, 5000);
// prices go out within 150 ms of the swap (the set of coins pages care about is worked out once a second)
let keepCache = { at: 0, set: new Set() };
const keepNow = () => { const t = now(); if (t - keepCache.at > 1000) keepCache = { at: t, set: keepSet(t) }; return keepCache.set; };
setInterval(() => {
  if (!tickBuf.size) return;
  const keep = keepNow(), list = [...tickBuf.values()].filter(x => keep.has(x[0])); tickBuf.clear();
  if (list.length) emit("tick", list);
}, 150);
setInterval(() => {
  const t = now(), keep = keepSet(t);
  for (const m of keep) if (!sentTok.has(m) && TL.has(m)) { sentTok.add(m); emit("token", tokOut(TL.get(m))); }   // a coin new to the site arrives whole
  const meta = [...metaDirty].filter(m => keep.has(m) && TL.has(m)).map(m => tokOut(TL.get(m), false)); metaDirty = new Set();
  if (meta.length) emit("meta", meta);
  if (sentTok.size > 3000) sentTok = new Set(keep);
}, 5000);

/* ---------- storage hooks ---------- */
const iso = ms => new Date(ms).toISOString();
G.hooks.field = (r, f) => {
  DB.upsertRound({ key: r.key, tf: r.tfk, starts_at: iso(r.s), ends_at: iso(r.e), field_top: f.top, field_bench: f.bench, live: f.live }).catch(e => log("error", "save round: " + e.message));
  emit("round", roundState(r, now()));
};
const lcsSave = new Map();
G.hooks.lcs = (r, st) => {
  clearTimeout(lcsSave.get(r.key));
  lcsSave.set(r.key, setTimeout(() => { lcsSave.delete(r.key); DB.updateRound(r.key, { lcs: lcsJSON(st) }).catch(e => log("error", "save bracket: " + e.message)); emit("round", roundState(r, now())); }, 300));
};
G.hooks.sq = r => emit("round", roundState(r, now()));
G.hooks.board = b => emit("board", { top: b.top.map(x => x.m), bench: b.bench.map(x => x.m) });

/* ---------- settlement ---------- */
let settling = false;
async function settleTick(t) {
  if (settling) return; settling = true;
  try {
    const todo = new Map();
    for (const r of roundsWithOpenBets()) todo.set(r.key, r);
    for (const tfk of TFK) { const r = roundAt(tfk, t - TF[tfk].W); if (!G.settled.has(r.key) && G.fields.has(r.key)) todo.set(r.key, r); }
    for (const r of todo.values()) {
      for (const d of decide(r, t)) {
        let row;
        try { row = await DB.settleBet(d.bet.id, d.status, d.payout, d.why, d.receipt || null); }
        catch (e) { log("error", `settle ${d.bet.id}: ${e.message}`); continue; }
        d.bet.st = d.status; d.bet.pay = d.status === "won" ? d.payout : 0; d.bet.why = d.why;
        if (row === null) log("warn", `bet ${d.bet.id} was already settled in the database`);
        pushDoc("members", d.bet.uid);
        if (d.status !== "lost") emit("paid", { uid: d.bet.uid, bet: d.bet.id, st: d.status, pay: d.bet.pay, cur: d.bet.cur });
      }
      const ended = t >= r.e + 5000, open = [...G.bets.values()].some(b => b.rk === r.key && b.st === "open");
      if (ended && !open && !G.settled.has(r.key)) {
        const res = {}; for (const mk of MKS) { const x = resultOf(r, mk); if (x) res[mk] = x; }
        if (Object.keys(res).length || t > r.e + 120000 || !(G.fields.get(r.key) || {}).live) {
          G.settled.add(r.key);
          DB.updateRound(r.key, { results: res, settled_at: iso(t) }).catch(e => log("error", "save results: " + e.message));
          emit("results", { key: r.key, res });
          log("info", `round ${r.key} settled: ${Object.entries(res).map(([mk, x]) => mk + "=" + (x.winners[0] ? (TL.get(x.winners[0]) || {}).s : "refund")).join(" ")}`);
        }
      }
    }
  } finally { settling = false; }
}

/* ---------- loops ---------- */
// DEX Screener prices every 4 seconds, new candidates checked in between; the pool stream finds the candidates
const short = () => G.board.top.length < 15;
let feedBusy = false, gtBusy = false;
async function feedStep() {
  if (feedBusy) return; feedBusy = true;
  const t = now(), keep = keepSet(t);
  try {
    if (t - FEED.lastPrice > 4000) await jobPrices([...keep].slice(0, 360));
    else if (FEED.pending.length) await jobValidate();
    else if (t - (FEED.lastDS || 0) > (short() ? 15000 : 60000)) await jobDiscoverDS();
    else if (!pumpOff() && t - FEED.lastDisc > 30000) await jobDiscover();
  } catch (e) { if (t - FEED.lastPrice > 4000) FEED.lastPrice = t - 2000; log("warn", "feed: " + e.message); }
  finally { feedBusy = false; }
}
// listen to the pool stream: every minute while the board is short, every 4 minutes once it's full
function sampleStep() {
  if (FEED.sample.running || now() - FEED.sample.at < (short() ? 60e3 : 240e3)) return;
  samplePools(short() ? 25000 : 40000).then(n => { if (n) log("info", `pool stream: ${FEED.sample.pools} active pools, ${n} new coins to check`); else if (FEED.sample.err) log("warn", "pool stream: " + FEED.sample.err); });
}
// coin details for everything the site shows (board first): logos and links, then descriptions
let metaBusy = false, descBusy = false;
async function metaStep() {
  if (metaBusy) return; metaBusy = true;
  try { await jobMeta([...new Set([...G.board.top, ...G.board.bench].map(x => x.m).concat([...keepSet(now())]))]); }
  catch (e) { log("warn", "coin details: " + e.message); }
  finally { metaBusy = false; }
}
async function descStep() {
  if (descBusy) return; descBusy = true;
  try {
    const order = [...G.board.top, ...G.board.bench].map(x => x.m).concat([...keepSet(now())]);
    const tok = order.map(m => TL.get(m)).find(x => x && !x.descAt && !x.full);
    if (tok) await jobDesc(tok);
  } catch (_) {}
  finally { descBusy = false; }
}
// candles survive restarts: read a coin's saved candles when it comes back, save every few minutes and on shutdown
let loadBusy = false, saveBusy = false;
async function loadStep() {
  if (loadBusy || !STORE.on) return; loadBusy = true;
  try {
    const order = [...G.board.top.map(x => x.m), ...G.board.bench.map(x => x.m), ...keepSet(now())];
    const tok = order.map(m => TL.get(m)).find(x => x && !x.storeAt && !x.full);
    if (tok) { tok.storeAt = now(); await storeLoad(tok); }
  } catch (e) { log("warn", "candle load: " + e.message); }
  finally { loadBusy = false; }
}
async function saveStep(all) {
  if (saveBusy || !STORE.on) return; saveBusy = true;
  try {
    const t = now(), order = [...new Set([...G.board.top.map(x => x.m), ...G.board.bench.map(x => x.m), ...keepSet(t)])];
    const due = order.map(m => TL.get(m)).filter(x => x && x.C.length && x.storeAt && (all || t - (x.savedAt || 0) > 300e3)).slice(0, all ? 60 : 8);
    await Promise.all(due.map(x => storeSave(x).catch(() => {})));
  } finally { saveBusy = false; }
}
process.on("SIGTERM", async () => {
  log("info", "stopping: saving candles and squad tracking");
  saveBusy = false;
  await Promise.race([Promise.all([saveStep(true), pfSave(false), opensSave()]), new Promise(r => setTimeout(r, 8000))]);
  process.exit(0);
});
// background chart history for coins on the board (then on deck, then everything else kept), one GeckoTerminal call at a time
async function gtStep() {
  if (gtBusy || !CFG.gtBackfill || now() < FEED.gtPauseUntil) return; gtBusy = true;
  try {
    // coins someone has open right now first, then the board, on deck and the rest
    const order = [...FEED.viewed.keys(), ...G.board.top.map(x => x.m), ...G.board.bench.map(x => x.m), ...keepSet(now())];
    const tok = order.map(m => TL.get(m)).find(x => x && x.pool && (!x.histAt || !x.hist5At));
    if (tok) await jobBackfill(tok);
  } catch (e) { if (e.status === 429) FEED.gtPauseUntil = now() + 45e3; }
  finally { gtBusy = false; }
}
function engineStep() {
  const t = now();
  refreshBoard(t);
  ensureFields(t);
  for (const tfk of TFK) for (const r of runningRounds(tfk, t)) if (G.fields.has(r.key)) { lcs(r, t); fixOpens(r, t); }
  settleTick(t).catch(e => log("error", "settle: " + e.message));
}

// a round's opening prices, fixed for every coin in its field once the opening window has passed and kept in the
// database, so a server restart doesn't cancel the round: its results compare the close with these same prices
const opensDone = new Set(); let opensDirty = false;
function fixOpens(r, t) {
  if (opensDone.has(r.key) || t < r.s + Math.max(5000, r.W * 0.03) + 5000) return;
  const f = G.fields.get(r.key); if (!f || !f.live) { opensDone.add(r.key); return; }
  let n = 0; for (const tok of fieldOf(r, "top")) { retOf(tok, r, t); if (G.opens.has(r.key + "|" + tok.m)) n++; }
  opensDone.add(r.key); if (n) opensDirty = true;
}
async function opensSave() {
  if (!opensDirty || DB.kind !== "supabase") return; opensDirty = false;
  try { await DB.req("candles?on_conflict=mint", { method: "POST", body: { mint: "game:opens", data: JSON.stringify([...G.opens]), updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" }); }
  catch (e) { opensDirty = true; log("warn", "save opening prices: " + e.message); }
}
async function opensLoad() {
  if (DB.kind !== "supabase") return;
  try { const r = await DB.req("candles?mint=eq.game:opens&select=data"); if (r && r[0]) for (const [k, v] of JSON.parse(r[0].data)) if (!G.opens.has(k)) G.opens.set(k, v); }
  catch (e) { log("warn", "load opening prices: " + e.message); }
}

async function loadState() {
  const t = now(), since = t - 26 * 3600e3;
  await opensLoad();
  for (const r of await DB.loadRounds(since)) {
    // a round that was still running when the server restarted keeps going if its opening prices were saved; otherwise
    // it lost its prices from before the restart, so it isn't scored (its bets are refunded) unless its results were saved
    const R = roundOfKey(r.key), saved = r.settled_at || (r.results && Object.keys(r.results).length);
    const kept = R && (r.field_top || []).some(m => G.opens.has(r.key + "|" + m));
    const cut = !saved && R && R.s < t && !CFG.scoreLate && !kept;
    G.fields.set(r.key, { top: r.field_top || [], bench: r.field_bench || [], live: !!r.live && !cut, at: Date.parse(r.created_at) || t });
    if (r.lcs) G.lcs.set(r.key, lcsFromJSON(r.lcs));
    if (r.results) for (const [mk, res] of Object.entries(r.results)) G.results.set(r.key + "|" + mk, res);
    if (r.settled_at) G.settled.add(r.key);
  }
  for (const row of await DB.loadBets(since)) indexBet(betIn(row));
  for (const s of await DB.loadSquads()) { if (String(s.mint).startsWith("sq:")) continue; const ts = Date.parse(s.joined_at); joinSquad(s.user_id, s.mint, ts); G.followed.set(s.mint, Math.max(G.followed.get(s.mint) || 0, ts)); }
  for (const m of G.followed.keys()) if (!TL.has(m)) FEED.pending.push(m);
  // coins from the last few hours of rounds go straight back to DEX Screener, so a restart doesn't start from an empty board
  for (const f of G.fields.values()) if (t - f.at < 6 * 3600e3) for (const m of [...f.top, ...f.bench]) if (!TL.has(m) && !FEED.pending.includes(m)) FEED.pending.push(m);
  for (const p of await DB.loadProofs(t - 30 * 86400e3)) SOC.proofs.set(p.id, { id: p.id, uid: p.user_id, m: p.mint, k: p.task, u: p.url, ts: Date.parse(p.created_at) });
  for (const k of await DB.loadMarks()) { if (!SOC.proofs.has(k.proof_id)) continue; let mk = SOC.marks.get(k.proof_id); if (!mk) SOC.marks.set(k.proof_id, mk = { v: new Map(), f: new Map() }); (k.kind === "flag" ? mk.f : mk.v).set(k.user_id, Date.parse(k.created_at) || t); }
  SOC.chat = (await DB.loadChat(t - 3 * 86400e3)).reverse().map(c => ({ id: "c" + c.id, uid: c.user_id, c: c.chan, x: c.body, ts: Date.parse(c.created_at), sys: !!c.sys }));
  const ids = new Set([...SOC.squads.keys(), ...[...G.bets.values()].map(b => b.uid), ...SOC.chat.map(c => c.uid), ...[...SOC.proofs.values()].map(p => p.uid)]);
  const list = [...ids];
  for (let i = 0; i < list.length; i += 80) for (const p of await DB.profilesByIds(list.slice(i, i + 80))) SOC.people.set(p.id, { name: p.name, avatar: p.avatar, handle: p.handle || "" });
  log("info", `loaded ${G.fields.size} rounds, ${G.bets.size} bets, ${SOC.proofs.size} proofs, ${SOC.chat.length} messages, ${SOC.people.size} people from ${DB.kind}`);
}

async function main() {
  checkConfig(log); initMoney();
  try { await loadState(); } catch (e) { log("error", "could not load saved state: " + e.message + " — did you run supabase/schema.sql?"); }
  // pump.fun squads: the stored copy, then every member wallet's profit, a batch of up to 100 every 15 s
  // saved every minute while scores move (and on shutdown), so a restart keeps each round's squad race and its scores
  pfLoad().then(() => { setInterval(pfStep, +process.env.PF_STEP_MS || 15000); setInterval(() => { if (PF.dirty) pfSave(false); }, 60e3);
    // the squads' top coins: logos and tickers from DEX Screener, now and every 15 minutes (each coin at most twice a day)
    pfCoinMeta().catch(() => {}); setInterval(() => pfCoinMeta().catch(() => {}), 15 * 60e3); });
  if (CFG.feed === "replay") startReplay(process.env.REPLAY_FILE || new URL("./replay.json", import.meta.url).pathname);
  else {
    setInterval(() => feedStep(), 1000);
    setInterval(() => gtStep(), 2500);
    setInterval(metaStep, 3000);
    // KOLs: the list now and twice a day, their transactions decoded as they arrive
    loadKols().then(n => log(n ? "info" : "warn", n ? `KOLs: ${n} wallets from ${KOL.stats.source}` : "KOLs off: " + KOL.stats.err));
    setInterval(() => loadKols().catch(() => {}), 12 * 3600e3);
    setInterval(() => kolStep(() => FEED.sol), 250);
    setInterval(() => kolPrune(keepSet(now())), 600e3);
    setInterval(kolHistStep, 5000);
    storeInit().then(() => log(STORE.on ? "info" : "warn", STORE.on ? "candle storage ready" : "candle storage off: " + STORE.err));
    setInterval(() => { if (!STORE.on) storeInit().then(() => { if (STORE.on) log("info", "candle storage ready"); }); }, 60000);   // picks up the table once it exists
    setInterval(loadStep, 700);
    setInterval(() => saveStep(false), 30000);
    setInterval(descStep, 1500);
    setInterval(sampleStep, 2000); sampleStep();
    rpcStart(() => {});
    // start the price stream for kept coins, up to four a second (board coins first)
    setInterval(() => {
      if (!RPC.live) return;
      const order = [...G.board.top, ...G.board.bench].map(x => x.m).concat([...keepSet(now())]);
      const next = [...new Set(order)].map(m => TL.get(m)).filter(tok => tok && !RPC.watched.has(tok.m) && tok.dex === "pumpswap" && tok.quote === "SOL").slice(0, 4);
      for (const tok of next) rpcWatch(tok).catch(e => log("warn", "rpc watch: " + e.message));
    }, 1000);
    setInterval(() => prune(keepSet(now())), 60000);
  }
  setInterval(engineStep, 1000);
  setInterval(() => opensSave().catch(() => {}), 60e3);
  setInterval(() => { const t = now(); for (const k of G.opens.keys()) { const r = roundOfKey(k.split("|")[0]); if (!r || t - r.e > 26 * 3600e3) G.opens.delete(k); } }, 600e3);
  if (MONEY.enabled) {
    setInterval(() => scanDeposits().catch(e => log("warn", "deposit scan: " + e.message)), 30000);
    setInterval(() => recoverWithdrawals().catch(e => log("warn", "withdrawal check: " + e.message)), 60000);
    recoverWithdrawals().catch(() => {}); scanDeposits().catch(() => {});
  }
  makeServer({ snapshot, health }).listen(CFG.port, () => log("info", `round server on :${CFG.port} (${CFG.feed} feed, ${DB.kind} storage, money ${CFG.realMoney ? CFG.network : "off"})`));
}
process.on("unhandledRejection", e => log("error", "unhandled: " + (e && e.stack || e)));
main();
