// Everything a logged-in player can do. Each action checks the rules on the server before anything is saved.
import { CFG, TF, TFK, MKS, CURRENCIES } from "./config.js";
import { DB } from "./db.js";
import { TL, FEED, applyPairs } from "./market.js";
import { getJSON, isAddress } from "./util.js";
import { G, roundAt, betState, quote, indexBet, lcs, roundState, roundOfKey } from "./game.js";
import { SOC, betIn, betOut, joinSquad, pushDoc, setPerson } from "./social.js";
import { TASKS, PROOF } from "./rules.js";
import { MONEY, moneyInfo, prepareDeposit, confirmDeposit, submitDeposit, withdraw } from "./money.js";
import { emit } from "./hub.js";
import { rateOk, log } from "./util.js";

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const fmt = (v, cur) => (cur === "SOL" ? (+v).toFixed(4).replace(/\.?0+$/, "") : (+v).toFixed(2)) + " " + cur;

// keeps the profile row in step with Privy (name, wallets) at most every 10 minutes
const synced = new Map();
export async function ensureUser(user) {
  const at = synced.get(user.id);
  if (!at || Date.now() - at > 600e3) {
    const p = { id: user.id, name: user.name };
    if (user.email) p.email = user.email;
    if (user.wallets && user.wallets.length) { p.wallets = user.wallets; p.wallet = user.wallet; }   // a failed Privy lookup never wipes saved wallets
    const row = await DB.ensureProfile(p);
    synced.set(user.id, Date.now());
    setPerson(user.id, { name: row.name, avatar: row.avatar || null, handle: row.handle || "" });
    return row;
  }
  return null;
}
export async function me(user) {
  const row = (await ensureUser(user)) || await DB.getProfile(user.id);
  const mine = [...G.bets.values()].filter(b => b.uid === user.id).sort((a, b) => b.ts - a.ts).slice(0, 200).map(betOut);
  return { id: user.id, name: row.name, handle: row.handle || "", email: user.email, wallet: user.wallet, wallets: user.wallets,
    bal: { tSOL: +row.bal_tsol, SOL: +row.bal_sol }, topupOk: +row.bal_tsol < 5 && (!row.topup_at || Date.now() - Date.parse(row.topup_at) > 86400e3),
    bets: mine, money: moneyInfo() };
}
async function balances(uid) { const p = await DB.getProfile(uid); return p ? { tSOL: +p.bal_tsol, SOL: +p.bal_sol } : null; }

export async function systemPost(uid, chan, text) {
  try { const row = await DB.insertChat({ user_id: uid, chan, body: text.slice(0, 280), sys: true }); SOC.chat.push({ id: "c" + row.id, uid, c: chan, x: row.body, ts: Date.parse(row.created_at), sys: true }); trimChat(); pushDoc("posts", uid); }
  catch (e) { log("warn", "system post failed: " + e.message); }
}
function trimChat() { if (SOC.chat.length > 6000) SOC.chat.splice(0, SOC.chat.length - 5000); }

