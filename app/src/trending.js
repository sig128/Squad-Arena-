/* ================= trending panel and KOLs ================= */
// The server ranks the young coins it tracks by recent trading (and KOL holders); KOL trades come from the chain, live.
const TRD = { list: [], at: 0 };
const KOLS = new Map();                      // mint -> { holders: [...], trades: [...], at }
const kolName = k => k.name || (k.x ? "@" + k.x : short(k.w));
function kolAv(k, size) {
  const init = esc((kolName(k) || "?").replace(/^@/, "")[0] || "?");
  return `<span class="av kav" data-s="${init}" style="--s:${size}px;--rw:1.5px;--ring:var(--rule2)">${k.avatar ? `<img src="${esc(k.avatar)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer">` : init}</span>`;
}

/* ---------- trending view ---------- */
function trendingEvent(list) { TRD.list = Array.isArray(list) ? list : []; TRD.at = 0; }
function renderTrending() {
  const el = $("trendRows"); if (!el) return;
  if (nowW() - TRD.at < 1000) return; TRD.at = nowW();
  const rows = TRD.list.map(m => TL.get(m)).filter(Boolean);
  $("trendMeta").textContent = rows.length ? rows.length + " coins" : "";
  if (!rows.length) { el.innerHTML = `<div class="empty">${S.srv ? "Ranking the coins the arena tracks. This fills in within a minute of the server starting." : "Trending runs on the live arena at squadarena.fun."}</div>`; return; }
  const onB = new Map(S.board.top.map((t, i) => [t.m, i + 1])), onD = new Set(S.board.bench.map(t => t.m)), tNow = nowW();
  const head = `<div class="tr th"><span>#</span><span>Coin</span><span class="c-age num">Age</span><span class="num">Mcap</span><span class="num">1h</span><span class="num">Vol 1h</span><span class="c-v24 num">Vol 24h</span><span class="num">KOLs</span><span class="c-hold num">Holders</span><span></span></div>`;
  el.innerHTML = head + rows.map((tok, i) => {
    const p = pAt(tok, tNow), ch = tok.ch ? tok.ch[1] / 100 : null, b = onB.get(tok.m), d = onD.has(tok.m);
    const tag = b ? `<span class="badge">#${b} on the board</span>` : d ? `<span class="badge">On deck</span>` : "";
    return `<div class="tr" data-m="${esc(tok.m)}" tabindex="0" role="link" aria-label="${esc(tok.s)}. Open the coin page.">
      <span class="dim">${i + 1}</span>
      <span class="tk-cell">${avHTML(tok, 20, 2)}<b>${esc(tok.s)}</b>${tag}<span class="nm">${esc(tok.n || "")}</span></span>
      <span class="c-age num dim">${tok.born ? age(tNow - tok.born) : "—"}</span>
      <span class="num">${fmtUsd(p != null ? p * tok.supply : tok.mc)}</span>
      <span class="num ${ch == null ? "" : ch >= 0 ? "up" : "down"}">${fmtPct(ch, 1)}</span>
      <span class="num">${fmtUsd(tok.vol ? tok.vol[1] : null)}</span>
      <span class="c-v24 num">${fmtUsd(tok.vol ? tok.vol[3] : null)}</span>
      <span class="num">${tok.kol ? `<b>${tok.kol}</b>` : `<span class="dim">—</span>`}</span>
      <span class="c-hold num dim">${tok.holders ? fmtNum(tok.holders) : "—"}</span>
      <span class="back">${b || d ? `<span class="btn btn-quiet btn-xs" data-act="bet">Back</span>` : ""}</span></div>`;
  }).join("");
  qsa(".tr[data-m]", el).forEach(r => {
    r.onclick = e => { const m = r.dataset.m; if (e.target.closest("[data-act=bet]")) { openBet(m, bestMarket(m)); return; } location.hash = "#coin-" + m; };
    r.onkeydown = e => { if (e.key === "Enter") location.hash = "#coin-" + r.dataset.m; };
  });
}

