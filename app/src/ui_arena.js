/* ================= ui: router, top bar, strip, race chart, board ================= */
let curView = null;
function parseHash() {
  const h = decodeURIComponent((location.hash || "").slice(1));
  if (h.startsWith("coin-")) return { v: "coin", m: h.slice(5) };
  if (h === "arena" || h === "markets" || h === "squads") return { v: h };
  return { v: "arena" };
}
const tokAny = m => T.get(m) || TR.get(m) || TL.get(m);
function route() {
  const { v, m } = parseHash();
  if (v === "coin" && !tokAny(m)) {
    // a shared link to a coin this page hasn't loaded: look it up on Solana first
    if (isMintLike(m) && route.pending !== m) { route.pending = m; resolveCoin(m).then(ok => { route.pending = null; if (ok) route(); else if (location.hash !== "#arena") location.hash = "#arena"; }); return; }
    if (route.pending === m) return;
    if (location.hash !== "#arena") location.hash = "#arena"; return;
  }
  if (curView === v && (v !== "coin" || S.coin === m)) return;
  const prevEl = curView ? $("v-" + curView) : null, nextEl = $("v-" + v);
  S.view = v; S.coin = v === "coin" ? m : null;
  qsa(".nav a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const show = () => {
    qsa("section.view").forEach(el => { if (el !== nextEl) el.hidden = true; });     // only one view at a time, also when a link opens a coin page directly
    if (v === "coin") buildCoin(m);
    nextEl.hidden = false; enterAnim(nextEl);
    if (prevEl) window.scrollTo(0, 0);
    dirty.all = true; hideLens();
  };
  if (prevEl && prevEl !== nextEl && !reduced) { prevEl.classList.add("leave"); setTimeout(() => { prevEl.classList.remove("leave"); show(); }, 150); }
  else show();
  const p = $("navProg"); p.classList.remove("run"); void p.offsetWidth; p.classList.add("run");
  curView = v;
  if (v === "coin") setChatChan(m); else if (chatChan !== "g" && !isMember(chatChan)) setChatChan("g");
  setPresence();
}
function enterAnim(el) {
  [...el.children].forEach((c, i) => c.style.setProperty("--i", i));
  el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  qsa("[data-scr]", el).forEach(h => scramble(h, h.dataset.txt || (h.dataset.txt = h.textContent)));
  clearTimeout(el._enterT); el._enterT = setTimeout(() => el.classList.remove("enter"), 1100);
}
addEventListener("hashchange", route);

/* ---------- timeframe + mode controls ---------- */
function renderTf() {
  qsa(".seg.tf").forEach(seg => {
    seg.innerHTML = TFK.map(k => `<button type="button" data-tf="${k}" aria-pressed="${k === S.tf}"${tfOk(k) ? "" : ` disabled title="24-hour rounds need live data"`}>${k.toUpperCase()}</button>`).join("");
    qsa("button", seg).forEach(b => b.onclick = () => setTf(b.dataset.tf));
  });
}
function setTf(k) {
  if (!tfOk(k) || S.tf === k) return;
  S.tf = k; store.set("tf", k); renderTf(); dirty.all = true; S.lastLead = null;
  const el = $("v-" + S.view); if (el && (S.view === "arena" || S.view === "markets")) enterAnim(el);
}
function renderMode() {
  const live = S.mode !== "replay";
  if ($("modeDot")) { $("modeDot").className = "dot " + (live ? "live" : "rep"); $("modeTxt").textContent = live ? "Live" : "Replay"; }
}

