/* ================= ui: markets (top gainer, last coin standing, hype delta) ================= */
let mkBuiltFor = "";
function buildMarkets() {
  const key = S.tf + S.mode; if (mkBuiltFor === key && $("tList")) return; mkBuiltFor = key;
  const att = { "15m": "5m pace vs 1h", "30m": "5m pace vs 1h", "1h": "1h pace vs 6h", "24h": "6h pace vs 24h" }[S.tf];
  $("mkTop").innerHTML = `<div class="mk-h"><div><h3 data-scr>Top gainer</h3><p>Pick the coin with the best TWAP return over the round. The top 15 and the coins on deck are all in play.</p></div><button class="btn btn-solid btn-xs" type="button" data-bet="top">Bet</button></div>
    <div class="mk-k"><span>Pool<b id="tPool">—</b></span><span>Bettors<b id="tPeople">—</b></span><span>Bets<b id="tWin">—</b></span></div>
    <div><div class="st st-h"><span>#</span><span>Coin</span><span class="num">TWAP</span><span class="num">Share</span><span class="num">Odds</span></div><div id="tList"></div></div>`;
  $("mkLcs").innerHTML = `<div class="mk-h"><div><h3 data-scr>Last coin standing</h3><p>The bottom coins are cut at each sixth of the round, 3·3·3·2·2, until two duel to the close. Back any survivor at any time. Earlier bets carry more weight, and losing pools flow to the survivors.</p></div><button class="btn btn-solid btn-xs" type="button" data-bet="lcs">Bet</button></div>
    <div class="mk-k"><span>Pool<b id="lPool">—</b></span><span>Alive<b id="lAlive">—</b></span><span>Next cut<b id="lNext">—</b></span><span>Weight now<b id="lW">—</b></span></div>
    <canvas class="bk" id="bkCv" aria-label="Elimination bracket"></canvas>
    <div class="next" id="lZone"></div>`;
  $("mkHype").innerHTML = `<div class="mk-h"><div><h3 data-scr>Hype delta</h3><p>Score = TWAP return ÷ (1 + growth in trading pace). One pool pays the most efficient move, the other the biggest hype bust: pace up, price down.</p></div></div>
    <div class="mk-k"><span>Pools<b id="hPool">—</b></span><span>Pace<b>${att}</b></span><span>Bets<b id="hWin">—</b></span></div>
    <canvas class="hq" id="hqCv" aria-label="Attention growth against return"></canvas>
    <div class="pools2"><div><h4><span>Most efficient</span><button class="btn btn-quiet btn-xs" type="button" data-bet="eff">Bet</button></h4><div id="effList"></div></div>
      <div><h4><span>Biggest bust</span><button class="btn btn-quiet btn-xs" type="button" data-bet="bust">Bet</button></h4><div id="bustList"></div></div></div>`;
  qsa("[data-bet]", $("mkGrid")).forEach(b => b.onclick = () => openBet(null, b.dataset.bet));
  const bk = $("bkCv"); bk.addEventListener("pointermove", bkHit); bk.addEventListener("pointerleave", () => { bkHover = null; dirty.mk = true; });
  bk.addEventListener("click", () => { if (bkHover) openBet(bkHover, "lcs"); });
  const hq = $("hqCv"); hq.addEventListener("pointermove", hqHit); hq.addEventListener("pointerleave", () => { hqHover = null; dirty.mk = true; });
  hq.addEventListener("click", () => { if (hqHover) location.hash = "#coin-" + hqHover; });
}
function stRow(i, tok, val, share, odds, cls, mk) {
  return `<div class="st ${cls || ""}" data-m="${esc(tok.m)}" data-mk="${mk}"><span class="r">${i}</span><span class="nmw">${tkHTML(tok, 14)}<span class="bar"><i style="width:${(clamp(share, 0, 1) * 100).toFixed(1)}%"></i></span></span>
    <span class="num ${val == null ? "dim" : val >= 0 ? "up" : "down"}">${val == null ? "—" : fmtPct(val)}</span><span class="num dim">${(share * 100).toFixed(0)}%</span><span class="odds">${fmtX(odds)}</span></div>`;
}
function renderMarkets(w) {
  if (S.view !== "markets") return;
  buildMarkets();
  if (!tfOk(S.tf)) {
    ["tList", "effList", "bustList"].forEach(id => $(id).innerHTML = `<div class="closed">24-hour rounds run on live data. Open the data panel from the Replay button to go live.</div>`);
    $("lZone").textContent = ""; return;
  }
  const r = roundAt(S.tf, w), bs = betState(r, "top", w);
  const mine = new Set(S.my.b.filter(b => b.rk === r.key).map(b => b.mk + b.m));
  // top gainer
  const pt = pool(r, "top"), st = standings(r, w);
  $("tPool").textContent = fmtSol(pt.P); $("tPeople").textContent = pt.people; $("tWin").textContent = bs.open ? "close in " + dur(betCloseAt(r) - w) : "closed";
  setHTML($("tList"), st.map((x, i) => {
    const sh = (pt.sh.get(x.tok.m) || 0) / [...pt.sh.values()].reduce((a, b) => a + b, 0);
    const cls = (x.rug ? "out " : "") + (inBench(x.tok.m) || !inTop(x.tok.m) ? "dimb " : "") + (mine.has("top" + x.tok.m) ? "mine" : "");
    return stRow(i + 1, x.tok, x.rug ? null : x.R, sh || 0, impliedOdds(r, "top", x.tok.m), cls, "top");
  }).join(""));
  // lcs
  const pl = pool(r, "lcs"), ls = lcs(r, w), z = lcsZone(r, ls, w), lb = betState(r, "lcs", w);
  $("lPool").textContent = fmtSol(pl.P); $("lAlive").textContent = ls.alive.size + " / " + ls.field.length;
  $("lNext").textContent = ls.done < 5 ? "C" + (ls.done + 1) + " in " + dur(r.s + (ls.done + 1) * r.W / 6 - w) : w < r.e ? "final in " + dur(r.e - w) : "settled";
  $("lW").textContent = lb.open ? "×" + lb.w.toFixed(2) : "closed";
  $("lZone").innerHTML = ls.warming ? `<span>Live data joined this round partway. Betting opens with the next round.</span><b>${dur(r.e - w)}</b>` : z.cut.length ? `<span>Cut zone at C${z.k}: ${z.cut.map(m => tkHTML(T.get(m), 13)).join(" ")}</span><b>${dur(z.at - w)}</b>`
    : ls.winner ? `<span>Winner ${tkHTML(T.get(ls.winner), 13)}</span><b>${fmtPct(ls.final[0].R)}</b>` : `<span>Final duel: ${[...ls.alive].map(m => tkHTML(T.get(m), 13)).join(" vs ")}</span><b>${dur(r.e - w)}</b>`;
  // hype
  const pe = pool(r, "eff"), pb = pool(r, "bust"), h = hype(r, w).filter(x => x.R != null), hb = betState(r, "eff", w);
  $("hPool").textContent = fmtSol(pe.P + pb.P); $("hWin").textContent = hb.open ? "close in " + dur(betCloseAt(r) - w) : "closed";
  const effS = h.slice().sort((a, b) => b.eff - a.eff).slice(0, 5), bustS = h.filter(x => x.bust > 0).sort((a, b) => b.bust - a.bust).slice(0, 5);
  const line = (x, v, mk) => `<div class="st" data-m="${esc(x.tok.m)}" data-mk="${mk}" style="grid-template-columns:minmax(0,1fr) 54px 46px"><span class="nmw">${tkHTML(x.tok, 13)}</span><span class="num ${x.R >= 0 ? "up" : "down"}">${fmtPct(x.R, 1)}</span><span class="odds">${v.toFixed(3)}</span></div>`;
  setHTML($("effList"), effS.map(x => line(x, x.eff, "eff")).join("") || `<div class="empty">No scores yet.</div>`);
  setHTML($("bustList"), bustS.map(x => line(x, x.bust, "bust")).join("") || `<div class="closed">No coin has rising pace and a falling price right now. If none qualifies at the close, this pool refunds.</div>`);
  onPick($("mkGrid"), ".st[data-m]", (el, inner) => { if (inner.closest("a")) return; openBet(el.dataset.m, el.dataset.mk); });
}

