// pump.fun squads (the Squad Invitational): pump.fun's squad leaderboard, mirrored.
// pump.fun answers servers with a bot check, so the squads and their members are copied once from pump.fun's own
// leaderboard in a browser and uploaded here (POST /admin/pf-copy). Squads are locked for the whole competition.
// From then on each squad is tracked live: every member wallet's profit comes from Solana Tracker (on-chain trades
// and prices), and a squad's score is pump.fun's score at the copy plus the change since. pump.fun applies rules this
// can't see (only trades made on pump.fun count, a member's own coins don't), so it can drift slightly from theirs.
import crypto from "node:crypto";
import zlib from "node:zlib";
import { CFG } from "./config.js";
import { DB } from "./db.js";
import { getJSON, log, isAddress, now } from "./util.js";

const ADMIN_HASH = "c665fd97550f44af6fed9d2bf94d676eb01849e66af1c16f17ab244427fe96cb";   // sha256 of the upload token (the token isn't in the code)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PF = {
  comp: null,                // { id, title, startsAt, endsAt, prize, prizes: [[from, to, amount]], entries, img }
  at: 0,                     // when the copy was taken
  squads: new Map(),         // id -> squad as copied: { id, rank0, name, img, x, n, pnl0, r0, u0, sol, positions, top, members }
  base: new Map(),           // wallet -> [total, realized, unrealized] from Solana Tracker when tracking started
  cur: new Map(),            // wallet -> [total, realized, unrealized, at]
  live: new Map(),           // id -> { pnl, r, u, at } the squad's score now
  series: new Map(),         // id -> [[t, pnl]]
  next: new Map(),           // wallet -> when it is due again
  fields: new Map(),         // round key -> { ids, at }: the squads racing in that round (the 15 leading at its open)
  dirty: false,              // tracking moved since the last save
  stats: { calls: 0, ok: 0, failed: 0, err: "", lastAt: 0, wallets: 0, tracked: 0, sample: null, pauseUntil: 0, saved: 0 },
  onUpdate: null             // (list of [id, pnl, r, u]) after each refresh
};
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const num = v => (Number.isFinite(+v) ? +v : 0);
const httpsUrl = v => /^https:\/\/[^\s"'<>]+$/.test(String(v || "")) ? String(v).slice(0, 400) : null;

/* ---------- the copy ---------- */
function cleanCopy(j) {
  const c = j && j.comp, list = j && j.squads;
  if (!c || !UUID.test(c.id || "") || !Array.isArray(list) || !list.length || list.length > 300) throw new Error("not a squad copy");
  const squads = [];
  for (const s of list) {
    if (!s || !UUID.test(s.id || "") || !Array.isArray(s.members)) continue;
    const members = s.members.slice(0, 25).filter(m => m && isAddress(m.w)).map(m => ({ w: m.w, u: str(m.u, 40), img: httpsUrl(m.img), x: str(m.x, 40).replace(/[^A-Za-z0-9_]/g, "") || null,
      pnl0: num(m.pnl), r0: num(m.r), u0: num(m.un) }));
    squads.push({ id: s.id, rank0: num(s.rank), name: str(s.name, 40) || "Squad", img: httpsUrl(s.img), x: str(s.x, 40).replace(/[^A-Za-z0-9_]/g, "") || null,
      n: num(s.n) || members.length, pnl0: num(s.pnl), r0: num(s.r), u0: num(s.un), sol: num(s.sol), positions: num(s.positions),
      top: (Array.isArray(s.top) ? s.top : []).slice(0, 8).map(p => ({ m: str(p.m, 60), s: str(p.s, 20), n: str(p.n, 40), img: httpsUrl(p.img), chain: num(p.chain) })), members });
  }
  if (!squads.length) throw new Error("no squads in the copy");
  return { comp: { id: c.id, title: str(c.title, 80), startsAt: Date.parse(c.startsAt) || 0, endsAt: Date.parse(c.endsAt) || 0, prize: num(c.prize),
    prizes: (Array.isArray(c.prizes) ? c.prizes : []).slice(0, 10).map(p => [num(p.rankFrom), num(p.rankTo), num(p.amount)]), entries: num(c.entries), img: httpsUrl(c.img) },
    at: num(j.at) || now(), squads };
}
function useCopy(c, keepBase) {
  PF.comp = c.comp; PF.at = c.at; PF.squads = new Map(c.squads.map(s => [s.id, s]));
  if (!keepBase) { PF.base.clear(); PF.cur.clear(); PF.series.clear(); PF.fields.clear(); }
  PF.next.clear(); recompute();
}
export async function pfIngest(req, res, send) {
  const body = await new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > 4e6) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString())); req.on("error", reject);
  });
  let j; try { j = JSON.parse(body); } catch (_) { return send(400, { error: "Bad JSON." }); }
  const tok = String(j.token || ""), h = crypto.createHash("sha256").update(tok).digest("hex");
  if (!tok || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(ADMIN_HASH))) return send(403, { error: "Not allowed." });
  let c; try { c = cleanCopy(j.data); } catch (e) { return send(400, { error: e.message }); }
  useCopy(c, false);
  log("info", `pump.fun squads: copy of ${c.squads.length} squads, ${[...PF.squads.values()].reduce((a, s) => a + s.members.length, 0)} members (${c.comp.title})`);
  await pfSave(true);
  return send(200, { ok: true, squads: c.squads.length });
}

