/* ================= pump.fun squads: the squad race ================= */
// pump.fun's squad competition, mirrored by the round server: squads, members and profit (pump.fun's own figures at the
// copy, tracked on-chain since). The arena's race can show the squads instead of coins, and the squad race is a market:
// the 15 leading squads at a round's open race on profit gained during the round.
const PFS = { on: false, comp: null, at: 0, tracked: 0, list: [], byId: new Map(), series: new Map(), loadedFor: "", busy: false, loadedAt: 0, detail: null, detailAt: 0 };
const RACE = { mode: "squads" };          // the page opens on the squad race; Coins is one click away
const sqTok = s => ({ m: s.id, s: s.name, n: s.n + " members", logo: s.img });
const sgnUsd = v => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + fmtUsd(Math.abs(v));
const sqAv = (s, size) => avHTML(sqTok(s), size, 2);
// a squad's top coin: the coin's logo (falls back like any coin logo: other gateways, the site's image proxy, its initial)
const SOL_CHAIN = 1399811149;
const coinAv = (p, size) => `<span class="sq-coin" title="${esc(p.s || "?")}${p.n && p.n !== p.s ? " · " + esc(p.n) : ""}">${avHTML({ m: p.m || p.s || "", s: p.s || "?", logo: p.img }, size, 1)}</span>`;

/* ---------- data ---------- */
function pfVal(id, t) {
  const ser = PFS.series.get(id); if (!ser || !ser.length || ser[0][0] > t) return null;
  let lo = 0, hi = ser.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ser[m][0] <= t) lo = m; else hi = m - 1; }
  return ser[lo][1];
}
function pfValLin(id, t) {
  const ser = PFS.series.get(id); if (!ser || !ser.length || ser[0][0] > t) return null;
  let lo = 0, hi = ser.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ser[m][0] <= t) lo = m; else hi = m - 1; }
  const a = ser[lo], b = ser[lo + 1]; return b && b[0] > a[0] ? a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]) : a[1];
}
async function pfLoad(r, force) {
  if (!S.srv || !SRV.url || PFS.busy) return;
  const key = r ? r.key : ""; if (!force && PFS.loadedFor === key && nowW() - PFS.loadedAt < 300e3) return;
  PFS.busy = true;
  try {
    const j = await fetch(SRV.url + "/pf?since=1").then(x => x.ok ? x.json() : null); if (!j) return;
    PFS.on = !!j.on; PFS.comp = j.comp || null; PFS.at = j.at || 0; PFS.tracked = j.tracked || 0;
    PFS.list = j.squads || []; PFS.byId = new Map(PFS.list.map(s => [s.id, s]));
    for (const [id, ser] of Object.entries(j.series || {})) PFS.series.set(id, ser);
    PFS.loadedFor = key; PFS.loadedAt = nowW(); dirty.race = true;
  } catch (_) {} finally { PFS.busy = false; }
}
// live: [id, pnl, realized, unrealized] for squads whose score moved
function pfEvent(d) {
  if (!d || !Array.isArray(d.list)) return;
  for (const [id, pnl, r, u] of d.list) {
    const s = PFS.byId.get(id); if (s) { s.pnl = pnl; s.r = r; s.u = u; }
    let ser = PFS.series.get(id); if (!ser) PFS.series.set(id, ser = []);
    const last = ser[ser.length - 1]; if (last && d.t - last[0] < 20000) last[1] = pnl; else ser.push([d.t, pnl]);
    if (ser.length > 4000) ser.splice(0, 1000);
  }
  PFS.tracked = d.t;
  PFS.list.sort((a, b) => b.pnl - a.pnl).forEach((s, i) => s.rank = i + 1);
  if (PFS.detail) { const s = PFS.byId.get(PFS.detail.id); if (s) { PFS.detail.pnl = s.pnl; PFS.detail.r = s.r; PFS.detail.u = s.u; PFS.detail.rank = s.rank; } }
  dirty.race = true;
}
// the squads racing this round: fixed at the open by the server, else the 15 leading squads now
function sqField(r) {
  const st = SRV.rounds && SRV.rounds.get(r.key), f = st && st.field && st.field.sq;
  return f && f.length ? f : PFS.list.slice(0, 15).map(s => s.id);
}
function sqGain(id, r, w) { const a = pfVal(id, r.s), s = PFS.byId.get(id); if (a == null || !s) return null; const b = Math.min(w, r.e) >= nowW() - 1000 ? s.pnl : pfVal(id, Math.min(w, r.e)); return b == null ? null : b - a; }

