// Solana money moves without libraries: transfer transactions built by hand, signed with Node's ed25519.
import crypto from "node:crypto";
import { CFG } from "./config.js";
import { getJSON, b58dec, b58enc, isAddress, sleep } from "./util.js";

export const SYSTEM = "11111111111111111111111111111111";
export const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const LAMPORTS = 1e9;

function cu16(n) { const out = []; let v = n; for (;;) { let b = v & 0x7f; v >>= 7; if (!v) { out.push(b); break; } out.push(b | 0x80); } return out; }
const u64le = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// legacy transaction: from → to, plus an optional memo; the fee payer is `from`
export function transferMessage({ from, to, lamports, blockhash, memo }) {
  if (!isAddress(from) || !isAddress(to)) throw new Error("bad address");
  if (from === to) throw new Error("same address");
  const keys = [from, to, SYSTEM]; if (memo) keys.push(MEMO);
  const header = [1, 0, memo ? 2 : 1];          // 1 signer; system program (and memo) read-only
  const ix = [Buffer.from([2, ...cu16(2), 0, 1, ...cu16(12)]), Buffer.concat([Buffer.from([2, 0, 0, 0]), u64le(lamports)])];
  const parts = [Buffer.from(header), Buffer.from(cu16(keys.length)), ...keys.map(k => Buffer.from(b58dec(k))), Buffer.from(b58dec(blockhash)), Buffer.from(cu16(memo ? 2 : 1)), ...ix];
  if (memo) { const d = Buffer.from(String(memo).slice(0, 64), "utf8"); parts.push(Buffer.from([3, ...cu16(0), ...cu16(d.length)]), d); }
  return Buffer.concat(parts);
}
export function wrapTx(message, sigs) { return Buffer.concat([Buffer.from(cu16(sigs.length)), ...sigs.map(s => Buffer.from(s)), message]); }
export const unsignedTx = message => wrapTx(message, [Buffer.alloc(64)]);

/* ---------- treasury key ---------- */
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
export function loadKey(secret) {
  if (!secret) return null;
  let bytes;
  const s = secret.trim();
  if (s.startsWith("[")) bytes = Buffer.from(JSON.parse(s)); else bytes = Buffer.from(b58dec(s));
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error("TREASURY_SECRET must be a 64-byte secret key (base58 or a JSON array)");
  const seed = bytes.subarray(0, 32), priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  if (bytes.length === 64 && !pub.equals(bytes.subarray(32))) throw new Error("TREASURY_SECRET public half does not match");
  return { priv, address: b58enc(pub), sign: msg => crypto.sign(null, msg, priv) };
}
export function newKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: b58enc(pub), secret: b58enc(Buffer.concat([seed, pub])) };
}

/* ---------- RPC ---------- */
let rid = 0;
export async function rpc(method, params) {
  const j = await getJSON(CFG.moneyRpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }), timeout: 20000 });
  if (j.error) { const e = new Error(j.error.message || "RPC error"); e.rpc = j.error; throw e; }
  return j.result;
}
export const latestBlockhash = async () => (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
export const balanceOf = async addr => (await rpc("getBalance", [addr, { commitment: "confirmed" }])).value;
export const sendRaw = tx => rpc("sendTransaction", [Buffer.from(tx).toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }]);
export async function statusOf(sig) { const r = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]); return r.value[0]; }
export const txOf = sig => rpc("getTransaction", [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);

// SOL sent to `to` by one of `fromSet` inside a confirmed transaction
export function transfersIn(tx, to) {
  if (!tx || !tx.meta || tx.meta.err) return [];
  const all = [...(tx.transaction.message.instructions || [])];
  for (const inner of tx.meta.innerInstructions || []) all.push(...(inner.instructions || []));
  return all.filter(ix => ix.program === "system" && ix.parsed && (ix.parsed.type === "transfer" || ix.parsed.type === "transferWithSeed") && ix.parsed.info.destination === to)
    .map(ix => ({ from: ix.parsed.info.source, lamports: +ix.parsed.info.lamports }));
}

// send and wait until confirmed; returns { sig, ok, err }
export async function sendAndConfirm(tx, sig, timeoutMs = 75000) {
  try { await sendRaw(tx); } catch (e) { return { sig, ok: false, err: e.message }; }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(2000);
    try { const st = await statusOf(sig); if (st) { if (st.err) return { sig, ok: false, err: JSON.stringify(st.err) }; if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return { sig, ok: true }; } } catch (_) {}
    if ((Date.now() - t0) % 10000 < 2100) { try { await sendRaw(tx); } catch (_) {} }   // re-broadcast now and then
  }
  return { sig, ok: null, err: "not confirmed yet" };
}
