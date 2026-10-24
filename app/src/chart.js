/* ---------- coin chart: TradingView Lightweight Charts v5 (Apache-2.0) + indicators + drawings ---------- */
let lwBroken = false;
const LW = () => { const L = window.LightweightCharts; return !lwBroken && L && typeof L.createChart === "function" && L.CandlestickSeries ? L : null; };
function buildCoinFallback(m) { lwBroken = true; chartDestroy(); buildCoin(m); }
const STYLES = [["candles", "Candles"], ["bars", "Bars"], ["line", "Line"], ["area", "Area"]];
const IND_DEF = [
  { id: "vol", name: "Volume", tag: () => "Vol", def: [], on: true, lim: [] },
  { id: "sma1", name: "Moving average", tag: p => "MA " + p[0], def: [20], on: true, lim: [[2, 500]] },
  { id: "sma2", name: "Moving average", tag: p => "MA " + p[0], def: [50], on: false, lim: [[2, 500]] },
  { id: "ema1", name: "Exponential MA", tag: p => "EMA " + p[0], def: [9], on: false, lim: [[2, 500]] },
  { id: "ema2", name: "Exponential MA", tag: p => "EMA " + p[0], def: [21], on: false, lim: [[2, 500]] },
  { id: "bb", name: "Bollinger Bands", tag: p => "BB " + p[0] + " " + p[1], def: [20, 2], on: false, lim: [[2, 500], [0.5, 5]] },
  { id: "vwap", name: "VWAP since launch", tag: () => "VWAP", def: [], on: false, lim: [] },
  { id: "rsi", name: "RSI", tag: p => "RSI " + p[0], def: [14], on: false, pane: true, lim: [[2, 200]] },
  { id: "macd", name: "MACD", tag: p => "MACD " + p.join(" "), def: [12, 26, 9], on: false, pane: true, lim: [[2, 200], [3, 300], [2, 100]] }
];
const IND = Object.fromEntries(IND_DEF.map(d => [d.id, d]));
const IND_COL = {
  light: { sma1: "#b26b00", sma2: "#2f5fb3", ema1: "#7a3fb8", ema2: "#0f7f73", bb: "#7d7d85", vwap: "#b8326f", rsi: "#7a3fb8", macd: "#2f5fb3", sig: "#b26b00" },
  dark: { sma1: "#f0a43a", sma2: "#6f9cf0", ema1: "#b48af0", ema2: "#3fc7b8", bb: "#8d8d94", vwap: "#f06fa8", rsi: "#b48af0", macd: "#6f9cf0", sig: "#f0a43a" }
};
const icol = k => IND_COL[pal === PAL.dark ? "dark" : "light"][k] || C.fg;
const indCfg = (() => {
  const sv = store.get("ind", {}) || {}, o = {};
  IND_DEF.forEach(d => { const s = sv[d.id] || {};
    o[d.id] = { on: typeof s.on === "boolean" ? s.on : d.on, p: d.def.map((v, i) => { const x = Array.isArray(s.p) ? +s.p[i] : NaN, [a, b] = d.lim[i]; return isFinite(x) ? clamp(x, a, b) : v; }) }; });
  return o;
})();
const indSig = () => IND_DEF.map(d => indCfg[d.id].on ? d.id + indCfg[d.id].p.join(",") : "").join(";");
const chartPref = { scale: ["log", "pct"].includes(store.get("cscale", "")) ? store.get("cscale", "") : "", magnet: store.get("magnet", true) !== false, kols: store.get("kols", true) !== false };
if (STYLES.some(s => s[0] === store.get("cstyle", ""))) coinUI.style = store.get("cstyle", "candles");
const CH = { sd: 4, step: 0, pendLR: null, chart: null, main: null, vol: null, lines: [], rk: "", vk: "", n: 0, first: 0, bars: [], times: [], ind: {}, K: 1, iv: 1, fullAt: 0, syncAt: 0, theme: "", openLine: null, openP: null, openAt: 0, hl: new Map(), markers: null, mkKey: "", hover: false, hoverI: -1, full: false, prim: null, leg: [], lastC: 1, ro: null };
const DW = { tool: "cross", list: [], sel: null, pend: null, hov: null, meas: null, drag: null, down: null, dragEnd: 0, addAt: 0, m: null };
const tsec = c => Math.floor(c.t / 1000);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function tparts(sec) { const d = new Date(sec * 1000), u = S.mode === "replay"; return { h: u ? d.getUTCHours() : d.getHours(), mi: u ? d.getUTCMinutes() : d.getMinutes(), s: d.getSeconds(), d: u ? d.getUTCDate() : d.getDate(), mo: u ? d.getUTCMonth() : d.getMonth() }; }
const tickFmt = (sec, kind) => { const p = tparts(+sec); return kind < 3 ? p.d + " " + MON[p.mo] : pad2(p.h) + ":" + pad2(p.mi) + (kind === 4 ? ":" + pad2(p.s) : ""); };
const crossTime = sec => { const p = tparts(+sec); return p.d + " " + MON[p.mo] + " " + pad2(p.h) + ":" + pad2(p.mi) + (coinUI.iv < 1 ? ":" + pad2(p.s) : "") + (S.mode === "replay" ? " UTC" : ""); };
function rgba(col, a) {
  let h = String(col || "").trim(); if (h[0] !== "#") return col;
  h = h.slice(1); if (h.length === 3) h = [...h].map(c => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
const fmtSig = v => { if (v == null || !isFinite(v)) return "—"; const a = Math.abs(v), s = v < 0 ? "−" : ""; if (!a) return "0"; if (a >= 1e6) return s + (a / 1e6).toFixed(2) + "M"; if (a >= 1e3) return s + (a / 1e3).toFixed(1) + "K"; return s + fmtPrice(a).replace("$", ""); };
/* axis precision follows the visible range, so a tight range never shows the same label twice */
function fmtPx(p, sd) {
  if (p == null || !isFinite(p)) return "—"; const a = Math.abs(p), sg = p < 0 ? "−" : "";
  if (a >= 1) return sg + "$" + a.toFixed(Math.max(2, sd - 1 - Math.floor(Math.log10(a))));
  if (a >= 0.001) return sg + "$" + a.toFixed(Math.min(12, sd - 1 - Math.floor(Math.log10(a))));
  const s = a.toFixed(20).split(".")[1]; let z = 0; while (s[z] === "0") z++;
  return sg + "$0.0" + [...String(z)].map(d => SUBD[d]).join("") + s.slice(z, z + sd);
}
const unitFmt = () => coinUI.unit === "mc" ? v => fmtMc(v, CH.step) : v => fmtPx(v, CH.sd);
function axisPrecision() {
  if (!CH.main) return; let r = null; try { r = CH.main.priceScale().getVisibleRange(); } catch (_) {}
  if (!r || chartPref.scale === "pct") return;
  const hi = Math.max(Math.abs(r.from), Math.abs(r.to)), span = Math.abs(r.to - r.from) || hi * 1e-3;
  CH.sd = clamp(Math.ceil(Math.log10(hi / span)) + 2, 4, 9); CH.step = span / 8;
}

/* indicator maths, all aligned to the bar array (null where undefined) */
function sma(v, n) { const o = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function ema(v, n) { const o = new Array(v.length).fill(null), k = 2 / (n + 1); let e = null, s = 0, c = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue; if (e == null) { s += x; if (++c === n) { e = s / n; o[i] = e; } } else { e = x * k + e * (1 - k); o[i] = e; } } return o; }
function bands(v, n, k) { const m = sma(v, n), up = m.slice(), lo = m.slice(); for (let i = n - 1; i < v.length; i++) { let q = 0; for (let j = i - n + 1; j <= i; j++) q += (v[j] - m[i]) ** 2; const sd = Math.sqrt(q / n); up[i] = m[i] + k * sd; lo[i] = m[i] - k * sd; } return [m, up, lo]; }
function vwapOf(b) { const o = []; let pv = 0, vv = 0; for (const c of b) { const v = c.v || 0; pv += (c.h + c.l + c.c) / 3 * v; vv += v; o.push(vv > 0 ? pv / vv : null); } return o; }
function rsiOf(v, n) {
  const o = new Array(v.length).fill(null), val = (g, l) => l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l); let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = val(g, l); } } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = val(g, l); } }
  return o;
}
function macdOf(v, f, s, g) { const a = ema(v, f), b = ema(v, s), m = v.map((_, i) => a[i] == null || b[i] == null ? null : a[i] - b[i]), si = ema(m, g); return [m, si, m.map((x, i) => x == null || si[i] == null ? null : x - si[i])]; }
function computeInd(b) {
  const c = b.map(x => x.c), on = id => indCfg[id].on, P = id => indCfg[id].p.map((x, i) => IND[id].id === "bb" && i === 1 ? x : Math.round(x)), o = {};
  for (const id of ["sma1", "sma2"]) if (on(id)) o[id] = sma(c, P(id)[0]);
  for (const id of ["ema1", "ema2"]) if (on(id)) o[id] = ema(c, P(id)[0]);
  if (on("bb")) o.bb = bands(c, P("bb")[0], P("bb")[1]);
  if (on("vwap")) o.vwap = vwapOf(b);
  if (on("rsi")) o.rsi = rsiOf(c, P("rsi")[0]);
  if (on("macd")) { let [f, s, g] = P("macd"); if (f > s) [f, s] = [s, f]; o.macd = macdOf(c, f, s, g); }
  return o;
}

