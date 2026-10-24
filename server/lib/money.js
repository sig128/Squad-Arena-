// Real SOL: deposits into the treasury wallet, withdrawals out of it. Devnet until NETWORK=mainnet.
// Every move is recorded in the database first, so a crash never pays twice or loses a balance.
import crypto from "node:crypto";
import { CFG } from "./config.js";
import { DB } from "./db.js";
import { log, b58enc, b58dec as SOL_b58dec, isAddress, sleep } from "./util.js";
import * as SOL from "./solana.js";

export const MONEY = { key: null, enabled: false, treasuryLamports: null, locks: new Set(), seen: new Set() };
export function initMoney() {
  try { MONEY.key = SOL.loadKey(CFG.treasurySecret); } catch (e) { log("error", "treasury key: " + e.message); }
  MONEY.enabled = CFG.realMoney && !!MONEY.key;
  if (MONEY.enabled) log("info", `SOL wallet on (${CFG.network}), treasury ${MONEY.key.address}`);
}
export const moneyInfo = () => ({ enabled: MONEY.enabled, network: CFG.network, treasury: MONEY.key ? MONEY.key.address : null,
  depositMin: CFG.depositMin, withdrawMin: CFG.withdrawMin, withdrawMax: CFG.withdrawMax, withdrawDaily: CFG.withdrawDaily });
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const memoFor = uid => "squadarena:" + crypto.createHash("sha256").update(uid).digest("hex").slice(0, 10);
const toLamports = sol => Math.round(Number(sol) * SOL.LAMPORTS);

export async function prepareDeposit(user, from, sol) {
  if (!MONEY.enabled) throw err("The SOL wallet is off on this server.");
  if (!user.wallets.includes(from)) throw err("Send from a wallet linked to your account.");
  const lamports = toLamports(sol);
  if (!(lamports >= toLamports(CFG.depositMin))) throw err(`The minimum deposit is ${CFG.depositMin} SOL.`);
  if (lamports > toLamports(1000)) throw err("That deposit is too large.");
  const bh = await SOL.latestBlockhash();
  const msg = SOL.transferMessage({ from, to: MONEY.key.address, lamports, blockhash: bh.blockhash, memo: memoFor(user.id) });
  const list = (PREP.get(user.id) || []).filter(x => Date.now() - x.at < 150e3); list.push({ msg, from, lamports, at: Date.now() }); PREP.set(user.id, list.slice(-5));
  return { tx: SOL.unsignedTx(msg).toString("base64"), lamports, treasury: MONEY.key.address, network: CFG.network };
}
// the wallet signed the exact transaction the server prepared; the server sends it on its own RPC (devnet or mainnet)
const PREP = new Map();
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
export async function submitDeposit(user, b64) {
  if (!MONEY.enabled) throw err("The SOL wallet is off on this server.");
  const tx = Buffer.from(String(b64 || ""), "base64");
  if (tx.length < 65 + 100 || tx[0] !== 1) throw err("That isn't the deposit transaction.");
  const sig = tx.subarray(1, 65), msg = tx.subarray(65);
  const p = (PREP.get(user.id) || []).find(x => x.msg.equals(msg));
  if (!p) throw err("That deposit expired. Start it again.");
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(SOL_b58dec(p.from))]), format: "der", type: "spki" });
  if (!crypto.verify(null, msg, pub, sig)) throw err("The wallet signature doesn't match. Try again.");
  PREP.set(user.id, (PREP.get(user.id) || []).filter(x => x !== p));
  const sigStr = b58enc(sig), r = await SOL.sendAndConfirm(tx, sigStr, 60000);
  if (r.ok === false) throw err("The network rejected the deposit: " + (r.err || "unknown error"), 502);
  if (r.ok === null) return { sig: sigStr, pending: true, lamports: p.lamports };
  const c = await confirmDeposit(user, sigStr);
  return { sig: sigStr, ...c };
}

export async function confirmDeposit(user, sig) {
  if (!MONEY.enabled) throw err("The SOL wallet is off on this server.");
  if (typeof sig !== "string" || sig.length < 64 || sig.length > 100) throw err("That doesn't look like a transaction signature.");
  let tx = null;
  for (let i = 0; i < 12 && !tx; i++) { try { tx = await SOL.txOf(sig); } catch (_) {} if (!tx) await sleep(2500); }
  if (!tx) throw err("The deposit isn't confirmed yet. It will be credited automatically once it lands.", 202);
  const ins = SOL.transfersIn(tx, MONEY.key.address).filter(t => user.wallets.includes(t.from));
  const lamports = ins.reduce((a, t) => a + t.lamports, 0);
  if (!lamports) throw err("That transaction didn't send SOL from your wallet to the arena.");
  const bal = await DB.creditDeposit(user.id, sig, CFG.network, ins[0].from, lamports);
  MONEY.seen.add(sig);
  return { lamports, credited: bal != null, bal };
}

