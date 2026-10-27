/* ================= the bet slip in the rail ================= */
// The rail's first panel is a bet slip by default (the wire is the other tab). The slip backs whatever the race shows:
// a squad in the squad race, or a coin in the top-gainer race. Its mode is the race's mode, so the two always match.
const SLIP = { tab: "bet", pick: { squads: null, coins: null }, busy: false, wireN: 0 };

function setRailTab(t, quiet) {
  SLIP.tab = t === "wire" ? "wire" : "bet";
  qsa("#railTabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.rt === SLIP.tab)));
  $("slip").hidden = SLIP.tab !== "bet"; $("feed").hidden = SLIP.tab !== "wire";
  document.querySelector(".rail").classList.toggle("bet", SLIP.tab === "bet");
  if (SLIP.tab === "wire") { SLIP.wireN = 0; $("wireN").textContent = ""; }
  if (!quiet) renderSlip(nowW(), true);
}
// new wire lines while the slip is showing: a count on the Wire tab
function slipWireBump() { if (SLIP.tab === "wire") return; SLIP.wireN++; const n = $("wireN"); if (n) n.textContent = SLIP.wireN > 99 ? "99+" : String(SLIP.wireN); }

// pick a squad or coin from anywhere (a Back button): shows it in the slip when the slip is on screen, else the bet sheet
function slipPick(mode, id) {
  const rl = document.querySelector(".rail"), box = rl && rl.getBoundingClientRect();
  const onScreen = box && !railOff && box.width > 0 && box.top < innerHeight - 120 && box.bottom > 120;
  if (!onScreen) { if (mode === "squads") openSqBet(id); else openBet(id, "top"); return; }
  if (RACE.mode !== mode) { RACE.mode = mode; raceModeUI(); }
  SLIP.pick[mode] = id; if (SLIP.tab !== "bet") setRailTab("bet");
  renderSlip(nowW(), true);
  const a = $("sAmt"); if (a) a.focus({ preventScroll: true });
}

function slipRows(r, w) {
  if (RACE.mode === "squads") {
    if (!S.srv) return { rows: [], empty: "The squad race runs on the live arena." };
    if (!PFS.on) return { rows: [], empty: PFS.loadedAt ? "pump.fun's squads aren't loaded yet." : "Loading squads…" };
    const pl = sqPool(r);
    const rows = sqField(r).map(id => PFS.byId.get(id)).filter(Boolean).map(s => {
      const g = sqGain(s.id, r, w), sh = pl.sh.get(s.id) || 0;
      return { id: s.id, av: sqAv(s, 22), name: s.name, sub: sgnUsd(s.pnl) + " total", val: sgnUsd(g), up: g == null ? null : g >= 0, g: g ?? -1e15, odds: sh ? pl.P * (1 - RAKE) / sh : null };
    }).sort((a, b) => b.g - a.g);
    return { rows, empty: "No squads in this round's race yet." };
  }
  const pl = pool(r, "top");
  const rows = fieldOf(r, "top").map(tok => {
    const R = retOf(tok, r, w), sh = pl.sh.get(tok.m) || 0;
    return { id: tok.m, av: avHTML(tok, 22, 1.5), name: tok.s, sub: inTop(tok.m) ? "top 15" : "on deck", val: fmtPct(R), up: R == null ? null : R >= 0, g: R ?? -1e9, odds: sh ? pl.P * (1 - RAKE) / sh : null };
  }).sort((a, b) => b.g - a.g);
  return { rows, empty: "No coins in this round yet." };
}
function slipState(r, w, id) { return RACE.mode === "squads" ? sqBetState(r, w, id) : betState(r, "top", w, id); }

function renderSlip(w, force) {
  const box = $("slip"); if (!box || box.hidden || railOff) return;
  if (!force && S.tickN % 2) return;
  const mode = RACE.mode, r = roundAt(S.tf, w), pick = SLIP.pick[mode];
  if (mode === "squads" && S.srv && PFS.loadedFor !== r.key) pfLoad(r);
  qsa("#slipMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  // when bets close, or why they can't be placed
  const bs = slipState(r, w, null), closeAt = betCloseAt(r);
  $("slipSt").textContent = bs.open ? `bets close in ${dur(closeAt - w)}` : `Bets closed · next round in ${dur(nextRoundAt(r) - w)}`;
  $("slipSt").className = "slip-st" + (bs.open ? "" : " shut");
  // closed here but open in another round length: one click to switch
  const alt = bs.open ? null : TFK.filter(k => k !== S.tf && tfOk(k)).map(k => ({ k, r: roundAt(k, w) })).find(x => slipState(x.r, w, null).open);
  setHTML($("slipAlt"), alt ? `<button type="button" class="btn btn-solid btn-xs" data-tf="${alt.k}">Bet in the ${TF[alt.k].label} round · open ${dur(betCloseAt(alt.r) - w)}</button>` : "");
  const { rows, empty } = slipRows(r, w);
  setHTML($("slipList"), rows.length ? rows.map((x, i) => `<button type="button" class="srow" data-id="${esc(x.id)}" aria-pressed="${x.id === pick}">
      <span class="rk">${i + 1}</span>${x.av}<span class="nm"><b>${esc(x.name)}</b><span>${esc(x.sub)}</span></span>
      <span class="v"><b class="${x.up == null ? "dim" : x.up ? "up" : "down"}">${x.val}</b><span>${x.odds ? fmtX(x.odds) : "—"}</span></span></button>`).join("")
    : `<div class="empty">${esc(empty)}</div>`);
  $("slipHead").textContent = (mode === "squads" ? "Squad race · " : "Top gainer · ") + TF[S.tf].label + " round · gained · pays";
  slipCalc(r, w);
}
function slipCalc(r, w) {
  if (SLIP.cur !== CUR) {                   // the stake buttons follow the currency (practice tSOL or real SOL)
    SLIP.cur = CUR; $("sAmt").value = CUR === "SOL" ? "0.05" : "0.5"; $("sAmt").step = CUR === "SOL" ? "0.01" : "0.05";
    $("sQuick").innerHTML = (CUR === "SOL" ? ["0.01", "0.05", "0.1", "0.5"] : ["0.1", "0.5", "1", "5"]).map(v => `<button type="button" data-v="${v}">${v}</button>`).join("") + `<button type="button" data-v="max">Max</button>`;
  }
  const mode = RACE.mode, pick = SLIP.pick[mode], a = parseFloat($("sAmt").value) || 0, bs = slipState(r, w, pick);
  $("sCur").textContent = CUR;
  const name = !pick ? "—" : mode === "squads" ? (PFS.byId.get(pick) || {}).name || "—" : (tokAny(pick) || {}).s || "—";
  SLIP.name = name;
  $("sW").textContent = bs.open ? "×" + bs.w.toFixed(3) : "—";
  let pay = null;
  if (pick && bs.open && a > 0) {
    if (mode === "squads") { const pl = sqPool(r), mine = pl.sh.get(pick) || 0; pay = (pl.P + a) * (1 - RAKE) * (a * bs.w) / (mine + a * bs.w); }
    else pay = quote(r, "top", pick, a, bs.w).pay;
  }
  $("sO").textContent = pay == null ? "—" : fmtSol(pay) + " · " + fmtX(pay / a);
  const go = $("sGo");
  if (!SLIP.busy) {
    go.textContent = S.srv && !S.me.id ? "Log in to bet" : !pick ? (mode === "squads" ? "Pick a squad" : "Pick a coin") : "Back " + name;
    go.disabled = !!(S.srv && S.me.id) && (!pick || !bs.open);
    $("sErr").textContent = pick && !bs.open && !/close|next round/i.test(bs.why) ? bs.why : "";
  }
  $("sBal").textContent = (CUR === "SOL" ? "Real SOL" : "Practice tSOL") + " · balance " + fmtSol(S.my.bal);
}
async function slipGo() {
  if (S.srv && !S.me.id) { srvLogin(); return; }
  const mode = RACE.mode, pick = SLIP.pick[mode], a = parseFloat($("sAmt").value) || 0, go = $("sGo");
  if (!pick || SLIP.busy) return;
  SLIP.busy = true; go.disabled = true; go.textContent = "Placing…"; $("sErr").textContent = "";
  try {
    const r = roundAt(S.tf, nowW());
    if (mode === "squads") await srvPlaceBet(r, "sq", pick, a); else await placeBet(r, "top", pick, a);
    notice("Bet placed · " + fmtSol(a) + " on " + SLIP.name); dirty.race = true;
  } catch (e) { $("sErr").textContent = e && e.message ? e.message : "The bet didn't go through."; }
  finally { SLIP.busy = false; renderSlip(nowW(), true); }
}

(function slipInit() {
  qsa("#railTabs button").forEach(b => b.addEventListener("click", () => setRailTab(b.dataset.rt)));
  qsa("#slipMode button").forEach(b => b.addEventListener("click", () => { if (RACE.mode === b.dataset.mode) return; RACE.mode = b.dataset.mode; hover = null; raceModeUI(); renderSqTable(nowW()); renderSlip(nowW(), true); }));
  onPick($("slipList"), ".srow[data-id]", rw => { SLIP.pick[RACE.mode] = rw.dataset.id; renderSlip(nowW(), true); });
  const amt = $("sAmt"); amt.value = CUR === "SOL" ? "0.05" : "0.5";
  amt.addEventListener("input", () => slipCalc(roundAt(S.tf, nowW()), nowW()));
  amt.addEventListener("keydown", e => { if (e.key === "Enter") slipGo(); });
  $("sQuick").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (!b) return; amt.value = b.dataset.v === "max" ? Math.max(0, Math.floor(S.my.bal * 100) / 100) : b.dataset.v; slipCalc(roundAt(S.tf, nowW()), nowW()); });
  $("sGo").addEventListener("click", slipGo);
  $("slipAlt").addEventListener("click", e => { const b = e.target.closest("button[data-tf]"); if (b) { setTf(b.dataset.tf); renderSlip(nowW(), true); } });
  $("sMore").addEventListener("click", () => { const p = SLIP.pick[RACE.mode]; if (RACE.mode === "squads") openSqBet(p); else openBet(p, "top"); });
  setRailTab("bet", true);                 // the page always opens on the slip
})();