export async function placeBet(user, body) {
  const tf = String(body.tf || ""), mk = String(body.mk || ""), m = String(body.m || ""), cur = String(body.cur || "tSOL");
  if (!TF[tf] || !MKS.includes(mk)) throw err("Unknown market.");
  if (!TFK.includes(tf)) throw err("Rounds now run for 24 hours. Reload the page to bet.", 409);
  if (!CURRENCIES().includes(cur) || (cur === "SOL" && !MONEY.enabled)) throw err(cur === "tSOL" ? "Bets are in real SOL now. Reload the page." : "Betting with SOL is off on this server.");
  if (!rateOk("bet:" + user.id, 30, 6)) throw err("Slow down a little.", 429);
  await ensureUser(user);
  const w = Date.now(), r = roundAt(tf, w);
  if (body.rk && body.rk !== r.key) throw err("That round just closed. Check the odds for the new round.", 409);
  const bs = betState(r, mk, w, m); if (!bs.open) throw err(bs.why, 409);
  const dp = cur === "SOL" ? 1e6 : 1e4, s = Math.floor(+body.s * dp) / dp;
  if (!(s >= CFG.minStake[cur])) throw err(`The minimum stake is ${fmt(CFG.minStake[cur], cur)}.`);
  if (s > CFG.maxStake[cur]) throw err(`The maximum stake is ${fmt(CFG.maxStake[cur], cur)}.`);
  const weight = +bs.w.toFixed(4), q = quote(r, mk, m, s, weight, cur);
  let row;
  try { row = await DB.placeBet({ uid: user.id, rk: r.key, tf, rs: r.s, mk, m, cur, s, w: weight, q: +q.mult.toFixed(3) }); }
  catch (e) { if (/insufficient/i.test(e.message)) { const b = await balances(user.id); throw err(`You have ${fmt(b ? b[cur] : 0, cur)}. Lower the stake.`); } throw e; }
  const b = betIn(row); indexBet(b);
  const joined = mk === "sq" ? false : joinSquad(user.id, m, b.ts);
  pushDoc("members", user.id);
  emit("round", roundState(r, Date.now()));
  if (joined) await systemPost(user.id, m, "joined the squad");
  return { bet: betOut(b), bal: await balances(user.id), joined };
}

// any Solana coin can have a squad: joining is free, betting stays limited to the board
export async function joinSquadAction(user, body) {
  const m = String(body.m || "").trim();
  if (!isAddress(m)) throw err("That isn't a Solana coin address.");
  if (!rateOk("squad:" + user.id, 20, 5)) throw err("Slow down a little.", 429);
  if (!TL.has(m)) {
    let pairs = null; try { pairs = await getJSON("https://api.dexscreener.com/tokens/v1/solana/" + m); } catch (_) {}
    if (pairs && pairs.length) applyPairs(pairs, Date.now());
    if (!TL.has(m)) throw err("Couldn't find that coin trading on Solana.");
  }
  await ensureUser(user);
  const first = ![...SOC.squads.values()].some(s => s.has(m));
  const joined = joinSquad(user.id, m, Date.now());
  if (!joined) return { joined: false, first: false };
  await DB.joinSquad(user.id, m);
  G.followed.set(m, Date.now());
  pushDoc("members", user.id);
  emit("follow", { m });
  await systemPost(user.id, m, first ? "started the squad" : "joined the squad");
  return { joined: true, first };
}

export async function streakPass(user, body) {
  const b = G.bets.get(String(body.bet || "")), nm = String(body.m || "");
  if (!b || b.uid !== user.id) throw err("That bet isn't yours.");
  if (b.mk !== "lcs" || b.st !== "open") throw err("The pass works on open Last coin standing bets.");
  if (b.sp) throw err("You already used the streak pass on this bet.");
  const r = roundOfKey(b.rk), st = lcs(r, Date.now());
  if (!st) throw err("This bracket isn't scored.");
  const survived = st.cps.filter(c => !c.cut.includes(b.m)).length;
  if (survived < 3 || !st.alive.has(b.m) || st.done >= 5) throw err("The pass unlocks after your coin survives 3 checkpoints.");
  if (!st.alive.has(nm)) throw err("Pick a coin that is still in the bracket.");
  const row = await DB.usePass(b.id, user.id, nm); if (!row) throw err("The pass couldn't be used.");
  b.m = nm; b.sp = true; joinSquad(user.id, nm, Date.now());
  pushDoc("members", user.id); emit("round", roundState(r, Date.now()));
  return { bet: betOut(b) };
}

export async function topup(user) {
  await ensureUser(user);
  const nb = await DB.topup(user.id);
  if (nb == null) throw err("Top-ups unlock when you're under 5 tSOL, once a day.");
  return { bal: await balances(user.id) };
}

