/* ================= engine: board, rounds, markets, pools, settlement ================= */
const S = {
  mode: "replay", tf: TFK.includes(store.get("tf", "15m")) ? store.get("tf", "15m") : "15m",
  view: "arena", coin: null,
  board: { top: [], bench: [] }, boardSig: "", rt: 0, w: 0,
  me: { id: null, name: "", avatar: "", color: "", isOwner: false, canWrite: null },
  my: { v: 1, bal: START_BAL, b: [], sq: {}, h: "" },
  myProofs: { p: [], v: {}, f: {} }, myPosts: { ms: [] },
  members: new Map(), proofs: new Map(), posts: new Map(), live: new Map(),
  wallet: null, fields: new Map(), lcsMemo: new Map(), results: new Map(), betIdx: new Map(),
  seenRound: {}, lastLead: null, leadAt: 0, movedAt: {}, hypeSaid: {}, prevTop: null, rugSaid: new Set(), ageSaid: new Set(),
  readOnly: false, dbReady: false
};
const MKS = ["top", "lcs", "eff", "bust"];
const MK = {
  top:  { label: "Top gainer", short: "Top" },
  lcs:  { label: "Last coin standing", short: "LCS" },
  eff:  { label: "Hype delta · most efficient", short: "Efficient" },
  bust: { label: "Hype delta · biggest bust", short: "Bust" },
  sq:   { label: "Squad race", short: "Squad" }            // pump.fun squads; not in MKS (coin markets), see pfsquads.js
};
const nowW = () => Date.now();
const modeCode = () => S.mode === "replay" ? "R" : "L";
const replayRec = w => D0 + (((w % LOOP) + LOOP) % LOOP);
const mktT = w => S.mode === "replay" ? replayRec(w) : w;
function roundAt(tfk, w, md) {
  md = md || modeCode(); const tf = TF[tfk], s = Math.floor(w / tf.W) * tf.W;
  return { tfk, tf, W: tf.W, s, e: s + tf.W, md, rs: md === "R" ? replayRec(s) : s, key: md + "." + tfk + "." + s };
}
const recOf = (r, w) => r.rs + (w - r.s);
const winOf = r => Math.max(5000, r.W * 0.03);
const tfOk = tfk => !(S.mode === "replay" && tfk === "24h");
function firstTime(tok) { let f = Infinity; if (tok.C.length) f = tok.C[0].t; if (tok.C5.length) f = Math.min(f, tok.C5[0].t); if (tok.ticks.length) f = Math.min(f, tok.ticks[0].t); return f; }

/* ---------- board ---------- */
function computeBoard(t, M) {
  const list = [];
  for (const tok of (M || T).values()) {
    if (!tok.gate) continue;
    if (tok.rugAt && t >= tok.rugAt) continue;
    if (tok.born && t - tok.born > MAX_AGE) continue;
    const p = pAt(tok, t); if (p == null) continue;
    list.push({ tok, mc: p * tok.supply });
  }
  list.sort((a, b) => b.mc - a.mc);
  return { top: list.slice(0, 15).map(x => x.tok), bench: list.slice(15, 25).map(x => x.tok) };
}
const boardMemo = new Map();
function boardAtRec(t, md) {
  if ((md || modeCode()) !== "R") return S.mode === "replay" ? { top: [], bench: [] } : S.board;
  const k = Math.floor(t / 5000); let b = boardMemo.get(k);
  if (!b) { b = computeBoard(k * 5000, TR); boardMemo.set(k, b); if (boardMemo.size > 4000) boardMemo.clear(); }
  return b;
}
function assignSlots(top) {
  const keep = new Set(top.map(t => t.m));
  for (const m of [...slotOf.keys()]) if (!keep.has(m)) { lastSlot.set(m, slotOf.get(m)); slotOf.delete(m); }
  const used = new Set(slotOf.values());
  for (const t of top) { if (slotOf.has(t.m)) continue; let s = lastSlot.get(t.m); if (s == null || used.has(s)) { s = 0; while (used.has(s)) s++; } slotOf.set(t.m, s); used.add(s); }
}
const inTop = m => S.board.top.some(t => t.m === m);
const inBench = m => S.board.bench.some(t => t.m === m);