/* ---------- the race, drawn by drawRace in the arena ---------- */
// squads aren't tied to rounds: the chart is each of the 15 leading squads' all-time profit, from the start of the
// tracked history to now, like pump.fun's leaderboard
const sqCol = s => pal[((s.rank0 || 1) - 1) % pal.length];
function sqSeries(r, w) {
  const te = w, ids = PFS.list.slice(0, 15).map(s => s.id), out = [];
  let t0 = Infinity; for (const id of ids) { const ser = PFS.series.get(id); if (ser && ser.length) t0 = Math.min(t0, ser[0][0]); }
  if (!isFinite(t0)) t0 = PFS.at || te - 3600e3; t0 = Math.min(t0, te - 60000);
  const N = clamp(Math.floor((race.clientWidth || 600) / 3), 60, 300);
  ids.forEach(id => {
    const s = PFS.byId.get(id); if (!s) return;
    const at = t => t >= nowW() - 1500 ? s.pnl : pfValLin(id, t);
    const pts = []; for (let k = 0; k <= N; k++) { const t = t0 + (te - t0) * k / N, v = at(t); if (v != null) pts.push({ t, v }); }
    if (!pts.length) pts.push({ t: te, v: s.pnl });
    out.push({ tok: sqTok(s), pts, end: s.pnl, col: sqCol(s), at });
  });
  return { ser: out, t0, t1: te, te, abs: true };
}
function raceModeUI() {
  const sq = RACE.mode === "squads";
  qsa("#raceMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === RACE.mode)));
  const setH = (id, t) => { const h = $(id); h.textContent = t; h.dataset.txt = t; };      // dataset.txt: the heading's scramble effect replays this text
  setH("raceTitle", sq ? "Squads" : "Race");
  $("raceSub").textContent = sq ? (PFS.comp ? PFS.comp.title : "pump.fun squads") + " · all-time profit" : "% since round open";
  $("race").setAttribute("aria-label", sq ? "The 15 leading pump.fun squads, all-time profit" : "All top 15 coins, percent change since the round opened");
  $("raceSeg").hidden = sq;
  setH("boardH", sq ? "Leaderboard" : "Top 15");
  $("boardSub").textContent = sq ? "every pump.fun squad, ranked by all-time profit" : "pump.fun coins launched in the last 72 h, ranked by market cap";
  $("tbl").hidden = sq; $("sqTbl").hidden = !sq;
  if (sq) pfLoad(roundAt(S.tf, nowW()));
  dirty.race = true;
}
qsa("#raceMode button").forEach(b => b.addEventListener("click", () => { RACE.mode = b.dataset.mode; hover = null; raceModeUI(); renderSqTable(nowW()); }));

/* ---------- the squad table under the race ---------- */
function renderSqTable(w) {
  const el = $("sqTbl"); if (!el || el.hidden) return;
  if (!S.srv) { setHTML(el, `<div class="empty">The squad race runs on the live arena.</div>`); return; }
  if (!PFS.on) { setHTML(el, `<div class="empty">${PFS.loadedAt ? "pump.fun's squads aren't loaded on the round server yet." : "Loading squads…"}</div>`); return; }
  const r = roundAt(S.tf, w), inF = new Set(sqField(r)), bs = sqBetState(r, w);
  const row = s => `<div class="row sqr${hover === s.id ? " hot" : ""}" data-sq="${esc(s.id)}" tabindex="0" role="link" aria-label="${esc(s.name)} squad. Open its page.">
    <span class="rk">${s.rank}</span>
    <span class="tk-cell">${sqAv(s, 20)}<b>${esc(s.name)}</b><span class="nm">${s.n} members</span></span>
    <span class="num ${s.pnl >= 0 ? "up" : "down"}">${sgnUsd(s.pnl)}</span>
    <span class="num dim sq-ru">${sgnUsd(s.r)}</span>
    <span class="num dim sq-ru">${sgnUsd(s.u)}</span>
    <span class="sq-top">${(s.top || []).map(p => coinAv(p, 18)).join("")}</span>
    <span class="back">${inF.has(s.id) ? `<span class="btn btn-quiet btn-xs" data-act="bet"${bs.open ? "" : ` aria-disabled="true"`}>Back</span>` : ""}</span></div>`;
  setHTML(el, `<div class="row thead sqr"><span>#</span><span>Squad</span><span class="num">Profit</span><span class="num sq-ru">Realized</span><span class="num sq-ru">Unrealized</span><span>Top coins</span><span></span></div>`
    + PFS.list.map(row).join("")
    + `<p class="fine sq-note">Mirrored from pump.fun's ${esc(PFS.comp ? PFS.comp.title : "squad leaderboard")}: names, pictures and members as on pump.fun; profit is pump.fun's at the copy (${PFS.at ? local(PFS.at, false) : "—"}) plus each member's on-chain profit since${PFS.tracked ? ", updated " + ago(nowW() - PFS.tracked) : ""}. It can differ slightly from pump.fun's official score.</p>`);
  onPick(el, ".row[data-sq]", (rw, inner) => { const id = rw.dataset.sq; if (inner.closest("[data-act=bet]")) { slipPick("squads", id); return; } location.hash = "#sq-" + id; });
  if (!el.__keys) { el.__keys = 1; el.addEventListener("keydown", e => { const rw = e.target.closest(".row[data-sq]"); if (rw && e.key === "Enter") location.hash = "#sq-" + rw.dataset.sq; }); }
}

/* ---------- betting on the squad race ---------- */
function sqBetState(r, w, id) {
  const el = (w - r.s) / r.W;
  if (!S.srv) return { open: false, why: "The squad race runs on the live arena." };
  // the squad race is scored from the squads' tracked history, so it stays open even when the coin race isn't
  const st = SRV.rounds && SRV.rounds.get(r.key);
  if (el >= BET_WIN) return { open: false, why: "Bets close at 40% of the round. The next round opens in " + dur(r.e - w) + "." };
  if (!st || !(st.field.sq || []).length) return { open: false, why: "The squad race starts with the next round, in " + dur(r.e - w) + "." };
  if (id && !st.field.sq.includes(id)) return { open: false, why: "That squad isn't in this round's race. The 15 leading squads at the open race." };
  return { open: true, el, w: 1 / (1 + 2 * el) };
}
function sqPool(r) {
  const st = SRV.rounds && SRV.rounds.get(r.key), p = st && st.pools && st.pools["sq|" + CUR], seed = seedNow(), sh = new Map();
  let P = 0; for (const id of sqField(r)) { sh.set(id, seed); P += seed; }
  if (p) { P = p.P; for (const [id, v] of Object.entries(p.sh)) sh.set(id, v); }
  return { P, sh, people: p ? p.people : 0 };
}
function openSqBet(id) {
  if (!S.srv) { notice("The squad race runs on the live arena"); return; }
  if (!tfOk(S.tf)) { notice("24-hour rounds need live data"); return; }
  const st = { id };
  const draw = () => {
    const w = nowW(), r = roundAt(S.tf, w), field = sqField(r).map(x => PFS.byId.get(x)).filter(Boolean), s = st.id ? PFS.byId.get(st.id) : null;
    modal(`${head("Back a squad", TF[S.tf].label + " squad race · live", s ? sqAv(s, 30) : "")}
      <p class="fine" style="margin:10px 0 12px">The squad that gains the most profit during the round wins the pool. Bets close at 40%; earlier bets carry more weight.</p>
      <label class="lbl">Squad</label>
      <div class="picks" id="bPicks">${field.map(x => `<button type="button" data-m="${esc(x.id)}" aria-pressed="${x.id === st.id}">${sqAv(x, 16)}<span>${esc(x.name)}</span></button>`).join("") || `<span class="dim">No squads in this round's race yet.</span>`}</div>
      <label class="lbl" for="bAmt">Stake</label>
      <div class="field"><input id="bAmt" type="number" inputmode="decimal" min="${minStake()}" step="${CUR === "SOL" ? 0.01 : 0.05}" value="${st.amt || (CUR === "SOL" ? 0.05 : 0.5)}"><span>${CUR}</span></div>
      <div class="quick">${(CUR === "SOL" ? ["0.01", "0.05", "0.1", "0.5"] : ["0.1", "0.5", "1", "5"]).map(v => `<button type="button" data-v="${v}">${v}</button>`).join("")}<button type="button" data-v="max">Max</button></div>
      <div class="calc"><div><span>Weight if placed now</span><b id="cW">—</b></div><div><span>Pool now</span><b id="cP">—</b></div><div><span>Your share of this pick</span><b id="cS">—</b></div><div class="pay"><span>Payout if it wins</span><b id="cO">—</b></div></div>
      <p class="err" id="bErr"></p>
      <button class="btn btn-solid btn-wide" type="button" id="bGo">${!S.me.id ? "Log in to place bets" : "Place bet"}</button>
      <p class="fine">${CUR === "SOL" ? "Real SOL from your arena balance." : "Practice credits (tSOL), no real SOL moves."} Pari-mutuel: the whole pool, minus a ${RAKE * 100}% rake, goes to backers of the winning squad, split by stake × weight. Each pool starts with a ${seedNow()} ${CUR} house seed per squad. Squad profit is pump.fun's at the copy plus on-chain profit since. Balance: ${fmtSol(S.my.bal)}.</p>`);
    qsa("#bPicks button", root).forEach(b => b.onclick = () => { st.id = b.dataset.m; qsa("#bPicks button", root).forEach(x => x.setAttribute("aria-pressed", String(x === b))); calc(); });
    qsa(".quick button", root).forEach(b => b.onclick = () => { $("bAmt").value = b.dataset.v === "max" ? Math.max(0, Math.floor(S.my.bal * 100) / 100) : b.dataset.v; calc(); });
    $("bAmt").addEventListener("input", calc);
    $("bGo").onclick = async () => {
      if (!S.me.id) { closeModal(); srvLogin(); return; }
      const a = parseFloat($("bAmt").value) || 0, go = $("bGo");
      if (!st.id) { $("bErr").textContent = "Pick a squad first."; return; }
      go.disabled = true; go.textContent = "Placing…";
      try { await srvPlaceBet(roundAt(S.tf, nowW()), "sq", st.id, a); closeModal(); notice("Bet placed · " + fmtSol(a) + " on " + (PFS.byId.get(st.id) || {}).name); dirty.race = true; }
      catch (e) { go.disabled = false; go.textContent = "Place bet"; $("bErr").textContent = e && e.message ? e.message : "The bet didn't go through."; }
    };
    calc(); sheetTick = setInterval(calc, 1000);
  };
  const calc = () => {
    if (!$("bAmt")) return;
    const w = nowW(), r = roundAt(S.tf, w), a = parseFloat($("bAmt").value) || 0, bs = sqBetState(r, w, st.id), pl = sqPool(r);
    $("cW").textContent = bs.open ? "×" + bs.w.toFixed(3) : "—";
    $("cP").textContent = fmtSol(pl.P) + " · " + pl.people + " bettor" + (pl.people === 1 ? "" : "s");
    if (st.id && bs.open && a > 0) { const mine = pl.sh.get(st.id) || 0, pay = (pl.P + a) * (1 - RAKE) * (a * bs.w) / (mine + a * bs.w); $("cS").textContent = ((a * bs.w) / (mine + a * bs.w) * 100).toFixed(1) + "%"; $("cO").textContent = fmtSol(pay) + " · " + fmtX(pay / a); }
    else { $("cS").textContent = "—"; $("cO").textContent = "—"; }
    const go = $("bGo"); if (!S.me.id) { go.disabled = false; return; } if (!go.textContent.includes("…")) { go.disabled = !bs.open || !st.id; $("bErr").textContent = st.id && !bs.open ? bs.why : ""; }
  };
  draw();
}
function sqBetLive(b, w) {
  const r = roundOfBet(b);
  if (w >= r.e) return `<span class="dim">settling…</span>`;
  const g = sqField(r).map(id => ({ id, g: sqGain(id, r, w) })).filter(x => x.g != null).sort((a, c) => c.g - a.g), i = g.findIndex(x => x.id === b.m);
  return i >= 0 ? `#${i + 1} · ${sgnUsd(g[i].g)}` : "—";
}

/* ---------- a squad's page ---------- */
async function loadSquad(id) {
  if (!S.srv || !SRV.url) return;
  try { const j = await fetch(SRV.url + "/pf/squad?id=" + encodeURIComponent(id) + "&since=1").then(x => x.ok ? x.json() : null); if (j && S.view === "sq" && S.sq === id) { PFS.detail = j; PFS.detailAt = nowW(); renderSquadPage(true); } } catch (_) {}
}
function buildSquadPage(id) {
  const el = $("v-sq"); PFS.detail = null; S.sq = id;
  el.innerHTML = `<a class="c-back" href="#arena">← Arena</a><div id="sqPage"><div class="empty">Loading the squad…</div></div>`;
  if (!PFS.list.length) pfLoad(roundAt(S.tf, nowW()), true);
  loadSquad(id);
}
function renderSquadPage(full) {
  const d = PFS.detail, box = $("sqPage"); if (!d || !box) return;
  const w = nowW(), r = roundAt(S.tf, w), g = sqGain(d.id, r, w), inRace = sqField(r).includes(d.id), bs = sqBetState(r, w, d.id);
  if (full) {
    const prize = PFS.comp && PFS.comp.prizes ? PFS.comp.prizes.find(p => d.rank >= p[0] && d.rank <= p[1]) : null;
    box.innerHTML = `<div class="c-head">${sqAv(d, 54)}<div class="ttl"><h1>${esc(d.name)} <span class="tier">#<span id="sqRank">${d.rank}</span></span></h1>
        <div class="sub"><span>${d.n} members</span><span>${esc(PFS.comp ? PFS.comp.title : "pump.fun squads")}</span>${prize ? `<span>in the prize zone · ${fmtUsd(prize[2])}</span>` : ""}${d.x ? `<a class="link" href="https://x.com/${esc(d.x)}" target="_blank" rel="noopener">@${esc(d.x)}</a>` : ""}</div></div>
        <div class="px"><b id="sqPnl" class="${d.pnl >= 0 ? "up" : "down"}">${sgnUsd(d.pnl)}</b><span class="dim" id="sqRU">realized ${sgnUsd(d.r)} · unrealized ${sgnUsd(d.u)}</span></div></div>
      <div class="c-grid"><div class="chart-box">
        <div class="chart-bar"><div class="ohlc"><span>Profit, all time</span></div></div>
        <canvas id="sqCv" style="display:block;width:100%;height:260px;border:1px solid var(--rule)" aria-label="${esc(d.name)} all-time profit"></canvas>
        <div class="sec"><div class="sec-h"><div class="t"><h2>Members</h2><p>Profit in the competition, best first</p></div></div>
          <div class="ox"><table class="tbl2"><thead><tr><th>#</th><th>Member</th><th class="n">Profit</th><th class="n">Realized</th><th class="n">Unrealized</th><th>Wallet</th></tr></thead><tbody id="sqMembers"></tbody></table></div></div>
      </div><div class="side">
        <div class="box"><h4>Back ${esc(d.name)}</h4><div id="sqBack"></div></div>
        <div class="box"><h4>Top coins</h4><div class="pos">${(d.top || []).map(p => `<div class="p"><b style="display:flex;align-items:center;gap:8px">${coinAv(p, 20)}${p.c === SOL_CHAIN && p.m ? `<a class="link" href="#coin-${esc(p.m)}">${esc(p.s || "?")}</a>` : esc(p.s || "?")}</b><span class="num dim">${esc(p.n || "")}</span></div>`).join("") || `<p class="fine">No positions listed.</p>`}</div></div>
        <div class="box"><h4>Squad</h4><dl class="kv"><dt>Rank now</dt><dd id="sqRank2">#${d.rank}</dd><dt>Rank at the copy</dt><dd>#${d.rank0}</dd><dt>Positions</dt><dd>${fmtNum(d.positions)}</dd><dt>Bought</dt><dd>${d.sol ? fmtNum(d.sol) + " SOL" : "—"}</dd><dt>Copied from pump.fun</dt><dd>${d.at ? local(d.at, false) : "—"}</dd><dt>Profit updated</dt><dd id="sqUpd">${d.tracked ? ago(w - d.tracked) : "—"}</dd></dl>
          <p class="fine">Names, pictures and members as on pump.fun. Profit is pump.fun's at the copy plus each member's on-chain profit since, so it can differ slightly from pump.fun's official score.</p></div>
      </div></div>`;
    $("sqMembers").innerHTML = d.members.map((m, i) => `<tr><td class="dim">${i + 1}</td><td><span style="display:inline-flex;align-items:center;gap:8px">${avHTML({ m: m.w, s: m.u || "?", logo: m.img }, 20, 1.5)}<b>${esc(m.u || short(m.w))}</b>${m.x ? ` <a class="link dim" href="https://x.com/${esc(m.x)}" target="_blank" rel="noopener">@${esc(m.x)}</a>` : ""}</span></td>
      <td class="n ${m.pnl >= 0 ? "up" : "down"}">${sgnUsd(m.pnl)}</td><td class="n dim">${sgnUsd(m.r)}</td><td class="n dim">${sgnUsd(m.un)}</td><td><a class="link dim" href="https://solscan.io/account/${esc(m.w)}" target="_blank" rel="noopener">${esc(short(m.w))}</a></td></tr>`).join("");
    onPick($("sqBack"), "[data-sqbet]", () => openSqBet(d.id));
  }
  const pn = $("sqPnl"); if (pn) { pn.textContent = sgnUsd(d.pnl); pn.className = d.pnl >= 0 ? "up" : "down"; $("sqRU").textContent = `realized ${sgnUsd(d.r)} · unrealized ${sgnUsd(d.u)}`; $("sqRank").textContent = d.rank; $("sqRank2").textContent = "#" + d.rank; $("sqUpd").textContent = PFS.tracked ? ago(w - PFS.tracked) : "—"; }
  setHTML($("sqBack"), !inRace ? `<div class="closed">Not in this round's race. The ${TF[S.tf].label} race takes the 15 leading squads at each round's open.</div>`
    : `<div class="next" style="padding:6px 0"><span>${TF[S.tf].label} squad race${g != null ? " · " + sgnUsd(g) + " so far" : ""}<br><span class="dim">${bs.open ? "open · weight ×" + bs.w.toFixed(2) : esc(bs.why)}</span></span><button class="btn btn-solid btn-xs" type="button" data-sqbet="1"${bs.open ? "" : " disabled"}>Bet</button></div>`);
  drawSquadChart();
}
function drawSquadChart() {
  const cv = $("sqCv"), d = PFS.detail; if (!cv || !d || !cv.offsetParent) return;
  const { ctx, w: W, h: H } = fit(cv); ctx.clearRect(0, 0, W, H);
  const pts = (d.series || []).concat((PFS.series.get(d.id) || []).filter(p => !d.series.length || p[0] > d.series[d.series.length - 1][0])).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) { ctx.fillStyle = C.dim; ctx.font = `12px ${MONO}`; ctx.textAlign = "center"; ctx.fillText("The profit line fills in as the squad is tracked.", W / 2, H / 2); return; }
  const L = 64, R = 12, Tp = 12, B = 22, pw = W - L - R, ph = H - Tp - B, t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 60000);
  let mn = Infinity, mx = -Infinity; pts.forEach(p => { mn = Math.min(mn, p[1]); mx = Math.max(mx, p[1]); }); const pad = Math.max(10, (mx - mn) * 0.1); mn -= pad; mx += pad;
  const X = t => L + (t - t0) / (t1 - t0) * pw, Y = v => Tp + (mx - v) / (mx - mn) * ph;
  ctx.font = `11px ${MONO}`; ctx.textAlign = "right"; ctx.textBaseline = "middle"; const stp = niceStep(mx - mn, 5);
  for (let v = Math.ceil(mn / stp) * stp; v <= mx; v += stp) { const y = Math.round(Y(v)) + .5; ctx.strokeStyle = C.rule; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillStyle = C.dim; ctx.fillText(sgnUsd(v), L - 8, y); }
  ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = C.dim; ctx.fillText(local(t0, false), L, Tp + ph + 6); ctx.textAlign = "right"; ctx.fillText("now", L + pw, Tp + ph + 6);
  ctx.strokeStyle = d.pnl >= pts[0][1] ? C.up : C.down; ctx.lineWidth = 1.8; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))); ctx.stroke();
}