/* ---------- round strip + timeline ---------- */
function renderStrip(w) {
  const r = roundAt(S.tf, w);
  if (!tfOk(S.tf)) { $("sTitle").textContent = "ROUND · " + S.tf.toUpperCase(); $("sSub").textContent = "Live only"; return; }
  const a = S.mode === "replay" ? utc(r.rs, false) + "–" + utc(r.rs + r.W, false) + " UTC · replay" : local(r.s, false) + "–" + local(r.e, false);
  $("sTitle").textContent = "ROUND · " + S.tf.toUpperCase();
  $("sSub").textContent = a;
  $("sLeft").textContent = dur(r.e - w);
  const el = (w - r.s) / r.W;
  $("sBets").textContent = el < BET_WIN ? dur(r.s + r.W * BET_WIN - w) : "closed";
  const st = lcs(r, w), nk = st.done + 1;
  $("sCut").textContent = st.warming ? "next round" : nk <= 5 ? dur(r.s + nk * r.W / 6 - w) + " · " + nk + "/5" : "final";
  if (st.warming) $("sBets").textContent = "next round";
  let P = 0; for (const mk of MKS) P += pool(r, mk).P;
  $("sPool").textContent = fmtSol(P);
}
function drawTimeline(w) {
  const cv = $("tlCv"); if (!cv.offsetParent) return;
  const { ctx, w: W, h: H } = fit(cv); ctx.clearRect(0, 0, W, H);
  const r = roundAt(S.tf, w), x0 = 4, x1 = W - 4, X = f => x0 + (x1 - x0) * f, y = 22;
  const el = clamp((w - r.s) / r.W, 0, 1);
  ctx.font = `9px ${MONO}`; ctx.textBaseline = "top";
  ctx.fillStyle = C.rule; ctx.fillRect(x0, y - 1, x1 - x0, 2);
  ctx.fillStyle = C.fg; ctx.fillRect(x0, y - 1, (x1 - x0) * el, 2);
  // bet window bracket
  ctx.strokeStyle = el < BET_WIN ? C.fg : C.faint; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X(0) + .5, y - 7); ctx.lineTo(X(0) + .5, y - 10); ctx.lineTo(X(BET_WIN) - .5, y - 10); ctx.lineTo(X(BET_WIN) - .5, y - 7); ctx.stroke();
  ctx.fillStyle = el < BET_WIN ? C.fg : C.faint; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText("BETS OPEN", X(0) + 4, y - 11.5);
  // checkpoints
  const st = lcs(r, w);
  for (let k = 1; k <= 5; k++) {
    const x = Math.round(X(k / 6)) + .5, done = k <= st.done;
    ctx.fillStyle = done ? C.fg : C.bg; ctx.strokeStyle = done ? C.fg : C.dim;
    ctx.beginPath(); ctx.rect(x - 3, y - 3, 6, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = done ? C.dim : C.faint; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("C" + k, x, y + 6);
  }
  // now cursor
  const nx = Math.round(X(el)) + .5;
  ctx.strokeStyle = C.fg; ctx.beginPath(); ctx.moveTo(nx, y - 6); ctx.lineTo(nx, y + 6); ctx.stroke();
  ctx.fillStyle = C.fg; ctx.beginPath(); ctx.moveTo(nx - 3.5, y + 9); ctx.lineTo(nx + 3.5, y + 9); ctx.lineTo(nx, y + 5); ctx.closePath(); ctx.fill();
}