/* ---------- fields and scoring ---------- */
function fieldMemo(r) {
  if (S.srv) { const st = SRV.rounds.get(r.key); return st ? st.field : { top: SRV.board.top.slice(), bench: SRV.board.bench.slice() }; }
  let f = S.fields.get(r.key);
  if (!f) {
    const b = r.md === "R" ? computeBoard(r.rs, TR) : { top: S.board.top.slice(), bench: S.board.bench.slice() };
    f = { top: b.top.map(t => t.m), bench: b.bench.map(t => t.m) }; S.fields.set(r.key, f);
  }
  return f;
}
function fieldOf(r, mk) { const f = fieldMemo(r), M = mapOf(r.md); return (mk === "top" ? f.top.concat(f.bench) : f.top).map(m => M.get(m)).filter(Boolean); }
function retOf(tok, r, wEnd) {
  if (!tok) return null;
  const win = winOf(r), te = recOf(r, Math.min(wEnd, r.e)), ft = firstTime(tok);
  const a0 = Math.max(r.rs, ft === Infinity ? r.rs : ft);
  if (a0 > te - 2000) return null;
  const o = twap(tok, a0, Math.min(a0 + win, te)), c = twap(tok, Math.max(a0, te - win), te);
  return o && c ? c / o - 1 : null;
}
function spotRet(tok, r, w) {
  const ft = firstTime(tok), a0 = Math.max(r.rs, ft === Infinity ? r.rs : ft), te = recOf(r, Math.min(w, r.e));
  if (a0 > te) return null;
  const o = twap(tok, a0, Math.min(a0 + winOf(r), te)), p = pAt(tok, te);
  return o && p ? p / o - 1 : null;
}
// a live round only counts when live data covers its start (prices from go-live on, or candles loaded back past the open)
function roundLive(r) {
  if (S.srv) { const st = SRV.rounds.get(r.key); return !!(st && st.live); }
  if (r.md !== "L" || !LIVE.started || r.s >= LIVE.started - 60000) return true;
  const f = S.fields.get(r.key), toks = (f ? f.top : S.board.top.map(t => t.m)).map(m => TL.get(m)).filter(Boolean);
  return toks.length > 0 && toks.every(t => (t.C.length && t.C[0].t <= r.s) || (t.C5.length && t.C5[0].t <= r.s));
}
const WARM = () => ({ field: [], alive: new Set(), out: [], cps: [], crash: [], done: 0, winner: null, final: null, warming: true });
function distribute(n, parts) { const b = Math.floor(n / parts), rem = n % parts; return Array.from({ length: parts }, (_, i) => b + (i < rem ? 1 : 0)); }
function lcs(r, w) {
  if (!roundLive(r)) return WARM();
  if (S.srv) { const sr = SRV.rounds.get(r.key); if (!sr || !sr.lcs) return WARM(); if (!sr._lcs) sr._lcs = { ...sr.lcs, alive: new Set(sr.lcs.alive) }; return sr._lcs; }
  let st = S.lcsMemo.get(r.key); const M = mapOf(r.md);
  if (!st) { const f = fieldOf(r, "lcs"); st = { field: f.map(t => t.m), alive: new Set(f.map(t => t.m)), out: [], cps: [], crash: [], done: 0, winner: null, final: null }; S.lcsMemo.set(r.key, st); }
  while (st.done < 5) {
    const k = st.done + 1, tk = r.s + k * r.W / 6; if (tk > w) break;
    const trec = recOf(r, tk);
    for (const m of [...st.alive]) { const tok = M.get(m); if (!tok || (tok.rugAt && tok.rugAt <= trec)) { st.alive.delete(m); st.out.push({ m, k, why: "rug", R: null }); } }
    for (const tok of boardAtRec(trec, r.md).top) if (!st.field.includes(tok.m)) { st.field.push(tok.m); st.alive.add(tok.m); st.crash.push({ m: tok.m, k }); }
    const ranked = [...st.alive].map(m => ({ m, R: retOf(M.get(m), r, tk) })).sort((a, b) => (b.R ?? -9) - (a.R ?? -9));
    const n = ranked.length, cut = Math.max(0, Math.min(n - 2, distribute(Math.max(0, n - 2), 6 - k)[0]));
    const cutList = cut ? ranked.slice(n - cut) : [];
    cutList.forEach(x => { st.alive.delete(x.m); st.out.push({ m: x.m, k, why: "cut", R: x.R }); });
    st.cps.push({ k, t: tk, cut: cutList.map(x => x.m), ranked });
    st.done = k;
  }
  const te = recOf(r, Math.min(w, r.e));
  for (const m of [...st.alive]) { const tok = M.get(m); if (tok && tok.rugAt && tok.rugAt <= te) { st.alive.delete(m); st.out.push({ m, k: st.done + .5, why: "rug", R: null }); } }
  if (w >= r.e && st.done === 5 && !st.final) {
    st.final = [...st.alive].map(m => ({ m, R: retOf(M.get(m), r, r.e) })).sort((a, b) => (b.R ?? -9) - (a.R ?? -9));
    st.winner = st.final.length ? st.final[0].m : null;
  }
  return st;
}
function lcsZone(r, st, w) { // survivors that would be cut if the next checkpoint were now
  if (st.done >= 5) return { k: 6, cut: [], at: r.e };
  const M = mapOf(r.md), k = st.done + 1, ranked = [...st.alive].map(m => ({ m, R: retOf(M.get(m), r, w) })).sort((a, b) => (b.R ?? -9) - (a.R ?? -9));
  const n = ranked.length, cut = Math.max(0, Math.min(n - 2, distribute(Math.max(0, n - 2), 6 - k)[0]));
  return { k, at: r.s + k * r.W / 6, cut: ranked.slice(n - cut).map(x => x.m), ranked };
}
function attn(tok, tfk, tNow) {
  const ageMin = tok.born ? Math.max(1, (tNow - tok.born) / 60000) : 1e9;
  const [m5, h1, h6, h24] = tok.tx, rate = (n, mins) => n / Math.max(1, Math.min(mins, ageMin));
  let a, b;
  if (tfk === "15m" || tfk === "30m") { a = rate(m5, 5); b = rate(h1, 60); }
  else if (tfk === "1h") { a = rate(h1, 60); b = rate(h6, 360); }
  else { a = rate(h6, 360); b = rate(h24, 1440); }
  return b > 0 ? a / b - 1 : 0;
}
function hype(r, w) {
  const tNow = S.mode === "replay" ? SNAP : nowW();
  return fieldOf(r, "eff").map(tok => {
    const R = retOf(tok, r, w), A = attn(tok, r.tfk, tNow);
    return { tok, R, A, eff: R == null ? null : R / (1 + Math.max(A, -0.9)), bust: R != null && R < 0 && A > 0 ? A * -R : 0 };
  });
}
function standings(r, w) {
  return fieldOf(r, "top").map(tok => ({ tok, R: retOf(tok, r, w), rug: !!(tok.rugAt && tok.rugAt <= recOf(r, Math.min(w, r.e))) }))
    .sort((a, b) => (a.rug - b.rug) || ((b.R ?? -9) - (a.R ?? -9)));
}