/* ---------- build / teardown ---------- */
function chartOpts() {
  const L = LW();
  return {
    autoSize: true,
    layout: { background: { type: L.ColorType.Solid, color: C.bg }, textColor: C.dim, fontFamily: MONO, fontSize: 10, attributionLogo: false, panes: { separatorColor: C.rule2, separatorHoverColor: C.hover, enableResize: true } },
    grid: { vertLines: { color: C.rule }, horzLines: { color: C.rule } },
    crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: C.faint, width: 1, style: L.LineStyle.Dashed, labelBackgroundColor: C.fg }, horzLine: { color: C.faint, width: 1, style: L.LineStyle.Dashed, labelBackgroundColor: C.fg } },
    rightPriceScale: { borderColor: C.rule2 },
    timeScale: { borderColor: C.rule2, timeVisible: true, secondsVisible: coinUI.iv < 1, rightOffset: 4, minBarSpacing: 0.5, tickMarkFormatter: tickFmt },
    localization: { timeFormatter: crossTime, locale: "en-US" },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: CH.full },
    handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true }
  };
}
function chartDestroy() {
  if (CH.ro) { CH.ro.disconnect(); CH.ro = null; }
  if (CH.chart) { try { CH.chart.remove(); } catch (_) {} }
  Object.assign(CH, { pendLR: null, chart: null, main: null, vol: null, lines: [], rk: "", vk: "", n: 0, first: 0, bars: [], times: [], ind: {}, openLine: null, openP: null, hl: new Map(), markers: null, mkKey: "", hover: false, prim: null, leg: [] });
  if (CH.full) { CH.full = false; document.body.classList.remove("chart-full"); }
  Object.assign(DW, { tool: "cross", sel: null, pend: null, hov: null, meas: null, drag: null, down: null });
}
function chartInit(m) {
  const L = LW(), el = $("cChart"); if (!L || !el) return false;
  try { CH.chart = L.createChart(el, chartOpts()); } catch (e) { console.warn("chart init failed", e); CH.chart = null; return false; }
  CH.theme = C.bg + C.fg + MONO;
  DW.m = m; DW.list = loadDraw(m);
  CH.chart.subscribeCrosshairMove(onCross);
  CH.chart.timeScale().subscribeSizeChange(w => { if (CH.pendLR && w >= 60) { const f = CH.pendLR; CH.pendLR = null; try { CH.chart.timeScale().setVisibleLogicalRange(f()); } catch (_) {} } });
  CH.chart.subscribeDblClick(p => { if (!p.point || (p.paneIndex || 0) !== 0 || DW.tool !== "cross" || DW.pend || performance.now() - DW.addAt < 700 || hitDraw(p.point)) return; resetView(); });
  el.addEventListener("pointerdown", onDown, true);
  el.addEventListener("pointermove", onMove, true);
  el.addEventListener("pointerup", onUp, true);
  el.addEventListener("pointercancel", onUp, true);
  el.addEventListener("keydown", onKey);
  CH.ro = new ResizeObserver(() => { legendPos(); if (CH.prim) CH.prim.req(); }); CH.ro.observe(el);
  applyHeights();
  return true;
}
function applyHeights() {
  const el = $("cChart"); if (!el || !CH.chart) return;
  const subs = IND_DEF.filter(d => d.pane && indCfg[d.id].on).length, narrow = innerWidth < 640, base = narrow ? 330 : 440, sub = narrow ? 100 : 120;
  el.style.height = CH.full ? "" : (base + subs * sub) + "px";
  const ps = CH.chart.panes(); ps.forEach((p, i) => { try { p.setStretchFactor(i ? sub : base); } catch (_) {} });
}
function pf() {
  const mc = coinUI.unit === "mc", last = Math.max(CH.lastC || 1, 1e-12);
  const f = unitFmt();
  return { type: "custom", minMove: mc ? 1 : Math.pow(10, Math.floor(Math.log10(last)) - 4), formatter: v => v < 0 ? "" : f(v) };   // a price is never below zero: no "$-40K" in the volume margin
}
function rebuildSeries() {
  const L = LW(), ch = CH.chart;
  [CH.main, CH.vol, ...CH.lines.map(x => x.s)].forEach(s => { if (s) try { ch.removeSeries(s); } catch (_) {} });
  CH.main = CH.vol = null; CH.lines = []; CH.hl = new Map(); CH.openLine = null; CH.openP = null; CH.markers = null; CH.mkKey = "";
  if (indCfg.vol.on) {
    CH.vol = ch.addSeries(L.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "custom", minMove: 1, formatter: v => fmtUsd(v) }, lastValueVisible: false, priceLineVisible: false }, 0);
    CH.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
  }
  const st = coinUI.style, base = { priceFormat: pf(), lastValueVisible: true, priceLineVisible: true, priceLineColor: C.dim, priceLineStyle: L.LineStyle.Dotted, priceLineWidth: 1 };
  if (st === "line") CH.main = ch.addSeries(L.LineSeries, { ...base, color: C.fg, lineWidth: 2, crosshairMarkerRadius: 3, crosshairMarkerBorderColor: C.bg, crosshairMarkerBackgroundColor: C.fg }, 0);
  else if (st === "area") CH.main = ch.addSeries(L.AreaSeries, { ...base, lineColor: C.fg, topColor: rgba(C.fg, 0.07), bottomColor: rgba(C.fg, 0.07), lineWidth: 2, crosshairMarkerRadius: 3 }, 0);
  else if (st === "bars") CH.main = ch.addSeries(L.BarSeries, { ...base, upColor: C.up, downColor: C.down, thinBars: false }, 0);
  else CH.main = ch.addSeries(L.CandlestickSeries, { ...base, upColor: C.bg, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down }, 0);
  CH.main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: indCfg.vol.on ? 0.22 : 0.06 }, mode: chartPref.scale === "log" ? L.PriceScaleMode.Logarithmic : chartPref.scale === "pct" ? L.PriceScaleMode.Percentage : L.PriceScaleMode.Normal, borderColor: C.rule2 });
  const ov = (col, extra) => ch.addSeries(L.LineSeries, { color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf(), autoscaleInfoProvider: () => null, ...extra }, 0);
  for (const id of ["sma1", "sma2", "ema1", "ema2", "vwap"]) if (indCfg[id].on) CH.lines.push({ id, s: ov(icol(id)), get: o => o[id] });
  if (indCfg.bb.on) {
    CH.lines.push({ id: "bb", s: ov(icol("bb"), { lineStyle: L.LineStyle.Dashed }), get: o => o.bb[0] });
    CH.lines.push({ id: "bb", k: 1, s: ov(icol("bb")), get: o => o.bb[1] });
    CH.lines.push({ id: "bb", k: 2, s: ov(icol("bb")), get: o => o.bb[2] });
  }
  let pi = 1;
  if (indCfg.rsi.on) {
    const s = ch.addSeries(L.LineSeries, { color: icol("rsi"), lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: "custom", minMove: 0.01, formatter: v => v.toFixed(1) }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, pi);
    [70, 30].forEach(v => s.createPriceLine({ price: v, color: C.faint, lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: false }));
    s.priceScale().applyOptions({ borderColor: C.rule2, scaleMargins: { top: 0.1, bottom: 0.1 } });
    CH.lines.push({ id: "rsi", s, get: o => o.rsi, pane: pi }); pi++;
  }
  if (indCfg.macd.on) {
    const fm = { type: "custom", minMove: coinUI.unit === "mc" ? 0.01 : 1e-12, formatter: fmtSig };
    const h = ch.addSeries(L.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: fm }, pi);
    const a = ch.addSeries(L.LineSeries, { color: icol("macd"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fm }, pi);
    const g = ch.addSeries(L.LineSeries, { color: icol("sig"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fm }, pi);
    a.priceScale().applyOptions({ borderColor: C.rule2, scaleMargins: { top: 0.12, bottom: 0.08 } });
    CH.lines.push({ id: "macd", k: 2, s: h, hist: true, get: o => o.macd[2], pane: pi }, { id: "macd", s: a, get: o => o.macd[0], pane: pi }, { id: "macd", k: 1, s: g, get: o => o.macd[1], pane: pi });
  }
  if (!CH.prim) CH.prim = mkPrim();
  CH.main.attachPrimitive(CH.prim);
  applyHeights(); legendBuild();
}