/* ---------- KOLs on a coin ---------- */
async function loadKolsFor(m) {
  if (!S.srv || !SRV.url || loadKolsFor.busy) return; loadKolsFor.busy = true;
  try {
    const r = await fetch(SRV.url + "/kols?m=" + encodeURIComponent(m)); if (!r.ok) return;
    const j = await r.json(); KOLS.set(m, { holders: j.holders || [], trades: j.trades || [], at: nowW() });
    if (coinUI.m === m) { renderKolBox(m); CH.mkKey = ""; dirty.coin = true; }
  } catch (_) {}
  finally { loadKolsFor.busy = false; if (coinUI.m === m && !KOLS.has(m)) renderKolBox(m); }
}
// an open coin page refreshes its KOLs every minute (live trades arrive in between)
function kolTick() { const m = S.view === "coin" ? coinUI.m : null; if (m && S.srv && nowW() - ((KOLS.get(m) || {}).at || 0) > 60000) loadKolsFor(m); }
function kolEvent(d) {
  if (!d || !d.m || !d.tr) return;
  const k = KOLS.get(d.m) || { holders: [], trades: [], at: 0 }, tr = d.tr;
  if (k.trades.some(x => x.sig === tr.sig && x.w === tr.w)) return;
  k.trades.push(tr); if (k.trades.length > 300) k.trades.splice(0, k.trades.length - 300);
  k.holders = k.holders.filter(h => h.w !== tr.w);
  if (tr.hold > 0) k.holders.unshift({ w: tr.w, name: tr.name, x: tr.x, avatar: tr.avatar, amt: tr.hold, since: tr.t });
  KOLS.set(d.m, k);
  const tok = TL.get(d.m); if (tok) tok.kol = k.holders.length;
  if (coinUI.m === d.m) { renderKolBox(d.m); CH.mkKey = ""; dirty.coin = true; }
  if (tok && (inTop(d.m) || inBench(d.m)) && tr.sol >= 0.5) wire("KOL", `${esc(kolName(tr))} ${tr.side === "buy" ? "bought" : "sold"} ${fmtAmt(tr.sol, "SOL")} of ${tkHTML(tok)}.`, tr.side === "buy");
}
function renderKolBox(m) {
  const el = $("cKols"); if (!el || coinUI.m !== m) return;
  const k = KOLS.get(m), on = SRV.cfg && SRV.cfg.kols > 0, tok = tokAny(m), p = tok ? pAt(tok, nowW()) : null;
  $("cKolN").textContent = k && k.holders.length ? k.holders.length : "";
  if (!on) { el.innerHTML = `<p class="fine">KOL tracking switches on once the server has a KOL list.</p>`; return; }
  if (!k) { el.innerHTML = `<p class="fine">Loading…</p>`; return; }
  const hold = k.holders.slice(0, 12).map(h => `<div class="kol">${kolAv(h, 20)}<span class="kn">${h.x ? `<a href="https://x.com/${esc(h.x)}" target="_blank" rel="noopener">${esc(kolName(h))}</a>` : esc(kolName(h))}</span><span class="num dim">${p ? fmtUsd(h.amt * p) : fmtNum(h.amt)}</span></div>`).join("");
  const last = k.trades.slice(-6).reverse().map(t => `<div class="kol">${kolAv(t, 16)}<span class="kn">${esc(kolName(t))} <span class="${t.side === "buy" ? "up" : "down"}">${t.side === "buy" ? "bought" : "sold"}</span></span><span class="num dim">${fmtAmt(t.sol, "SOL")} · ${ago(nowW() - t.t)}</span></div>`).join("");
  el.innerHTML = (hold || `<p class="fine">No tracked KOL holds it yet.</p>`) + (last ? `<div class="kh">Latest KOL trades</div>${last}` : "");
}
// chart markers: KOL buys under the candle, sells above it
function kolMarkers(tok) {
  const k = KOLS.get(tok.m); if (!k || !k.trades.length) return [];
  const out = [];
  for (const t of k.trades.slice(-80)) {
    const i = barIndexAt(t.t); if (i < 0) continue;
    const buy = t.side === "buy", nm = kolName(t);
    out.push({ time: tsec(CH.bars[i]), position: buy ? "belowBar" : "aboveBar", color: buy ? C.up : C.down, shape: buy ? "arrowUp" : "arrowDown", text: (nm.length > 12 ? nm.slice(0, 11) + "…" : nm) + " " + (t.sol >= 10 ? Math.round(t.sol) : t.sol.toFixed(1)) });
  }
  return out;
}
const kolKey = m => { const k = KOLS.get(m); return k ? k.trades.length + ":" + (k.trades.length ? k.trades[k.trades.length - 1].t : 0) : "0"; };