/* ---------- bets and pools ---------- */
function rebuildBetIdx() {
  S.betIdx = new Map();
  const add = b => { if ((b.cur || "tSOL") !== CUR) return; const k = b.rk + "|" + b.mk; let a = S.betIdx.get(k); if (!a) S.betIdx.set(k, a = []); a.push(b); };
  const ok = b => b && typeof b.rk === "string" && typeof b.m === "string" && MKS.includes(b.mk) && typeof b.s === "number" && b.s > 0 && b.s <= 1000 && typeof b.w === "number" && b.w > 0 && b.w <= 1;
  for (const [uid, d] of S.members) { if (uid === S.me.id || !d || !Array.isArray(d.b)) continue; d.b.slice(0, 200).forEach(b => ok(b) && add({ ...b, by: uid })); }
  S.my.b.forEach(b => add({ ...b, by: S.me.id || "me" }));
}
function pool(r, mk) {
  if (S.srv) {
    const sr = SRV.rounds.get(r.key), sp = sr && sr.pools && sr.pools[mk + "|" + CUR], seed = SRV.cfg ? +(SRV.cfg.seed[CUR] ?? 0) : SEED;
    if (sp) return { P: sp.P, sh: new Map(Object.entries(sp.sh)), n: sp.n, people: sp.people };
    const sh = new Map(); let P = 0; for (const t of fieldOf(r, mk)) { sh.set(t.m, seed); P += seed; } return { P, sh, n: 0, people: 0 };
  }
  const sh = new Map(); let P = 0, n = 0; const who = new Set();
  for (const t of fieldOf(r, mk)) { sh.set(t.m, SEED); P += SEED; }
  for (const b of S.betIdx.get(r.key + "|" + mk) || []) {
    if (b.st === "refund") continue;
    P += b.s; sh.set(b.m, (sh.get(b.m) || 0) + b.s * b.w); n++; who.add(b.by);
  }
  return { P, sh, n, people: who.size };
}
function quote(r, mk, m, s, w) {
  const pl = pool(r, mk), mine = pl.sh.get(m) || 0;
  const pay = (pl.P + s) * (1 - RAKE) * (s * w) / (mine + s * w);
  return { pay, mult: s > 0 ? pay / s : 0, pl };
}
function impliedOdds(r, mk, m) { const pl = pool(r, mk), sh = pl.sh.get(m) || 0; return sh ? pl.P * (1 - RAKE) / sh : null; }
function betState(r, mk, w, m) {
  const el = (w - r.s) / r.W;
  if (!tfOk(r.tfk)) return { open: false, why: "24-hour rounds need live data. Switch to live in the data panel." };
  if (!roundLive(r)) return { open: false, why: "Live data joined this round partway, so it isn't scored. Betting opens with the next round in " + dur(r.e - w) + "." };
  if (mk === "lcs") {
    if (w >= r.e - winOf(r)) return { open: false, why: "The final duel is being scored. The next bracket opens in " + dur(r.e - w) + "." };
    if (m) { const st = lcs(r, w); if (!st.alive.has(m)) return { open: false, why: "That coin is out of this bracket." }; }
    return { open: true, el, w: 1 / (1 + 2 * el) };
  }
  if (el >= BET_WIN) return { open: false, why: "Bets close at 40% of the round. The next round opens in " + dur(r.e - w) + "." };
  if (m) { const tok = T.get(m); if (!tok || (tok.rugAt && tok.rugAt <= recOf(r, w))) return { open: false, why: "That coin was removed by the rug filter." }; if (!fieldOf(r, mk).some(t => t.m === m)) return { open: false, why: "That coin is not in this round's field." }; }
  return { open: true, el, w: 1 / (1 + 2 * el) };
}
function resultOf(r, mk) {
  if (S.srv) { const sres = SRV.results.get(r.key + "|" + mk); if (!sres) return null; sres.r = r; return sres; }
  const key = r.key + "|" + mk; let res = S.results.get(key); if (res) return res;
  if (nowW() < r.e + 1200 || !roundLive(r)) return null;
  const rugged = tok => tok.rugAt && tok.rugAt <= r.rs + r.W;
  if (mk === "top") {
    const st = fieldOf(r, "top").filter(t => !rugged(t)).map(t => ({ m: t.m, R: retOf(t, r, r.e) })).filter(x => x.R != null).sort((a, b) => b.R - a.R);
    if (!st.length) return null;
    res = { winners: [st[0].m], top: st.slice(0, 3), metric: st[0].R };
  } else if (mk === "lcs") {
    const st = lcs(r, r.e + 1); if (!st.winner) return null;
    res = { winners: [st.winner], top: st.final, metric: st.final[0].R };
  } else {
    const h = hype(r, r.e).filter(x => !rugged(x.tok) && x.R != null);
    if (!h.length) return null;
    if (mk === "eff") { h.sort((a, b) => b.eff - a.eff); res = { winners: [h[0].tok.m], top: h.slice(0, 3).map(x => ({ m: x.tok.m, R: x.R, A: x.A, v: x.eff })), metric: h[0].eff }; }
    else { h.sort((a, b) => b.bust - a.bust); res = h[0].bust > 0 ? { winners: [h[0].tok.m], top: h.slice(0, 3).map(x => ({ m: x.tok.m, R: x.R, A: x.A, v: x.bust })), metric: h[0].bust } : { winners: [], refundAll: true, why: "no coin had rising attention and a falling price" }; }
  }
  res.r = r; res.mk = mk; res.hash = "";
  S.results.set(key, res);
  receipt(r, mk, res);
  return res;
}
async function receipt(r, mk, res) {
  try {
    const body = JSON.stringify({ round: r.key, market: mk, mode: r.md === "R" ? "replay" : "live", field: fieldOf(r, mk).map(t => t.m), winners: res.winners, top: (res.top || []).map(x => [x.m, x.R == null ? null : +x.R.toFixed(6)]), rake: RAKE, seed: SEED });
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    res.hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (_) { res.hash = hashStr(r.key + mk + res.winners.join()).toString(16).padStart(8, "0"); }
  dirty.settled = true;
}
function roundOfBet(b) { return roundAt(b.tf, b.rs, b.md); }
function settleMine(w) {
  if (S.srv) return;                     // the round server settles and pays out
  let changed = false;
  for (const b of S.my.b) {
    if (b.st !== "open") continue;
    const r = roundOfBet(b), tok = mapOf(b.md).get(b.m);
    if (b.md === "L" && S.mode === "replay") continue; // live bets settle when live data is back
    if (!tok) continue;
    if (tok && tok.rugAt && tok.rugAt <= recOf(r, Math.min(w, r.e))) { b.st = "refund"; b.why = "rug"; S.my.bal += b.s; changed = true; wire("Refund", `${tkHTML(tok)} was removed by the rug filter. Your ${fmtSol(b.s)} on ${esc(MK[b.mk].short)} is back.`, true); continue; }
    if (w < r.e + 1500) continue;
    const res = resultOf(r, b.mk); if (!res) continue;
    if (res.refundAll) { b.st = "refund"; b.why = res.why; S.my.bal += b.s; changed = true; continue; }
    if (res.winners.includes(b.m)) {
      const pl = pool(r, b.mk), tot = res.winners.reduce((a, m) => a + (pl.sh.get(m) || 0), 0);
      b.pay = +(pl.P * (1 - RAKE) * (b.s * b.w) / (tot || 1)).toFixed(4); b.st = "won"; S.my.bal += b.pay;
      wire("You won", `${esc(MK[b.mk].label)} · ${tkHTML(tok)} paid ${fmtSol(b.pay)} on your ${fmtSol(b.s)}.`, true); notice("You won " + fmtSol(b.pay));
    } else { b.st = "lost"; b.pay = 0; }
    changed = true;
  }
  if (changed) { S.my.bal = +S.my.bal.toFixed(4); rebuildBetIdx(); persist("members"); dirty.bets = true; renderWallet(); }
}
async function placeBet(r, mk, m, s) {
  if (S.srv) return srvPlaceBet(r, mk, m, s);
  const w = nowW(), bs = betState(r, mk, w, m);
  if (!bs.open) throw new Error(bs.why);
  if (!(s >= MIN_STAKE)) throw new Error("The minimum stake is " + MIN_STAKE + " tSOL.");
  if (s > S.my.bal + 1e-9) throw new Error("You have " + fmtSol(S.my.bal) + ". Lower the stake.");
  if (S.readOnly) throw new Error("This view is read-only, so bets can't be saved here.");
  const tok = T.get(m), q = quote(r, mk, m, s, bs.w);
  let sig = null;
  if (S.wallet && S.wallet.key !== "practice") {
    const msg = `Squad Arena bet\n${MK[mk].label}\nRound ${r.key}\nCoin ${tok.s} (${tok.m})\nStake ${s} tSOL · weight ${bs.w.toFixed(3)}\nQuote ${fmtX(q.mult)}\n${new Date().toISOString()}`;
    const res = await provider(S.wallet.key).signMessage(new TextEncoder().encode(msg), "utf8");
    sig = res && res.signature ? [...res.signature.slice(0, 6)].map(x => x.toString(16).padStart(2, "0")).join("") : "signed";
  }
  const b = { id: rid(), mk, tf: r.tfk, rs: r.s, md: r.md, rk: r.key, m, s: +s.toFixed(4), w: +bs.w.toFixed(4), ts: w, st: "open", q: +q.mult.toFixed(3), sig };
  S.my.b.unshift(b); if (S.my.b.length > 160) S.my.b.length = 160;
  S.my.bal = +(S.my.bal - b.s).toFixed(4);
  const joined = !S.my.sq[m]; if (joined) S.my.sq[m] = w;
  rebuildBetIdx(); persist("members"); renderWallet(); dirty.bets = true; dirty.squads = true;
  wire("You", `${fmtSol(b.s)} on ${tkHTML(tok)} · ${esc(MK[mk].label)} · ${r.tf.label} · weight ${b.w.toFixed(2)} · quote ${fmtX(q.mult)}.`, true);
  if (joined) { postSystem(m, "joined the squad"); wire("Squad", `You joined the ${tkHTML(tok)} squad. Its tasks are on the coin page.`); }
  return b;
}
function useStreakPass(b, newM) {
  if (S.srv) return api("/pass", { bet: b.id, m: newM }).then(o => { const i = SRV.allBets.findIndex(x => x.id === b.id); if (i >= 0) SRV.allBets[i] = o.bet; srvMine(); rebuildBetIdx(); dirty.bets = true; });
  const r = roundOfBet(b), st = lcs(r, nowW());
  if (b.sp) throw new Error("You already used the streak pass on this bet.");
  const survived = st.cps.filter(c => !c.cut.includes(b.m)).length;
  if (survived < 3 || !st.alive.has(b.m)) throw new Error("The pass unlocks after your coin survives 3 checkpoints.");
  if (!st.alive.has(newM)) throw new Error("Pick a coin that is still in the bracket.");
  b.m = newM; b.sp = 1; if (!S.my.sq[newM]) S.my.sq[newM] = nowW();
  rebuildBetIdx(); persist("members"); dirty.bets = true;
}
function streakInfo(b) {
  if (b.mk !== "lcs" || b.st !== "open") return null;
  const r = roundOfBet(b), st = lcs(r, nowW());
  const survived = st.cps.filter(c => !c.cut.includes(b.m)).length;
  return { ok: !b.sp && survived >= 3 && st.alive.has(b.m) && st.done < 5, survived, used: !!b.sp };
}

/* ---------- wire ---------- */
function mktClock() { return S.mode === "replay" ? utc(S.rt) : local(nowW()); }
function wire(tag, html, key) {
  const feed = $("feed"); if (!feed) return null;
  const el = document.createElement("div"); el.className = "ev";
  el.innerHTML = `<time>${mktClock()}</time><span class="tg${key ? " k" : ""}">${esc(tag)}</span><p>${html}</p>`;
  feed.prepend(el); while (feed.children.length > 160) feed.lastChild.remove();
  if (typeof bumpUnread === "function") bumpUnread(1);
  return el;
}
let noticeT = null;
function notice(text) { const n = $("notice"); n.textContent = text; n.classList.add("on"); clearTimeout(noticeT); noticeT = setTimeout(() => n.classList.remove("on"), 4200); }

function bestMarket(m) {
  const w = nowW(), r = roundAt(S.tf, w);
  for (const mk of ["top", "lcs", "eff"]) if (tfOk(S.tf) && betState(r, mk, w, m).open) return mk;
  return "top";
}
function events(w) {
  const top = S.board.top.map(t => t.m);
  if (!S.evInit) { S.evInit = true; for (const tok of T.values()) S.movedAt[tok.m] = w; }
  if (S.prevTop) {
    const ins = top.filter(m => !S.prevTop.includes(m)), outs = S.prevTop.filter(m => !top.includes(m));
    ins.forEach(m => { const tok = T.get(m); wire("Entry", `${tkHTML(tok)} enters the top 15 at ${fmtUsd(mcAt(tok, S.rt))}. It can crash the next bracket checkpoint.`, true); });
    outs.forEach(m => { const tok = T.get(m); if (!tok) return; const why = tok.rugAt && tok.rugAt <= S.rt ? "rug filter" : tok.born && S.rt - tok.born > MAX_AGE ? "older than 72 h" : "dropped below #15"; wire("Exit", `${tkHTML(tok)} leaves the top 15 (${why}).`); });
  }
  S.prevTop = top;
  const loopId = S.mode === "replay" ? Math.floor(w / LOOP) : 0;
  for (const tok of T.values()) {
    const key = tok.m + ":" + loopId;
    if (tok.rugAt && tok.rugAt <= S.rt && S.rt - tok.rugAt < 15000 && !S.rugSaid.has(key)) {
      S.rugSaid.add(key); wire("Rug filter", `${tkHTML(tok)} removed: ${esc(tok.rugWhy || "liquidity pulled")}. Open bets on it are refunded.`, true); notice(tok.s + " removed by the rug filter");
    }
  }
  const r = roundAt(S.tf, w);
  if (!tfOk(S.tf)) return;
  if (S.seenRound[S.tf] !== r.key) {
    const prev = S.seenRound[S.tf]; S.seenRound[S.tf] = r.key;
    if (prev) {
      const pr = roundAt(S.tf, r.s - 1);
      setTimeout(() => {
        for (const mk of MKS) { const res = resultOf(pr, mk); if (!res) continue;
          if (res.refundAll) wire("Settled", `${esc(MK[mk].label)}: refunded, ${esc(res.why)}.`);
          else wire("Settled", `${esc(MK[mk].label)} · ${tkHTML(T.get(res.winners[0]))} wins at ${mk === "eff" || mk === "bust" ? "score " + res.metric.toFixed(3) : fmtPct(res.metric)}.`, true); }
        dirty.settled = true;
      }, 1600);
    }
    wire("Round", `${esc(TF[S.tf].label)} round open until ${S.mode === "replay" ? utc(recOf(r, r.e), false) + " UTC" : local(r.e, false)}. Bets on Top gainer and Hype close at 40%. The bracket cuts at 1/6 to 5/6.`);
    S.lastLead = null;
  }
  const st = standings(r, w).filter(x => !x.rug && x.R != null);
  if (st.length && (w - r.s) > r.W * 0.08) {
    const lead = st[0].tok.m;
    if (S.lastLead && lead !== S.lastLead && w - S.leadAt > 25000) { S.leadAt = w; wire("Lead", `${tkHTML(st[0].tok)} takes #1 in Top gainer at ${fmtPct(st[0].R)}. ${tkHTML(T.get(S.lastLead))} drops to #${st.findIndex(x => x.tok.m === S.lastLead) + 1}.`); }
    if (!S.lastLead) S.leadAt = w;
    S.lastLead = lead;
  }
  const lst = lcs(r, w), said = S.seenRound["cp" + r.key] || 0;
  if (lst.done > said) {
    for (const cp of lst.cps.filter(c => c.k > said)) {
      if (w - cp.t < 20000) {
        wire("Cut " + cp.k + "/5", cp.cut.length ? `Checkpoint ${cp.k} cuts ${cp.cut.map(m => tkHTML(T.get(m))).join(" ")}. ${lst.alive.size} left.` : `Checkpoint ${cp.k}: no cut, ${lst.alive.size} left.`, true);
        flashBracket = performance.now();
      }
    }
    S.seenRound["cp" + r.key] = lst.done;
  }
  if ((w - r.s) / r.W > 0.5 && !S.hypeSaid[r.key]) {
    S.hypeSaid[r.key] = 1;
    const h = hype(r, w).filter(x => x.R != null);
    const bust = h.filter(x => x.A > 0.3 && x.R < -0.02).sort((a, b) => b.bust - a.bust)[0];
    const quiet = h.filter(x => x.A < 0 && x.R > 0.02).sort((a, b) => b.eff - a.eff)[0];
    if (bust) wire("Hype", `${tkHTML(bust.tok)}: trading pace ${fmtPct(bust.A, 0)} vs its baseline, price ${fmtPct(bust.R)}. Attention without follow-through.`);
    if (quiet) wire("Hype", `${tkHTML(quiet.tok)} is up ${fmtPct(quiet.R)} while its trading pace is ${fmtPct(quiet.A, 0)}. Quiet climb.`);
  }
  for (const tok of S.board.top) {
    const a = pAt(tok, S.rt - 60000), b = pAt(tok, S.rt);
    if (!a || !b) continue; const mv = b / a - 1;
    if (Math.abs(mv) >= 0.06 && w - (S.movedAt[tok.m] || 0) > 120000 && w - (S.movedAny || 0) > 20000) { S.movedAt[tok.m] = S.movedAny = w; wire("Move", `${tkHTML(tok)} ${fmtPct(mv)} in 1 min. Round: ${fmtPct(spotRet(tok, r, w))}.`); }
  }
}
let flashBracket = 0;