/* ---------- data sync ---------- */
const barOf = c => coinUI.style === "line" || coinUI.style === "area" ? { time: tsec(c), value: c.c } : { time: tsec(c), open: c.o, high: c.h, low: c.l, close: c.c };
const volOf = c => ({ time: tsec(c), value: c.v || 0, color: rgba(c.c >= c.o ? C.up : C.down, 0.32) });
const histCol = v => rgba(v >= 0 ? C.up : C.down, 0.5);
function lineData(b, arr, hist) { const o = []; if (!arr) return o; for (let i = 0; i < b.length; i++) { const v = arr[i]; if (v != null && isFinite(v)) o.push(hist ? { time: tsec(b[i]), value: v, color: histCol(v) } : { time: tsec(b[i]), value: v }); } return o; }
function setAll(b, ind) {
  CH.main.setData(b.map(barOf));
  if (CH.vol) CH.vol.setData(b.map(volOf));
  for (const ln of CH.lines) ln.s.setData(lineData(b, ln.get(ind), ln.hist));
}
function pushAt(b, ind, i) {
  const c = b[i]; if (!c) return;
  CH.main.update(barOf(c)); if (CH.vol) CH.vol.update(volOf(c));
  for (const ln of CH.lines) { const arr = ln.get(ind), v = arr && arr[i]; if (v != null && isFinite(v)) ln.s.update(ln.hist ? { time: tsec(c), value: v, color: histCol(v) } : { time: tsec(c), value: v }); }
}
function chartSync(force) {
  if (!CH.chart || !coinUI.m) return;
  const tok = tokAny(coinUI.m); if (!tok) return;
  const now = performance.now(); if (!force && now - CH.syncAt < 90) return; CH.syncAt = now;
  const K = coinUI.unit === "mc" ? tok.supply : 1, raw = candlesIv(tok, tokTime(tok), coinUI.iv);
  const b = K === 1 ? raw : raw.map(c => ({ ...c, o: c.o * K, h: c.h * K, l: c.l * K, c: c.c * K })), n = b.length, first = n ? b[0].t : 0;
  if (n) CH.lastC = b[n - 1].c;
  const theme = C.bg + C.fg + MONO;
  if (theme !== CH.theme) { CH.theme = theme; CH.chart.applyOptions(chartOpts()); }
  const rk = [tok.m, coinUI.style, coinUI.unit, indSig(), theme].join("|"), vk = [tok.m, coinUI.iv, S.mode].join("|");
  const prevLR = CH.n ? CH.chart.timeScale().getVisibleLogicalRange() : null;   // read before a rebuild empties the time scale
  const rebuilt = rk !== CH.rk; if (rebuilt) { CH.rk = rk; rebuildSeries(); }
  const ind = computeInd(b);
  const full = rebuilt || force || vk !== CH.vk || n < CH.n || first !== CH.first || n > CH.n + 1 || now - CH.fullAt > 15000;
  try {
    if (full) {
      const ts = CH.chart.timeScale(), keep = prevLR && vk === CH.vk && n >= CH.n ? prevLR : null;
      const pre = keep && CH.first ? Math.max(0, b.findIndex(x => x.t >= CH.first)) : 0;
      setAll(b, ind);
      if (n) {
        if (keep) { const d = keep.to >= CH.n - 1.5 ? n - CH.n : pre; setLR(() => ({ from: keep.from + d, to: keep.to + d })); }
        else setLR(() => { const span = viewSpan(n); return { from: n + 4 - span, to: n + 4 }; });   // this build's bar count (CH.n is still the old one here)
      }
      CH.vk = vk; CH.fullAt = now;
    } else if (n) {
      const lb = b[n - 1], lk = n + "|" + lb.o + "|" + lb.h + "|" + lb.l + "|" + lb.c + "|" + lb.v;
      if (lk !== CH.lk) { if (n === CH.n + 1) pushAt(b, ind, n - 2); pushAt(b, ind, n - 1); }
    }
    if (n) { const lb = b[n - 1]; CH.lk = n + "|" + lb.o + "|" + lb.h + "|" + lb.l + "|" + lb.c + "|" + lb.v; }
  } catch (e) { console.warn("chart update", e); CH.fullAt = 0; }
  CH.n = n; CH.first = first; CH.bars = b; CH.times = b.map(x => x.t); CH.ind = ind; CH.K = K; CH.iv = coinUI.iv;
  if (CH.pendLR && CH.chart.timeScale().width() >= 60) setLR(CH.pendLR);
  axisPrecision(); roundLine(tok, K, now); markersSync(tok); hlineSync();
  if (!CH.hover) legendVals(n - 1); else if (full) legendVals(CH.hoverI = clamp(CH.hoverI, 0, Math.max(0, n - 1)));
  legendPos(); scaleBtns();
  const em = $("cEmpty"); if (em) { em.hidden = !!n; em.textContent = S.mode === "replay" ? "No trades yet at this point of the replay." : "Loading candles…"; }
  if (CH.prim) CH.prim.req();
  coinUI.paintMs = performance.now() - now;
}
/* a range set while the chart has no width (view still animating in) would pin the bar spacing at its minimum, so wait for a real width */
function setLR(fn) { const ts = CH.chart.timeScale(); if (ts.width() < 60) { CH.pendLR = fn; return; } CH.pendLR = null; ts.setVisibleLogicalRange(fn()); }
/* default view: about 7px per candle, at least 30 candles wide, newest on the right */
function viewSpan(n) { const w = CH.chart.timeScale().width() || ($("cChart") ? $("cChart").clientWidth - 70 : 600); return clamp(Math.round(w / 7), 30, 150); }
function roundLine(tok, K, now) {
  if (!CH.main || (now - CH.openAt < 1000 && CH.openLine)) return; CH.openAt = now;
  let p = null;
  if (tfOk(S.tf)) { const r = roundAt(S.tf, S.w), f = firstTime(tok), s0 = Math.max(r.rs, f); if (isFinite(s0) && s0 <= S.rt) p = twap(tok, s0, s0 + winOf(r)); }
  p = p != null && isFinite(p) && p > 0 ? p * K : null;
  if (p == null) { if (CH.openLine) { CH.main.removePriceLine(CH.openLine); CH.openLine = null; } return; }
  if (!CH.openLine) CH.openLine = CH.main.createPriceLine({ price: p, color: C.faint, lineWidth: 1, lineStyle: LW().LineStyle.Dashed, axisLabelVisible: true, title: "round open", axisLabelColor: C.faint, axisLabelTextColor: C.bg });
  else if (CH.openP !== p) CH.openLine.applyOptions({ price: p });
  CH.openP = p;
}
function barIndexAt(t) { const ts = CH.times, n = ts.length; if (!n || t < ts[0] || t > ts[n - 1] + CH.iv * 60000) return -1; let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ts[m] <= t) lo = m; else hi = m - 1; } return lo; }
function markersSync(tok) {
  const L = LW(); if (!L.createSeriesMarkers || !CH.main) return;
  const mine = S.my.b.filter(b => b.m === tok.m && b.md === S.mode).slice(0, 40);
  const key = mine.map(b => b.id).join() + "|" + kolKey(tok.m) + "|" + CH.n + "|" + CH.first + "|" + CH.iv + "|" + CH.rk; if (key === CH.mkKey) return; CH.mkKey = key;
  const ms = [];
  for (const b of mine) {
    let t = b.ts; if (S.mode === "replay") { try { t = recOf(roundAt(b.tf, b.ts, b.md), b.ts); } catch (_) { continue; } }
    const i = barIndexAt(t); if (i < 0) continue;
    ms.push({ time: tsec(CH.bars[i]), position: "belowBar", color: C.fg, shape: "arrowUp", text: (b.s < 10 ? b.s.toFixed(2) : Math.round(b.s)) + " · " + ((MK[b.mk] && MK[b.mk].short) || "bet") });
  }
  ms.sort((a, c) => a.time - c.time);
  try { if (!CH.markers) CH.markers = L.createSeriesMarkers(CH.main, ms); else CH.markers.setMarkers(ms); } catch (e) { console.warn("markers", e); }
}

