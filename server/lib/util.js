export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const now = () => Date.now();

export function log(level, msg, extra) {
  const line = new Date().toISOString() + " " + level.toUpperCase().padEnd(5) + " " + msg + (extra ? " " + JSON.stringify(extra) : "");
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export async function getJSON(url, opts = {}) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), opts.timeout || 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { accept: "application/json", "user-agent": "SquadArena/1.0", ...(opts.headers || {}) } });
    const text = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status} ${url.split("?")[0]}: ${text.slice(0, 200)}`); e.status = r.status; e.body = text; throw e; }
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(to); }
}

// base58 (Solana addresses, keys, signatures)
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58dec(s) {
  s = String(s); let zeros = 0; while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes = [];                                   // little-endian accumulator
  for (let i = zeros; i < s.length; i++) {
    let c = B58.indexOf(s[i]); if (c < 0) throw new Error("bad base58");
    for (let j = 0; j < bytes.length; j++) { c += bytes[j] * 58; bytes[j] = c & 255; c >>= 8; }
    while (c) { bytes.push(c & 255); c >>= 8; }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let k = 0; k < bytes.length; k++) out[out.length - 1 - k] = bytes[k];
  return out;
}
export function b58enc(u8) {
  const d = [0];
  for (const b of u8) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ""; for (let k = 0; k < u8.length && u8[k] === 0; k++) s += "1";
  if (u8.every(x => x === 0)) return s;
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
export const isAddress = a => { try { return typeof a === "string" && a.length >= 32 && a.length <= 44 && b58dec(a).length === 32; } catch (_) { return false; } };

// tiny token bucket per key for write endpoints
const buckets = new Map();
export function rateOk(key, perMin, burst) {
  const t = now(), b = buckets.get(key) || { tokens: burst, at: t };
  b.tokens = Math.min(burst, b.tokens + (t - b.at) * perMin / 60000); b.at = t;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1; buckets.set(key, b);
  if (buckets.size > 20000) buckets.clear();
  return true;
}