/* ---------- loading a squad copy (the round server's owner only: the link carries a one-off upload token) ---------- */
function pfUploadFromHash() {
  const m = /^#pf-upload=([0-9a-f]{32,64})$/.exec(location.hash || ""); if (!m || !S.srv) return false;
  const token = m[1]; history.replaceState(null, "", location.pathname + location.search + "#arena");
  modal(`${head("Load pump.fun squads", "Pick the squad copy file to send to the round server")}
    <p class="fine" style="margin:12px 0">Choose <b>pump-squads.json</b> from your Downloads folder.</p>
    <label class="btn btn-solid btn-wide" for="pfFile" style="margin-top:6px">Choose file</label>
    <input id="pfFile" type="file" accept="application/json,.json" style="position:absolute;width:1px;height:1px;opacity:0">
    <p class="fine" id="pfMsg" aria-live="polite"></p>`);
  $("pfFile").addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0], msg = $("pfMsg"); if (!f) return;
    msg.textContent = "Sending " + f.name + "…";
    try {
      const data = JSON.parse(await f.text());
      const r = await fetch(SRV.url + "/admin/pf-copy", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ token, data }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The server said " + r.status);
      msg.textContent = `Loaded ${j.squads} squads. Tracking starts now.`; pfLoad(roundAt(S.tf, nowW()), true);
    } catch (er) { msg.textContent = "Didn't work: " + er.message; }
  });
  return true;
}
addEventListener("hashchange", pfUploadFromHash);