/* ---------- legend: OHLC row above, indicator values inside each pane ---------- */
function legendBuild() {
  const el = $("cLeg"); if (!el) return; CH.leg = [];
  const row = (id, label, cols, pane) => `<div class="lg" data-pane="${pane || 0}"><span class="lt" style="color:${cols[0]}">${esc(label)}</span>${cols.map((c, k) => `<b data-v="${id}:${k}" style="color:${c}"></b>`).join("")}<button type="button" class="lx" data-rm="${id}" aria-label="Remove ${esc(label)}">×</button></div>`;
  const main = [], subs = [];
  if (indCfg.vol.on) main.push(row("vol", "Vol", [C.dim]));
  for (const id of ["sma1", "sma2", "ema1", "ema2", "vwap"]) if (indCfg[id].on) main.push(row(id, IND[id].tag(indCfg[id].p), [icol(id)]));
  if (indCfg.bb.on) main.push(row("bb", IND.bb.tag(indCfg.bb.p), [icol("bb"), icol("bb"), icol("bb")]));
  for (const ln of CH.lines) if (ln.pane && !subs.some(s => s.id === ln.id)) subs.push({ id: ln.id, pane: ln.pane });
  el.innerHTML = `<div class="lgp" data-pane="0">${main.join("")}</div>` + subs.map(s => `<div class="lgp" data-pane="${s.pane}">${row(s.id, IND[s.id].tag(indCfg[s.id].p), s.id === "macd" ? [icol("macd"), icol("sig"), C.dim] : [icol(s.id)], s.pane)}</div>`).join("");
  qsa("[data-rm]", el).forEach(b => b.onclick = e => { e.stopPropagation(); indCfg[b.dataset.rm].on = false; store.set("ind", indCfg); indMenu(); chartSync(true); });
  CH.leg = qsa("[data-v]", el).map(x => { const [id, k] = x.dataset.v.split(":"); return { x, id, k: +k }; });
  legendPos();
}
function legendPos() {
  const el = $("cLeg"), host = $("cChart"); if (!el || !host || !CH.chart) return;
  const top0 = host.getBoundingClientRect().top, ps = CH.chart.panes();
  qsa(".lgp", el).forEach(p => { const pane = ps[+p.dataset.pane], he = pane && pane.getHTMLElement(); if (!he) { p.hidden = true; return; } p.hidden = false; const t = Math.round(he.getBoundingClientRect().top - top0) + 4; if (p._t !== t) { p._t = t; p.style.top = t + "px"; } });
}
function legendVals(i) {
  const c = CH.bars[i], F = unitFmt();
  if ($("cOhlc")) {
    if (!c) $("cOhlc").innerHTML = "";
    else { const chg = c.o ? c.c / c.o - 1 : 0;
      $("cOhlc").innerHTML = `<span>${S.mode === "replay" ? utc(c.t, false) + " UTC" : local(c.t, false)}</span><span>O <b>${F(c.o)}</b></span><span>H <b>${F(c.h)}</b></span><span>L <b>${F(c.l)}</b></span><span>C <b>${F(c.c)}</b></span><span class="${chg >= 0 ? "up" : "down"}">${fmtPct(chg)}</span>${c.v ? `<span>Vol <b>${fmtUsd(c.v)}</b></span>` : ""}${c.open ? `<span class="dim">forming</span>` : ""}`; }
  }
  const o = CH.ind;
  for (const L of CH.leg) {
    let v = null, f = F;
    if (L.id === "vol") { v = c ? c.v : null; f = fmtUsd; }
    else if (L.id === "bb") v = o.bb && o.bb[[1, 0, 2][L.k]][i];
    else if (L.id === "rsi") { v = o.rsi && o.rsi[i]; f = x => x.toFixed(1); }
    else if (L.id === "macd") { v = o.macd && o.macd[L.k][i]; f = fmtSig; }
    else v = o[L.id] && o[L.id][i];
    const s = v == null || !isFinite(v) ? "—" : f(v); if (L.x.textContent !== s) L.x.textContent = s;
  }
}
function onCross(p) {
  const ok = p && p.point && p.logical != null && CH.n;
  const i = ok ? clamp(Math.round(p.logical), 0, CH.n - 1) : -1;
  CH.hover = ok && p.logical >= -0.5 && p.logical <= CH.n - 0.5;
  if (CH.hover) { if (i !== CH.hoverI) { CH.hoverI = i; legendVals(i); } } else if (CH.hoverI !== -1) { CH.hoverI = -1; legendVals(CH.n - 1); }
  DW.hov = ok && (p.paneIndex || 0) === 0 ? ptAt(p.point, true) : null;
  if (DW.meas && !DW.meas.done && DW.hov) DW.meas.b = DW.hov;
  if ((DW.pend || (DW.meas && !DW.meas.done)) && CH.prim) CH.prim.req();
}