/* ---------- live tracking through Solana Tracker ---------- */
// a wallet summary's profit in USD: [total, realized, unrealized]
function pnlOf(x) {
  const s = (x && (x.summary || x)) || {}, p = s.pnl || s.profit || {};
  const pick = (...v) => { for (const a of v) if (Number.isFinite(+a) && a !== null && a !== "") return +a; return null; };
  const r = pick(p.realized, p.realizedUsd, s.realized, s.realizedPnl, s.realized_pnl);
  const u = pick(p.unrealized, p.unrealizedUsd, s.unrealized, s.unrealizedPnl, s.unrealized_pnl);
  const t = pick(p.total, p.totalUsd, s.total, s.totalPnl, s.total_pnl, r != null && u != null ? r + u : null);
  return t == null ? null : [t, r ?? 0, u ?? 0];
}
// the shape of one answer, for /health (keys and number types only)
const shape = (o, d = 0) => !o || typeof o !== "object" || d > 3 ? typeof o : Object.fromEntries(Object.entries(o).slice(0, 14).map(([k, v]) => [k, shape(v, d + 1)]));
function due(t) {
  // the 15 leading squads every PF_FAST seconds, the rest every PF_SLOW seconds
  const order = [...PF.live.entries()].sort((a, b) => b[1].pnl - a[1].pnl).map(([id]) => id), fast = new Set(order.slice(0, 15));
  const out = [];
  for (const [id, s] of PF.squads) {
    const every = (fast.has(id) ? CFG.pfFast : CFG.pfSlow) * 1000;
    for (const m of s.members) if ((PF.next.get(m.w) || 0) <= t) out.push([m.w, every]);
  }
  return out;
}
export async function pfStep() {
  if (!PF.squads.size || !CFG.solanaTrackerKey || now() < PF.stats.pauseUntil) return;
  const t = now(), list = due(t).slice(0, 100); if (!list.length) return;
  for (const [w, every] of list) PF.next.set(w, t + every);
  PF.stats.calls++;
  try {
    const j = await getJSON("https://data.solanatracker.io/v2/pnl/wallets/batch", { method: "POST", headers: { "x-api-key": CFG.solanaTrackerKey, "content-type": "application/json" },
      body: JSON.stringify({ wallets: list.map(x => x[0]) }), timeout: 20000 });
    const arr = Array.isArray(j) ? j : (j && (j.wallets || j.data || j.results || j.items)) || [];
    if (!PF.stats.sample && arr[0]) PF.stats.sample = shape(arr[0]);
    let got = 0;
    for (const x of arr) {
      const w = x && (x.wallet || x.address || x.owner); if (!w) continue;
      const v = pnlOf(x); if (!v) continue;
      got++; PF.cur.set(w, [...v, t]); if (!PF.base.has(w)) PF.base.set(w, v);
    }
    PF.stats.ok++; PF.stats.err = got ? "" : "no profit figures in the answer"; PF.stats.lastAt = t;
    recompute(t);
  } catch (e) {
    PF.stats.failed++; PF.stats.err = String(e.message || e).slice(0, 200);
    for (const [w] of list) PF.next.set(w, t + 60000);                                   // try those wallets again in a minute
    if ([401, 402, 403, 429].includes(e.status)) PF.stats.pauseUntil = t + 10 * 60e3;
  }
}
// a squad's score: pump.fun's at the copy plus each member's change since tracking started
function recompute(t = now()) {
  const upd = [];
  for (const [id, s] of PF.squads) {
    let d = 0, dr = 0, du = 0, seen = 0;
    for (const m of s.members) { const b = PF.base.get(m.w), c = PF.cur.get(m.w); if (b && c) { d += c[0] - b[0]; dr += c[1] - b[1]; du += c[2] - b[2]; seen++; } }
    const v = { pnl: s.pnl0 + d, r: s.r0 + dr, u: s.u0 + du, at: seen ? t : PF.at, seen };
    const old = PF.live.get(id); PF.live.set(id, v);
    if (!old || Math.abs(old.pnl - v.pnl) > 0.005 || !PF.series.has(id)) {
      let ser = PF.series.get(id); if (!ser) PF.series.set(id, ser = [[PF.at, s.pnl0]]);
      const last = ser[ser.length - 1];
      if (t - last[0] < 20000) last[1] = v.pnl; else ser.push([t, +v.pnl.toFixed(2)]);
      const cut = t - 8 * 86400e3; while (ser.length > 2 && ser[1][0] < cut) ser.shift();
      upd.push([id, +v.pnl.toFixed(2), +v.r.toFixed(2), +v.u.toFixed(2)]);
    }
  }
  PF.stats.wallets = PF.cur.size; PF.stats.tracked = [...PF.live.values()].filter(v => v.seen).length;
  if (upd.length) PF.dirty = true;
  if (upd.length && PF.onUpdate) PF.onUpdate(upd, t);
}
// the score at time t (the last known point at or before t)
export function pfAt(id, t) {
  const ser = PF.series.get(id); if (!ser || !ser.length || ser[0][0] > t) return null;
  let lo = 0, hi = ser.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ser[m][0] <= t) lo = m; else hi = m - 1; }
  return ser[lo][1];
}
// a round's squad race: the 15 leading squads by score at the round's open. Fixed the first time it's asked for and kept
// with the tracking, so a server restart keeps the same race (and its bets). Needs tracking from before the open.
export function pfField(r) {
  const have = PF.fields.get(r.key); if (have) return have.ids;
  if (!PF.squads.size || !PF.at || PF.at > r.s || now() < r.s) return null;
  const ids = [...PF.squads.keys()].map(id => ({ id, v: pfAt(id, r.s) })).filter(x => x.v != null)
    .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1)).slice(0, 15).map(x => x.id);
  if (ids.length < 2) return null;
  PF.fields.set(r.key, { ids, at: now() }); PF.dirty = true;
  for (const [k, f] of PF.fields) if (now() - f.at > 3 * 86400e3) PF.fields.delete(k);
  return ids;
}
export const pfFieldIds = key => (PF.fields.get(key) || {}).ids || null;
export const pfRanked = () => [...PF.squads.values()].map(s => ({ s, v: PF.live.get(s.id) || { pnl: s.pnl0, r: s.r0, u: s.u0 } })).sort((a, b) => b.v.pnl - a.v.pnl);
export const pfTop = n => pfRanked().slice(0, n).map(x => x.s.id);

