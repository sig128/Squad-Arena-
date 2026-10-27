/* ================= ui: squads, coin page, animated task visuals ================= */
function squadTier(tok) { const p = pAt(tok, tokTime(tok)); return tierOf(p == null ? 0 : p * tok.supply); }
function taskProgress(m, sqd) { const out = {}; for (const t of TASKS) { const ps = sqd.byTask.get(t.id) || []; out[t.id] = { n: ps.length, prog: Math.min(1, ps.length / t.goal), ps }; } return out; }
function activeTask(tok, sqd) {
  const tier = squadTier(tok), pr = taskProgress(tok.m, sqd);
  const open = TASKS.filter(t => t.tier <= tier && pr[t.id].prog < 1);
  if (!open.length) { const t = TASKS.filter(t => t.tier <= tier).slice(-1)[0]; return { t, p: pr[t.id] }; }
  const best = Math.max(...open.map(t => pr[t.id].prog)), lead = open.filter(t => pr[t.id].prog === best);
  const t = lead[hashStr(tok.m) % lead.length];
  return { t, p: pr[t.id] };
}
function segbar(n, on, live) {
  let h = ""; for (let i = 0; i < n; i++) h += `<i class="${i < on ? "on" : i === on && live ? "edge" : ""}"></i>`;
  return `<div class="segbar" style="--n:${n}">${h}</div>`;
}
let sqSig = "";
function renderSquads() {
  if (S.view !== "squads") return;
  const onBoard = S.board.top.concat(S.board.bench), seen = new Set(onBoard.map(t => t.m)), counts = new Map();
  for (const [, d] of allMemberDocs()) for (const m of Object.keys((d && d.sq) || {})) if (!seen.has(m)) counts.set(m, (counts.get(m) || 0) + 1);
  const others = [...counts.keys()].map(m => tokAny(m)).filter(Boolean).sort((a, b) => (isMember(b.m) - isMember(a.m)) || counts.get(b.m) - counts.get(a.m)).slice(0, 30);
  const list = onBoard.concat(others);
  const sig = list.map(t => t.m).join() + "|" + allProofs().length + "|" + [...S.members.keys()].length + "|" + Object.keys(S.my.sq).length;
  const grid = $("sqGrid");
  if (sig !== sqSig || !grid.children.length) {
    sqSig = sig;
    grid.innerHTML = list.map(tok => {
      const sqd = squadOf(tok.m), tier = squadTier(tok), a = activeTask(tok, sqd), cleared = TASKS.filter(t => t.tier <= tier && (sqd.byTask.get(t.id) || []).length >= t.goal).length;
      return `${tok === others[0] ? `<div class="sq-sep"><b>Squads off the board</b><span>Started from search. Tasks, proofs and chat work for any coin.</span></div>` : ""}<div class="sq${inBench(tok.m) ? " bench" : ""}${seen.has(tok.m) ? "" : " off"}" data-m="${esc(tok.m)}" tabindex="0" role="link" aria-label="${esc(tok.s)} squad">
        <div class="sq-top">${avHTML(tok, 30, 2)}<div class="nm"><b>$${esc(tok.s)}</b><span>${esc(tok.n)}</span></div><span class="tier" title="${esc(TIERS[tier].name)}">${TIERS[tier].n}</span></div>
        <canvas data-viz="${a.t.viz}" data-m="${esc(tok.m)}" data-k="${a.t.id}" aria-label="${esc(a.t.name)}: ${a.p.n} of ${a.t.goal}"></canvas>
        <div class="sq-meta"><span>${esc(a.t.name)}</span><b>${a.p.n}/${a.t.goal}</b></div>
        <div class="sq-meta"><span>Members <b>${sqd.members.length}</b></span><span>Cleared <b>${cleared}/${TASKS.filter(t => t.tier <= tier).length}</b></span><span class="sqo" data-on="${esc(tok.m)}"></span></div>
        <div class="tierbar" data-tb="${esc(tok.m)}"></div></div>`;
    }).join("") || `<div class="empty" style="padding:22px">Waiting for the board.</div>`;
    qsa(".sq", grid).forEach(el => { el.onclick = () => location.hash = "#coin-" + el.dataset.m; el.onkeydown = e => { if (e.key === "Enter") location.hash = "#coin-" + el.dataset.m; }; });
    registerViz(grid);
  }
  qsa("[data-tb]", grid).forEach(el => {
    const tok = tokAny(el.dataset.tb); if (!tok) return; const p = pAt(tok, tokTime(tok)), mc = p == null ? 0 : p * tok.supply, k = tierOf(mc), nx = TIERS[k + 1];
    const f = nx ? clamp((Math.log(mc) - Math.log(Math.max(1, TIERS[k].min || 1e5))) / (Math.log(nx.min) - Math.log(Math.max(1, TIERS[k].min || 1e5))), 0, 1) : 1;
    el.innerHTML = `<div class="sq-meta" style="margin-bottom:5px"><span>${fmtUsd(mc)}</span><span>${nx ? "Tier " + nx.n + " at " + fmtUsd(nx.min) : "Top tier"}</span></div>${segbar(20, Math.round(f * 20), !!nx)}`;
  });
  qsa("[data-on]", grid).forEach(el => { const n = onlineCount(el.dataset.on); el.innerHTML = n ? `Here <b>${n}</b>` : ""; });
  $("sqOnline").textContent = S.peers && S.peers.length ? S.peers.length + " online" : "";
}
function renderLadder() {
  $("ladder").innerHTML = TIERS.map((t, i) => `<div><b>TIER ${t.n} · ${esc(t.name.toUpperCase())}</b><span>${i ? "from " + fmtUsd(t.min) + " market cap" : "every new squad"}</span><ul>${TASKS.filter(x => x.tier === i).map(x => `<li>${esc(x.name)} <span class="dim">· ${x.goal}</span></li>`).join("")}</ul></div>`).join("");
}