/* ---------- bracket canvas ---------- */
let bkHover = null, bkGeo = null;
function drawBracket(w) {
  const cv = $("bkCv"); if (!cv || !cv.offsetParent || !tfOk(S.tf)) return;
  const { ctx, w: W, h: H } = fit(cv); ctx.clearRect(0, 0, W, H);
  const r = roundAt(S.tf, w), st = lcs(r, w), z = lcsZone(r, st, w), el = clamp((w - r.s) / r.W, 0, 1);
  if (st.warming) { ctx.fillStyle = C.dim; ctx.font = `11px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Live data joined this round partway.", W / 2, H / 2 - 9); ctx.fillText("The next bracket starts at " + local(r.e, false) + ".", W / 2, H / 2 + 9); return; }
  const M = mapOf(r.md), Lb = 88, Rb = 48, top = 22, x0 = Lb + 6, x1 = W - Rb - 6, X = f => x0 + (x1 - x0) * f;
  const Rnow = new Map([...st.alive].map(m => [m, retOf(M.get(m), r, w)]));
  const outK = new Map(st.out.map(o => [o.m, o])), joinK = new Map(st.crash.map(c => [c.m, c.k]));
  const alive = [...st.alive].sort((a, b) => (Rnow.get(b) ?? -9) - (Rnow.get(a) ?? -9));
  const outs = st.out.slice().sort((a, b) => b.k - a.k || (b.R ?? -9) - (a.R ?? -9)).map(o => o.m);
  const rows = alive.concat(outs.filter(m => !st.alive.has(m)));
  const n = Math.max(1, rows.length), rh = Math.min(19, (H - top - 4) / n);
  ctx.font = `9px ${MONO}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  const lab = ["OPEN", "C1", "C2", "C3", "C4", "C5", "CLOSE"];
  for (let k = 0; k <= 6; k++) {
    const x = Math.round(X(k / 6)) + .5, done = k === 0 || k <= st.done || (k === 6 && w >= r.e);
    ctx.fillStyle = done ? C.fg : C.faint; ctx.fillText(lab[k], x, 9);
    ctx.strokeStyle = k === st.done + 1 && k <= 5 ? C.fg : C.rule; ctx.setLineDash(k === st.done + 1 ? [] : [2, 3]); ctx.beginPath(); ctx.moveTo(x, top - 4); ctx.lineTo(x, top + n * rh); ctx.stroke(); ctx.setLineDash([]);
  }
  const zone = new Set(z.cut);
  if (zone.size) {
    const idx = rows.map((m, i) => zone.has(m) ? i : -1).filter(i => i >= 0), y0 = top + Math.min(...idx) * rh, y1 = top + (Math.max(...idx) + 1) * rh;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip(); ctx.strokeStyle = C.rule; ctx.lineWidth = 1;
    for (let x = x0 - (y1 - y0); x < x1; x += 7) { ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); ctx.stroke(); } ctx.restore();
    ctx.font = `8.5px ${MONO}`; const lw = ctx.measureText("CUT ZONE").width + 8, ly = y1 - 7;
    ctx.fillStyle = C.bg; ctx.fillRect(x1 - lw - 2, ly - 6, lw, 12); ctx.fillStyle = C.down; ctx.textAlign = "right"; ctx.fillText("CUT ZONE", x1 - 6, ly);
  }
  rows.forEach((m, i) => {
    const tok = M.get(m); if (!tok) return; const y = top + i * rh + rh / 2, isOut = !st.alive.has(m), o = outK.get(m), col = colorOf(m);
    const hov = bkHover === m, dimRow = bkHover && !hov;
    ctx.globalAlpha = dimRow ? .35 : 1;
    logoDot(ctx, tok, 9, y, Math.min(6, rh / 2 - 1.5), isOut ? null : col, isOut ? .45 : 1);
    ctx.fillStyle = isOut ? C.faint : C.fg; ctx.textAlign = "left"; ctx.font = `${hov ? 600 : 500} 10px ${MONO}`;
    ctx.fillText(tok.s.length > 10 ? tok.s.slice(0, 9) + "…" : tok.s, 20, y);
    const xs = X((joinK.get(m) || 0) / 6), endF = isOut ? (o ? clamp(o.k / 6, 0, 1) : el) : el, xe = X(endF);
    ctx.strokeStyle = isOut ? C.faint : col; ctx.lineWidth = isOut ? 1 : hov ? 2.6 : 1.8;
    if (!isOut && zone.has(m)) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(xs, y); ctx.lineTo(xe, y); ctx.stroke(); ctx.setLineDash([]);
    if (joinK.has(m)) { ctx.fillStyle = C.fg; ctx.font = `8px ${MONO}`; ctx.textAlign = "center"; ctx.fillText("▸", xs - 6, y); }
    if (isOut) { ctx.strokeStyle = o && o.why === "rug" ? C.down : C.dim; ctx.lineWidth = 1.4; const s = 3.2; ctx.beginPath(); ctx.moveTo(xe - s, y - s); ctx.lineTo(xe + s, y + s); ctx.moveTo(xe + s, y - s); ctx.lineTo(xe - s, y + s); ctx.stroke(); }
    else { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(xe, y, 2.8, 0, Math.PI * 2); ctx.fill(); }
    const R = isOut ? (o && o.why === "rug" ? null : o && o.R) : Rnow.get(m);
    ctx.textAlign = "right"; ctx.font = `10px ${MONO}`; ctx.fillStyle = isOut ? C.faint : R == null ? C.faint : R >= 0 ? C.up : C.down;
    ctx.fillText(o && o.why === "rug" ? "rug" : fmtPct(R, 1), W - 2, y);
    if (st.winner === m) { ctx.fillStyle = C.fg; ctx.font = `600 8.5px ${MONO}`; ctx.textAlign = "left"; ctx.fillText("WIN", xe + 7, y); }
    ctx.globalAlpha = 1;
  });
  const nx = Math.round(X(el)) + .5; ctx.strokeStyle = C.fg; ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(nx, top - 4); ctx.lineTo(nx, top + n * rh); ctx.stroke(); ctx.globalAlpha = 1;
  const fl = (performance.now() - flashBracket) / 900;
  if (fl >= 0 && fl < 1 && !reduced) { const x = X(st.done / 6) + (x1 - X(st.done / 6)) * fl; ctx.fillStyle = C.fg; ctx.globalAlpha = 1 - fl; ctx.fillRect(x, top - 4, 1.5, n * rh + 4); ctx.globalAlpha = 1; dirty.mk = true; }
  bkGeo = { rows, top, rh };
}
function bkHit(e) {
  if (!bkGeo) return; const rc = e.currentTarget.getBoundingClientRect(), y = e.clientY - rc.top;
  const i = Math.floor((y - bkGeo.top) / bkGeo.rh); const m = i >= 0 && i < bkGeo.rows.length ? bkGeo.rows[i] : null;
  if (m !== bkHover) { bkHover = m; dirty.mk = true; }
  e.currentTarget.style.cursor = m ? "pointer" : "default";
}