/* ---------- what pages see ---------- */
// a squad's history for a page: every point from the last few hours (rounds are scored on those), older history
// thinned to about 300 points (the last one in each slice of time)
function thinFor(ser, cut, t) {
  const fine = t - 2.5 * 3600e3, step = Math.max(1, (fine - cut) / 300), out = []; let lastB = null;
  for (let i = 0; i < ser.length; i++) {
    const p = ser[i]; if (p[0] < cut && !(ser[i + 1] && ser[i + 1][0] >= cut)) continue;
    if (p[0] >= fine || !out.length) { out.push(p); lastB = null; continue; }
    const b = Math.floor((p[0] - cut) / step); if (b === lastB) out[out.length - 1] = p; else { out.push(p); lastB = b; }
  }
  return out;
}
export function pfList(since) {
  if (!PF.squads.size) return { on: false };
  const ranked = pfRanked(), cut = Math.max(0, +since || 0), fieldIds = new Set(ranked.slice(0, 25).map(x => x.s.id));
  return { on: true, comp: PF.comp, at: PF.at, tracked: PF.stats.lastAt,
    squads: ranked.map((x, i) => ({ id: x.s.id, rank: i + 1, rank0: x.s.rank0, name: x.s.name, img: x.s.img, n: x.s.n, pnl: +x.v.pnl.toFixed(2), r: +x.v.r.toFixed(2), u: +x.v.u.toFixed(2),
      top: x.s.top.slice(0, 3).map(p => ({ s: p.s, img: p.img })) })),
    series: cut ? Object.fromEntries([...fieldIds].map(id => [id, thinFor(PF.series.get(id) || [], cut, now())])) : {} };
}
export function pfSquad(id, since) {
  const s = PF.squads.get(id); if (!s) return null;
  const v = PF.live.get(id) || { pnl: s.pnl0, r: s.r0, u: s.u0 }, rank = pfRanked().findIndex(x => x.s.id === id) + 1, cut = Math.max(0, +since || 0);
  const members = s.members.map(m => { const b = PF.base.get(m.w), c = PF.cur.get(m.w), d = b && c ? [c[0] - b[0], c[1] - b[1], c[2] - b[2]] : [0, 0, 0];
    return { w: m.w, u: m.u, img: m.img, x: m.x, pnl: +(m.pnl0 + d[0]).toFixed(2), r: +(m.r0 + d[1]).toFixed(2), un: +(m.u0 + d[2]).toFixed(2) }; }).sort((a, b) => b.pnl - a.pnl);
  return { id, rank, rank0: s.rank0, name: s.name, img: s.img, x: s.x, n: s.n, pnl: +v.pnl.toFixed(2), r: +v.r.toFixed(2), u: +v.u.toFixed(2), sol: s.sol, positions: s.positions,
    top: s.top, members, comp: PF.comp, at: PF.at, tracked: PF.stats.lastAt, series: thinFor(PF.series.get(id) || [], cut, now()) };
}
export const pfHealth = () => ({ on: PF.squads.size > 0, squads: PF.squads.size, members: [...PF.squads.values()].reduce((a, s) => a + s.members.length, 0), copiedAt: PF.at, ...PF.stats,
  pausedFor: Math.max(0, Math.round((PF.stats.pauseUntil - now()) / 1000)) });

