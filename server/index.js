// Squad Arena round server. Runs 24/7 (Railway): watches the coins, opens and scores every round, takes bets,
// pays out, and streams the arena to every open page.
import { CFG, TF, TFK, MKS, CURRENCIES, checkConfig } from "./lib/config.js";
import { log, now } from "./lib/util.js";
import { DB } from "./lib/db.js";
import { TL, FEED, RPC, jobPrices, jobValidate, jobDiscover, jobDiscoverDS, jobBackfill, samplePools, chartC, prune, rpcStart, rpcWatch, pumpOff } from "./lib/market.js";
import { G, roundAt, roundOfKey, refreshBoard, ensureFields, lcs, lcsJSON, lcsFromJSON, resultOf, decide, roundsWithOpenBets, indexBet, roundState } from "./lib/game.js";
import { SOC, betIn, joinSquad, pushDoc, allDocs, peopleOut } from "./lib/social.js";
import { emit, online } from "./lib/hub.js";
import { makeServer } from "./lib/api.js";
import { initMoney, moneyInfo, scanDeposits, recoverWithdrawals, MONEY } from "./lib/money.js";
import { startReplay } from "./lib/replay.js";

const STARTED = now();
const r6 = v => v == null ? null : +(+v).toPrecision(7);
const candleOut = c => [c.t, r6(c.o), r6(c.h), r6(c.l), r6(c.c), Math.round(c.v || 0)];
function tokOut(tok, full = true) {
  const o = { m: tok.m, s: tok.s, n: tok.n, born: tok.born, supply: tok.supply, px: r6(tok.px), mc: tok.mc, liq: tok.liq, vol: tok.vol, tx: tok.tx, bs: tok.bs, ch: tok.ch,
    pool: tok.pool, dex: tok.dex, quote: tok.quote, pa: tok.pa, x: tok.x, tg: tok.tg, dc: tok.dc, w: tok.w, ds: (tok.ds || "").slice(0, 360), logo: tok.logo,
    gate: tok.gate, rugAt: tok.rugAt, rugWhy: tok.rugWhy, rpc: !!tok.rpcAt };
  if (full) {
    const t = now();
    o.C = chartC(tok, false, t).slice(-150).map(candleOut);
    o.C5 = chartC(tok, true, t).filter(c => c.t >= t - 26 * 3600e3).map(candleOut);
    o.ticks = tok.ticks.filter(k => k.t >= t - 20 * 60e3).map(k => [k.t, r6(k.p)]);
  }
  return o;
}
// coins the site needs: the board, everything in a running round's field, and coins with open bets
function keepSet(t) {
  const keep = new Set([...G.board.top, ...G.board.bench].map(x => x.m));
  for (const tfk of TFK) { const f = G.fields.get(roundAt(tfk, t).key); if (f) { f.top.forEach(m => keep.add(m)); f.bench.forEach(m => keep.add(m)); } }
  for (const b of G.bets.values()) if (b.st === "open") keep.add(b.m);
  // coins with a squad, most recently joined first
  [...G.followed].sort((a, b) => b[1] - a[1]).slice(0, 300).forEach(([m]) => keep.add(m));
  // coins someone has open on a coin page right now
  for (const [m, at] of FEED.viewed) { if (t - at < 600e3) keep.add(m); else FEED.viewed.delete(m); }
  return keep;
}
function snapshot() {
  const t = now(), keep = keepSet(t);
  const rounds = {}, results = {};
  for (const tfk of TFK) for (const k of [0, 1]) {
    const r = roundAt(tfk, t - k * TF[tfk].W), st = roundState(r, t); if (st) rounds[r.key] = st;
    for (const mk of MKS) { const res = G.results.get(r.key + "|" + mk); if (res) results[r.key + "|" + mk] = res; }
  }
  return {
    v: 1, now: t, started: STARTED,
    cfg: { rake: CFG.rake, seed: CFG.seed, betWindow: CFG.betWindow, minStake: CFG.minStake, maxStake: CFG.maxStake, currencies: CURRENCIES(), startBalance: CFG.startBalance, money: moneyInfo(), rpc: RPC.live },
    board: { top: G.board.top.map(x => x.m), bench: G.board.bench.map(x => x.m) },
    tokens: [...keep].map(m => TL.get(m)).filter(Boolean).map(tok => tokOut(tok)),
    rounds, results, docs: allDocs(), people: peopleOut()
  };
}
function health() {
  return { ok: true, time: now(), up: Math.round((now() - STARTED) / 1000), feed: CFG.feed, coins: TL.size, board: G.board.top.length, rpc: RPC.live, rpcCoins: RPC.watched.size,
    db: DB.kind, money: moneyInfo(), treasurySol: MONEY.treasuryLamports == null ? null : MONEY.treasuryLamports / 1e9, calls: FEED.calls, errors: FEED.errs, lastError: FEED.lastErr || null, lastPrice: FEED.lastPrice,
    discovery: { pools: FEED.sample.pools, fresh: FEED.sample.fresh, ago: FEED.sample.at ? Math.round((now() - FEED.sample.at) / 1000) : null, err: FEED.sample.err, pending: FEED.pending.length, pumpfun: !pumpOff() },
    charts: { withHistory: [...TL.values()].filter(x => x.C.length > 1).length, backfilled: FEED.backfilled, backfill: CFG.gtBackfill } };
}

