// Our own candles survive restarts: one row per coin in the "candles" table (gzipped JSON, base64), through Supabase's REST API.
// Saved every few minutes and when Railway stops the server; read back when a coin comes back after a restart.
import zlib from "node:zlib";
import { CFG } from "./config.js";
import { kolSave, kolLoad } from "./kol.js";

export const STORE = { on: false, err: "", saved: 0, loaded: 0 };
const rest = () => CFG.supabaseUrl + "/rest/v1/candles";
const hdr = extra => { const h = { apikey: CFG.supabaseKey, ...extra }; if (/^eyJ/.test(CFG.supabaseKey)) h.authorization = "Bearer " + CFG.supabaseKey; return h; };
const arr = c => [c.t, +c.o.toPrecision(7), +c.h.toPrecision(7), +c.l.toPrecision(7), +c.c.toPrecision(7), Math.round(c.v || 0)];
const obj = a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });

export async function storeInit() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey) { STORE.err = "no Supabase settings"; return; }
  try {
    const r = await fetch(rest() + "?select=mint&limit=1", { headers: hdr({}), signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    if (r.ok) { STORE.on = true; STORE.err = ""; }
    else STORE.err = /candles|relation|schema cache/i.test(text) ? "the candles table is missing: run the candles part of supabase/schema.sql" : `HTTP ${r.status} ${text.slice(0, 140)}`;
  } catch (e) { STORE.err = e.message; }
}
export async function storeSave(tok) {
  if (!STORE.on || !tok.C.length) return;
  const data = zlib.gzipSync(JSON.stringify({ v: 1, C: tok.C.slice(-1500).map(arr), C5: tok.C5.slice(-900).map(arr), K: kolSave(tok.m), L: tok.launch || null })).toString("base64");
  const r = await fetch(rest() + "?on_conflict=mint", { method: "POST", headers: hdr({ "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ mint: tok.m, data, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const t = await r.text(); STORE.err = `save: HTTP ${r.status} ${t.slice(0, 140)}`; throw new Error(STORE.err); }
  tok.savedAt = Date.now(); STORE.saved++;
}
// stored candles go in front of the ones this process has built since it started
export async function storeLoad(tok) {
  if (!STORE.on) return false;
  const r = await fetch(rest() + "?mint=eq." + encodeURIComponent(tok.m) + "&select=data", { headers: hdr({}), signal: AbortSignal.timeout(10000) });
  if (!r.ok) { await r.text().catch(() => ""); return false; }
  const rows = await r.json(); if (!rows.length) return false;
  const j = JSON.parse(zlib.gunzipSync(Buffer.from(rows[0].data, "base64")).toString());
  const merge = (own, saved) => { const first = own.length ? own[0].t : Infinity; return (saved || []).map(obj).filter(c => c.t < first && c.c > 0).concat(own); };
  tok.C = merge(tok.C, j.C).slice(-1500); tok.C5 = merge(tok.C5, j.C5).slice(-900);
  if (j.K) kolLoad(tok.m, j.K);
  if (j.L && !tok.launch) tok.launch = j.L;                // the launch verdict outlives the launch candle
  STORE.loaded++;
  return true;
}