/* ---------- hype quadrant ---------- */
let hqHover = null, hqGeo = null;
function drawQuadrant(w) {
  const cv = $("hqCv"); if (!cv || !cv.offsetParent || !tfOk(S.tf)) return;
  const { ctx, w: W, h: H } = fit(cv); ctx.clearRect(0, 0, W, H);
  const r = roundAt(S.tf, w), pts = hype(r, w).filter(x => x.R != null);
  const L = 44, Rr = 12, Tp = 12, B = 26, pw = W - L - Rr, ph = H - Tp - B;
  let ax0 = -1, ax1 = 1, ry = 0.02; pts.forEach(p => { ax0 = Math.min(ax0, p.A); ax1 = Math.max(ax1, p.A); ry = Math.max(ry, Math.abs(p.R)); });
  ax0 = Math.max(-1, ax0 - .1); ax1 = Math.min(5, ax1 + .2); ry *= 1.18;
  const X = a => L + (clamp(a, ax0, ax1) - ax0) / (ax1 - ax0) * pw, Y = v => Tp + (ry - clamp(v, -ry, ry)) / (2 * ry) * ph;
  ctx.font = `9.5px ${MONO}`; ctx.lineWidth = 1;
  ctx.strokeStyle = C.rule2; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(X(0) + .5, Tp); ctx.lineTo(X(0) + .5, Tp + ph); ctx.moveTo(L, Math.round(Y(0)) + .5); ctx.lineTo(L + pw, Math.round(Y(0)) + .5); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = C.rule; ctx.strokeRect(L + .5, Tp + .5, pw - 1, ph - 1);
  ctx.fillStyle = C.faint; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText("QUIET CLIMB", L + 6, Tp + 5);
  ctx.textAlign = "right"; ctx.fillText("EARNED", L + pw - 6, Tp + 5);
  ctx.textBaseline = "bottom"; ctx.fillText("HYPE BUST", L + pw - 6, Tp + ph - 5); ctx.textAlign = "left"; ctx.fillText("FADING", L + 6, Tp + ph - 5);
  ctx.fillStyle = C.dim; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText("+" + (ry * 100).toFixed(1) + "%", L - 6, Tp + 6); ctx.fillText("0%", L - 6, Y(0)); ctx.fillText("−" + (ry * 100).toFixed(1) + "%", L - 6, Tp + ph - 6);
  ctx.textBaseline = "top"; ctx.textAlign = "center";
  ctx.fillText("pace " + fmtPct(ax0, 0), L + 26, Tp + ph + 8); ctx.fillText("0", X(0), Tp + ph + 8); ctx.fillText(fmtPct(ax1, 0), L + pw - 18, Tp + ph + 8);
  const mx = ["eff", "bust"].map(k => pts.slice().sort((a, b) => b[k] - a[k])[0]).filter(Boolean).map(p => p.tok.m);
  pts.forEach(p => {
    const x = X(p.A), y = Y(p.R), hov = hqHover === p.tok.m, col = colorOf(p.tok.m);
    logoDot(ctx, p.tok, x, y, hov ? 9 : 7, col, hqHover && !hov ? .35 : 1);
    if (hov || mx.includes(p.tok.m)) { ctx.fillStyle = C.fg; ctx.font = `${hov ? 600 : 500} 10px ${MONO}`; ctx.textAlign = x > L + pw - 80 ? "right" : "left"; ctx.textBaseline = "middle"; ctx.fillText(p.tok.s, x + (x > L + pw - 80 ? -13 : 13), y); }
  });
  if (hqHover) {
    const p = pts.find(p => p.tok.m === hqHover);
    if (p) { const lines = [p.tok.s, "return " + fmtPct(p.R), "pace " + fmtPct(p.A, 0), "efficiency " + p.eff.toFixed(3)]; ctx.font = `10px ${MONO}`;
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14, bh = lines.length * 14 + 8; let bx = X(p.A) + 14, by = Y(p.R) - bh - 8;
      if (bx + bw > W - 4) bx = X(p.A) - bw - 14; if (by < 2) by = Y(p.R) + 12;
      ctx.fillStyle = C.bg; ctx.strokeStyle = C.fg; ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
      ctx.fillStyle = C.fg; ctx.textAlign = "left"; ctx.textBaseline = "top"; lines.forEach((l, i) => { ctx.font = `${i ? 400 : 600} 10px ${MONO}`; ctx.fillText(l, bx + 7, by + 6 + i * 14); }); }
  }
  hqGeo = { pts: pts.map(p => ({ m: p.tok.m, x: X(p.A), y: Y(p.R) })) };
}
function hqHit(e) {
  if (!hqGeo) return; const rc = e.currentTarget.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
  let best = null, bd = 16; hqGeo.pts.forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p.m; } });
  if (best !== hqHover) { hqHover = best; dirty.mk = true; }
  e.currentTarget.style.cursor = best ? "pointer" : "crosshair";
}

