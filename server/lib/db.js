// Storage. Supabase (Postgres over its REST API, secret key, server only) or an in-memory stand-in for local tests.
import crypto from "node:crypto";
import { CFG } from "./config.js";
import { getJSON } from "./util.js";

const enc = v => encodeURIComponent(v);
const iso = ms => new Date(ms).toISOString();

class SupaDB {
  constructor(url, key) { this.base = url + "/rest/v1/"; this.key = key; this.kind = "supabase"; }
  async req(path, { method = "GET", body, prefer } = {}) {
    const headers = { apikey: this.key, "content-type": "application/json" };
    if (/^eyJ/.test(this.key)) headers.authorization = "Bearer " + this.key;   // older service_role keys are JWTs
    if (prefer) headers.prefer = prefer;
    try { return await getJSON(this.base + path, { method, headers, body: body == null ? undefined : JSON.stringify(body), timeout: 12000 }); }
    catch (e) { let msg = e.message; try { const j = JSON.parse(e.body || ""); msg = j.message || msg; e.code = j.code; } catch (_) {} e.message = msg; throw e; }
  }
  rpc(fn, args) { return this.req("rpc/" + fn, { method: "POST", body: args }); }
  async one(path) { const r = await this.req(path); return Array.isArray(r) ? r[0] || null : r; }

  getProfile(id) { return this.one(`profiles?id=eq.${enc(id)}&select=*`); }
  async ensureProfile(p) { const r = await this.req("profiles?on_conflict=id", { method: "POST", body: { ...p, seen_at: iso(Date.now()) }, prefer: "resolution=merge-duplicates,return=representation" }); return r[0]; }
  setHandle(id, handle) { return this.req(`profiles?id=eq.${enc(id)}`, { method: "PATCH", body: { handle }, prefer: "return=minimal" }); }
  profilesByIds(ids) { return ids.length ? this.req(`profiles?id=in.(${ids.map(i => '"' + i.replace(/"/g, "") + '"').join(",")})&select=id,name,avatar,handle`) : []; }
  topup(id) { return this.rpc("topup_practice", { p_user: id }); }

  placeBet(a) { return this.rpc("place_bet", { p_user: a.uid, p_round: a.rk, p_tf: a.tf, p_round_start: a.rs, p_market: a.mk, p_mint: a.m, p_currency: a.cur, p_stake: a.s, p_weight: a.w, p_quote: a.q }); }
  settleBet(id, status, payout, why, receipt) { return this.rpc("settle_bet", { p_bet: id, p_status: status, p_payout: payout, p_why: why, p_receipt: receipt || null }); }
  usePass(id, uid, mint) { return this.rpc("use_streak_pass", { p_bet: id, p_user: uid, p_mint: mint }); }
  loadBets(sinceMs) { return this.req(`bets?or=(status.eq.open,created_at.gte.${enc('"' + iso(sinceMs) + '"')})&select=*&order=created_at.asc&limit=20000`); }
  loadSquads() { return this.req("squad_members?select=*&limit=50000"); }

  upsertRound(r) { return this.req("rounds?on_conflict=key", { method: "POST", body: r, prefer: "resolution=ignore-duplicates,return=minimal" }); }
  updateRound(key, patch) { return this.req(`rounds?key=eq.${enc(key)}`, { method: "PATCH", body: patch, prefer: "return=minimal" }); }
  loadRounds(sinceMs) { return this.req(`rounds?ends_at=gte.${enc(iso(sinceMs))}&select=*&limit=2000`); }

  async insertProof(p) { const r = await this.req("proofs", { method: "POST", body: p, prefer: "return=representation" }); return r[0]; }
  loadProofs(sinceMs) { return this.req(`proofs?created_at=gte.${enc(iso(sinceMs))}&select=*&order=created_at.desc&limit=5000`); }
  loadMarks() { return this.req("proof_marks?select=*&limit=50000"); }
  async toggleMark(proofId, uid, kind) {
    const q = `proof_marks?proof_id=eq.${enc(proofId)}&user_id=eq.${enc(uid)}&kind=eq.${kind}`;
    const ex = await this.req(q + "&select=proof_id");
    if (ex.length) { await this.req(q, { method: "DELETE", prefer: "return=minimal" }); return false; }
    await this.req("proof_marks", { method: "POST", body: { proof_id: proofId, user_id: uid, kind }, prefer: "return=minimal" }); return true;
  }
  async insertChat(c) { const r = await this.req("chat", { method: "POST", body: c, prefer: "return=representation" }); return r[0]; }
  loadChat(sinceMs) { return this.req(`chat?created_at=gte.${enc(iso(sinceMs))}&select=*&order=created_at.desc&limit=3000`); }