/* ---------- race chart ---------- */
const race = $("race"); let raceCross = null, raceGeo = null, raceSpan = "fit", hover = null;
function raceSeries(r, w) {
  const te = recOf(r, w), out = [];
  const t1 = raceSpan === "full" ? r.rs + r.W : Math.max(te, r.rs + 60000);
  const N = clamp(Math.floor((race.clientWidth || 600) / 3), 60, 260);
  for (const tok of S.board.top) {
    const ft = firstTime(tok), a0 = Math.max(r.rs, ft === Infinity ? r.rs : ft);
    if (a0 > te) continue;
    const o = twap(tok, a0, Math.min(a0 + winOf(r), te)); if (!o) continue;
    const pts = [];
    for (let i = 0; i <= N; i++) { const t = a0 + (te - a0) * i / N; const p = pAt(tok, t); if (p != null) pts.push({ t, v: p / o - 1 }); }
    if (!pts.length) continue;
    out.push({ tok, pts, o, end: pts[pts.length - 1].v, col: colorOf(tok.m) });
  }
  return { ser: out, t0: r.rs, t1, te };
}
function drawRace(w) {
  if (!race.offsetParent) return;
  const { ctx, w: W, h: H } = fit(race); ctx.clearRect(0, 0, W, H);
  if (!tfOk(S.tf)) { ctx.fillStyle = C.dim; ctx.font = `12px ${MONO}`; ctx.textAlign = "center"; ctx.fillText("24-hour rounds run on live data. Open the data panel to go live.", W / 2, H / 2); return; }
  const r = roundAt(S.tf, w), { ser, t0, t1, te } = raceSeries(r, w);
  const narrow = W < 560, fs = narrow ? 10 : 11, labW = narrow ? 118 : 158;
  const L = narrow ? 42 : 52, R = labW + 16, Tp = 12, B = 24, pw = Math.max(20, W - L - R), ph = H - Tp - B;
  const X = t => L + (t - t0) / (t1 - t0) * pw;
  let mn = 0, mx = 0; ser.forEach(s => s.pts.forEach(p => { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; }));
  const pad = Math.max(0.0025, (mx - mn) * 0.08); mn -= pad; mx += pad;
  const Y = v => Tp + (mx - v) / (mx - mn) * ph;
  ctx.font = `${fs}px ${MONO}`; ctx.lineWidth = 1;
  const stp = niceStep(mx - mn, narrow ? 4 : 6); ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = Math.ceil(mn / stp) * stp; v <= mx + 1e-12; v += stp) {
    const yy = Math.round(Y(v)) + .5, zero = Math.abs(v) < stp / 1e3;
    ctx.strokeStyle = zero ? C.faint : C.rule; ctx.setLineDash(zero ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.dim; ctx.fillText((v > 0 ? "+" : v < 0 ? "−" : "") + +(Math.abs(v) * 100).toFixed(2) + "%", L - 8, yy);
  }
  // checkpoints + bet close markers, with labels that never overlap
  const labs = [{ x: L, t: "open", a: "left", c: C.dim, p: 0 }, { x: L + pw, t: raceSpan === "full" ? "close" : "now", a: "right", c: C.dim, p: 0 }];
  for (let k = 1; k <= 5; k++) { const t = r.rs + k * r.W / 6; if (t > t1) break; const x = Math.round(X(t)) + .5; ctx.strokeStyle = C.rule2; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke(); ctx.setLineDash([]); labs.push({ x, t: "C" + k, a: "center", c: C.faint, p: 2 }); }
  const bx = r.rs + r.W * BET_WIN; if (bx <= t1) { const x = Math.round(X(bx)) + .5; ctx.strokeStyle = C.faint; ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke(); labs.push({ x, t: "bets close", a: "center", c: C.dim, p: 1 }); }
  ctx.textBaseline = "top"; const placed = [];
  labs.sort((a, b) => a.p - b.p).forEach(l => { const wd = ctx.measureText(l.t).width, x0 = l.a === "left" ? l.x : l.a === "right" ? l.x - wd : l.x - wd / 2;
    if (placed.some(p => x0 < p[1] + 8 && x0 + wd > p[0] - 8)) return; placed.push([x0, x0 + wd]); ctx.fillStyle = l.c; ctx.textAlign = "left"; ctx.fillText(l.t, x0, Tp + ph + 8); });
  if (raceSpan === "full") { const x = Math.round(X(te)) + .5; ctx.strokeStyle = C.fg; ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke(); ctx.globalAlpha = 1; }
  const hov = hover && ser.some(s => s.tok.m === hover) ? hover : null;
  const line = (s, a, lw) => { ctx.globalAlpha = a; ctx.strokeStyle = s.col; ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
    let lx = -1e9; const n = s.pts.length;
    for (let i = 0; i < n; i++) { const p = s.pts[i], x = X(p.t); if (i && i < n - 1 && x - lx < 0.8) continue; const yy = Y(p.v); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); lx = x; }
    ctx.stroke(); ctx.globalAlpha = 1; };
  ser.forEach(s => { if (s.tok.m !== hov) line(s, hov ? .12 : 1, 1.5); });
  if (hov) { const s = ser.find(s => s.tok.m === hov); line(s, 1, 2.6); }
  const tc = raceCross && raceCross.x >= L && raceCross.x <= L + pw ? t0 + (raceCross.x - L) / pw * (t1 - t0) : null;
  const tcc = tc != null ? Math.min(tc, te) : null;
  const items = ser.map(s => {
    let v = s.end, x = X(te);
    if (tcc != null) { x = X(tcc); const p = pAt(s.tok, tcc); v = tcc >= s.pts[0].t && p != null ? p / s.o - 1 : null; }
    return { s, v, x, yl: v == null ? null : Y(v), y: v == null ? Y(s.end) : Y(v) };
  });
  items.forEach(it => { if (it.yl == null) return; ctx.globalAlpha = hov && it.s.tok.m !== hov ? .25 : 1; ctx.fillStyle = it.s.col; ctx.beginPath(); ctx.arc(it.x, it.yl, it.s.tok.m === hov ? 3.8 : 2.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; });
  if (tcc != null) {
    const x = Math.round(X(tcc)) + .5; ctx.strokeStyle = C.fg; ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke(); ctx.globalAlpha = 1;
    const lab = dur(tcc - r.rs) + (S.mode === "replay" ? " · " + utc(tcc) : ""); ctx.font = `500 ${fs}px ${MONO}`; const tw = ctx.measureText(lab).width + 10;
    const bxx = Math.min(Math.max(x - tw / 2, L), L + pw - tw); ctx.fillStyle = C.fg; ctx.fillRect(bxx, Tp + ph + 4, tw, fs + 8);
    ctx.fillStyle = C.bg; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(lab, bxx + 5, Tp + ph + 7);
  }
  spread(items, narrow ? fs + 5.5 : fs + 6.5, Tp + 8, Tp + ph - 8);
  const lx = L + pw + 14; ctx.textBaseline = "middle";
  items.forEach(it => {
    const dim = hov && it.s.tok.m !== hov; ctx.globalAlpha = dim ? .32 : 1;
    if (tcc == null && it.yl != null) { ctx.strokeStyle = it.s.col; ctx.lineWidth = 1; ctx.globalAlpha = dim ? .2 : .5; ctx.beginPath(); ctx.moveTo(it.x + 5, it.yl); ctx.lineTo(lx - 3, it.ly); ctx.stroke(); ctx.globalAlpha = dim ? .32 : 1; }
    const rr = narrow ? 6 : 7; logoDot(ctx, it.s.tok, lx + rr, it.ly, rr, it.s.col);
    ctx.fillStyle = C.fg; ctx.textAlign = "left"; ctx.font = `${it.s.tok.m === hov ? 600 : 500} ${fs}px ${MONO}`;
    const name = it.s.tok.s.length > 9 ? it.s.tok.s.slice(0, 8) + "…" : it.s.tok.s; ctx.fillText(name, lx + rr * 2 + 7, it.ly);
    ctx.textAlign = "right"; ctx.font = `${fs}px ${MONO}`; ctx.fillStyle = it.v == null ? C.faint : it.v >= 0 ? C.up : C.down;
    ctx.fillText(it.v == null ? "—" : fmtPct(it.v, narrow ? 1 : 2), W - 1, it.ly); ctx.globalAlpha = 1;
  });
  if (!ser.length) { ctx.fillStyle = C.dim; ctx.textAlign = "center"; ctx.font = `12px ${MONO}`; ctx.fillText("Waiting for prices…", L + pw / 2, Tp + ph / 2); }
  raceGeo = { L, pw, Tp, ph, X, Y, t0, t1, te, ser, items };
}
function raceHit(e) {
  if (!raceGeo) return;
  const rc = race.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, g = raceGeo;
  if (x >= g.L && x <= g.L + g.pw) {
    raceCross = { x, y }; const tc = Math.min(g.te, g.t0 + (x - g.L) / g.pw * (g.t1 - g.t0)); let best = null, bd = 18;
    g.ser.forEach(s => { if (tc < s.pts[0].t) return; const p = pAt(s.tok, tc); if (p == null) return; const d = Math.abs(g.Y(p / s.o - 1) - y); if (d < bd) { bd = d; best = s.tok.m; } });
    setHover(best);
  } else if (x > g.L + g.pw) { raceCross = null; const it = g.items.find(it => Math.abs(it.ly - y) < 9); setHover(it ? it.s.tok.m : null); }
  else { raceCross = null; setHover(null); }
  dirty.race = true;
}
race.addEventListener("pointermove", raceHit);
race.addEventListener("pointerdown", raceHit);
race.addEventListener("pointerleave", () => { raceCross = null; setHover(null); dirty.race = true; });
race.addEventListener("click", () => { if (hover) location.hash = "#coin-" + hover; });
qsa("#raceSeg button").forEach(b => b.addEventListener("click", () => { raceSpan = b.dataset.r; qsa("#raceSeg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); dirty.race = true; }));
function setHover(m) { if (hover === m) return; hover = m; rowEls.forEach((el, k) => el.classList.toggle("hot", k === m)); dirty.race = true; }

/* ---------- board table ---------- */
const COLS = [["rk", "22px", "#", 22], ["tok", "minmax(118px,1fr)", "Coin", 140], ["price", "86px", "Price", 86], ["round", "70px", "Round", 70], ["m5", "62px", "5m", 62], ["mc", "76px", "Mcap", 76], ["liq", "70px", "Liq", 70], ["vol", "70px", "Vol 1h", 70], ["txn", "64px", "Trades 1h", 64], ["age", "48px", "Age", 48], ["chart", "minmax(56px,96px)", "15 min", 60], ["squad", "48px", "Squad", 48], ["back", "56px", "", 56]];
const DROP = ["liq", "txn", "vol", "age", "squad", "m5", "price", "mc", "back", "chart"];
const NUMC = new Set(["price", "round", "m5", "mc", "liq", "vol", "txn", "age", "squad"]);
function layoutCols() {
  const tbl = $("tbl"), Wd = tbl.clientWidth - 12, hide = new Set();
  const need = () => COLS.filter(([k]) => !hide.has(k)).reduce((a, c) => a + c[3] + 12, -12);
  for (const k of DROP) { if (need() <= Wd) break; hide.add(k); }
  tbl.style.setProperty("--cols", COLS.filter(([k]) => !hide.has(k)).map(([, v]) => v).join(" "));
  qsa("[data-c]", tbl).forEach(el => el.classList.toggle("off", hide.has(el.dataset.c)));
  S.hideCols = hide;
}
function headHTML() { return COLS.map(([k, , lab]) => `<span data-c="${k}" class="${NUMC.has(k) ? "num" : ""}">${lab}</span>`).join(""); }
function rowHTML(tok, bench) {
  return `<span class="rk" data-c="rk"></span>
  <span class="tk-cell" data-c="tok">${avHTML(tok, 20, 2)}<b>${esc(tok.s)}</b><span class="nm">${esc(tok.n)}</span></span>
  <span class="num" data-c="price"></span><span class="num" data-c="round"></span><span class="num" data-c="m5"></span>
  <span class="num" data-c="mc"></span><span class="num" data-c="liq"></span><span class="num" data-c="vol"></span><span class="num" data-c="txn"></span>
  <span class="num" data-c="age"></span><span data-c="chart"><canvas class="spark"></canvas></span><span class="num" data-c="squad"></span>
  <span class="back" data-c="back"><span class="btn ${bench ? "btn-quiet" : "btn-quiet"} btn-xs" data-act="bet">Back</span></span>`;
}
const rowEls = new Map();
function ensureRow(tok, bench) {
  let el = rowEls.get(tok.m);
  if (el && el.dataset.bench === String(bench)) return el;
  if (el) el.remove();
  el = document.createElement("div"); el.className = "row" + (bench ? " bench" : ""); el.dataset.m = tok.m; el.dataset.bench = String(bench); el.tabIndex = 0;
  el.setAttribute("role", "link"); el.setAttribute("aria-label", `${tok.s}, ${tok.n}. Open the coin page.`);
  el.innerHTML = rowHTML(tok, bench);
  el.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") { setHover(tok.m); showLens(tok.m, el); } });
  el.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") { setHover(null); hideLens(); } });
  el.addEventListener("click", e => { hideLens(); if (e.target.closest("[data-act=bet]")) { openBet(tok.m, bestMarket(tok.m)); return; } location.hash = "#coin-" + tok.m; });
  el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); location.hash = "#coin-" + tok.m; } });
  el.refs = {}; qsa("[data-c]", el).forEach(c => el.refs[c.dataset.c] = c); el.refs.spark = el.querySelector(".spark");
  if (S.hideCols) qsa("[data-c]", el).forEach(c => c.classList.toggle("off", S.hideCols.has(c.dataset.c)));
  rowEls.set(tok.m, el); return el;
}
function layoutRows() {
  const rows = $("rows"), bench = $("bench"), first = new Map();
  rowEls.forEach((el, m) => { if (el.isConnected) first.set(m, el.getBoundingClientRect().top); });
  S.board.top.forEach(t => rows.appendChild(ensureRow(t, false)));
  S.board.bench.forEach(t => bench.appendChild(ensureRow(t, true)));
  const keepT = new Set(S.board.top.map(t => t.m)), keepB = new Set(S.board.bench.map(t => t.m));
  [...rows.children].forEach(el => { if (!keepT.has(el.dataset.m)) el.remove(); });
  [...bench.children].forEach(el => { if (!keepB.has(el.dataset.m)) el.remove(); });
  for (const [m, el] of rowEls) if (!el.isConnected) rowEls.delete(m);
  if (reduced) return;
  [...rows.children, ...bench.children].forEach(el => {
    const a = first.get(el.dataset.m); if (a == null) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500 }); return; }
    const dy = a - el.getBoundingClientRect().top; if (Math.abs(dy) < 1) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 560, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}