/* ---------- coin page ---------- */
const IVS = [[1 / 60, "1S"], [1, "1M"], [5, "5M"], [15, "15M"], [30, "30M"], [60, "1H"], [240, "4H"]];
const coinUI = { iv: IVS.some(x => x[0] === store.get("iv", 1)) ? store.get("iv", 1) : 1, span: 90, style: "candles", unit: store.get("unit", "price") === "mc" ? "mc" : "price", cross: null, pan: 0, drag: null, m: null };
function buildCoin(m) {
  const tok = tokAny(m), el = $("v-coin"); if (!tok) return;
  chartDestroy();
  coinUI.m = m; coinUI.pan = 0; coinUI.cross = null;
  const lw = !!LW(); if (!lw && !["candles", "line"].includes(coinUI.style)) coinUI.style = "candles";
  const A = (u, l) => `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`;
  const meta = [tok.x && A(tok.x, "X"), tok.tg && A(tok.tg, "Telegram"), tok.dc && A(tok.dc, "Discord"), tok.w && A(tok.w, "Website")].filter(Boolean).join("");
  el.innerHTML = `
  <a class="c-back" href="#arena">← Arena</a>
  <div class="c-head">${avHTML(tok, 54, 2)}
    <div class="ttl"><h1><span data-scr>${esc(tok.s)}</span><span class="tier" id="cTier"></span></h1>
      <div class="sub"><span>${esc(tok.n)}</span><span id="cAge"></span><span>${esc(tok.dex || "")}${tok.quote && tok.quote !== "SOL" ? " · paired with " + esc(tok.quote) : ""}</span><span id="cRank"></span></div></div>
    <div class="px"><b id="cPx">—</b><span id="cPct" class="num"></span></div>
  </div>
  <div class="c-links"><button class="btn btn-solid btn-xs" type="button" id="cCaBtn" aria-label="Copy contract address">Copy CA</button>${/pump$/.test(tok.m) || /pump/.test(tok.dex || "") ? A("https://pump.fun/coin/" + tok.m, "pump.fun") : ""}${A("https://dexscreener.com/solana/" + (tok.pool || tok.m), "DEX Screener")}${A("https://solscan.io/token/" + tok.m, "Solscan")}${meta ? `<span class="lbl">Links set by the coin's creator</span>${meta}` : ""}</div>
  ${tok.ds ? `<p class="desc">${esc(tok.ds.slice(0, 360))}</p>` : ""}
  <div class="c-grid">
    <div class="chart-box" id="cBox">
      <div class="chart-bar"><div class="ohlc" id="cOhlc"></div>
        <div class="cctl"><div class="seg" id="cIv" role="group" aria-label="Candle interval">${IVS.map(([m, l]) => `<button type="button" data-iv="${m}"${(m === 240 || m < 1) && S.mode === "replay" ? ` disabled title="${m < 1 ? "1-second" : "4-hour"} candles need live data"` : ""}>${l}</button>`).join("")}</div>${lw ? "" : `<div class="seg" id="cSpan"><button type="button" data-s="0">All</button></div>`}
        <div class="seg" id="cStyle" role="group" aria-label="Chart type">${(lw ? STYLES : STYLES.filter(x => x[0] === "candles" || x[0] === "line")).map(([k, l]) => `<button type="button" data-y="${k}">${l}</button>`).join("")}</div>
        <div class="seg" id="cUnit" role="group" aria-label="Chart values"><button type="button" data-u="price">Price</button><button type="button" data-u="mc">Mcap</button></div>
        ${lw ? `<div class="cind"><button class="btn btn-quiet btn-xs" type="button" id="cIndBtn" aria-expanded="false" aria-controls="cIndMenu">Indicators</button><div class="cmenu" id="cIndMenu" role="dialog" aria-label="Indicators" hidden></div></div>` : ""}</div></div>
      ${lw ? `<div class="cx">${chartToolsHTML()}<div class="cchart" id="cChart" tabindex="0" role="application" aria-label="${esc(tok.s)} chart. Drag to move, scroll to zoom, drag an axis to stretch it."><div class="cleg" id="cLeg"></div><div class="cempty" id="cEmpty" hidden></div><div class="ktip" id="cKolTip" hidden></div></div></div>`
        : `<canvas id="coinCv" aria-label="${esc(tok.s)} price chart, 1-minute candles"></canvas>`}
      ${lw ? `<div class="chart-bar cfoot"><span class="cfr"><span class="tbtn"><button type="button" data-act="fit" title="Show all candles">Fit</button><button type="button" data-act="live" title="Jump to the latest candle">Latest</button></span><span class="tbtn"><button type="button" data-sc="pct" title="Percent scale">%</button><button type="button" data-sc="log" title="Log scale">log</button><button type="button" data-sc="auto" title="Auto-fit the price axis">auto</button></span></span><span class="lat hint">Drag to move · scroll to zoom · drag either axis to stretch · double-click to reset</span></div>
      <div class="chart-bar cnote"><span class="lat" id="cLat"></span><a class="lat tv" href="https://www.tradingview.com/" target="_blank" rel="noopener">Chart: TradingView</a></div>`
        : `<div class="chart-bar cfoot"><span class="lat" id="cLat"></span><span class="lat">Scroll to zoom · drag to pan · double-click to reset</span></div>`}
    </div>
    <div class="side">
      <div class="box"><h4>Back ${esc(tok.s)}</h4><div id="cBack"></div></div>
      <div class="box"><h4>Your position</h4><div class="pos" id="cPos"></div></div>
      ${S.srv ? `<div class="box"><h4>KOL holders <span id="cKolN" class="dim"></span></h4><div id="cKols"><p class="fine">Loading…</p></div></div>` : ""}
      <div class="box"><h4>Stats</h4><dl class="kv" id="cKv"></dl>
        <div class="mint"><code id="cMint">${esc(tok.m)}</code><button class="btn btn-quiet btn-xs" type="button" id="cCopy">Copy</button></div></div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-h"><div class="t"><h2 data-scr>Squad</h2><p id="cSqSub"></p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-quiet" type="button" id="cBet" hidden>Back $${esc(tok.s)}</button><button class="btn btn-solid" type="button" id="cJoin"></button></div></div>
    <p class="desc" style="margin:0 0 12px">${esc(RULES_TASKS)}</p>
    <div class="tasks" id="cTasks"></div>
  </div>
  <div class="sec"><div class="c-grid">
    <div><div class="sec-h"><div class="t"><h2>Proof feed</h2><p>Who did what, newest first</p></div></div><div class="proofs" id="cProofs"></div></div>
    <div><div class="sec-h"><div class="t"><h2>Members</h2></div></div><div class="members" id="cMembers"></div></div>
  </div></div>`;
  if (coinUI.iv === 240 && S.mode === "replay") coinUI.iv = 60;
  if (coinUI.iv < 1 && S.mode === "replay") coinUI.iv = 1;
  qsa("#cIv button").forEach(b => { b.setAttribute("aria-pressed", String(+b.dataset.iv === coinUI.iv)); b.onclick = () => { coinUI.iv = +b.dataset.iv; store.set("iv", coinUI.iv); if (CH.chart) CH.chart.applyOptions({ timeScale: { secondsVisible: coinUI.iv < 1 }, localization: { timeFormatter: crossTime } }); coinUI.span = 90; coinUI.pan = 0; qsa("#cIv button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); if ($("cSpan")) $("cSpan").firstChild.setAttribute("aria-pressed", "false"); dirty.coin = true; if (S.mode !== "replay") queueHistory(); if (CH.chart) chartSync(true); }; });
  qsa("#cUnit button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.u === coinUI.unit)); b.onclick = () => { coinUI.unit = b.dataset.u; store.set("unit", coinUI.unit); qsa("#cUnit button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); dirty.coin = true; updateCoin(); if (CH.chart) chartSync(true); }; });
  qsa("#cStyle button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.y === coinUI.style)); b.onclick = () => { coinUI.style = b.dataset.y; store.set("cstyle", coinUI.style); qsa("#cStyle button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); dirty.coin = true; if (CH.chart) chartSync(true); }; });
  $("cCopy").onclick = () => copyText(tok.m, $("cCopy"), $("cMint"));
  $("cCaBtn").onclick = () => copyText(tok.m, $("cCaBtn"));
  $("cBet").onclick = () => openBet(m, bestMarket(m));
  $("cJoin").onclick = async () => {
    const b = $("cJoin");
    if (isMember(m)) { copyText(location.href.split("#")[0] + "#coin-" + m, b); return; }
    b.disabled = true;
    try { await joinSquad(m); b.disabled = false; notice("You're in the $" + tok.s + " squad"); coinSig = ""; updateCoin(true); }
    catch (e) { notice(e.message); }
    finally { b.disabled = false; }
  };
  if (lw) { if (chartInit(m)) { chartWire(); chartSync(true); } else { buildCoinFallback(m); } }
  else {
  qsa("#cSpan button").forEach(b => { b.setAttribute("aria-pressed", String(coinUI.span === 0)); b.onclick = () => { const on = coinUI.span !== 0; coinUI.span = on ? 0 : 90; coinUI.pan = 0; b.setAttribute("aria-pressed", String(on)); dirty.coin = true; }; });
  const cv = $("coinCv");
    cv.addEventListener("pointermove", e => { const rc = cv.getBoundingClientRect(); coinUI.cross = { x: e.clientX - rc.left, y: e.clientY - rc.top };
      if (coinUI.drag) { const dx = e.clientX - coinUI.drag.x; coinUI.pan = Math.max(0, coinUI.drag.pan + Math.round(dx / (coinUI.cw || 8))); }
      dirty.coin = true; });
    cv.addEventListener("pointerleave", () => { coinUI.cross = null; coinUI.drag = null; dirty.coin = true; });
    cv.addEventListener("pointerdown", e => { coinUI.drag = { x: e.clientX, pan: coinUI.pan }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointerup", () => { coinUI.drag = null; });
    cv.addEventListener("dblclick", () => { coinUI.pan = 0; coinUI.span = 90; qsa("#cSpan button").forEach(x => x.setAttribute("aria-pressed", "false")); dirty.coin = true; });
    cv.addEventListener("wheel", e => { e.preventDefault(); const cur = coinUI.span || coinUI.nAll || 120; coinUI.span = clamp(Math.round(cur * (e.deltaY > 0 ? 1.15 : 0.87)), 12, 400); qsa("#cSpan button").forEach(x => x.setAttribute("aria-pressed", "false")); dirty.coin = true; }, { passive: false });
  }
  coinSig = ""; updateCoin(true);
}
let coinSig = "";
function updateCoin(force) {
  if (S.view !== "coin" || !coinUI.m) return;
  const m = coinUI.m, tok = tokAny(m); if (!tok) return;
  const w = S.w, r = roundAt(S.tf, w), p = pAt(tok, tokTime(tok)), mc = p == null ? null : p * tok.supply, tier = tierOf(mc || 0);
  $("cPx").textContent = coinUI.unit === "mc" ? fmtUsd(mc) : fmtPrice(p);
  const rr = tfOk(S.tf) ? spotRet(tok, r, w) : null; $("cPct").textContent = rr == null ? "" : fmtPct(rr) + " this " + S.tf.toUpperCase() + " round"; $("cPct").className = "num " + (rr == null ? "dim" : rr >= 0 ? "up" : "down");
  $("cTier").textContent = "TIER " + TIERS[tier].n + " · " + TIERS[tier].name.toUpperCase();
  $("cAge").textContent = tok.born ? "launched " + age(tokTime(tok) - tok.born) + " ago" : "";
  const ti = S.board.top.findIndex(t => t.m === m), bi = S.board.bench.findIndex(t => t.m === m);
  $("cRank").textContent = ti >= 0 ? "#" + (ti + 1) + " in the top 15" : bi >= 0 ? "on deck #" + (16 + bi) : tok.rugAt && tok.rugAt <= S.rt ? "removed by the rug filter" : tok.flag ? "kept off the board · " + tok.flag : tooNew(tok) ? "too new for the board · eligible in " + age(tooNew(tok)) : "not on the board · squads still work";
  $("cKv").innerHTML = [["Price", fmtPrice(p)], ["Market cap", fmtUsd(mc)], ["Liquidity", fmtUsd(tok.liq)], ["Vol 5m · 1h", fmtUsd(tok.vol[0]) + " · " + fmtUsd(tok.vol[1])], ["Vol 6h · 24h", fmtUsd(tok.vol[2]) + " · " + fmtUsd(tok.vol[3])],
    ["Trades 5m · 1h", fmtNum(tok.tx[0]) + " · " + fmtNum(tok.tx[1])], ["Buys · sells 1h", fmtNum(tok.bs[0]) + " · " + fmtNum(tok.bs[1])], ["Change 1h · 24h", fmtPct((tok.ch[1] || 0) / 100, 1) + " · " + fmtPct((tok.ch[3] || 0) / 100, 1)],
    ["Pace growth", fmtPct(attn(tok, S.tf === "24h" ? "24h" : S.tf, S.mode === "replay" ? SNAP : nowW()), 0)], ["Venue", (tok.dex || "—") + " " + short(tok.pool || "")]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  const bettable = tfOk(S.tf) && MKS.some(mk => fieldOf(r, mk).some(t => t.m === m) || (mk === "lcs" && lcs(r, w).alive.has(m)));
  $("cBet").hidden = !bettable;
  setHTML($("cBack"), !bettable && tfOk(S.tf) ? `<div class="closed">Not in this round. Bets open when ${esc(tok.s)} makes the top 25; the squad, its tasks and chat work any time.</div>` : tfOk(S.tf) ? MKS.map(mk => {
    const bs = betState(r, mk, w, m), od = impliedOdds(r, mk, m), inF = fieldOf(r, mk).some(t => t.m === m) || (mk === "lcs" && lcs(r, w).alive.has(m));
    return `<div class="next" style="padding:6px 0;border-bottom:1px solid var(--rule)"><span>${esc(MK[mk].label)}<br><span class="dim">${!inF ? "not in this round" : bs.open ? (od ? fmtX(od) + " · weight ×" + bs.w.toFixed(2) : "open") : "closed"}</span></span>
      <button class="btn btn-quiet btn-xs" type="button" data-cb="${mk}"${!inF || !bs.open ? " disabled" : ""}>Bet</button></div>`;
  }).join("") : `<div class="closed">24-hour rounds need live data.</div>`);
  onPick($("cBack"), "[data-cb]", b => openBet(coinUI.m, b.dataset.cb));
  const mine = S.my.b.filter(b => b.m === m).slice(0, 8);
  $("cPos").innerHTML = mine.length ? mine.map(b => `<div class="p"><b>${fmtSol(b.s)} · ${esc(MK[b.mk].short)}</b><span class="num">${betLive(b, w)}</span><span>${b.tf.toUpperCase()} round · weight ${b.w.toFixed(2)} · quote ${fmtX(b.q)}</span></div>`).join("")
    : `<div class="empty" style="padding:8px 0">No bets on ${esc(tok.s)} yet.${bettable ? " Backing it in any market also makes you a squad member." : ""}</div>`;
  const member = isMember(m), sqd = squadOf(m), here = onlineCount(m);
  if (!$("cJoin").disabled) $("cJoin").textContent = member ? "Copy invite link" : sqd.members.length ? "Join the squad" : "Start the squad";
  $("cJoin").classList.toggle("btn-solid", !member); $("cJoin").classList.toggle("btn-quiet", member);
  $("cSqSub").textContent = `${sqd.members.length} member${sqd.members.length === 1 ? "" : "s"}${here ? " · " + here + " here now" : ""} · tier ${TIERS[tier].n} ${TIERS[tier].name}${TIERS[tier + 1] ? " · next tier at " + fmtUsd(TIERS[tier + 1].min) : ""}`;
  const sig = m + "|" + tier + "|" + sqd.proofs.map(p => p.id + p.checks + p.flags).join() + "|" + sqd.members.length + "|" + member + "|" + canShare();
  if (sig !== coinSig || force) { coinSig = sig; renderTasks(tok, sqd, tier, member); renderProofs(tok, sqd, member); renderMembers(tok, sqd); }
  const lat = $("cLat");
  if (lat) lat.textContent = S.mode === "replay" ? "Replay of real 1-minute candles · " + utc(S.rt) + " UTC" : liveLatency(tok);
}
function renderTasks(tok, sqd, tier, member) {
  const pr = taskProgress(tok.m, sqd), share = canShare();
  $("cTasks").innerHTML = TASKS.map(t => {
    const st = pr[t.id], locked = t.tier > tier, done = st.prog >= 1, ongoing = !locked && !done && st.n > 0;
    const n = Math.min(t.goal, 20), on = Math.round(st.prog * n);
    const mineDone = S.myProofs.p.some(p => p.m === tok.m && p.k === t.id);
    const act = locked ? `<span class="st8">Unlocks at ${fmtUsd(TIERS[t.tier].min)}</span>` : done ? `<span class="st8">Cleared</span>`
      : mineDone ? `<span class="st8">Your proof is in</span>` : `<button class="btn btn-quiet btn-xs" type="button" data-proof="${t.id}"${member && share ? "" : " disabled"} title="${!member ? "Back the coin to join the squad first" : !share ? "This view can't post to the shared arena" : ""}">Post proof</button>`;
    const people = [...new Set(st.ps.map(p => p.uid))].slice(0, 5).map(uid => picHTML(uid)).join("");
    return `<div class="task${locked ? " locked" : ""}${done ? " done" : ""}${ongoing ? " ongoing" : ""}" data-k="${t.id}">
      <canvas data-viz="${t.viz}" data-m="${esc(tok.m)}" data-k="${t.id}" aria-hidden="true"></canvas>
      <div class="tt"><div class="tt-h"><b>${esc(t.name)}</b><span>${st.n}/${t.goal}</span></div><p>${esc(t.brief)}</p>${segbar(n, on, ongoing)}
      <div class="tt-f"><span class="ppl">${people}</span>${act}</div></div><i class="scan"></i></div>`;
  }).join("");
  qsa("[data-proof]", $("cTasks")).forEach(b => b.onclick = () => openProof(tok.m, b.dataset.proof));
  registerViz($("cTasks"));
}
function renderProofs(tok, sqd, member) {
  const el = $("cProofs"), me = S.me.id || "me";
  if (!sqd.proofs.length) { el.innerHTML = `<div class="empty">No proofs yet. Join the squad, pick a task above and post the link to what you made.</div>`; return; }
  el.innerHTML = sqd.proofs.slice(0, 40).map(p => {
    const t = TASK[p.k], own = p.uid === me, mine = S.myProofs.v[p.id], fl = S.myProofs.f[p.id];
    return `<div class="pr">${picHTML(p.uid)}<div class="w"><b>${esc(nameOf(p.uid))} <span class="dim">${esc(handleOf(p.uid))}</span></b><span>${esc(t.name)} · ${ago(nowW() - p.ts)} · ${p.checks} verified${p.flags ? " · " + p.flags + " flagged" : ""}</span></div>
      <div class="acts">${/^https:\/\/[^\s<>"']+$/i.test(p.u || "") ? `<a class="btn btn-quiet btn-xs" href="${esc(p.u)}" target="_blank" rel="noopener noreferrer">View ↗</a>` : ""}${!own && member && canShare() ? `<button class="btn btn-quiet btn-xs" type="button" data-ck="${esc(p.id)}" aria-pressed="${!!mine}">${mine ? "Verified" : "Verify"}</button><button class="btn btn-quiet btn-xs" type="button" data-fl="${esc(p.id)}">${fl ? "Unflag" : "Flag"}</button>` : ""}</div></div>`;
  }).join("");
  qsa("[data-ck]", el).forEach(b => b.onclick = () => checkProof(b.dataset.ck, false));
  qsa("[data-fl]", el).forEach(b => b.onclick = () => checkProof(b.dataset.fl, true));
}
function renderMembers(tok, sqd) {
  const el = $("cMembers");
  if (!sqd.members.length) { el.innerHTML = `<div class="empty">No members yet. The first bet on ${esc(tok.s)} founds the squad.</div>`; return; }
  const done = new Map(); sqd.proofs.forEach(p => done.set(p.uid, (done.get(p.uid) || 0) + 1));
  el.innerHTML = sqd.members.slice(0, 50).map(mm => `<div class="mm">${picHTML(mm.uid)}<div style="min-width:0"><b>${esc(nameOf(mm.uid))}</b> <span>${esc(mm.h ? "@" + mm.h : "")}</span><br><span>joined ${ago(nowW() - mm.since)} · ${done.get(mm.uid) || 0} proofs</span></div><span class="num">${mm.stake > 0 ? fmtSol(mm.stake) : ""}</span></div>`).join("");
}
function hitTask(m, k) {
  if (S.view === "coin" && coinUI.m === m) { const el = qsa(`.task[data-k="${k}"]`, $("cTasks"))[0]; if (el) { el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit"); } }
  VIZ.forEach(v => { if (v.m === m && v.k === k) v.hit = performance.now(); });
  dirty.squads = true;
}

/* ---------- coin chart: real candles, 1m data aggregated to the chosen interval ---------- */
// 1-second candles come straight from the live ticks (one per second, with that second's high and low); each opens at the last close
function candlesSec(tok, tEnd) {
  const out = [];
  for (const k of tok.ticks) {
    if (k.t > tEnd) break;
    const b = Math.floor(k.t / 1000) * 1000, last = out[out.length - 1];
    if (last && last.t === b) { last.h = Math.max(last.h, k.h == null ? k.p : k.h, k.p); last.l = Math.min(last.l, k.l == null ? k.p : k.l, k.p); last.c = k.p; continue; }
    const o = last ? last.c : k.p;
    out.push({ t: b, o, h: Math.max(o, k.p, k.h == null ? k.p : k.h), l: Math.min(o, k.p, k.l == null ? k.p : k.l), c: k.p, v: 0, open: b + 1000 > tEnd });
  }
  return out.length > 3000 ? out.slice(out.length - 3000) : out;
}
function candlesIv(tok, tEnd, iv) {
  if (iv < 1) return candlesSec(tok, tEnd);
  const one = candlesTo(tok, tEnd, 3000);
  let src = one;
  if (iv >= 5 && tok.C5.length) { const first = one.length ? one[0].t : Infinity; src = tok.C5.filter(c => c.t < first && c.t <= tEnd).concat(one); }
  if (iv === 1) return one;
  const out = [], span = iv * 60000;
  for (const c of src) {
    const b = Math.floor(c.t / span) * span, last = out[out.length - 1];
    if (!last || last.t !== b) out.push({ t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0, open: !!c.open || b + span > tEnd });
    else { last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v || 0; if (c.open) last.open = true; }
  }
  return out;
}
function drawCoin() { if (CH.chart) chartSync(false); else drawCoinCanvas(); }
function drawCoinCanvas() {
  const cv = $("coinCv"); if (!cv || !cv.offsetParent || !coinUI.m) return;
  const tok = tokAny(coinUI.m); if (!tok) return;
  const t0p = performance.now(), { ctx, w: W, h: H } = fit(cv); ctx.clearRect(0, 0, W, H);
  const K = coinUI.unit === "mc" ? tok.supply : 1, raw = candlesIv(tok, tokTime(tok), coinUI.iv);
  const all = K === 1 ? raw : raw.map(c => ({ ...c, o: c.o * K, h: c.h * K, l: c.l * K, c: c.c * K })); coinUI.nAll = all.length;
  const F = K === 1 ? fmtPrice : v => fmtMc(v);
  if (!all.length) { ctx.fillStyle = C.dim; ctx.font = `12px ${MONO}`; ctx.textAlign = "center"; ctx.fillText(S.mode === "replay" ? "No trades yet at this point of the replay." : "Loading candles…", W / 2, H / 2); return; }
  const n = clamp(coinUI.span || all.length, 8, Math.max(8, all.length)), end = Math.max(Math.min(all.length, n), all.length - coinUI.pan), vis = all.slice(Math.max(0, end - n), end);
  const Rm = 78, L = 8, Tp = 10, Bm = 22, pw = W - L - Rm, phAll = H - Tp - Bm, vh = Math.round(phAll * .18), ph = phAll - vh - 6;
  let mn = Infinity, mx = -Infinity, vmax = 0; vis.forEach(c => { mn = Math.min(mn, c.l); mx = Math.max(mx, c.h); vmax = Math.max(vmax, c.v || 0); });
  const r = roundAt(S.tf, S.w), openP = tfOk(S.tf) ? twap(tok, Math.max(r.rs, firstTime(tok)), Math.max(r.rs, firstTime(tok)) + winOf(r)) * K : null;
  const pd = (mx - mn) * .08 || mx * .01; mn -= pd; mx += pd;
  const cw = pw / n; coinUI.cw = cw;
  const X = i => L + (i + (n - vis.length)) * cw + cw / 2, Y = p => Tp + (mx - p) / (mx - mn) * ph;
  ctx.font = `10px ${MONO}`; ctx.lineWidth = 1;
  const stp = niceStep(mx - mn, 5); ctx.textAlign = "left"; ctx.textBaseline = "middle";
  for (let v = Math.ceil(mn / stp) * stp; v <= mx; v += stp) { const y = Math.round(Y(v)) + .5; ctx.strokeStyle = C.rule; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillStyle = C.dim; ctx.fillText(K === 1 ? fmtPrice(v) : fmtMc(v, stp), L + pw + 8, y); }
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = C.dim;
  const every = Math.max(1, Math.ceil(70 / cw)); vis.forEach((c, i) => { if (Math.round(c.t / (coinUI.iv * 60000)) % every) return; const x = X(i); if (x < L + 20 || x > L + pw - 20) return; ctx.fillText(S.mode === "replay" ? utc(c.t, false) : local(c.t, false), x, Tp + phAll + 6); });
  if (vmax > 0) vis.forEach((c, i) => { const hgt = (c.v || 0) / vmax * vh; ctx.fillStyle = C.rule2; ctx.fillRect(X(i) - Math.max(1, cw * .32), Tp + phAll - hgt, Math.max(2, cw * .64), hgt); });
  if (openP && openP >= mn && openP <= mx) { const y = Math.round(Y(openP)) + .5; ctx.strokeStyle = C.faint; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.dim; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText("round open", L + 4, y - 3); }
  const col = colorOf(tok.m) || C.fg;
  if (coinUI.style === "line") {
    ctx.strokeStyle = inTop(tok.m) ? col : C.fg; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.beginPath(); vis.forEach((c, i) => i ? ctx.lineTo(X(i), Y(c.c)) : ctx.moveTo(X(i), Y(c.c))); ctx.stroke();
  } else {
    vis.forEach((c, i) => {
      const x = X(i), up = c.c >= c.o, bw = Math.max(1, Math.min(14, cw * .66)); ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, Y(c.h)); ctx.lineTo(Math.round(x) + .5, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c)), bh = Math.max(1, y2 - y1);
      if (up) { ctx.fillStyle = C.bg; ctx.fillRect(x - bw / 2, y1, bw, bh); ctx.strokeRect(Math.round(x - bw / 2) + .5, Math.round(y1) + .5, Math.max(1, Math.round(bw) - 1), Math.max(1, Math.round(bh) - 1)); }
      else ctx.fillRect(x - bw / 2, y1, bw, bh);
    });
  }
  const last = vis[vis.length - 1], ly = Y(last.c);
  if (coinUI.pan === 0) {
    ctx.strokeStyle = C.fg; ctx.globalAlpha = .4; ctx.setLineDash([1, 3]); ctx.beginPath(); ctx.moveTo(L, Math.round(ly) + .5); ctx.lineTo(L + pw, Math.round(ly) + .5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const lab = F(last.c); ctx.font = `500 10px ${MONO}`; const tw = ctx.measureText(lab).width + 10;
    ctx.fillStyle = C.fg; ctx.fillRect(L + pw + 2, ly - 8, tw, 16); ctx.fillStyle = C.bg; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(lab, L + pw + 7, ly);
  }
  let rc = last;
  if (coinUI.cross && coinUI.cross.x >= L && coinUI.cross.x <= L + pw) {
    const i = clamp(Math.round((coinUI.cross.x - L) / cw - .5 - (n - vis.length)), 0, vis.length - 1); rc = vis[i];
    const x = Math.round(X(i)) + .5, y = clamp(coinUI.cross.y, Tp, Tp + ph);
    ctx.strokeStyle = C.fg; ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + phAll); ctx.moveTo(L, Math.round(y) + .5); ctx.lineTo(L + pw, Math.round(y) + .5); ctx.stroke(); ctx.globalAlpha = 1;
    const pv = mx - (y - Tp) / ph * (mx - mn), lab = F(pv); ctx.font = `10px ${MONO}`; const tw = ctx.measureText(lab).width + 10;
    ctx.fillStyle = C.dim; ctx.fillRect(L + pw + 2, y - 8, tw, 16); ctx.fillStyle = C.bg; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(lab, L + pw + 7, y);
  }
  const chg = rc.o ? rc.c / rc.o - 1 : 0;
  $("cOhlc").innerHTML = `<span>${S.mode === "replay" ? utc(rc.t, false) + " UTC" : local(rc.t, false)}</span><span>O <b>${F(rc.o)}</b></span><span>H <b>${F(rc.h)}</b></span><span>L <b>${F(rc.l)}</b></span><span>C <b>${F(rc.c)}</b></span><span class="${chg >= 0 ? "up" : "down"}">${fmtPct(chg)}</span>${rc.v ? `<span>Vol <b>${fmtUsd(rc.v)}</b></span>` : ""}${rc.open ? `<span class="dim">forming</span>` : ""}`;
  coinUI.paintMs = performance.now() - t0p;
}