  creditDeposit(uid, sig, network, from, lamports) { return this.rpc("credit_deposit", { p_user: uid, p_sig: sig, p_network: network, p_from: from, p_lamports: lamports }); }
  requestWithdrawal(uid, network, to, lamports) { return this.rpc("request_withdrawal", { p_user: uid, p_network: network, p_to: to, p_lamports: lamports }); }
  finishWithdrawal(id, status, sig, error) { return this.rpc("finish_withdrawal", { p_id: id, p_status: status, p_sig: sig || null, p_error: error || null }); }
  markSent(id, sig) { return this.req(`withdrawals?id=eq.${enc(id)}&status=eq.pending`, { method: "PATCH", body: { status: "sent", sig, updated_at: iso(Date.now()) }, prefer: "return=minimal" }); }
  async withdrawnToday(uid) { const r = await this.req(`withdrawals?user_id=eq.${enc(uid)}&status=neq.failed&created_at=gte.${enc(iso(Date.now() - 86400e3))}&select=lamports`); return r.reduce((a, x) => a + +x.lamports, 0); }
  openWithdrawals() { return this.req("withdrawals?status=in.(pending,sent)&select=*"); }
  async moneyOf(uid) {
    const [d, w] = await Promise.all([this.req(`deposits?user_id=eq.${enc(uid)}&select=*&order=created_at.desc&limit=20`), this.req(`withdrawals?user_id=eq.${enc(uid)}&select=*&order=created_at.desc&limit=20`)]);
    return { deposits: d, withdrawals: w };
  }
  knownDeposit(sig) { return this.one(`deposits?sig=eq.${enc(sig)}&select=sig`); }
  profilesByWallet(addr) { return this.req(`profiles?wallets=cs.{${enc(addr)}}&select=id,wallets`); }
}

