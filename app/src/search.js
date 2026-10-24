/* ================= search: any coin, from the board or anywhere on Solana ================= */
const SR = { q: "", res: [], remote: [], sel: 0, t: null, seq: 0, open: false };
const isMintLike = q => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
// a coin that isn't on the board still gets a page: its data comes from DEX Screener, its candles from GeckoTerminal
const tokTime = tok => S.mode === "replay" && tok && !TR.has(tok.m) ? nowW() : S.rt;
function localMatches(q) {
  const ql = q.toLowerCase(), seen = new Set(), out = [];
  const add = (tok, rank) => { if (!tok || seen.has(tok.m)) return; seen.add(tok.m); out.push({ tok, rank }); };
  const pool = [...S.board.top, ...S.board.bench, ...T.values(), ...TL.values()];
  for (const tok of pool) {
    const s = (tok.s || "").toLowerCase(), n = (tok.n || "").toLowerCase();
    const score = s === ql || s === "$" + ql ? 0 : s.startsWith(ql) ? 1 : n.startsWith(ql) ? 2 : s.includes(ql) || n.includes(ql) ? 3 : tok.m === q || (q.length >= 6 && tok.m.startsWith(q)) ? 0 : 9;
    if (score < 9) add(tok, score);
  }
  const boardIdx = m => { const i = S.board.top.findIndex(t => t.m === m); if (i >= 0) return i; const j = S.board.bench.findIndex(t => t.m === m); return j >= 0 ? 15 + j : 99; };
  return out.sort((a, b) => a.rank - b.rank || boardIdx(a.tok.m) - boardIdx(b.tok.m) || (mcAt(b.tok, tokTime(b.tok)) || 0) - (mcAt(a.tok, tokTime(a.tok)) || 0)).slice(0, 8).map(x => x.tok);
}
async function remoteSearch(q) {
  const url = isMintLike(q) ? "https://api.dexscreener.com/tokens/v1/solana/" + q : "https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q);
  const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json(), pairs = Array.isArray(j) ? j : (j.pairs || []);
  const best = new Map();
  for (const p of pairs) {
    if (!p || p.chainId !== "solana" || !p.baseToken || !p.priceUsd) continue;
    const m = p.baseToken.address, cur = best.get(m), liq = (p.liquidity && p.liquidity.usd) || 0;
    if (!cur || liq > ((cur.liquidity && cur.liquidity.usd) || 0)) best.set(m, p);
  }
  // real trading first: 24 h volume (liquidity alone is easy to fake), with fake-cap clones (market cap over 60× liquidity) pushed down
  const score = p => { const liq = (p.liquidity && p.liquidity.usd) || 0, mc = +(p.marketCap || p.fdv) || 0, vol = (p.volume && p.volume.h24) || 0; return (mc / Math.max(1, liq) > 60 ? 0.001 : 1) * (vol + Math.min(liq, vol * 5) * 0.01 + 1e-6 * liq); };
  return [...best.values()].sort((a, b) => score(b) - score(a)).slice(0, 10);
}
function squadSize(m) { try { return squadOf(m).members.length; } catch (_) { return 0; } }
function srRow(item, i) {
  if (item.tok) {
    const tok = item.tok, ti = S.board.top.findIndex(t => t.m === tok.m), bi = S.board.bench.findIndex(t => t.m === tok.m), n = squadSize(tok.m);
    const tag = ti >= 0 ? "#" + (ti + 1) : bi >= 0 ? "On deck" : n ? "Squad" : "";
    return `<button type="button" role="option" class="s-row" data-i="${i}" aria-selected="${i === SR.sel}">${avHTML(tok, 22, 1.5)}<span class="s-nm"><b>$${esc(tok.s)}</b><span>${esc(tok.n || "")}</span></span><span class="s-mc">${fmtUsd(mcAt(tok, tokTime(tok)) || tok.mc)}</span><span class="s-tag">${[tag, n ? n + " in squad" : "", short(tok.m)].filter(Boolean).join(" · ")}</span></button>`;
  }
  const p = item.pair, b = p.baseToken, mc = +(p.marketCap || p.fdv) || 0, age = p.pairCreatedAt ? ageShort(nowW() - p.pairCreatedAt) : "";
  return `<button type="button" role="option" class="s-row" data-i="${i}" aria-selected="${i === SR.sel}">${avHTML({ m: b.address, s: b.symbol || "?", logo: (p.info && p.info.imageUrl) || null }, 22, 1.5)}<span class="s-nm"><b>$${esc(b.symbol || "?")}</b><span>${esc(b.name || "")}</span></span><span class="s-mc">${mc ? fmtUsd(mc) : "—"}</span><span class="s-tag">${esc(short(b.address))}${age ? " · " + esc(age) : ""}${p.volume && p.volume.h24 ? " · " + fmtUsd(p.volume.h24) + " vol 24h" : ""}</span></button>`;
}
const ageShort = ms => { const h = ms / 3600e3; return h < 1 ? Math.max(1, Math.round(h * 60)) + "m old" : h < 48 ? Math.round(h) + "h old" : Math.round(h / 24) + "d old"; };
function srRender() {
  const list = $("searchList"); if (!list) return;
  const loc = SR.res.map(tok => ({ tok })), rem = SR.remote.filter(p => !SR.res.some(t => t.m === p.baseToken.address)).map(pair => ({ pair }));
  SR.items = loc.concat(rem);
  if (!SR.q) { list.hidden = true; $("searchIn").setAttribute("aria-expanded", "false"); return; }
  SR.sel = clamp(SR.sel, 0, Math.max(0, SR.items.length - 1));
  let html = "";
  if (loc.length) html += `<div class="s-h">In the arena</div>` + loc.map((x, i) => srRow(x, i)).join("");
  if (rem.length) html += `<div class="s-h">On Solana</div>` + rem.map((x, i) => srRow(x, loc.length + i)).join("");
  if (!html) html = `<div class="s-empty">${SR.busy ? "Searching…" : "No coin found. Try the ticker, the name or the contract address."}</div>`;
  else if (SR.busy) html += `<div class="s-empty">Searching Solana…</div>`;
  html += `<div class="s-foot">Any coin can have a squad. Betting opens when a coin makes the top 25.</div>`;
  list.innerHTML = html; list.hidden = false; $("searchIn").setAttribute("aria-expanded", "true");
  qsa(".s-row", list).forEach(b => { b.onpointerdown = e => e.preventDefault(); b.onclick = () => srPick(+b.dataset.i); });
}
function srInput() {
  const q = $("searchIn").value.trim(); SR.q = q; SR.sel = 0;
  SR.res = q.length >= 1 ? localMatches(q) : []; SR.remote = []; SR.busy = q.length >= 2;
  srRender(); clearTimeout(SR.t);
  if (q.length < 2) return;
  const my = ++SR.seq;
  SR.t = setTimeout(async () => {
    try { const r = await remoteSearch(q); if (my !== SR.seq) return; SR.remote = r; }
    catch (_) { if (my !== SR.seq) return; SR.remote = []; }
    SR.busy = false; srRender();
  }, 280);
}
function srPick(i) {
  const it = (SR.items || [])[i]; if (!it) return;
  let m;
  if (it.tok) m = it.tok.m;
  else { m = it.pair.baseToken.address; if (!tokAny(m)) adoptPair(it.pair); }
  srClose(true);
  location.hash = "#coin-" + m;
}
function srClose(clear) { const list = $("searchList"); if (list) list.hidden = true; $("searchIn").setAttribute("aria-expanded", "false"); if (clear) { $("searchIn").value = ""; SR.q = ""; SR.res = []; SR.remote = []; } $("searchIn").blur(); }
async function resolveCoin(m) {
  try { const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + m); if (!r.ok) return false; const pairs = await r.json(); const best = (pairs || []).filter(p => p && p.chainId === "solana" && p.baseToken && p.baseToken.address === m).sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0]; if (!best) return false; adoptPair(best); return !!tokAny(m); }
  catch (_) { return false; }
}
// a DEX Screener pair becomes a coin the page can show
function adoptPair(p) {
  applyPairs([p], nowW());
  const tok = TL.get(p.baseToken.address); if (!tok) return null;
  if (p.info && p.info.imageUrl && !tok.logo) tok.logo = p.info.imageUrl;
  tok.offBoard = true;
  return tok;
}

