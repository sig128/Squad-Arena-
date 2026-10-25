/* ================= core: utils, data, tokens, pricing ================= */
const $ = id => document.getElementById(id);
const qsa = (s, el) => [...(el || document).querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
const hoverable = matchMedia("(hover:hover)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem("sa." + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem("sa." + k, JSON.stringify(v)); } catch (_) {} }
};
const rid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* ---------- recorded data (injected at build) ---------- */
const REC = /*REC*/null;
const LOGO = /*LOGOS*/{};
const SNAP = REC.snap;                 // capture time of the snapshot metrics
const REC_END = REC.end;               // end of the last recorded 1-minute candle
const LOOP = 3600e3;                   // the replay loops the recorded hour, aligned to UTC hours
const D0 = REC_END - LOOP;
const TF = {
  "15m": { k: "15m", W: 15 * 60e3, label: "15 min" },
  "30m": { k: "30m", W: 30 * 60e3, label: "30 min" },
  "1h":  { k: "1h",  W: 3600e3,     label: "1 hour" },
  "24h": { k: "24h", W: 86400e3,    label: "24 hours" }
};
const TFK = ["15m", "30m", "1h", "24h"];
const RAKE = 0.03, SEED = 0.1, BET_WIN = 0.4, START_BAL = 25, MIN_STAKE = 0.05, MAX_AGE = 72 * 3600e3;
const GATE = { liq: 25e3, turn: 0.25, trades: 2000, tx24: 300, mcLiq: 60 };

/* ---------- formatting ---------- */
const SUBD = "₀₁₂₃₄₅₆₇₈₉";
function fmtPrice(p) {
  if (p == null || !isFinite(p)) return "—";
  if (p >= 1) return "$" + p.toFixed(3);
  if (p >= 0.001) return "$" + p.toPrecision(4);
  const s = p.toFixed(18).split(".")[1]; let z = 0; while (s[z] === "0") z++;
  return "$0.0" + [...String(z)].map(d => SUBD[d]).join("") + s.slice(z, z + 4);
}
const fmtUsd = v => v == null || !isFinite(v) ? "—" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
function fmtMc(v, step) {
  if (v == null || !isFinite(v)) return "—";
  const u = Math.abs(v) >= 1e6 ? [1e6, "M"] : Math.abs(v) >= 1e3 ? [1e3, "K"] : [1, ""];
  const d = step ? clamp(Math.ceil(-Math.log10(step / u[0]) - 1e-9), 0, 3) : (u[1] === "M" ? 3 : 1);
  return "$" + (v / u[0]).toFixed(d) + u[1];
}
const fmtNum = v => v == null || !isFinite(v) ? "—" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "K" : Math.round(v).toLocaleString("en-US");
const fmtPct = (v, d = 2) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%";
let CUR = "tSOL";                      // practice credits, or SOL on a server with the SOL wallet on
const fmtSol = v => (Math.abs(v) < 100 ? v.toFixed(CUR === "SOL" ? 4 : 2) : Math.round(v).toLocaleString("en-US")) + " " + CUR;
const fmtX = v => v == null || !isFinite(v) ? "—" : "×" + (v >= 100 ? v.toFixed(0) : v.toFixed(2));
const pad2 = n => String(n).padStart(2, "0");
function dur(ms) { ms = Math.max(0, ms); const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? h + ":" + pad2(m) + ":" + pad2(s % 60) : pad2(m) + ":" + pad2(s % 60); }
function age(ms) { const h = ms / 3600e3; return h < 1 ? Math.max(1, Math.round(h * 60)) + "m" : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + "h" : (h / 24).toFixed(1) + "d"; }
function utc(t, sec = true) { const d = new Date(t); return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + (sec ? ":" + pad2(d.getUTCSeconds()) : ""); }
function local(t, sec = true) { const d = new Date(t); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + (sec ? ":" + pad2(d.getSeconds()) : ""); }
const short = a => a ? a.slice(0, 4) + "…" + a.slice(-4) : "";
function ago(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; }

/* ---------- tokens ---------- */
const TR = new Map(), TL = new Map();   // mint -> token, for the recorded hour and for live data
let T = TR;                              // the map the screen is showing
const mapOf = md => md === "R" ? TR : TL;
function decodeOH(line) {
  const parts = line.split("|"); const t0 = +parts[1] * 1000, B = +parts[2], k = B / 1e4;
  return parts[3].split(";").map(c => { const a = c.split(",").map(Number);
    return { t: t0 + a[0] * 60000, o: (a[1] + a[2]) * k, h: (a[1] + a[3]) * k, l: (a[1] - a[4]) * k, c: a[1] * k, v: a[5] }; });
}
function makeToken(r) {
  const t = {
    m: r.m, s: r.s, n: r.n || r.s, born: r.t || 0, px: r.px || null, mc: r.mc || null,
    supply: r.mc && r.px ? r.mc / r.px : 1e9,
    liq: r.l ?? null, vol: r.v || [0, 0, 0, 0], tx: r.tx || [0, 0, 0, 0], bs: r.bs || [0, 0], ch: r.ch || [0, 0, 0, 0],
    pool: r.p || null, dex: r.dex || null, quote: r.q || "SOL", pa: r.pa || null,
    x: r.x || null, tg: r.tg || null, dc: r.dc || null, w: r.w || null, ds: r.ds || "",
    logo: LOGO[r.m] || r.logo || null, C: [], C5: [], ticks: [], rugAt: 0, rugWhy: "", gate: true, firstT: Infinity, lastSeen: 0, disp: null
  };
  if (r.oh) t.C = decodeOH(r.oh);
  t.firstT = t.C.length ? t.C[0].t : Infinity;
  return t;
}
function loadRecorded() {
  TR.clear();
  for (const r of REC.tokens) { if (!r.oh) continue; const t = makeToken(r); TR.set(t.m, t); }
  for (const t of TR.values()) detectRugReplay(t);
}
// price at time t (recorded time in replay, wall time live): ticks > 1m candles > 5m candles
function idxLE(A, t) { let lo = 0, hi = A.length - 1; if (hi < 0 || t < A[0].t) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m].t <= t) lo = m; else hi = m - 1; } return lo; }
function pAt(tok, t) {
  const K = tok.ticks;
  if (K.length && t >= K[0].t) {
    const i = idxLE(K, t); if (i >= K.length - 1) return K[K.length - 1].p;
    const a = K[i], b = K[i + 1]; return a.p + (b.p - a.p) * (t - a.t) / (b.t - a.t || 1);
  }
  let C = tok.C, span = 60000, i = idxLE(C, t);
  if (i < 0 && tok.C5.length) { C = tok.C5; span = 300000; i = idxLE(C, t); }
  if (i < 0) return null;
  const c = C[i], f = (t - c.t) / span;
  if (f >= 1) return c.c;      // after this candle: hold its close until the next candle or tick
  return pathAt(c, f);
}
// inside a candle the price walks open → low → high → close (or open → high → low → close on a red candle):
// the usual OHLC path convention, so lines pass through the real extremes of every minute
function pathPts(c) { return c.c >= c.o ? [[0, c.o], [0.3, c.l], [0.7, c.h], [1, c.c]] : [[0, c.o], [0.3, c.h], [0.7, c.l], [1, c.c]]; }
function pathAt(c, f) {
  const P = pathPts(c);
  for (let k = 1; k < P.length; k++) if (f <= P[k][0]) { const a = P[k - 1], b = P[k]; return a[1] + (b[1] - a[1]) * (f - a[0]) / (b[0] - a[0]); }
  return c.c;
}
function pathExt(c, f) { let h = c.o, l = c.o; for (const [x, v] of pathPts(c)) if (x <= f) { h = Math.max(h, v); l = Math.min(l, v); } const p = pathAt(c, f); return { h: Math.max(h, p), l: Math.min(l, p), p }; }
function twap(tok, a, b) {
  if (!(b > a)) return pAt(tok, a);
  let s = 0, n = 0; const N = 14;
  for (let i = 0; i <= N; i++) { const p = pAt(tok, a + (b - a) * i / N); if (p != null) { s += p; n++; } }
  return n ? s / n : null;
}
const mcAt = (tok, t) => { const p = pAt(tok, t); return p == null ? null : p * tok.supply; };
// candles up to time tEnd, the last one cut at tEnd so the chart never shows what has not happened yet
function candlesTo(tok, tEnd, maxN) {
  const out = [], C = tok.C; let i = idxLE(C, tEnd);
  if (i >= 0) {
    const from = Math.max(0, i - (maxN || 400));
    for (let k = from; k < i; k++) out.push(C[k]);
    const c = C[i], f = (tEnd - c.t) / 60000;
    if (f >= 1) out.push(c);
    else { const e = pathExt(c, f); out.push({ t: c.t, o: c.o, h: e.h, l: e.l, c: e.p, v: c.v * f, open: true }); }
  }
  // live ticks after the last candle become candles of their own
  const K = tok.ticks;
  if (K.length) {
    const lastT = out.length ? out[out.length - 1].t : -Infinity;
    let cur = null;
    for (const k of K) {
      if (k.t > tEnd) break;
      const mt = Math.floor(k.t / 60000) * 60000; if (mt <= lastT) continue;
      if (!cur || cur.t !== mt) { const prev = cur || out[out.length - 1]; cur = { t: mt, o: prev ? prev.c : k.p, h: k.p, l: k.p, c: k.p, v: 0, tick: true }; if (prev) { cur.h = Math.max(cur.h, cur.o); cur.l = Math.min(cur.l, cur.o); } out.push(cur); }
      cur.h = Math.max(cur.h, k.p); cur.l = Math.min(cur.l, k.p); cur.c = k.p;
    }
  }
  return maxN && out.length > maxN ? out.slice(out.length - maxN) : out;
}
// rug rule: liquidity below the floor, or a 5-minute drop of 80% or more
function detectRugReplay(tok) {
  const C = tok.C; if (C.length < 2) return;
  const t0 = C[0].t + 300e3, t1 = C[C.length - 1].t + 60000;
  for (let t = t0; t <= t1; t += 5000) {
    const a = pAt(tok, t - 300e3), b = pAt(tok, t);
    if (a && b && b / a - 1 <= -0.8) { tok.rugAt = t; tok.rugWhy = "price fell " + Math.round((1 - b / a) * 100) + "% in 5 min"; return; }
  }
}