/* ---------- animated task visuals ---------- */
const VIZ = []; let vizIO = null;
const SCRIPTS = "AБΓДΣЖΩλあカキ한글ąßøÆ文字中अआ" + "ابت";
function registerViz(root) {
  for (let i = VIZ.length - 1; i >= 0; i--) if (!VIZ[i].cv.isConnected) VIZ.splice(i, 1);
  if (!vizIO && "IntersectionObserver" in window) vizIO = new IntersectionObserver(es => es.forEach(e => { const v = VIZ.find(v => v.cv === e.target); if (v) v.vis = e.isIntersecting; }));
  qsa("canvas[data-viz]", root).forEach(cv => {
    if (VIZ.some(v => v.cv === cv)) return;
    const v = { cv, kind: cv.dataset.viz, m: cv.dataset.m, k: cv.dataset.k, vis: !vizIO, hit: 0, seed: hashStr(cv.dataset.m + cv.dataset.k) };
    VIZ.push(v); if (vizIO) vizIO.observe(cv);
    requestAnimationFrame(() => { if (cv.isConnected && cv.offsetParent) drawViz(v, reduced ? 0 : performance.now()); });
  });
}
const logoGrid = new Map();
function gridOf(tok, N) {
  const key = tok.m + N; if (logoGrid.has(key)) return logoGrid.get(key);
  const im = imgOf(tok); if (!im) return null;
  try {
    const c = document.createElement("canvas"); c.width = c.height = N; const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(im, 0, 0, N, N); const d = x.getImageData(0, 0, N, N).data, out = [];
    for (let i = 0; i < N * N; i++) out.push(`rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]})`);
    const order = out.map((_, i) => i), rnd = rng(hashStr(tok.m)); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const g = { c: out, order }; logoGrid.set(key, g); return g;
  } catch (_) { return null; }
}
function vizState(v) {
  const sqd = squadOf(v.m), ps = sqd.byTask.get(v.k) || [], t = TASK[v.k];
  return { n: ps.length, prog: Math.min(1, ps.length / t.goal), ps, t, sqd };
}
let vizCache = { t: 0, map: new Map() };
function drawViz(v, now) {
  const tok = tokAny(v.m); if (!tok) return;
  if (now - vizCache.t > 1000) vizCache = { t: now, map: new Map() };
  let st = vizCache.map.get(v.m + v.k); if (!st) { st = vizState(v); vizCache.map.set(v.m + v.k, st); }
  const { ctx, w, h } = fit(v.cv); ctx.clearRect(0, 0, w, h);
  const s = now / 1000, col = colorOf(v.m), fg = C.fg, faint = C.rule2, prog = st.prog, done = prog >= 1, R = rng(v.seed);
  const hit = clamp(1 - (now - v.hit) / 900, 0, 1);
  const cx = w / 2, cy = h / 2, S0 = Math.min(w, h);
  ctx.lineWidth = 1;
  switch (v.kind) {
    case "pixels": {
      const N = 12, g = gridOf(tok, N), cell = Math.floor(S0 / N), ox = Math.floor(cx - cell * N / 2), oy = Math.floor(cy - cell * N / 2), lit = Math.round(prog * N * N);
      const litSet = new Set(g ? g.order.slice(0, lit) : []);
      for (let i = 0; i < N * N; i++) {
        const x = ox + (i % N) * cell, y = oy + Math.floor(i / N) * cell;
        if (litSet.has(i)) { ctx.fillStyle = g.c[i]; ctx.fillRect(x, y, cell - 1, cell - 1); }
        else { ctx.fillStyle = faint; ctx.fillRect(x + cell / 2 - .75, y + cell / 2 - .75, 1.5, 1.5); }
      }
      if (!done && g) { const k = g.order[lit + Math.floor(s * 6) % Math.max(1, N * N - lit)] ?? 0, x = ox + (k % N) * cell, y = oy + Math.floor(k / N) * cell; ctx.strokeStyle = fg; ctx.strokeRect(x + .5, y + .5, cell - 1, cell - 1); }
      if (hit) { ctx.strokeStyle = fg; ctx.globalAlpha = hit; ctx.strokeRect(ox - 3 + .5, oy - 3 + .5, cell * N + 5, cell * N + 5); ctx.globalAlpha = 1; }
      break;
    }
    case "radar": {
      const rad = S0 / 2 - 4, a = s * 1.6 % (Math.PI * 2);
      ctx.strokeStyle = faint; [1, .66, .33].forEach(f => { ctx.beginPath(); ctx.arc(cx, cy, rad * f, 0, Math.PI * 2); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(cx - rad, cy); ctx.lineTo(cx + rad, cy); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx, cy + rad); ctx.stroke();
      if (!done) for (let i = 0; i < 10; i++) { ctx.strokeStyle = fg; ctx.globalAlpha = (1 - i / 10) * .5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a - i * .05) * rad, cy + Math.sin(a - i * .05) * rad); ctx.stroke(); }
      ctx.globalAlpha = 1;
      const n = st.n, total = Math.max(n, 1);
      for (let i = 0; i < n; i++) {
        const ang = R() * Math.PI * 2, rr = rad * (.25 + R() * .7), x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        const da = ((a - ang) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), fresh = da < .5 && !done ? 1 - da / .5 : 0;
        ctx.fillStyle = col; const sz = 3 + fresh * 3; ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
      if (total && hit) { ctx.strokeStyle = fg; ctx.globalAlpha = hit; ctx.beginPath(); ctx.arc(cx, cy, rad * (1 - hit) + 2, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      break;
    }
    case "blocks": {
      const N = 5, cell = Math.floor((S0 - 4) / N), ox = Math.floor(cx - cell * N / 2), oy = Math.floor(cy - cell * N / 2), lit = Math.round(prog * N * N);
      const order = []; let x0 = 0, y0 = 0, x1 = N - 1, y1 = N - 1;
      while (x0 <= x1 && y0 <= y1) { for (let x = x0; x <= x1; x++) order.push([x, y0]); for (let y = y0 + 1; y <= y1; y++) order.push([x1, y]); if (y0 < y1) for (let x = x1 - 1; x >= x0; x--) order.push([x, y1]); if (x0 < x1) for (let y = y1 - 1; y > y0; y--) order.push([x0, y]); x0++; y0++; x1--; y1--; }
      order.forEach(([gx, gy], i) => { const x = ox + gx * cell, y = oy + gy * cell;
        if (i < lit) { ctx.fillStyle = i === lit - 1 && hit ? fg : col; ctx.fillRect(x + 1, y + 1, cell - 3, cell - 3); }
        else if (i === lit && !done) { if (Math.floor(s * 2) % 2 === 0) { ctx.fillStyle = fg; ctx.fillRect(x + 1, y + 1, cell - 3, cell - 3); } else { ctx.strokeStyle = fg; ctx.strokeRect(x + 1.5, y + 1.5, cell - 4, cell - 4); } }
        else { ctx.strokeStyle = faint; ctx.strokeRect(x + 1.5, y + 1.5, cell - 4, cell - 4); } });
      break;
    }
    case "eq": {
      const N = 12, bw = (w - 8) / N, act = Math.max(done ? N : 0, Math.ceil(prog * N));
      for (let i = 0; i < N; i++) {
        const on = i < act, amp = on ? (.35 + .65 * Math.abs(Math.sin(s * (2.2 + (i % 5) * .7) + i * 1.3) * Math.sin(s * 1.3 + i))) : .06 + .04 * Math.sin(s * 3 + i);
        const bh = Math.max(2, amp * (h - 12)) * (done ? .55 + .2 * Math.sin(s * 2 + i) : 1);
        ctx.fillStyle = on ? (i === act - 1 && hit ? fg : col) : faint; ctx.fillRect(4 + i * bw + 1, cy - bh / 2, bw - 3, bh);
      }
      break;
    }
    case "type": {
      const lines = 6, lh = (h - 12) / lines, done2 = Math.round(prog * lines), cw = 5;
      for (let l = 0; l < lines; l++) {
        const y = 8 + l * lh, len = Math.floor((w - 14) / cw * (.55 + R() * .45));
        let shown = l < done2 ? len : l === done2 && !done ? Math.floor((s * 14) % (len + 8)) : 0; shown = Math.min(len, shown);
        for (let c = 0; c < shown; c++) { if (R() < .14) continue; ctx.fillStyle = l < done2 ? fg : col; ctx.fillRect(6 + c * cw, y, cw - 1.5, Math.max(2, lh * .42)); }
        if (l === done2 && !done && Math.floor(s * 2) % 2 === 0) { ctx.fillStyle = fg; ctx.fillRect(6 + shown * cw, y - 1, 2, lh * .6); }
        if (l >= done2 && l !== done2) { ctx.fillStyle = faint; ctx.fillRect(6, y + lh * .2, w - 14, 1); }
      }
      break;
    }
    case "scramble": {
      const N = 3, cell = (S0 - 6) / N, lock = Math.round(prog * N * N); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let i = 0; i < N * N; i++) {
        const gx = i % N, gy = Math.floor(i / N), x = cx + (gx - 1) * cell, y = cy + (gy - 1) * cell, locked = i < lock;
        const ch = locked ? SCRIPTS[(v.seed + i * 7) % SCRIPTS.length] : SCRIPTS[Math.floor(s * 9 + i * 5) % SCRIPTS.length];
        ctx.font = `${locked ? 600 : 400} ${Math.round(cell * .5)}px ${MONO}`; ctx.fillStyle = locked ? (i === lock - 1 && hit ? col : fg) : faint; ctx.fillText(ch, x, y);
        if (locked) { ctx.strokeStyle = faint; ctx.strokeRect(x - cell / 2 + 2.5, y - cell / 2 + 2.5, cell - 5, cell - 5); }
      }
      break;
    }
    case "tug": {
      const rival = rivalOf(v.m), mine = st.n, theirs = rival ? (squadOf(rival.m).byTask.get(v.k) || []).length : 0;
      const share = mine + theirs ? mine / (mine + theirs) : .5, osc = done ? 0 : Math.sin(s * 3) * 2.5, mx = cx + (share - .5) * (w - 44) + osc, y = cy + 6;
      ctx.strokeStyle = faint; ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(mx, y); ctx.stroke(); ctx.lineWidth = 1;
      ctx.strokeStyle = fg; ctx.beginPath(); ctx.moveTo(cx + .5, y - 10); ctx.lineTo(cx + .5, y + 10); ctx.stroke();
      ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(mx, y - 7); ctx.lineTo(mx + 5, y); ctx.lineTo(mx, y + 7); ctx.lineTo(mx - 5, y); ctx.closePath(); ctx.fill();
      logoDot(ctx, tok, 9, y - 18, 7, col); if (rival) logoDot(ctx, rival, w - 9, y - 18, 7, colorOf(rival.m));
      ctx.font = `9px ${MONO}`; ctx.fillStyle = C.dim; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText(String(mine), 4, y + 10); ctx.textAlign = "right"; ctx.fillText(String(theirs), w - 4, y + 10);
      break;
    }
    case "orbit": {
      logoDot(ctx, tok, cx, cy, S0 * .14, col);
      const n = Math.max(1, Math.round(prog * 12)), ghosts = done ? 0 : 1;
      for (let i = 0; i < n + ghosts; i++) {
        const ring = 1 + (i % 3), rr = S0 * (.18 + ring * .09), sp = (1.4 - ring * .3) * (i % 2 ? 1 : -1), a = s * sp + i * 2.39;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i >= n) { ctx.strokeStyle = fg; ctx.strokeRect(x - 2.5, y - 2.5, 5, 5); } else { ctx.fillStyle = i === n - 1 && hit ? fg : col; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.strokeStyle = faint; [1, 2, 3].forEach(k => { ctx.beginPath(); ctx.arc(cx, cy, S0 * (.18 + k * .09), 0, Math.PI * 2); ctx.stroke(); });
      break;
    }
  }
  if (done) { ctx.strokeStyle = fg; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(w - 16, 8); ctx.lineTo(w - 12, 12); ctx.lineTo(w - 5, 4); ctx.stroke(); ctx.lineWidth = 1; }
}
function drawAllViz(now) { for (const v of VIZ) if (v.vis && v.cv.isConnected && v.cv.offsetParent) drawViz(v, now); }