/* ---------- your bets + settled rounds ---------- */
function betLive(b, w) {
  const r = roundOfBet(b), M = mapOf(b.md), tok = M.get(b.m);
  if (b.st !== "open") return b.st === "won" ? `<span class="up">won ${fmtSol(b.pay)}</span>` : b.st === "lost" ? `<span class="down">lost</span>` : `<span class="dim">refunded${b.why === "rug" ? " · rug" : ""}</span>`;
  if (b.md === "L" && S.mode === "replay") return `<span class="dim">waits for live data</span>`;
  if (w >= r.e) return `<span class="dim">settling…</span>`;
  if (b.mk === "sq") return sqBetLive(b, w);
  if (b.mk === "top") { const st = standings(r, w), i = st.findIndex(x => x.tok.m === b.m); return i >= 0 ? `#${i + 1} · ${fmtPct(st[i].R)}` : "—"; }
  if (b.mk === "lcs") { const st = lcs(r, w); return st.alive.has(b.m) ? `alive · ${st.alive.size} left` : `<span class="down">cut</span>`; }
  const h = hype(r, w).filter(x => x.R != null).sort((a, c) => c[b.mk] - a[b.mk]), i = h.findIndex(x => x.tok.m === b.m);
  return i >= 0 ? `#${i + 1} · ${h[i][b.mk].toFixed(3)}` : "—";
}
function renderMyBets(w) {
  const el = $("myBets"); if (!el || S.view !== "markets") return;
  const list = S.my.b.slice(0, 40), open = S.my.b.filter(b => b.st === "open");
  $("betsSub").textContent = S.my.b.length ? `${open.length} open · balance ${fmtSol(S.my.bal)} · ${canShare() ? "saved to the shared arena" : "saved in this browser"}` : "";
  if (!list.length) { el.innerHTML = `<div class="empty">No bets yet. Pick a market above, or press Back on any coin in the Arena. Every bet also makes you a member of that coin's squad.</div>`; return; }
  el.innerHTML = `<table class="tbl2"><thead><tr><th>Placed</th><th>Market</th><th>Round</th><th>Coin</th><th class="n">Stake</th><th class="n">Weight</th><th class="n">Quote</th><th>Now</th><th></th></tr></thead><tbody>${list.map(b => {
    const tok = mapOf(b.md).get(b.m), r = roundOfBet(b), si = streakInfo(b);
    const when = b.md === "R" ? utc(recOf(r, b.ts), false) + " rec" : local(b.ts, false);
    return `<tr><td class="dim">${when}</td><td>${esc(MK[b.mk].short)}</td><td class="dim">${b.tf.toUpperCase()} · ${b.md === "R" ? utc(r.rs, false) : local(r.s, false)}</td><td>${b.mk === "sq" ? (PFS.byId.get(b.m) ? `<a class="tk" href="#sq-${esc(b.m)}">${sqAv(PFS.byId.get(b.m), 13)}<span>${esc(PFS.byId.get(b.m).name)}</span></a>` : "squad") : tok ? tkHTML(tok, 13) : esc(short(b.m))}</td>
      <td class="n">${fmtSol(b.s)}</td><td class="n">${b.w.toFixed(2)}</td><td class="n">${fmtX(b.q)}</td><td>${betLive(b, w)}</td>
      <td>${si && si.ok ? `<button class="btn btn-quiet btn-xs" type="button" data-pass="${esc(b.id)}">Streak pass</button>` : si && si.used ? `<span class="dim cap">pass used</span>` : ""}</td></tr>`;
  }).join("")}</tbody></table>`;
  qsa("[data-pass]", el).forEach(btn => btn.onclick = () => openStreakPass(btn.dataset.pass));
}
function renderSettled(w) {
  const el = $("settled"); if (!el || S.view !== "markets") return;
  if (!tfOk(S.tf)) { el.innerHTML = ""; return; }
  const cur = roundAt(S.tf, w), rows = [];
  for (let k = 1; k <= 4; k++) {
    const r = roundAt(S.tf, cur.s - k * cur.W + 1);
    const res = MKS.map(mk => resultOf(r, mk)); if (res.every(x => !x)) continue;
    rows.push({ r, res });
  }
  if (!rows.length) { el.innerHTML = `<div class="empty">The first settled round appears here when the current one closes.</div>`; return; }
  const cell = (x, mk) => !x ? `<td class="dim">—</td>` : x.refundAll ? `<td class="dim">refund</td>` : `<td>${tkHTML(mapOf(x.r.md).get(x.winners[0]), 13)} <span class="dim">${mk === "eff" || mk === "bust" ? x.metric.toFixed(3) : fmtPct(x.metric, 1)}</span></td>`;
  el.innerHTML = `<table class="tbl2"><thead><tr><th>Round</th><th>Top gainer</th><th>Last coin standing</th><th>Most efficient</th><th>Biggest bust</th><th>Receipt</th></tr></thead><tbody>${rows.map(({ r, res }) =>
    `<tr><td class="dim">${r.md === "R" ? utc(r.rs, false) + "–" + utc(r.rs + r.W, false) + " UTC" : local(r.s, false) + "–" + local(r.e, false)}</td>${MKS.map((mk, i) => cell(res[i], mk)).join("")}<td class="hash" title="SHA-256 of the round's inputs and results">${esc((res.find(Boolean) || {}).hash ? res.find(Boolean).hash.slice(0, 16) : "…")}</td></tr>`).join("")}</tbody></table>`;
}
