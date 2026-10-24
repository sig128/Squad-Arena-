// Our own candles survive restarts: one gzipped JSON file per coin in Supabase Storage (private bucket "candles").
// Saved every few minutes and when Railway stops the server; read back when a coin comes back after a restart.
import zlib from "node:zlib";
import { CFG } from "./config.js";

export const STORE = { on: false, err: "", saved: 0, loaded: 0, bearer: false };
const base = () => CFG.supabaseUrl + "/storage/v1";
const hdr = extra => {
  const h = { apikey: CFG.supabaseKey, ...extra };
  if (STORE.bearer || /^eyJ/.test(CFG.supabaseKey)) h.authorization = "Bearer " + CFG.supabaseKey;
  return h;
};
const arr = c => [c.t, +c.o.toPrecision(7), +c.h.toPrecision(7), +c.l.toPrecision(7), +c.c.toPrecision(7), Math.round(c.v || 0)];
const obj = a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });

async function makeBucket() {
  const r = await fetch(base() + "/bucket", { method: "POST", headers: hdr({ "content-type": "application/json" }), body: JSON.stringify({ id: "candles", name: "candles", public: false }), signal: AbortSignal.timeout(10000) });
  const text = await r.text();
  return { ok: r.ok || /already exists|duplicate/i.test(text), status: r.status, text };
}
export async function storeInit() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey) { STORE.err = "no Supabase settings"; return; }
  try {
    let r = await makeBucket();
    if (!r.ok && !STORE.bearer && /jwt|authorization|unauthorized|invalid/i.test(r.text)) { STORE.bearer = true; r = await makeBucket(); }   // some key types also want the Authorization header
    if (r.ok) { STORE.on = true; STORE.err = ""; } else STORE.err = `bucket: HTTP ${r.status} ${r.text.slice(0, 140)}`;
  } catch (e) { STORE.err = "bucket: " + e.message; }
}
export async function storeSave(tok) {
  if (!STORE.on || !tok.C.length) return;
  const body = zlib.gzipSync(JSON.stringify({ v: 1, m: tok.m, C: tok.C.slice(-1500).map(arr), C5: tok.C5.slice(-900).map(arr) }));
  const r = await fetch(`${base()}/object/candles/${tok.m}.json.gz`, { method: "POST", headers: hdr({ "content-type": "application/gzip", "x-upsert": "true" }), body, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const t = await r.text(); STORE.err = `save: HTTP ${r.status} ${t.slice(0, 140)}`; throw new Error(STORE.err); }
  tok.savedAt = Date.now(); STORE.saved++;
}
// stored candles go in front of the ones this process has built since it started
export async function storeLoad(tok) {
  if (!STORE.on) return false;
  const r = await fetch(`${base()}/object/candles/${tok.m}.json.gz`, { headers: hdr({}), signal: AbortSignal.timeout(10000) });
  if (!r.ok) { await r.text().catch(() => ""); return false; }                       // no file yet (a coin we haven't watched before)
  const j = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString());
  const merge = (own, saved) => { const first = own.length ? own[0].t : Infinity; return (saved || []).map(obj).filter(c => c.t < first && c.c > 0).concat(own); };
  tok.C = merge(tok.C, j.C).slice(-1500); tok.C5 = merge(tok.C5, j.C5).slice(-900);
  STORE.loaded++;
  return true;
}