/* ---------- palette (validated for both themes) ---------- */
const PAL = {
  light: ["#2a78d6","#eb6834","#1baf7a","#eda100","#e87ba4","#008300","#6250d6","#be222d","#1aa1c9","#8a4b24","#b082f7","#97176e","#868604","#2d54a0","#007176"],
  dark:  ["#3987e5","#d95926","#199e70","#c98500","#d55181","#008300","#9085e9","#bd1f3d","#32a0c5","#a26239","#c45bd6","#a8336f","#8b8c14","#5468c9","#017b80"]
};
let C = {}, pal = PAL.light, MONO = "monospace", DISP = "monospace";
function readTheme() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  C = { bg: g("--bg"), bg2: g("--bg2"), fg: g("--fg"), dim: g("--dim"), faint: g("--faint"), rule: g("--rule"), rule2: g("--rule2"), hover: g("--hover"), up: g("--up"), down: g("--down"), warn: g("--warn"),
        stage: g("--stage"), stageFg: g("--stage-fg"), stageDim: g("--stage-dim"), stageRule: g("--stage-rule") };
  pal = g("--mode") === "dark" ? PAL.dark : PAL.light; MONO = g("--mono") || "monospace"; DISP = g("--disp") || MONO;
  qsa("[data-av]").forEach(el => el.style.setProperty("--ring", ringOf(el.dataset.av)));
  dirty.all = true;
}
const slotOf = new Map(), lastSlot = new Map();
const colorOf = m => slotOf.has(m) ? pal[slotOf.get(m)] : C.faint;
const ringOf = m => slotOf.has(m) ? pal[slotOf.get(m)] : "var(--faint)";
const IMG = {};
// IPFS logos: ipfs.io and most public gateways fail or time out in browsers; Filebase answers in a few hundred ms,
// pump.fun's own Pinata gateway is the second try
const ipfsCid = u => { const m = String(u || "").match(/^(?:ipfs:\/\/(?:ipfs\/)?|https?:\/\/[^/]+\/ipfs\/)([A-Za-z0-9]{40,}[^?#]*)/); return m ? m[1] : null; };
const logoUrl = u => { const c = ipfsCid(u); return c ? "https://ipfs.filebase.io/ipfs/" + c : u; };
function imgOf(tok) { if (!tok.logo) return null; let im = IMG[tok.m]; if (!im) { im = new Image(); im.decoding = "async"; im.src = logoUrl(tok.logo); IMG[tok.m] = im; } return im.complete && im.naturalWidth ? im : null; }
function avHTML(tok, size, rw) {
  const src = tok && tok.logo && logoUrl(tok.logo), m = tok ? tok.m : "";
  return `<span class="av${src ? "" : " mono"}" data-av="${esc(m)}" data-s="${esc((tok && tok.s || "?")[0])}" style="--s:${size}px;--rw:${rw}px;--ring:${ringOf(m)}">${src ? `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">` : esc((tok && tok.s || "?")[0])}</span>`;
}
// a logo that won't load (hosts that refuse other sites, slow IPFS) goes through the site's own image proxy, then falls back to the initial
document.addEventListener("error", e => {
  const im = e.target; if (!(im instanceof HTMLImageElement)) return;
  const av = im.parentElement; if (!av || !av.classList.contains("av")) return;
  const cid = ipfsCid(im.src);
  if (cid && !im.dataset.pin) { im.dataset.pin = "1"; im.src = "https://pump.mypinata.cloud/ipfs/" + cid + "?img-width=128&img-dpr=2"; return; }
  if (!im.dataset.px && /^https:/.test(im.src) && /^https?:$/.test(location.protocol) && !window.claude) { im.dataset.px = "1"; im.src = "/api/img?u=" + encodeURIComponent(cid ? "https://ipfs.filebase.io/ipfs/" + cid : im.src); return; }
  av.classList.add("mono"); av.textContent = av.dataset.s || "?";
}, true);
const tkHTML = (tok, size = 14) => tok ? `<a class="tk" href="#coin-${esc(tok.m)}">${avHTML(tok, size, 1.5)}<span>${esc(tok.s)}</span></a>` : "";
async function copyText(text, btn, selEl) {
  const label = btn ? btn.dataset.label || (btn.dataset.label = btn.textContent) : "";
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
  if (!ok) { const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand("copy"); } catch (_) {} ta.remove(); }
  if (!ok && selEl) { const rg = document.createRange(); rg.selectNodeContents(selEl); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
  if (btn) { btn.textContent = ok ? "Copied" : "Selected, press Ctrl+C"; setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1600); }
  if (ok && typeof notice === "function") notice("Contract address copied");
}
function tone(el, v) { el.classList.toggle("up", v != null && v >= 0); el.classList.toggle("down", v != null && v < 0); el.classList.toggle("dim", v == null); }
const dirty = { all: true };

/* ---------- canvas helpers ---------- */
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w: r.width, h: r.height };
}
function niceStep(range, n) { const raw = range / n || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag; }
function spread(items, gap, top, bottom) {
  items.sort((a, b) => a.y - b.y);
  items.forEach((it, i) => { it.ly = Math.max(it.y, i ? items[i - 1].ly + gap : top); });
  for (let i = items.length - 1; i >= 0; i--) { const lim = i === items.length - 1 ? bottom : items[i + 1].ly - gap; if (items[i].ly > lim) items[i].ly = lim; }
  items.forEach((it, i) => { if (i && it.ly < items[i - 1].ly + gap) it.ly = items[i - 1].ly + gap; if (!i && it.ly < top) it.ly = top; });
}
function logoDot(ctx, tok, cx, cy, r, ring, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha;
  const im = tok && imgOf(tok);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  if (im) { ctx.save(); ctx.clip(); ctx.drawImage(im, cx - r, cy - r, r * 2, r * 2); ctx.restore(); }
  else { ctx.fillStyle = ring || C.faint; ctx.fill(); ctx.fillStyle = C.bg; ctx.font = `600 ${Math.round(r)}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((tok && tok.s || "?")[0], cx, cy + .5); }
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r + 1.25, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>";
function scramble(el, text, durMs = 650) {
  if (!el) return;
  if (reduced) { el.textContent = text; return; }
  const id = (el._scr = (el._scr || 0) + 1), n = text.length, t0 = performance.now();
  const step = now => {
    if (el._scr !== id) return;
    const k = Math.min(1, (now - t0) / durMs), lock = Math.floor(k * n * 1.1);
    let out = ""; for (let i = 0; i < n; i++) { const ch = text[i]; out += i < lock || ch === " " ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]; }
    el.textContent = out; if (k < 1) requestAnimationFrame(step); else el.textContent = text;
  };
  requestAnimationFrame(step);
}
function markSVG(color) {
  /* three stacked chevrons: the squad leader's stripes */
  return `<g fill="none" stroke="${color || "currentColor"}" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter">${[4, 11.5, 19].map(y => `<polyline points="5,${y + 7.5} 16,${y} 27,${y + 7.5}"/>`).join("")}</g>`;
}