// deposits that never got a confirm call (closed tab, lost connection) are found by watching the treasury
export async function scanDeposits() {
  if (!MONEY.enabled) return;
  const sigs = await SOL.rpc("getSignaturesForAddress", [MONEY.key.address, { limit: 40, commitment: "confirmed" }]);
  for (const s of sigs || []) {
    if (s.err || MONEY.seen.has(s.signature)) continue;
    MONEY.seen.add(s.signature);
    if (await DB.knownDeposit(s.signature)) continue;
    let tx; try { tx = await SOL.txOf(s.signature); } catch (_) { MONEY.seen.delete(s.signature); continue; }
    for (const t of SOL.transfersIn(tx, MONEY.key.address)) {
      const owners = await DB.profilesByWallet(t.from);
      if (owners.length === 1) { const bal = await DB.creditDeposit(owners[0].id, s.signature, CFG.network, t.from, t.lamports); if (bal != null) log("info", `deposit ${t.lamports / 1e9} SOL credited to ${owners[0].id} (found by scan)`); break; }
    }
  }
  if (MONEY.seen.size > 5000) MONEY.seen = new Set([...MONEY.seen].slice(-2000));
  try { MONEY.treasuryLamports = await SOL.balanceOf(MONEY.key.address); } catch (_) {}
}

export async function withdraw(user, sol, to) {
  if (!MONEY.enabled) throw err("The SOL wallet is off on this server.");
  to = to || user.wallet;
  if (!isAddress(to) || !user.wallets.includes(to)) throw err("Withdrawals go to a wallet linked to your account.");
  const lamports = toLamports(sol);
  if (!(lamports >= toLamports(CFG.withdrawMin))) throw err(`The minimum withdrawal is ${CFG.withdrawMin} SOL.`);
  if (lamports > toLamports(CFG.withdrawMax)) throw err(`The most you can withdraw at once is ${CFG.withdrawMax} SOL.`);
  if (MONEY.locks.has(user.id)) throw err("A withdrawal is already on its way. Try again in a minute.", 409);
  MONEY.locks.add(user.id);
  try {
    if ((await DB.withdrawnToday(user.id)) + lamports > toLamports(CFG.withdrawDaily)) throw err(`The daily withdrawal limit is ${CFG.withdrawDaily} SOL.`);
    const tb = await SOL.balanceOf(MONEY.key.address);
    if (tb < lamports + 10000) { log("error", `treasury too low for a ${lamports / 1e9} SOL withdrawal (${tb / 1e9} SOL)`); throw err("Withdrawals are paused for a moment. Your balance is safe. Try again later.", 503); }
    let w;
    try { w = await DB.requestWithdrawal(user.id, CFG.network, to, lamports); }
    catch (e) { throw err(/insufficient/i.test(e.message) ? "Your balance is lower than that." : "The withdrawal couldn't start: " + e.message); }
    const bh = await SOL.latestBlockhash();
    const msg = SOL.transferMessage({ from: MONEY.key.address, to, lamports, blockhash: bh.blockhash, memo: "squadarena withdrawal" });
    const sigBytes = MONEY.key.sign(msg), sig = b58enc(sigBytes);
    await DB.markSent(w.id, sig);
    const r = await SOL.sendAndConfirm(SOL.wrapTx(msg, [sigBytes]), sig);
    if (r.ok) { await DB.finishWithdrawal(w.id, "confirmed", sig, null); return { id: w.id, sig, status: "confirmed", lamports }; }
    if (r.ok === false) { await DB.finishWithdrawal(w.id, "failed", sig, r.err); throw err("The network rejected the withdrawal, so your balance was restored. " + (r.err || ""), 502); }
    return { id: w.id, sig, status: "sent", lamports };             // the recovery loop finishes it
  } finally { MONEY.locks.delete(user.id); }
}

// finishes withdrawals that were cut off by a restart: confirmed ones close, lost ones refund once their blockhash has expired
export async function recoverWithdrawals() {
  if (!MONEY.key) return;
  for (const w of await DB.openWithdrawals()) {
    const age = Date.now() - Date.parse(w.updated_at || w.created_at);
    if (w.status === "pending") { if (age > 120e3) { await DB.finishWithdrawal(w.id, "failed", null, "never sent"); log("warn", `withdrawal ${w.id} refunded (never sent)`); } continue; }
    let st = null; try { st = await SOL.statusOf(w.sig); } catch (_) { continue; }
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) await DB.finishWithdrawal(w.id, "confirmed", w.sig, null);
    else if (st && st.err) await DB.finishWithdrawal(w.id, "failed", w.sig, JSON.stringify(st.err));
    else if (!st && age > 180e3) { await DB.finishWithdrawal(w.id, "failed", w.sig, "expired"); log("warn", `withdrawal ${w.id} refunded (expired)`); }
  }
}