function updateRows(w) {
  const r = roundAt(S.tf, w), tNow = S.rt, ok = tfOk(S.tf);
  const sq = new Map(); for (const [, d] of allMemberDocs()) for (const m of Object.keys((d && d.sq) || {})) sq.set(m, (sq.get(m) || 0) + 1);
  const all = S.board.top.concat(S.board.bench);
  all.forEach((tok, i) => {
    const el = rowEls.get(tok.m); if (!el) return; const R = el.refs, p = pAt(tok, tNow);
    R.rk.textContent = i < 15 ? i + 1 : "—";
    R.price.textContent = fmtPrice(p);
    const rr = ok ? spotRet(tok, r, w) : null; R.round.textContent = fmtPct(rr); tone(R.round, rr);
    const p5 = pAt(tok, tNow - 300e3), m5 = p5 && p ? p / p5 - 1 : null; R.m5.textContent = fmtPct(m5, 1); tone(R.m5, m5);
    R.mc.textContent = fmtUsd(p == null ? null : p * tok.supply);
    R.liq.textContent = fmtUsd(tok.liq); R.vol.textContent = fmtUsd(tok.vol[1]); R.txn.textContent = fmtNum(tok.tx[1]);
    R.age.textContent = tok.born ? age(tNow - tok.born) : "—";
    R.squad.textContent = sq.get(tok.m) || "—";
    const nm = R.tok, has = nm.querySelector(".badge");
    const isNew = tok.firstT !== Infinity && tNow - tok.firstT < 10 * 60e3 && tNow - tok.firstT >= 0;
    if (isNew && !has) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "New"; nm.insertBefore(b, nm.querySelector(".nm")); }
    if (!isNew && has) has.remove();
  });
  $("cutNote").textContent = S.board.bench.length ? S.board.bench.length + " coins" : "";
}
function drawSparks() {
  const r = roundAt(S.tf, S.w);
  rowEls.forEach((el, m) => {
    if (!el.isConnected || !el.refs.spark || !el.refs.spark.offsetParent) return;
    const tok = T.get(m); if (!tok) return; const cvs = el.refs.spark, { ctx, w, h } = fit(cvs); ctx.clearRect(0, 0, w, h);
    const t1 = S.rt, t0 = t1 - 15 * 60e3, pts = [];
    for (let i = 0; i <= 60; i++) { const t = t0 + (t1 - t0) * i / 60, p = pAt(tok, t); if (p != null) pts.push({ t, p }); }
    if (pts.length < 2) return;
    let mn = Infinity, mx = -Infinity; pts.forEach(p => { if (p.p < mn) mn = p.p; if (p.p > mx) mx = p.p; }); const pd = (mx - mn) * .15 || mx * .002; mn -= pd; mx += pd;
    const X = t => (t - t0) / (t1 - t0) * (w - 4) + 1, Y = p => h - 2 - (p - mn) / (mx - mn) * (h - 4);
    const bench = el.dataset.bench === "true"; ctx.strokeStyle = bench ? C.faint : colorOf(m); ctx.lineWidth = 1.25; ctx.lineJoin = "round"; ctx.beginPath();
    pts.forEach((p, k) => k ? ctx.lineTo(X(p.t), Y(p.p)) : ctx.moveTo(X(p.t), Y(p.p))); ctx.stroke();
    const e = pts[pts.length - 1]; ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(X(e.t), Y(e.p), 2, 0, Math.PI * 2); ctx.fill();
    if (r && tfOk(S.tf) && r.rs > t0) { const x = X(r.rs); ctx.strokeStyle = C.rule2; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.setLineDash([]); }
  });
}

