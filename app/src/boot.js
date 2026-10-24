/* ================= intro: fifteen coins enter, one squad wins ================= */
let introRaf = 0, introDone = null;
const ease = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const easeIO = x => { x = clamp(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
function playIntro(manual) {
  if (reduced && !manual) return;
  const el = $("intro"), cv = $("introCv"), word = $("introWord"), slog = $("introSlogan"), meta = $("introMeta");
  el.hidden = false; el.classList.remove("out"); word.textContent = ""; slog.textContent = ""; meta.textContent = "";
  document.documentElement.style.overflow = "hidden";
  const r = roundAt(TFK.includes(S.tf) && tfOk(S.tf) ? S.tf : "15m", nowW());
  const coins = S.board.top.slice(0, 15).map(t => ({ tok: t, R: retOf(t, r, nowW()) ?? 0 }));
  while (coins.length < 15) coins.push({ tok: null, R: -1 });
  /* the formation is the logo: three stripes of five. Best coin on the apex of the top stripe, the back stripe fills first. */
  const rank = coins.map((_, i) => i).sort((a, b) => coins[b].R - coins[a].R), slot = new Array(15);
  rank.forEach((ci, k) => { slot[ci] = k; });
  const U = [0, -1, 1, -2, 2], spot = k => { const st = Math.floor(k / 5), u = U[k % 5]; return { mx: 16 + u * 5.5, my: 4 + st * 7.5 + Math.abs(u) * 3.75 }; };
  const worstFirst = rank.slice().reverse(), groups = [3, 3, 3, 2, 2], cutAt = new Map(); let q = 0;
  groups.forEach((g, k) => { for (let j = 0; j < g; j++) cutAt.set(worstFirst[q++], k); });
  const winner = rank[0], loser = rank[1];
  const seed = rng(hashStr(coins.map(c => c.tok ? c.tok.m : "-").join())), from = coins.map(() => ({ dx: seed() - 0.5, dy: seed() }));
  const T0 = performance.now(), CUT0 = 1800, CUTDT = 330, DUEL = CUT0 + 5 * CUTDT, MORPH = DUEL + 820, END = DUEL + 3800;
  let textStage = 0, finished = false;
  const hud = [["SQUAD ARENA // ROUND ENGINE", "tl"], [new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", "tr"], ["PUMP.FUN · SOLANA MAINNET", "bl"], ["15 COINS · 3 MARKETS · 4 ROUND LENGTHS", "br"]];
  const finish = () => {
    if (finished) return; finished = true; cancelAnimationFrame(introRaf);
    el.classList.add("out"); store.set("intro", 1);
    setTimeout(() => { el.hidden = true; el.classList.remove("out"); document.documentElement.style.overflow = ""; scramble($("brandWord"), "SQUAD ARENA", 700); const v = $("v-" + S.view); if (v) enterAnim(v); }, reduced ? 0 : 720);
    window.removeEventListener("keydown", onKey); el.removeEventListener("click", finish);
  };
  const onKey = e => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(); };
  window.addEventListener("keydown", onKey); el.addEventListener("click", finish); $("introSkip").onclick = e => { e.stopPropagation(); finish(); };
  introDone = finish;
  const draw = now => {
    const t = now - T0, { ctx, w: W, h: H } = fit(cv); ctx.clearRect(0, 0, W, H);
    const fg = C.stageFg, dim = C.stageDim, guide = mixHex(C.stageRule, C.stageDim, 0.45);
    // corner captions, typed in
    ctx.font = `10px ${MONO}`; ctx.fillStyle = dim; ctx.globalAlpha = ease(t / 400);
    hud.forEach(([txt, pos], k) => {
      if (W < 640 && pos[1] === "r") return;
      const shown = Math.floor(clamp((t - 150 - k * 120) / 500, 0, 1) * txt.length);
      let s = txt.slice(0, shown); if (shown < txt.length && shown > 0) s += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      ctx.textAlign = pos[1] === "l" ? "left" : "right"; ctx.textBaseline = pos[0] === "t" ? "top" : "bottom";
      ctx.fillText(s, pos[1] === "l" ? 24 : W - 24, pos[0] === "t" ? 24 : H - 24);
    });
    ctx.globalAlpha = 1;
    // scale: the formation shrinks into the logo during the morph
    const S1 = clamp(Math.min(W * 0.78 / 22, H * 0.4 / 22.5), 6, 18), S2 = S1 * 0.62, m = easeIO((t - MORPH) / 700), Sc = S1 + (S2 - S1) * m;
    const cx = W / 2, cy = Math.min(H * 0.37, H / 2 - 60), X = mx => cx + (mx - 16) * Sc, Y = my => cy + (my - 15.25) * Sc, rc = clamp(S1 * 1.45, 9, 21);
    // the three stripes: hairline guides that thicken into the mark
    const lineP = ease((t - 200) / 750);
    if (lineP > 0) {
      ctx.lineCap = m > 0 ? "square" : "round"; ctx.lineJoin = "miter";
      ctx.strokeStyle = m > 0 ? mixHex(guide, fg, m) : guide; ctx.lineWidth = 1 + (3 * Sc - 1) * m;
      for (let st = 0; st < 3; st++) {
        const y0 = 4 + st * 7.5, p = clamp(lineP * 1.25 - st * 0.12, 0, 1), ax = X(16), ay = Y(y0);
        if (p <= 0) continue;
        ctx.beginPath(); ctx.moveTo(ax + (X(5) - ax) * p, ay + (Y(y0 + 7.5) - ay) * p); ctx.lineTo(ax, ay); ctx.lineTo(ax + (X(27) - ax) * p, ay + (Y(y0 + 7.5) - ay) * p); ctx.stroke();
      }
    }
    // coins
    let alive = 15;
    const fade = 1 - ease((t - MORPH) / 450);
    for (let i = 0; i < 15; i++) {
      const c = coins[i], k = slot[i], sp = spot(k), col = c.tok ? colorOf(c.tok.m) || pal[i % pal.length] : pal[i % pal.length];
      const t0 = 420 + (14 - k) * 60, a = ease((t - t0) / 560);
      if (a <= 0) continue;
      let x = X(sp.mx), y = Y(sp.my), alpha = Math.min(1, a * 1.6) * fade, flash = 0, scale = 1;
      x += (1 - a) * from[i].dx * W * 0.7; y += (1 - a) * (H * 0.65 + from[i].dy * H * 0.3);
      const ck = cutAt.get(i);
      let out = 0;
      if (ck != null) { const tk = CUT0 + ck * CUTDT; if (t >= tk) { flash = t < tk + 130 ? 1 : 0; out = clamp((t - tk - 130) / 520, 0, 1); } if (t >= tk + 130) alive--; }
      if (i === loser && t >= DUEL + 420) { out = clamp((t - DUEL - 420) / 520, 0, 1); alive--; }
      if ((i === winner || i === loser) && t > DUEL && t < DUEL + 420) flash = Math.floor((t - DUEL) / 105) % 2 === (i === winner ? 0 : 1) ? 1 : 0;
      if (i === winner && t > DUEL + 420) scale = 1 + 0.28 * easeIO((t - DUEL - 420) / 300);
      if (out > 0) {
        // knocked out: falls away, leaves an empty slot behind
        ctx.globalAlpha = ease(out) * fade * 0.8; ctx.strokeStyle = dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(sp.mx), Y(sp.my), rc * 0.26, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        y += out * out * H * 0.5; x += out * (from[i].dx > 0 ? 1 : -1) * rc * 1.5; alpha *= 1 - out;
      }
      if (alpha <= 0.01) continue;
      const rr = rc * scale * (Sc / S1);
      if (c.tok) logoDot(ctx, c.tok, x, y, rr, col, alpha); else { ctx.globalAlpha = alpha; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rr * 0.7, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      if (flash) { ctx.globalAlpha = alpha; ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rr + 4, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    // count under the formation
    const cA = ease((t - 900) / 400) * (1 - ease((t - MORPH) / 300));
    if (cA > 0.01) {
      const k = groups.reduce((n, g, j) => n + (t >= CUT0 + j * CUTDT + 130 ? 1 : 0), 0);
      const label = t >= DUEL ? (t >= DUEL + 420 ? "1 LEFT · WINNER" : "FINAL · 2 LEFT") : k ? `CUT ${k}/5 · ${alive} LEFT` : "15 COINS IN";
      ctx.globalAlpha = cA; ctx.fillStyle = dim; ctx.font = `10.5px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(label, cx, Y(26.5) + rc + 18); ctx.globalAlpha = 1;
    }
    // text
    if (textStage < 1 && t > MORPH + 150) { textStage = 1; scramble(word, "SQUAD ARENA", 800); }
    if (textStage < 2 && t > MORPH + 950) { textStage = 2; typeText(slog, "Fifteen coins enter. One squad wins.", 34); }
    if (textStage < 3 && t > MORPH + 2100) { textStage = 3; scramble(meta, S.mode === "replay" ? "Replaying a real hour of pump.fun · press any key" : "Live pump.fun coins · press any key", 600); }
    if (t > END) { finish(); return; }
    introRaf = requestAnimationFrame(draw);
  };
  introRaf = requestAnimationFrame(draw);
}
function typeText(el, text, ms) { let i = 0; el.classList.add("caret"); const id = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(id); setTimeout(() => el.classList.remove("caret"), 900); } }, ms); }
function mixHex(a, b, f) {
  const p = h => { h = String(h).trim(); if (h[0] !== "#") return [200, 200, 200]; if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const x = p(a), y = p(b); return "rgb(" + x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(",") + ")";
}

/* ================= main loop ================= */
S.tickN = 0;
function tick(force) {
  const w = nowW(); S.w = w; S.rt = mktT(w);
  const b = S.mode === "replay" ? boardAtRec(S.rt, "R") : S.srv ? { top: SRV.board.top.map(m => TL.get(m)).filter(Boolean), bench: SRV.board.bench.map(m => TL.get(m)).filter(Boolean) } : computeBoard(w, TL);
  const sig = b.top.map(t => t.m).join() + "|" + b.bench.map(t => t.m).join();
  S.board = b; assignSlots(b.top);
  if (sig !== S.boardSig || force) { S.boardSig = sig; layoutRows(); qsa("[data-av]").forEach(el => el.style.setProperty("--ring", ringOf(el.dataset.av))); dirty.squads = true; }
  events(w);
  settleMine(w);
  renderStrip(w); updateRows(w); fillLens();
  if (S.view === "markets") { renderMarkets(w); renderMyBets(w); renderSettled(w); }
  if (S.view === "squads") renderSquads();
  if (S.view === "trending") renderTrending();
  if (S.view === "coin") kolTick();
  if (S.view === "coin") updateCoin();
  if (dirty.chat) { dirty.chat = false; renderChat(); renderChatTabs(); }
  if (dirty.online) { dirty.online = false; const n = S.peers ? S.peers.length : 0; $("onlineTxt").textContent = n ? n + " online" : ""; }
  $("clock").textContent = S.mode === "replay" ? utc(S.rt) + " UTC" : local(w);
  if (S.tickN++ % 2 === 0) drawSparks();
}
let lastFrame = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (document.hidden || ts - lastFrame < 32) return; lastFrame = ts;
  const w = nowW(); S.w = w; S.rt = mktT(w);
  if (S.view === "arena") { drawRace(w); if (lensM) drawLens(); }
  if (S.view === "markets") { drawBracket(w); drawQuadrant(w); }
  if (S.view === "coin") drawCoin();
  drawTimeline(w);
  drawAllViz(reduced ? 0 : ts);
}

/* ================= boot ================= */
function boot() {
  loadRecorded();
  readTheme();
  $("markSvg").innerHTML = markSVG();
  $("thead").innerHTML = headHTML();
  renderTf(); renderMode(); renderFoot(); renderLadder(); renderWallet(); renderChatTabs(); renderChatState();
  tick(true);
  layoutCols(); new ResizeObserver(() => { layoutCols(); dirty.all = true; }).observe($("tbl"));
  route();
  matchMedia("(prefers-color-scheme:dark)").addEventListener("change", readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dirty.all = true; });
  addEventListener("resize", () => { if (lensOpen) hideLens(); });
  addEventListener("scroll", () => { if (lensOpen) hideLens(); }, { passive: true });
  const n = TR.size, rug = [...TR.values()].filter(t => t.rugAt).map(t => t.s);
  if (!S.srv) wire("Desk", `Replay of a real hour on pump.fun: ${n} coins launched in the last 72 hours, 1-minute candles, ${utc(D0, false)}–${utc(REC_END, false)} UTC on 23 Oct. The hour loops on the UTC clock, so everyone sees the same round.${rug.length ? " Watch for the rug filter near the end of the hour." : ""}`);
  setInterval(tick, S.srv ? 400 : 1000);         // live: board numbers follow the price stream closely
  requestAnimationFrame(frame);
  if (store.get("intro", 0) !== 1 && !reduced) playIntro(false);
  if (S.srv) { srvStart(); return; }
  initSocial().then(() => { renderChatState(); dirty.chat = true; });
  useCap("sample").then(s => { SAMPLE = s; caps.sample = !!s; $("askBtn").hidden = $("autoBtn").hidden = !s; });
  useCap("mcp").then(async m => {
    MCP = m; caps.mcp = !!m;
    if (m) {
      const owner = USER ? await USER.isOwner().catch(() => false) : false;
      wire("Live", owner ? "Live data is ready for you in the Claude desktop app. Open Data from the Replay button and press Go live." : "Live data runs for the page's owner in the Claude desktop app. You're watching the replay.");
      if (owner && store.get("live", 0) === 1) goLive().catch(e => wire("Live", esc(e.message)));
    }
  });
  if (S.direct) goLive().catch(e => wire("Live", "Live data didn't start: " + esc(e.message) + " Showing the replay."));
}
boot();