/* ---------- in-memory stand-in with the same behaviour as the SQL functions ---------- */
class MemDB {
  constructor() { this.kind = "memory"; this.p = new Map(); this.bets = new Map(); this.sq = new Map(); this.rounds = new Map(); this.proofs = new Map(); this.marks = new Set(); this.chat = []; this.dep = new Map(); this.wd = new Map(); this.ledger = []; this.cid = 0; }
  bal(uid, cur, amt, kind, ref) {
    const p = this.p.get(uid); const col = cur === "tSOL" ? "bal_tsol" : "bal_sol";
    if (!p || p[col] + amt < -1e-12) { const e = new Error("insufficient balance"); e.code = "P0001"; throw e; }
    if (ref && this.ledger.some(l => l.kind === kind && l.ref === ref)) { const e = new Error("duplicate ledger ref"); e.code = "23505"; throw e; }
    p[col] = +(p[col] + amt).toFixed(9); this.ledger.push({ uid, cur, amt, kind, ref }); return p[col];
  }
  async getProfile(id) { return this.p.get(id) || null; }
  async ensureProfile(p) { const cur = this.p.get(p.id) || { id: p.id, bal_tsol: CFG.startBalance, bal_sol: 0, topup_at: null, handle: null, created_at: new Date().toISOString() }; Object.assign(cur, p); this.p.set(p.id, cur); return cur; }
  async setHandle(id, handle) { const p = this.p.get(id); if (p) p.handle = handle; }
  async profilesByIds(ids) { return ids.map(i => this.p.get(i)).filter(Boolean).map(p => ({ id: p.id, name: p.name, avatar: p.avatar, handle: p.handle })); }
  async topup(id) { const p = this.p.get(id); if (!p || p.bal_tsol >= 5 || (p.topup_at && Date.now() - p.topup_at < 86400e3)) return null; p.topup_at = Date.now(); return this.bal(id, "tSOL", 25 - p.bal_tsol, "topup", id + ":" + new Date().toISOString().slice(0, 10)); }
  async placeBet(a) {
    const b = { id: crypto.randomUUID(), user_id: a.uid, round_key: a.rk, tf: a.tf, round_start: a.rs, market: a.mk, mint: a.m, currency: a.cur, stake: a.s, weight: a.w, quote: a.q, status: "open", payout: 0, why: null, pass_used: false, receipt: null, created_at: new Date().toISOString(), settled_at: null };
    this.bal(a.uid, a.cur, -a.s, "bet", b.id); this.bets.set(b.id, b);
    const k = a.uid + "|" + a.m; if (!this.sq.has(k)) this.sq.set(k, { user_id: a.uid, mint: a.m, joined_at: b.created_at });
    return b;
  }
  async settleBet(id, status, payout, why, receipt) {
    const b = this.bets.get(id); if (!b || b.status !== "open") return null;
    Object.assign(b, { status, payout: status === "won" ? payout : 0, why, receipt, settled_at: new Date().toISOString() });
    const credit = status === "won" ? payout : status === "refund" ? b.stake : 0;
    if (credit > 0) this.bal(b.user_id, b.currency, credit, status === "won" ? "payout" : "refund", b.id);
    return b;
  }
  async usePass(id, uid, mint) { const b = this.bets.get(id); if (!b || b.user_id !== uid || b.status !== "open" || b.market !== "lcs" || b.pass_used) return null; b.mint = mint; b.pass_used = true; const k = uid + "|" + mint; if (!this.sq.has(k)) this.sq.set(k, { user_id: uid, mint, joined_at: new Date().toISOString() }); return b; }
  async loadBets(sinceMs) { return [...this.bets.values()].filter(b => b.status === "open" || Date.parse(b.created_at) >= sinceMs); }
  async loadSquads() { return [...this.sq.values()]; }
  async upsertRound(r) { if (!this.rounds.has(r.key)) this.rounds.set(r.key, { ...r }); }
  async updateRound(key, patch) { const r = this.rounds.get(key); if (r) Object.assign(r, patch); }
  async loadRounds(sinceMs) { return [...this.rounds.values()].filter(r => Date.parse(r.ends_at) >= sinceMs); }
  async insertProof(p) {
    if ([...this.proofs.values()].some(x => x.url === p.url)) { const e = new Error("duplicate key value violates unique constraint \"proofs_url_key\""); e.code = "23505"; throw e; }
    if ([...this.proofs.values()].some(x => x.user_id === p.user_id && x.mint === p.mint && x.task === p.task)) { const e = new Error("duplicate key value violates unique constraint"); e.code = "23505"; throw e; }
    const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...p }; this.proofs.set(row.id, row); return row;
  }
  async loadProofs(sinceMs) { return [...this.proofs.values()].filter(p => Date.parse(p.created_at) >= sinceMs); }
  async loadMarks() { return [...this.marks].map(k => { const [proof_id, user_id, kind] = k.split("|"); return { proof_id, user_id, kind }; }); }
  async toggleMark(pid, uid, kind) { const k = pid + "|" + uid + "|" + kind; if (this.marks.has(k)) { this.marks.delete(k); return false; } this.marks.add(k); return true; }
  async insertChat(c) { const row = { id: ++this.cid, created_at: new Date().toISOString(), ...c }; this.chat.push(row); return row; }
  async loadChat(sinceMs) { return this.chat.filter(c => Date.parse(c.created_at) >= sinceMs).reverse(); }
  async creditDeposit(uid, sig, network, from, lamports) { if (this.dep.has(sig)) return null; this.dep.set(sig, { sig, user_id: uid, network, from_addr: from, lamports, created_at: new Date().toISOString() }); return this.bal(uid, "SOL", lamports / 1e9, "deposit", sig); }
  async requestWithdrawal(uid, network, to, lamports) { const w = { id: crypto.randomUUID(), user_id: uid, network, to_addr: to, lamports, status: "pending", sig: null, error: null, created_at: new Date().toISOString() }; this.bal(uid, "SOL", -lamports / 1e9, "withdraw", w.id); this.wd.set(w.id, w); return w; }
  async finishWithdrawal(id, status, sig, error) { const w = this.wd.get(id); if (!w || !["pending", "sent"].includes(w.status)) return null; Object.assign(w, { status, sig: sig || w.sig, error }); if (status === "failed") this.bal(w.user_id, "SOL", w.lamports / 1e9, "withdraw_refund", w.id); return w; }
  async markSent(id, sig) { const w = this.wd.get(id); if (w && w.status === "pending") Object.assign(w, { status: "sent", sig }); }
  async withdrawnToday(uid) { return [...this.wd.values()].filter(w => w.user_id === uid && w.status !== "failed" && Date.now() - Date.parse(w.created_at) < 86400e3).reduce((a, w) => a + w.lamports, 0); }
  async openWithdrawals() { return [...this.wd.values()].filter(w => ["pending", "sent"].includes(w.status)); }
  async moneyOf(uid) { return { deposits: [...this.dep.values()].filter(d => d.user_id === uid).reverse().slice(0, 20), withdrawals: [...this.wd.values()].filter(w => w.user_id === uid).reverse().slice(0, 20) }; }
  async knownDeposit(sig) { return this.dep.get(sig) || null; }
  async profilesByWallet(addr) { return [...this.p.values()].filter(p => (p.wallets || []).includes(addr)).map(p => ({ id: p.id, wallets: p.wallets })); }
}

export const DB = CFG.supabaseUrl && CFG.supabaseKey ? new SupaDB(CFG.supabaseUrl, CFG.supabaseKey) : new MemDB();