/* ---------- lens: the row's small chart grows into a big one ---------- */
const lens = $("lens"); let lensM = null, lensOpen = false;
function showLens(m, row) {
  if (!hoverable) return;
  lensM = m; const tok = T.get(m); if (!tok) return;
  $("lAv").innerHTML = avHTML(tok, 28, 2); $("lSym").textContent = tok.s; $("lName").textContent = tok.n;
  fillLens();
  const anchor = (row.querySelector('[data-c="chart"]:not(.off)') || row).getBoundingClientRect(), rr = row.getBoundingClientRect();
  const lw = Math.min(440, innerWidth - 32), lh = lens.offsetHeight || 360;
  let x = Math.min(Math.max(16, anchor.right - lw), innerWidth - lw - 16);
  let y = rr.bottom + 8; if (y + lh > innerHeight - 12) y = rr.top - lh - 8; if (y < 60) y = Math.max(60, Math.min(innerHeight - lh - 12, rr.bottom + 8));
  lens.style.left = x + "px"; lens.style.top = y + "px";
  lens.style.transformOrigin = `${anchor.left + anchor.width / 2 - x}px ${anchor.top + anchor.height / 2 - y}px`;
  if (!lensOpen) { lens.style.transition = "none"; lens.classList.remove("on"); void lens.offsetWidth; lens.style.transition = ""; lens.classList.add("on"); lensOpen = true; }
  drawLens();
}
function hideLens() { lens.classList.remove("on"); lensOpen = false; lensM = null; }
function metaRows(tok) {
  const p = pAt(tok, S.rt), sq = squadOf(tok.m);
  return [["Market cap", fmtUsd(p == null ? null : p * tok.supply)], ["Liquidity", fmtUsd(tok.liq)], ["Vol 24h", fmtUsd(tok.vol[3])],
    ["Trades 1h", fmtNum(tok.tx[1])], ["Buys / sells 1h", tok.bs ? fmtNum(tok.bs[0]) + " / " + fmtNum(tok.bs[1]) : "—"], ["Age", tok.born ? age(S.rt - tok.born) : "—"],
    ["Venue", (tok.dex || "—") + (tok.quote && tok.quote !== "SOL" ? " · " + tok.quote : "")], ["Squad", sq.members.length + " members"], ["Tier", TIERS[tierOf(p * tok.supply || 0)].name]];
}
function fillLens() {
  if (!lensM) return; const tok = T.get(lensM); if (!tok) return;
  const r = roundAt(S.tf, S.w), p = pAt(tok, S.rt), rr = tfOk(S.tf) ? spotRet(tok, r, S.w) : null;
  $("lPx").textContent = fmtPrice(p); $("lPct").textContent = fmtPct(rr); $("lPct").className = "num " + (rr == null ? "dim" : rr >= 0 ? "up" : "down");
  $("lMeta").innerHTML = metaRows(tok).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("lMint").textContent = "Mint " + short(tok.m);
}
function drawLens() {
  if (!lensM) return; const tok = T.get(lensM); if (!tok) return;
  const cvs = $("lensCv"), { ctx, w, h } = fit(cvs); ctx.clearRect(0, 0, w, h);
  const t1 = S.rt, t0 = Math.max(t1 - 60 * 60e3, tok.firstT === Infinity ? t1 - 60 * 60e3 : tok.firstT), pts = [];
  for (let i = 0; i <= 150; i++) { const t = t0 + (t1 - t0) * i / 150, p = pAt(tok, t); if (p != null) pts.push({ t, p }); }
  if (pts.length < 2) return;
  const inT = inTop(tok.m), col = inT ? colorOf(tok.m) : C.dim, r = roundAt(S.tf, S.w), Lm = 0, Rm = 72, Tm = 6, Bm = 18, pw = w - Lm - Rm, ph = h - Tm - Bm;
  let mn = Infinity, mx = -Infinity; pts.forEach(p => { if (p.p < mn) mn = p.p; if (p.p > mx) mx = p.p; }); const pd = (mx - mn) * .1 || mx * .002; mn -= pd; mx += pd;
  const X = t => Lm + (t - t0) / (t1 - t0 || 1) * pw, Y = p => Tm + (mx - p) / (mx - mn) * ph;
  ctx.font = `10px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { const v = mn + (mx - mn) * k / 3, y = Math.round(Y(v)) + .5; ctx.strokeStyle = C.rule; ctx.beginPath(); ctx.moveTo(Lm, y); ctx.lineTo(Lm + pw, y); ctx.stroke(); ctx.fillStyle = C.dim; ctx.fillText(fmtPrice(v), Lm + pw + 8, y); }
  if (tfOk(S.tf) && r.rs > t0) { const x = Math.round(X(r.rs)) + .5; ctx.strokeStyle = C.faint; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, Tm); ctx.lineTo(x, Tm + ph); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.dim; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("round open", x, Tm + ph + 5); }
  ctx.strokeStyle = col; ctx.lineWidth = 1.75; ctx.lineJoin = "round"; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(X(p.t), Y(p.p)) : ctx.moveTo(X(p.t), Y(p.p))); ctx.stroke();
  const e = pts[pts.length - 1]; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(e.t), Y(e.p), 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.dim; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText("−" + Math.round((t1 - t0) / 60000) + "m", Lm, Tm + ph + 5); ctx.textAlign = "right"; ctx.fillText("now", Lm + pw, Tm + ph + 5);
}

/* ---------- wallet button ---------- */
function renderWallet() {
  const b = $("walletBtn"); if (!b) return;
  if (S.srv) {
    if (!S.me.id) { b.textContent = "Log in"; b.classList.add("btn-solid"); return; }
    const addr = SRV.me && SRV.me.wallet; b.textContent = (addr ? short(addr) + " · " : "") + fmtSol(+(SRV.bal[CUR] || 0)); b.classList.remove("btn-solid"); return;
  }
  const bal = fmtSol(S.my.bal);
  b.textContent = S.wallet ? short(S.wallet.addr) + " · " + bal : bal;
  b.classList.toggle("btn-solid", !S.wallet);
}