/* ---------- kept in the database, so a restart keeps the copy and the tracking base ---------- */
const gz = o => zlib.gzipSync(JSON.stringify(o)).toString("base64"), ungz = s => JSON.parse(zlib.gunzipSync(Buffer.from(s, "base64")).toString());
// rows in the candles table keyed "pf:copy" / "pf:track" (the table holds one text value per key)
async function kvPut(k, v) { await DB.req("candles?on_conflict=mint", { method: "POST", body: { mint: k, data: JSON.stringify(v), updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" }); }
async function kvGet(k) { const r = await DB.req(`candles?mint=eq.${encodeURIComponent(k)}&select=data`); return r && r[0] ? JSON.parse(r[0].data) : null; }
export async function pfSave(withCopy) {
  if (DB.kind !== "supabase" || !PF.squads.size) return;
  try {
    if (withCopy) await kvPut("pf:copy", { gz: gz({ comp: PF.comp, at: PF.at, squads: [...PF.squads.values()] }) });
    const keepAll = now() - 30 * 3600e3, thin = s => { let last = -Infinity; return s.filter((p, i) => { if (i === 0 || i === s.length - 1 || p[0] >= keepAll || p[0] - last >= 3600e3) { last = p[0]; return true; } return false; }); };
    PF.dirty = false;
    await kvPut("pf:track", { gz: gz({ at: PF.at, base: [...PF.base], cur: [...PF.cur], series: [...PF.series].map(([id, s]) => [id, thin(s)]), fields: [...PF.fields] }) });
    PF.stats.saved++; PF.stats.savedAt = now();
  } catch (e) { PF.stats.err = "save: " + String(e.message).slice(0, 160); }
}
export async function pfLoad() {
  if (DB.kind !== "supabase") return;
  try {
    const c = await kvGet("pf:copy"); if (!c || !c.gz) return;
    useCopy(ungz(c.gz), false);
    const tr = await kvGet("pf:track");
    if (tr && tr.gz) { const t = ungz(tr.gz); if (t.at === PF.at) { PF.base = new Map(t.base); PF.cur = new Map(t.cur); PF.series = new Map(t.series); PF.fields = new Map(t.fields || []); recompute(); } }
    log("info", `pump.fun squads: ${PF.squads.size} squads loaded`);
  } catch (e) { PF.stats.err = "load: " + String(e.message).slice(0, 160); }
}
