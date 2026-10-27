// Squads, proofs, chat and names, kept in memory and saved to the database.
// The site reads them as one document per person (members / proofs / posts), the same shape it already draws.
import { G } from "./game.js";
import { emit } from "./hub.js";

export const SOC = {
  people: new Map(),     // uid -> { name, avatar, handle }
  squads: new Map(),     // uid -> Map(mint -> joined ms)
  proofs: new Map(),     // proof id -> { id, uid, m, k, u, ts }
  marks: new Map(),      // proof id -> { v: Map(uid -> ts), f: Map(uid -> ts) }
  chat: []               // { id, uid, c, x, ts, sys }
};

export const betOut = b => ({ id: b.id, mk: b.mk, tf: b.tf, rs: b.rs, md: "L", rk: b.rk, m: b.m, s: b.s, w: b.w, ts: b.ts, st: b.st, q: b.q, pay: b.pay || 0, sp: b.sp ? 1 : 0, cur: b.cur, why: b.why || null });
export function betIn(row) {
  const sq = String(row.mint || "").startsWith("sq:");                       // a squad-race bet (see DB.placeBet)
  return { id: row.id, uid: row.user_id, rk: row.round_key, tf: row.tf, rs: +row.round_start, mk: sq ? "sq" : row.market, m: sq ? row.mint.slice(3) : row.mint, cur: row.currency, s: +row.stake, w: +row.weight, q: +row.quote || 0,
    st: row.status, pay: +row.payout || 0, why: row.why || null, sp: !!row.pass_used, ts: Date.parse(row.created_at) || Date.now() };
}
export function joinSquad(uid, m, ts) { let s = SOC.squads.get(uid); if (!s) SOC.squads.set(uid, s = new Map()); if (!s.has(m)) { s.set(m, ts || Date.now()); return true; } return false; }

export function memberDoc(uid) {
  const b = []; for (const x of G.bets.values()) if (x.uid === uid) b.push(x);
  b.sort((a, c) => c.ts - a.ts);
  const sq = {}; for (const [m, ts] of SOC.squads.get(uid) || []) sq[m] = ts;
  const p = SOC.people.get(uid);
  return { b: b.slice(0, 200).map(betOut), sq, h: (p && p.handle) || "" };
}
export function proofDoc(uid) {
  const p = [...SOC.proofs.values()].filter(x => x.uid === uid).sort((a, b) => b.ts - a.ts).slice(0, 200).map(x => ({ id: x.id, m: x.m, k: x.k, u: x.u, ts: x.ts }));
  const v = {}, f = {};
  for (const [pid, mk] of SOC.marks) { if (mk.v.has(uid)) v[pid] = mk.v.get(uid); if (mk.f.has(uid)) f[pid] = mk.f.get(uid); }
  return { p, v, f };
}
export function postDoc(uid) {
  return { ms: SOC.chat.filter(x => x.uid === uid).slice(-80).map(x => ({ id: x.id, c: x.c, x: x.x, ts: x.ts, sys: x.sys ? 1 : 0 })) };
}
export function allDocs() {
  const uids = new Set([...SOC.squads.keys()]); for (const b of G.bets.values()) uids.add(b.uid);
  const proofUids = new Set([...SOC.proofs.values()].map(p => p.uid)); for (const mk of SOC.marks.values()) { for (const u of mk.v.keys()) proofUids.add(u); for (const u of mk.f.keys()) proofUids.add(u); }
  const postUids = new Set(SOC.chat.map(c => c.uid));
  const members = {}, proofs = {}, posts = {};
  for (const u of uids) members[u] = memberDoc(u);
  for (const u of proofUids) proofs[u] = proofDoc(u);
  for (const u of postUids) posts[u] = postDoc(u);
  return { members, proofs, posts };
}
export function peopleOut(ids) {
  const o = {}; for (const id of ids || SOC.people.keys()) { const p = SOC.people.get(id); if (p) o[id] = { name: p.name || "Player", avatarUrl: p.avatar || null }; }
  return o;
}
export const pushDoc = (coll, uid) => emit("doc", { coll, id: uid, data: coll === "members" ? memberDoc(uid) : coll === "proofs" ? proofDoc(uid) : postDoc(uid) });
export function setPerson(uid, p) { const cur = SOC.people.get(uid) || {}; const nx = { ...cur, ...p }; SOC.people.set(uid, nx); if (cur.name !== nx.name || cur.avatar !== nx.avatar) emit("people", { [uid]: { name: nx.name || "Player", avatarUrl: nx.avatar || null } }); }