export async function setHandle(user, body) {
  const h = String(body.h || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
  await ensureUser(user); await DB.setHandle(user.id, h || null);
  setPerson(user.id, { handle: h }); pushDoc("members", user.id);
  return { h };
}

export async function postProof(user, body) {
  const m = String(body.m || ""), k = String(body.k || ""), url = String(body.u || "").trim().slice(0, 300), task = TASKS[k];
  if (!task) throw err("Unknown task.");
  if (!(SOC.squads.get(user.id) || new Map()).has(m)) throw err("Join the squad first: back this coin in any market.");
  const mt = url.match(PROOF[task.proof]); if (!mt) throw err("That link doesn't look right for this task.");
  if (!rateOk("proof:" + user.id, 6, 3)) throw err("Slow down a little.", 429);
  let row;
  try { row = await DB.insertProof({ user_id: user.id, mint: m, task: k, url }); }
  catch (e) { if (e.code === "23505" || /duplicate/i.test(e.message)) throw err(/url/i.test(e.message) ? "Someone already submitted that link." : "You already have a proof on this task."); throw e; }
  SOC.proofs.set(row.id, { id: row.id, uid: user.id, m, k, u: url, ts: Date.parse(row.created_at) });
  if (task.proof === "x" && mt[1] && !(SOC.people.get(user.id) || {}).handle) { await DB.setHandle(user.id, mt[1]); setPerson(user.id, { handle: mt[1] }); pushDoc("members", user.id); }
  pushDoc("proofs", user.id);
  emit("proof", { m, k, id: row.id });
  await systemPost(user.id, m, "completed a proof for " + task.name);
  return { id: row.id };
}

export async function markProof(user, body) {
  const p = SOC.proofs.get(String(body.id || "")), kind = body.kind === "flag" ? "flag" : "check";
  if (!p) throw err("That proof is gone.");
  if (p.uid === user.id) throw err("You can't verify your own proof.");
  if (!(SOC.squads.get(user.id) || new Map()).has(p.m)) throw err("Only squad members can verify proofs.");
  if (!rateOk("mark:" + user.id, 60, 10)) throw err("Slow down a little.", 429);
  const on = await DB.toggleMark(p.id, user.id, kind);
  let mk = SOC.marks.get(p.id); if (!mk) SOC.marks.set(p.id, mk = { v: new Map(), f: new Map() });
  const bucket = kind === "flag" ? mk.f : mk.v; if (on) bucket.set(user.id, Date.now()); else bucket.delete(user.id);
  pushDoc("proofs", user.id);
  return { on };
}

export async function chat(user, body) {
  const c = String(body.c || "g").slice(0, 64), x = String(body.x || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 280);
  if (!x) throw err("Empty message.");
  if (c !== "g" && !TL.has(c) && !(SOC.squads.get(user.id) || new Map()).has(c)) throw err("Unknown channel.");
  if (!rateOk("chat:" + user.id, 20, 5)) throw err("You're sending messages too fast.", 429);
  await ensureUser(user);
  const row = await DB.insertChat({ user_id: user.id, chan: c, body: x, sys: false });
  const msg = { id: "c" + row.id, uid: user.id, c, x, ts: Date.parse(row.created_at), sys: false };
  SOC.chat.push(msg); trimChat();
  emit("chat", { id: msg.id, c, x, ts: msg.ts, by: user.id });
  pushDoc("posts", user.id);
  return { id: msg.id };
}

export async function money(user) { return { info: moneyInfo(), ...(await DB.moneyOf(user.id)) }; }
export async function depositPrepare(user, body) { await ensureUser(user); return prepareDeposit(user, String(body.from || user.wallet || ""), +body.sol); }
export async function depositSubmit(user, body) { await ensureUser(user); const r = await submitDeposit(user, String(body.tx || "")); return { ...r, bal: await balances(user.id) }; }
export async function depositConfirm(user, body) { await ensureUser(user); const r = await confirmDeposit(user, String(body.sig || "")); return { ...r, bal: await balances(user.id) }; }
export async function withdrawOut(user, body) { await ensureUser(user); const r = await withdraw(user, +body.sol, body.to ? String(body.to) : null); return { ...r, bal: await balances(user.id) }; }