/* ---------- drawings: trend lines, horizontal lines, measure ---------- */
function loadDraw(m) {
  const raw = store.get("dw." + m, []); if (!Array.isArray(raw)) return [];
  const okP = q => q && isFinite(q.t) && isFinite(q.p) && q.p > 0;
  return raw.filter(d => d && (d.k === "tl" ? okP(d.a) && okP(d.b) : d.k === "hl" && okP(d.a))).slice(0, 40).map(d => ({ id: String(d.id || rid()).slice(0, 20), k: d.k, a: { t: +d.a.t, p: +d.a.p }, b: d.b ? { t: +d.b.t, p: +d.b.p } : undefined }));
}
const saveDraw = () => { if (DW.m) store.set("dw." + DW.m, DW.list.slice(-40)); };
function lgOf(t) { const ts = CH.times, n = ts.length, iv = CH.iv * 60000; if (!n) return null; if (t <= ts[0]) return (t - ts[0]) / iv; if (t >= ts[n - 1]) return n - 1 + (t - ts[n - 1]) / iv; let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; } return lo + (t - ts[lo]) / (ts[hi] - ts[lo]); }
function tOfLg(l) { const ts = CH.times, n = ts.length, iv = CH.iv * 60000; if (!n || l == null) return null; if (l <= 0) return ts[0] + l * iv; if (l >= n - 1) return ts[n - 1] + (l - n + 1) * iv; const i = Math.floor(l); return ts[i] + (l - i) * (ts[i + 1] - ts[i]); }
function xOfL(l) { const ts = CH.chart.timeScale(), i = Math.floor(l), x0 = ts.logicalToCoordinate(i); return x0 == null ? null : x0 + (l - i) * ts.options().barSpacing; }
function lOfX(x) { const ts = CH.chart.timeScale(), i = ts.coordinateToLogical(x); if (i == null) return null; const x0 = ts.logicalToCoordinate(i); return x0 == null ? i : i + (x - x0) / ts.options().barSpacing; }
function pt(q) { if (!q || !CH.main) return null; const l = lgOf(q.t); if (l == null) return null; const x = xOfL(l), y = CH.main.priceToCoordinate(q.p * CH.K); return x == null || y == null ? null : { x, y }; }
function ptAt(px, snap) {
  if (!CH.main || !CH.n) return null;
  const l = lOfX(px.x); if (l == null) return null;
  if (snap && chartPref.magnet) { const i = Math.round(l); if (i >= 0 && i < CH.n) { const c = CH.bars[i]; let best = null;
    for (const v of [c.o, c.h, c.l, c.c]) { const y = CH.main.priceToCoordinate(v); if (y != null && Math.abs(y - px.y) < 14 && (!best || Math.abs(y - px.y) < best.d)) best = { d: Math.abs(y - px.y), v }; }
    if (best) return { t: CH.times[i], p: best.v / CH.K }; } }
  const p = CH.main.coordinateToPrice(px.y); if (p == null || !isFinite(p) || p <= 0) return null;
  return { t: tOfLg(l), p: p / CH.K };
}
function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy; let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0; t = clamp(t, 0, 1); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }
function hitDraw(px) {
  let best = null;
  for (const d of DW.list) {
    let dist;
    if (d.k === "tl") { const a = pt(d.a), b = pt(d.b); if (!a || !b) continue; dist = segDist(px, a, b); }
    else { const y = CH.main.priceToCoordinate(d.a.p * CH.K); if (y == null) continue; dist = Math.abs(px.y - y); }
    if (dist < 7 && (!best || dist < best.dist)) best = { d, dist };
  }
  return best && best.d;
}
function addDraw(d) { DW.addAt = performance.now(); d.id = rid(); DW.list.push(d); if (DW.list.length > 40) DW.list.shift(); DW.sel = d.id; saveDraw(); hlineSync(); toolBtns(); }
function delDraw(all) {
  if (!all && DW.sel) DW.list = DW.list.filter(d => d.id !== DW.sel); else DW.list = [];
  DW.sel = null; DW.meas = null; saveDraw(); hlineSync(); toolBtns(); if (CH.prim) CH.prim.req();
}
function hlineSync() {
  if (!CH.main) return; const L = LW(), seen = new Set();
  for (const d of DW.list) { if (d.k !== "hl") continue; seen.add(d.id);
    const price = d.a.p * CH.K, sel = DW.sel === d.id, key = price + "|" + sel + "|" + C.fg; let e = CH.hl.get(d.id);
    if (!e) { e = { line: CH.main.createPriceLine({ price, color: C.fg, lineWidth: sel ? 2 : 1, lineStyle: L.LineStyle.Solid, axisLabelVisible: true, axisLabelColor: C.fg, axisLabelTextColor: C.bg, title: "" }), key }; CH.hl.set(d.id, e); }
    else if (e.key !== key) { e.line.applyOptions({ price, lineWidth: sel ? 2 : 1, color: C.fg, axisLabelColor: C.fg, axisLabelTextColor: C.bg }); e.key = key; } }
  for (const [id, e] of CH.hl) if (!seen.has(id)) { try { CH.main.removePriceLine(e.line); } catch (_) {} CH.hl.delete(id); }
}
function mkPrim() {
  const P = { rq: null, req() { if (this.rq) this.rq(); }, attached(p) { this.rq = p.requestUpdate; }, detached() { this.rq = null; }, updateAllViews() {},
    paneViews() { return [{ zOrder: () => "top", renderer: () => ({ draw: tg => tg.useMediaCoordinateSpace(({ context, mediaSize }) => paintDraw(context, mediaSize)) }) }]; } };
  return P;
}
function paintDraw(x, ms) {
  if (!CH.main) return;
  x.save(); x.lineCap = "round"; x.font = `10px ${MONO}`;
  for (const d of DW.list) {
    if (d.k !== "tl") continue; const a = pt(d.a), b = pt(d.b); if (!a || !b) continue; const sel = DW.sel === d.id;
    x.strokeStyle = C.fg; x.lineWidth = sel ? 2 : 1.5; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    if (sel) for (const q of [a, b]) { x.fillStyle = C.bg; x.fillRect(q.x - 4, q.y - 4, 8, 8); x.lineWidth = 1; x.strokeRect(Math.round(q.x - 4) + .5, Math.round(q.y - 4) + .5, 7, 7); }
  }
  if (DW.pend && DW.hov) { const a = pt(DW.pend.a), b = pt(DW.hov); if (a && b) { x.strokeStyle = C.fg; x.lineWidth = 1.5; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.setLineDash([]); x.fillStyle = C.fg; x.fillRect(a.x - 3, a.y - 3, 6, 6); } }
  else if (DW.pend) { const a = pt(DW.pend.a); if (a) { x.fillStyle = C.fg; x.fillRect(a.x - 3, a.y - 3, 6, 6); } }
  const m = DW.meas;
  if (m) { const a = pt(m.a), b = pt(m.b);
    if (a && b) {
      const up = m.b.p >= m.a.p, col = up ? C.up : C.down, l = Math.min(a.x, b.x), t = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      x.fillStyle = rgba(col, 0.12); x.fillRect(l, t, w, h);
      x.strokeStyle = col; x.lineWidth = 1; const mx = Math.round(l + w / 2) + .5;
      x.beginPath(); x.moveTo(mx, a.y); x.lineTo(mx, b.y); x.moveTo(l, Math.round(b.y) + .5); x.lineTo(l + w, Math.round(b.y) + .5); x.stroke();
      const dirY = b.y < a.y ? 1 : -1; x.beginPath(); x.moveTo(mx - 4, b.y + dirY * 6); x.lineTo(mx, b.y); x.lineTo(mx + 4, b.y + dirY * 6); x.stroke();
      const la = lgOf(m.a.t), lb = lgOf(m.b.t), bars = la == null || lb == null ? 0 : Math.round(lb - la), dt = Math.abs(m.b.t - m.a.t), mins = Math.round(dt / 60000);
      const span = mins >= 60 ? Math.floor(mins / 60) + "h " + pad2(mins % 60) + "m" : mins + "m";
      const txt = `${fmtPct(m.b.p / m.a.p - 1)}  ${unitFmt()((m.b.p - m.a.p) * CH.K).replace("$-", "−$")}  ·  ${Math.abs(bars)} bars, ${span}`;
      const tw = x.measureText(txt).width + 14, bx = clamp(mx - tw / 2, 2, ms.width - tw - 2), by = clamp(up ? t - 26 : t + h + 6, 2, ms.height - 22);
      x.fillStyle = col; x.fillRect(bx, by, tw, 20); x.fillStyle = C.bg; x.textBaseline = "middle"; x.fillText(txt, bx + 7, by + 10.5);
    } }
  paintKols(x, ms);
  x.restore();
}
/* ---------- KOL bubbles: each KOL trade as the trader's avatar at its time and price; green ring buys, red ring sells ---------- */
const KIMG = new Map();
function kolImg(k) {
  if (!k.avatar) return null; let im = KIMG.get(k.avatar);
  if (!im) {
    im = new Image(); im.decoding = "async"; im.referrerPolicy = "no-referrer"; KIMG.set(k.avatar, im);
    im.onload = () => { if (CH.prim) CH.prim.req(); };
    im.onerror = () => { if (!im.dataset.px && /^https:/.test(k.avatar) && !window.claude) { im.dataset.px = "1"; im.src = "/api/img?u=" + encodeURIComponent(k.avatar); } else im.dead = true; };
    im.src = k.avatar;
  }
  return im.complete && im.naturalWidth && !im.dead ? im : null;
}
function paintKols(x, ms) {
  CH.kb = [];
  if (!chartPref.kols || !coinUI.m) return;
  const k = KOLS.get(coinUI.m), tok = tokAny(coinUI.m); if (!k || !k.trades.length || !tok) return;
  // one bubble per KOL, side and candle: several fills in the same candle add up
  const iv = (CH.iv || 1) * 60000, groups = new Map();
  for (const t of k.trades.slice(-400)) {
    const key = t.w + t.side + Math.floor(t.t / iv), g = groups.get(key), a = t.amt || 0;
    if (!g) groups.set(key, { ...t, sol: t.sol || 0, n: 1, amt: a, pa: t.px ? a : 0, pv: t.px ? t.px * a : 0 });
    else { g.sol += t.sol || 0; g.n++; g.amt += a; if (t.px) { g.pa += a; g.pv += t.px * a; } g.t = Math.max(g.t, t.t); }
  }
  for (const t of [...groups.values()].slice(-150)) {
    t.px = t.pa > 0 ? t.pv / t.pa : null;
    const p = t.px || pAt(tok, t.t); if (!p) continue;
    const q = pt({ t: t.t, p }); if (!q || q.x < -10 || q.x > ms.width + 10 || q.y < -10 || q.y > ms.height + 10) continue;
    const r = 6 + Math.min(4, Math.log10(1 + (t.sol || 0)) * 3), buy = t.side === "buy", ring = buy ? C.up : C.down, im = kolImg(t);
    x.save(); x.beginPath(); x.arc(q.x, q.y, r, 0, Math.PI * 2); x.closePath();
    if (im) { x.clip(); x.drawImage(im, q.x - r, q.y - r, r * 2, r * 2); }
    else { x.fillStyle = rgba(ring, 0.85); x.fill(); x.fillStyle = C.bg; x.font = `600 ${Math.round(r)}px ${MONO}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText((kolName(t).replace(/^@/, "")[0] || "?").toUpperCase(), q.x, q.y + 0.5); }
    x.restore();
    x.beginPath(); x.arc(q.x, q.y, r + 1, 0, Math.PI * 2); x.strokeStyle = ring; x.lineWidth = 2; x.stroke();
    CH.kb.push({ x: q.x, y: q.y, r: r + 2, t });
  }
}
// hovering a bubble shows who traded, how much and when
function kolHover(e) {
  const tip = $("cKolTip"); if (!tip) return;
  const px = localPt(e), hit = (CH.kb || []).slice().reverse().find(b => Math.hypot(b.x - px.x, b.y - px.y) <= b.r);
  if (!hit) { tip.hidden = true; return; }
  const t = hit.t, buy = t.side === "buy";
  tip.innerHTML = `<b>${esc(kolName(t))}</b> <span class="${buy ? "up" : "down"}">${buy ? "bought" : "sold"}</span> ${fmtKolSol(t.sol)}${t.n > 1 ? ` in ${t.n} trades` : ""}${t.px ? " at " + esc(coinUI.unit === "mc" && CH.K ? fmtUsd(t.px * CH.K) + " mcap" : fmtPrice(t.px)) : ""}<br><span class="dim">${esc(local(t.t, true))} · ${ago(nowW() - t.t)}</span>`;
  tip.hidden = false; const w = $("cChart").clientWidth;
  tip.style.left = Math.min(w - tip.offsetWidth - 8, hit.x + 12) + "px"; tip.style.top = Math.max(4, hit.y - tip.offsetHeight - 8) + "px";
}
function inMain(px) { if (!CH.chart) return false; const s = CH.chart.paneSize(0); return px.x >= 0 && px.y >= 0 && px.x < s.width && px.y < s.height; }
function localPt(e) { const r = $("cChart").getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hsOpts() { return { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: CH.full }; }
function onDown(e) {
  if (e.button !== 0 || !CH.main) return;
  const px = localPt(e); if (!inMain(px) || (e.target.closest && e.target.closest(".lg"))) { DW.down = null; return; }
  DW.down = { x: e.clientX, y: e.clientY, at: performance.now(), touch: e.pointerType === "touch", moved: false };
  if (DW.tool !== "cross" || !DW.sel) return;
  const d = DW.list.find(q => q.id === DW.sel); if (!d) return;
  let part = null;
  if (d.k === "tl") { const a = pt(d.a), b = pt(d.b); if (!a || !b) return; if (Math.hypot(px.x - a.x, px.y - a.y) < 10) part = "a"; else if (Math.hypot(px.x - b.x, px.y - b.y) < 10) part = "b"; else if (segDist(px, a, b) < 7) part = "body"; }
  else { const y = CH.main.priceToCoordinate(d.a.p * CH.K); if (y != null && Math.abs(px.y - y) < 7) part = "body"; }
  if (!part) return;
  const start = ptAt(px, false); if (!start) return;
  DW.drag = { d, part, start, orig: JSON.parse(JSON.stringify({ a: d.a, b: d.b })) };
  CH.chart.applyOptions({ handleScroll: false, handleScale: false });
  try { $("cChart").setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault(); e.stopPropagation();
}
function onMove(e) {
  if (DW.drag) {
    const g = DW.drag, q = ptAt(localPt(e), g.part !== "body"); if (!q) return;
    if (g.part === "a" || g.part === "b") g.d[g.part] = q;
    else { const dl = (lgOf(q.t) || 0) - (lgOf(g.start.t) || 0), r = q.p / g.start.p;
      g.d.a = { t: tOfLg(lgOf(g.orig.a.t) + dl), p: g.orig.a.p * r }; if (g.orig.b) g.d.b = { t: tOfLg(lgOf(g.orig.b.t) + dl), p: g.orig.b.p * r }; }
    if (g.d.k === "hl") hlineSync(); if (CH.prim) CH.prim.req();
    e.preventDefault(); e.stopPropagation(); return;
  }
  const dn = DW.down;
  if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 5) dn.moved = true;
  if (dn && e.buttons === 1 && (!dn.touch || CH.full) && CH.main) {
    const dx = e.clientX - dn.x, dy = e.clientY - dn.y;
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 0.8 && CH.main.priceScale().options().autoScale) { CH.main.priceScale().setAutoScale(false); scaleBtns(); }
  }
}
/* clicks are detected here, not via the library's click event, which swallows a quick second click at a new spot */
function onUp(e) {
  const dn = DW.down; DW.down = null;
  if (DW.drag) { DW.drag = null; DW.dragEnd = performance.now(); CH.chart.applyOptions({ handleScroll: hsOpts(), handleScale: chartOpts().handleScale }); saveDraw(); return; }
  if (!dn || dn.moved || e.type !== "pointerup" || performance.now() - dn.at > 700 || Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 5) return;
  const px = localPt(e); if (inMain(px)) onClick(px, e.shiftKey);
}
function onClick(px, shift) {
  if (!CH.main || performance.now() - DW.dragEnd < 300) return;
  const q = ptAt(px, true);
  if (DW.tool === "meas" || shift || (DW.meas && !DW.meas.done)) {
    if (!q) return;
    if (!DW.meas || DW.meas.done) DW.meas = { a: q, b: q, done: false }; else { DW.meas.b = q; DW.meas.done = true; if (DW.tool === "meas") setTool("cross"); }
  } else if (DW.tool === "tl") { if (!q) return; if (!DW.pend) DW.pend = { a: q }; else { addDraw({ k: "tl", a: DW.pend.a, b: q }); DW.pend = null; setTool("cross"); } }
  else if (DW.tool === "hl") { if (!q) return; addDraw({ k: "hl", a: q }); setTool("cross"); }
  else { DW.meas = null; const h = hitDraw(px); DW.sel = h ? h.id : null; hlineSync(); toolBtns(); }
  if (CH.prim) CH.prim.req();
}
function onKey(e) {
  if (e.key === "Escape") { if (DW.pend || DW.meas || DW.sel || DW.tool !== "cross") { DW.pend = null; DW.meas = null; DW.sel = null; setTool("cross"); hlineSync(); if (CH.prim) CH.prim.req(); e.stopPropagation(); } }
  else if ((e.key === "Delete" || e.key === "Backspace") && DW.sel) { e.preventDefault(); delDraw(false); }
}
addEventListener("keydown", e => { if (e.key === "Escape" && CH.full && !$("modalRoot").firstChild) setFull(false); });
function setTool(t) {
  DW.tool = t; if (t !== "tl") DW.pend = null; if (t !== "cross") DW.sel = null;
  const el = $("cChart"); if (el) el.classList.toggle("drawing", t !== "cross");
  toolBtns(); hlineSync(); if (CH.prim) CH.prim.req();
}
function toolBtns() {
  qsa("#cTools [data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === DW.tool)));
  const mg = $("cMagnet"); if (mg) mg.setAttribute("aria-pressed", String(chartPref.magnet));
  const kt = $("cKolT"); if (kt) kt.setAttribute("aria-pressed", String(chartPref.kols));
  const del = $("cDel"); if (del) { del.disabled = !DW.list.length && !DW.meas; const t = DW.sel ? "Delete the selected drawing" : "Clear all drawings"; del.title = t; del.setAttribute("aria-label", t); }
}
function scaleBtns() {
  if (!CH.main) return; const auto = CH.main.priceScale().options().autoScale;
  qsa("[data-sc]", $("cBox")).forEach(b => { const on = b.dataset.sc === "auto" ? auto : chartPref.scale === b.dataset.sc; if (b.getAttribute("aria-pressed") !== String(on)) b.setAttribute("aria-pressed", String(on)); });
}
function resetView() {
  if (!CH.chart) return; CH.main.priceScale().setAutoScale(true);
  if (CH.n) setLR(() => { const span = viewSpan(CH.n); return { from: CH.n + 4 - span, to: CH.n + 4 }; }); scaleBtns();
}
function setFull(on) {
  if (!CH.chart) return; CH.full = on;
  $("cBox").classList.toggle("full", on); document.body.classList.toggle("chart-full", on);
  const b = $("cFull"); if (b) { b.setAttribute("aria-pressed", String(on)); b.innerHTML = svgI(on ? "unfull" : "full"); const t = on ? "Leave full screen (Esc)" : "Full screen"; b.title = t; b.setAttribute("aria-label", t); }
  CH.chart.applyOptions({ handleScroll: hsOpts() }); applyHeights();
  requestAnimationFrame(() => { legendPos(); if (CH.prim) CH.prim.req(); });
}
const ICON = {
  kol: `<circle cx="5.5" cy="6" r="2.6"/><circle cx="11" cy="9.5" r="2.6"/><path d="M1.5 14c.6-2.2 2.2-3.2 4-3.2M7.6 14.5c.5-1.3 1.8-2 3.4-2s2.9.7 3.4 2"/>`,
  cross: `<path d="M8 2v12M2 8h12"/>`,
  tl: `<path d="M3 13L13 3"/><rect x="1.5" y="11.5" width="3" height="3"/><rect x="11.5" y="1.5" width="3" height="3"/>`,
  hl: `<path d="M1 8h14"/><rect x="6.5" y="6.5" width="3" height="3"/>`,
  meas: `<path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3M2 2h3M11 14h3"/>`,
  magnet: `<path d="M4 2v6a4 4 0 008 0V2M4 5h2M10 5h2"/>`,
  del: `<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5"/>`,
  full: `<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>`,
  unfull: `<path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/>`
};
const svgI = k => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">${ICON[k]}</svg>`;
function chartToolsHTML() {
  return `<div class="ctools" id="cTools" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
    <button type="button" data-tool="cross" title="Crosshair: select and move drawings" aria-label="Crosshair">${svgI("cross")}</button>
    <button type="button" data-tool="tl" title="Trend line: click two points" aria-label="Trend line">${svgI("tl")}</button>
    <button type="button" data-tool="hl" title="Horizontal line: click a price" aria-label="Horizontal line">${svgI("hl")}</button>
    <button type="button" data-tool="meas" title="Measure: click two points (or Shift + click)" aria-label="Measure">${svgI("meas")}</button>
    <i></i>
    <button type="button" id="cMagnet" title="Magnet: snap to open, high, low and close" aria-label="Magnet">${svgI("magnet")}</button>
    ${S.srv ? `<button type="button" id="cKolT" title="KOL trades on the chart" aria-label="Show KOL trades">${svgI("kol")}</button>` : ""}
    <button type="button" id="cDel" title="Clear all drawings" aria-label="Clear all drawings">${svgI("del")}</button>
    <i></i>
    <button type="button" id="cFull" title="Full screen (Esc to leave)" aria-label="Full screen" aria-pressed="false">${svgI("full")}</button>
  </div>`;
}
function indMenu() {
  const el = $("cIndMenu"); if (!el) return;
  el.innerHTML = `<div class="cm-h">Indicators</div>` + IND_DEF.map(d => `<div class="ir"><label><input type="checkbox" data-i="${d.id}"${indCfg[d.id].on ? " checked" : ""}><span>${esc(d.name)}</span></label><span class="ips">${d.def.map((_, k) => `<input type="number" class="ip" inputmode="decimal" data-i="${d.id}" data-k="${k}" value="${indCfg[d.id].p[k]}" min="${d.lim[k][0]}" max="${d.lim[k][1]}" step="${d.id === "bb" && k === 1 ? 0.1 : 1}" aria-label="${esc(d.name)} setting ${k + 1}">`).join("")}</span></div>`).join("")
    + `<div class="cm-f">Volume, MAs, Bollinger and VWAP sit on the price chart. RSI and MACD get their own panes.</div>`;
  qsa("input[type=checkbox]", el).forEach(c => c.onchange = () => { indCfg[c.dataset.i].on = c.checked; store.set("ind", indCfg); indBtn(); chartSync(true); });
  qsa("input.ip", el).forEach(c => c.onchange = () => { const d = IND[c.dataset.i], k = +c.dataset.k, [a, b] = d.lim[k]; let v = +c.value; if (!isFinite(v)) v = d.def[k]; v = clamp(d.id === "bb" && k === 1 ? Math.round(v * 10) / 10 : Math.round(v), a, b); c.value = v; indCfg[d.id].p[k] = v; store.set("ind", indCfg); chartSync(true); });
  indBtn();
}
function indBtn() { const b = $("cIndBtn"); if (b) { const n = IND_DEF.filter(d => indCfg[d.id].on).length; b.textContent = "Indicators" + (n ? " · " + n : ""); } }
function openIndMenu(open) {
  const el = $("cIndMenu"), b = $("cIndBtn"); if (!el || !b) return;
  el.hidden = !open; b.setAttribute("aria-expanded", String(open));
  if (open) { indMenu(); const f = el.querySelector("input"); if (f) f.focus(); }
}
document.addEventListener("pointerdown", e => { const el = $("cIndMenu"); if (el && !el.hidden && !e.target.closest(".cind")) openIndMenu(false); });
document.addEventListener("keydown", e => { const el = $("cIndMenu"); if (e.key === "Escape" && el && !el.hidden) { openIndMenu(false); $("cIndBtn").focus(); } });
function chartWire() {
  qsa("#cTools [data-tool]").forEach(b => b.onclick = () => { setTool(DW.tool === b.dataset.tool && b.dataset.tool !== "cross" ? "cross" : b.dataset.tool); $("cChart").focus({ preventScroll: true }); });
  $("cMagnet").onclick = () => { chartPref.magnet = !chartPref.magnet; store.set("magnet", chartPref.magnet); toolBtns(); };
  if ($("cKolT")) $("cKolT").onclick = () => { chartPref.kols = !chartPref.kols; store.set("kols", chartPref.kols); toolBtns(); if (!chartPref.kols && $("cKolTip")) $("cKolTip").hidden = true; if (CH.prim) CH.prim.req(); };
  $("cChart").addEventListener("pointermove", kolHover); $("cChart").addEventListener("pointerleave", () => { if ($("cKolTip")) $("cKolTip").hidden = true; });
  $("cDel").onclick = () => delDraw(!DW.sel);
  $("cIndBtn").onclick = () => openIndMenu($("cIndMenu").hidden);
  $("cFull").onclick = () => setFull(!CH.full);
  qsa("[data-act]", $("cBox")).forEach(b => b.onclick = () => {
    if (!CH.chart) return;
    if (b.dataset.act === "fit") { CH.main.priceScale().setAutoScale(true); CH.chart.timeScale().fitContent(); }
    else CH.chart.timeScale().scrollToRealTime();
    scaleBtns();
  });
  qsa("[data-sc]", $("cBox")).forEach(b => b.onclick = () => {
    if (!CH.main) return; const L = LW(), k = b.dataset.sc;
    if (k === "auto") CH.main.priceScale().setAutoScale(!CH.main.priceScale().options().autoScale);
    else { chartPref.scale = chartPref.scale === k ? "" : k; store.set("cscale", chartPref.scale); CH.main.priceScale().applyOptions({ mode: chartPref.scale === "log" ? L.PriceScaleMode.Logarithmic : chartPref.scale === "pct" ? L.PriceScaleMode.Percentage : L.PriceScaleMode.Normal, autoScale: true }); }
    scaleBtns();
  });
  toolBtns(); indBtn();
}
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__saChart = { CH, DW, ptAt, lOfX, tOfLg, lgOf };