/* ---------- a coin page for a coin the arena isn't tracking: poll its price, fetch its candles ---------- */
const WATCH = { m: null, timer: null, last: 0, hist: 0 };
async function watchTick() {
  const m = S.view === "coin" ? S.coin : null, tok = m && tokAny(m);
  if (!tok) return;
  const tracked = (S.srv && tok.ticks.length && nowW() - tok.ticks[tok.ticks.length - 1].t < 30000) || (!S.srv && S.mode !== "replay" && LIVE.on && (inTop(m) || inBench(m)));
  if (S.mode === "replay" && TR.has(m)) return;
  if (!tracked && nowW() - WATCH.last > 8000) {
    WATCH.last = nowW();
    try { const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + m); if (r.ok) applyPairs(await r.json(), nowW()); dirty.coin = true; } catch (_) {}
  }
  // the server answers at once with its own candles; asking again every few minutes keeps the coin live on the server while the page is open
  if (S.srv && nowW() - WATCH.hist > (tok.C.length ? 240000 : 15000)) {
    WATCH.hist = nowW();
    try { const r = await fetch(SRV.url + "/candles?m=" + encodeURIComponent(m)); if (r.ok) { const j = await r.json(); if ((j.C || []).length >= tok.C.length) { tok.C = (j.C || []).map(cIn); tok.C5 = (j.C5 || []).map(cIn); tok.firstT = firstTime(tok); dirty.coin = true; } } } catch (_) {}
  }
  else if (!S.srv && !tok.C.length && tok.pool && nowW() - WATCH.hist > 15000) {
    WATCH.hist = nowW();
    for (const five of [false, true]) {
      try {
        const q = five ? "minute?aggregate=5&limit=300" : "minute?aggregate=1&limit=200";
        const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${tok.pool}/ohlcv/${q}&currency=usd&token=base`); if (!r.ok) break;
        const j = await r.json(), list = j && j.data && j.data.attributes && j.data.attributes.ohlcv_list;
        const C = (list || []).map(c => ({ t: c[0] * 1000, o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] })).filter(c => c.c > 0).sort((a, b) => a.t - b.t);
        if (five) tok.C5 = C; else tok.C = C; tok.firstT = firstTime(tok); dirty.coin = true;
      } catch (_) { break; }
    }
  }
}
setInterval(() => { watchTick().catch(() => {}); }, 2000);

/* ---------- joining a squad without a bet ---------- */
async function joinSquad(m) {
  const tok = tokAny(m);
  if (S.srv) {
    if (!S.me.id) { srvLogin(); throw new Error("Log in to join the squad."); }
    const out = await api("/squad", { m });
    if (out.joined) { S.my.sq[m] = nowW(); wire("Squad", `You ${out.first ? "started" : "joined"} the ${tkHTML(tok)} squad. Its tasks are on this page.`, true); }
    dirty.squads = true; return out;
  }
  if (S.my.sq[m]) return { joined: false };
  const first = !squadOf(m).members.length;
  S.my.sq[m] = nowW(); persist("members"); postSystem(m, first ? "started the squad" : "joined the squad");
  wire("Squad", `You ${first ? "started" : "joined"} the ${tkHTML(tok)} squad. Its tasks are on this page.`, true);
  dirty.squads = true; return { joined: true, first };
}

/* ---------- wiring ---------- */
(function initSearch() {
  const inp = $("searchIn"); if (!inp) return;
  inp.addEventListener("input", srInput);
  inp.addEventListener("focus", () => { if (SR.q) srRender(); });
  inp.addEventListener("blur", () => setTimeout(() => { const l = $("searchList"); if (l && document.activeElement !== inp) l.hidden = true; }, 120));
  inp.addEventListener("keydown", e => {
    const n = (SR.items || []).length;
    if (e.key === "ArrowDown") { e.preventDefault(); SR.sel = Math.min(n - 1, SR.sel + 1); srRender(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); SR.sel = Math.max(0, SR.sel - 1); srRender(); }
    else if (e.key === "Enter") { e.preventDefault(); if (n) srPick(SR.sel); }
    else if (e.key === "Escape") { e.preventDefault(); srClose(true); }
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const tg = e.target; if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
    if (root.firstChild) return;
    e.preventDefault(); inp.focus(); inp.select();
  });
})();