/* ---------- live stream batching ---------- */
const tickBuf = new Map(); let metaDirty = new Set(), sentTok = new Set();
FEED.onTick = (tok, t, p) => { tickBuf.set(tok.m, [tok.m, t, r6(p)]); };
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
setInterval(() => {
  if (!tickBuf.size) return;
  const keep = keepSet(now()), list = [...tickBuf.values()].filter(x => keep.has(x[0])); tickBuf.clear();
  if (list.length) emit("tick", list);
}, 1000);
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
// background chart history for coins on the board (then on deck, then everything else kept), one GeckoTerminal call at a time
async function gtStep() {
  if (gtBusy || !CFG.gtBackfill || now() < FEED.gtPauseUntil) return; gtBusy = true;
  try {
    const order = [...G.board.top, ...G.board.bench].map(x => x.m).concat([...keepSet(now())]);
    const tok = order.map(m => TL.get(m)).find(x => x && x.pool && (!x.histAt || !x.hist5At));
    if (tok) await jobBackfill(tok);
  } catch (e) { if (e.status === 429) FEED.gtPauseUntil = now() + 120e3; }
  finally { gtBusy = false; }
}
function engineStep() {
  const t = now();
  refreshBoard(t);
  ensureFields(t);
  for (const tfk of TFK) lcs(roundAt(tfk, t), t);
  settleTick(t).catch(e => log("error", "settle: " + e.message));
}

async function loadState() {
  const t = now(), since = t - 26 * 3600e3;
  for (const r of await DB.loadRounds(since)) {
    // a round that was still running when the server restarted lost its prices from before the restart, so it isn't
    // scored (its bets are refunded) unless its results were already saved
    const R = roundOfKey(r.key), saved = r.settled_at || (r.results && Object.keys(r.results).length);
    const cut = !saved && R && R.s < t && !CFG.scoreLate;
    G.fields.set(r.key, { top: r.field_top || [], bench: r.field_bench || [], live: !!r.live && !cut, at: Date.parse(r.created_at) || t });
    if (r.lcs) G.lcs.set(r.key, lcsFromJSON(r.lcs));
    if (r.results) for (const [mk, res] of Object.entries(r.results)) G.results.set(r.key + "|" + mk, res);
    if (r.settled_at) G.settled.add(r.key);
  }
  for (const row of await DB.loadBets(since)) indexBet(betIn(row));
  for (const s of await DB.loadSquads()) { const ts = Date.parse(s.joined_at); joinSquad(s.user_id, s.mint, ts); G.followed.set(s.mint, Math.max(G.followed.get(s.mint) || 0, ts)); }
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
  if (CFG.feed === "replay") startReplay(process.env.REPLAY_FILE || new URL("./replay.json", import.meta.url).pathname);
  else {
    setInterval(() => feedStep(), 1000);
    setInterval(() => gtStep(), 4000);
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
