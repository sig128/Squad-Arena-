/* ================= ui: modals, wallet, chat panel, Claude desk ================= */
const root = $("modalRoot"); let lastFocus = null, sheetTick = null;
function modal(html, wide) {
  lastFocus = document.activeElement; clearInterval(sheetTick); sheetTick = null;
  root.innerHTML = `<div class="scrim" id="scrim"><div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
  $("scrim").addEventListener("pointerdown", e => { if (e.target.id === "scrim") closeModal(); });
  qsa(".x", root).forEach(x => x.onclick = closeModal);
  const f = root.querySelector("input,button:not(.x)"); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
}
function closeModal() { clearInterval(sheetTick); sheetTick = null; root.innerHTML = ""; if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }
document.addEventListener("keydown", e => { if (e.key === "Escape" && root.firstChild) closeModal(); });
const head = (title, sub, extra) => `<div class="m-head">${extra || ""}<h3>${esc(title)}</h3><span class="nm">${esc(sub || "")}</span><button class="x" aria-label="Close" type="button">×</button></div>`;

/* ---------- bet sheet ---------- */
function openBet(m, mk) {
  if (!tfOk(S.tf)) { notice("24-hour rounds need live data"); return; }
  const st = { m, mk: mk || "top" };
  const draw = () => {
    const w = nowW(), r = roundAt(S.tf, w), field = st.mk === "lcs" ? [...lcs(r, w).alive].map(x => T.get(x)).filter(Boolean) : fieldOf(r, st.mk);
    if (st.m && !field.some(t => t.m === st.m)) { /* keep the pick visible but closed */ }
    const tok = st.m ? tokAny(st.m) : null;
    modal(`${head("Place a bet", TF[S.tf].label + " round · " + (S.mode === "replay" ? "replay" : "live"), tok ? avHTML(tok, 30, 2) : "")}
      <div class="mkt-tabs" style="margin-top:14px">${MKS.map(k => `<button type="button" data-k="${k}" aria-pressed="${k === st.mk}">${esc(MK[k].short)}</button>`).join("")}</div>
      <p class="fine" style="margin:-4px 0 12px" id="bRule"></p>
      <label class="lbl">Coin</label>
      <div class="picks" id="bPicks">${field.map(t => `<button type="button" data-m="${esc(t.m)}" aria-pressed="${t.m === st.m}" class="${inTop(t.m) ? "" : "dimb"}">${avHTML(t, 16, 1.5)}<span>${esc(t.s)}</span></button>`).join("") || `<span class="dim">No coins open in this market.</span>`}</div>
      <label class="lbl" for="bAmt">Stake</label>
      <div class="field"><input id="bAmt" type="number" inputmode="decimal" min="${minStake()}" step="${CUR === "SOL" ? 0.01 : 0.05}" value="${st.amt || (CUR === "SOL" ? 0.05 : 0.5)}"><span>${CUR}</span></div>
      <div class="quick">${(CUR === "SOL" ? ["0.01", "0.05", "0.1", "0.5"] : ["0.1", "0.5", "1", "5"]).map(v => `<button type="button" data-v="${v}">${v}</button>`).join("")}<button type="button" data-v="max">Max</button></div>
      <div class="calc"><div><span>Weight if placed now</span><b id="cW">—</b></div><div><span>Pool now</span><b id="cP">—</b></div><div><span>Your share of this pick</span><b id="cS">—</b></div><div class="pay"><span>Payout if it wins</span><b id="cO">—</b></div></div>
      <p class="err" id="bErr"></p>
      <button class="btn btn-solid btn-wide" type="button" id="bGo">${S.srv && !S.me.id ? "Log in to place bets" : S.wallet && S.wallet.key !== "practice" ? "Sign and place bet" : "Place bet"}</button>
      <p class="fine">${CUR === "SOL" ? "Real SOL from your arena balance" + (SRV.cfg && SRV.cfg.money && SRV.cfg.money.network !== "mainnet" ? " (devnet test SOL)" : "") + "." : "Practice credits (tSOL), no real SOL moves."} Pari-mutuel: the whole pool, minus a ${RAKE * 100}% rake, goes to the winning pick, split by stake × weight. Each pool starts with a ${seedNow()} ${CUR} house seed per coin. Bets on a coin the rug filter removes are refunded. Balance: ${fmtSol(S.my.bal)}.</p>`);
    qsa(".mkt-tabs button", root).forEach(b => b.onclick = () => { st.mk = b.dataset.k; st.amt = parseFloat($("bAmt").value) || 0.5; draw(); });
    qsa("#bPicks button", root).forEach(b => b.onclick = () => { st.m = b.dataset.m; qsa("#bPicks button", root).forEach(x => x.setAttribute("aria-pressed", String(x === b))); calc(); });
    qsa(".quick button", root).forEach(b => b.onclick = () => { $("bAmt").value = b.dataset.v === "max" ? Math.max(0, Math.floor(S.my.bal * 100) / 100) : b.dataset.v; calc(); });
    $("bAmt").addEventListener("input", calc);
    $("bGo").onclick = async () => {
      if (S.srv && !S.me.id) { closeModal(); srvLogin(); return; }
      const a = parseFloat($("bAmt").value) || 0, go = $("bGo");
      if (!st.m) { $("bErr").textContent = "Pick a coin first."; return; }
      go.disabled = true; go.textContent = S.wallet && S.wallet.key !== "practice" ? "Waiting for signature…" : "Placing…";
      try { const r = roundAt(S.tf, nowW()); await placeBet(r, st.mk, st.m, a); closeModal(); notice("Bet placed · " + fmtSol(a) + " on " + tokAny(st.m).s); }
      catch (e) { go.disabled = false; go.textContent = "Place bet"; $("bErr").textContent = e && e.message ? e.message : "The wallet didn't sign. Approve the message to place the bet."; }
    };
    calc();
    sheetTick = setInterval(calc, 1000);
  };
  const calc = () => {
    if (!$("bAmt")) return;
    const w = nowW(), r = roundAt(S.tf, w), a = parseFloat($("bAmt").value) || 0, bs = betState(r, st.mk, w, st.m);
    $("bRule").textContent = { top: "Best TWAP return over the round wins. Bets close at 40%.", lcs: "Last survivor of the bracket wins. Open until the final duel; weight drops as the round goes on.", eff: "Best return per unit of attention growth wins. Bets close at 40%.", bust: "Biggest drop while trading pace rose wins. Refunds if no coin qualifies." }[st.mk];
    $("cW").textContent = bs.open ? "×" + bs.w.toFixed(3) : "—";
    const pl = pool(r, st.mk); $("cP").textContent = fmtSol(pl.P) + " · " + pl.people + " bettor" + (pl.people === 1 ? "" : "s");
    if (st.m && bs.open && a > 0) { const q = quote(r, st.mk, st.m, a, bs.w), sh = (pl.sh.get(st.m) || 0); $("cS").textContent = ((a * bs.w) / (sh + a * bs.w) * 100).toFixed(1) + "%"; $("cO").textContent = fmtSol(q.pay) + " · " + fmtX(q.mult); }
    else { $("cS").textContent = "—"; $("cO").textContent = "—"; }
    const go = $("bGo"); if (S.srv && !S.me.id) { go.disabled = false; return; } if (!go.textContent.includes("…")) { go.disabled = !bs.open || !st.m; $("bErr").textContent = st.m && !bs.open ? bs.why : ""; }
  };
  draw();
}
function openStreakPass(id) {
  const b = S.my.b.find(x => x.id === id); if (!b) return;
  const r = roundOfBet(b), st = lcs(r, nowW()), M = mapOf(b.md);
  modal(`${head("Streak pass", "Move this stake to another survivor once")}
    <p class="fine" style="color:var(--fg)">${tkHTML(M.get(b.m))} survived 3 checkpoints. Move your ${fmtSol(b.s)} to another coin still in the bracket and keep your weight of ${b.w.toFixed(2)}.</p>
    <div class="picks" style="margin-top:12px">${[...st.alive].filter(m => m !== b.m).map(m => `<button type="button" data-m="${esc(m)}">${avHTML(M.get(m), 16, 1.5)}<span>${esc(M.get(m).s)}</span></button>`).join("")}</div><p class="err" id="spErr"></p>`);
  qsa(".picks button", root).forEach(x => x.onclick = async () => { try { await useStreakPass(b, x.dataset.m); closeModal(); notice("Stake moved to " + M.get(x.dataset.m).s); wire("You", `Streak pass used: your LCS stake now rides on ${tkHTML(M.get(x.dataset.m))}.`, true); } catch (e) { $("spErr").textContent = e.message; } });
}

/* ---------- wallet ---------- */
function detectWallets() { const w = window; return { phantom: !!((w.phantom && w.phantom.solana && w.phantom.solana.isPhantom) || (w.solana && w.solana.isPhantom)), solflare: !!(w.solflare && w.solflare.isSolflare), backpack: !!(w.backpack && w.backpack.isBackpack) }; }
const provider = k => k === "phantom" ? (window.phantom && window.phantom.solana) || window.solana : k === "solflare" ? window.solflare : window.backpack;
function openWallet() {
  const d = detectWallets(), who = S.me.id ? (S.me.name || "your claude.ai account") : null;
  const opt = (k, n) => `<button type="button" data-k="${k}"><b>${n}</b><span class="${d[k] ? "ok" : ""}">${S.wallet && S.wallet.key === k ? "Connected" : d[k] ? "Detected" : "Not found"}</span></button>`;
  modal(`${head("Wallet", "Practice balance and sign-in")}
    <div class="m-px" style="display:flex;align-items:baseline;gap:10px;margin:14px 0 4px"><b style="font-size:24px;font-weight:500" class="tab-n">${fmtSol(S.my.bal)}</b><span class="dim">practice credits</span></div>
    <p class="fine" style="margin:0 0 14px">${who ? "Signed in as " + esc(who) + ". Bets, squads and proofs follow this account" + (canShare() ? " and are visible to everyone in this arena." : ", kept in this browser.") : "Not signed in to claude.ai here, so everything stays in this browser."}</p>
    <label class="lbl" for="xHandle">Your X handle (shown on your proofs)</label>
    <div class="field"><span>@</span><input id="xHandle" class="sm" maxlength="15" value="${esc(S.my.h || "")}" placeholder="handle" autocomplete="off"></div>
    <hr class="divider">
    <label class="lbl">Sign in with a wallet</label>
    <div class="wl"><button type="button" disabled><b>Continue with Google</b><span>Setup pending</span></button>${opt("phantom", "Phantom")}${opt("solflare", "Solflare")}${opt("backpack", "Backpack")}</div>
    <p class="err" id="wErr" style="margin-top:12px"></p>
    <p class="fine">Google sign-in will create an embedded Solana wallet for each user once the auth provider is configured. Wallet extensions usually can't reach a page inside the Claude viewer; on your own domain they connect normally. A connected wallet signs each bet message. No transaction is sent.</p>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${S.wallet ? `<button class="btn btn-quiet" type="button" id="wDisc">Disconnect ${esc(S.wallet.name)}</button>` : ""}${S.my.bal < 5 ? `<button class="btn btn-quiet" type="button" id="wTop">Top up to ${START_BAL} tSOL</button>` : ""}</div>`);
  $("xHandle").addEventListener("change", e => { const v = e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15); e.target.value = v; S.my.h = v; persist("members"); notice(v ? "Handle saved: @" + v : "Handle cleared"); });
  if ($("wDisc")) $("wDisc").onclick = async () => { try { await provider(S.wallet.key)?.disconnect?.(); } catch (_) {} S.wallet = null; renderWallet(); closeModal(); };
  if ($("wTop")) $("wTop").onclick = () => { S.my.bal = START_BAL; persist("members"); renderWallet(); closeModal(); notice("Practice balance reset"); };
  qsa(".wl button[data-k]", root).forEach(b => b.onclick = async () => {
    const k = b.dataset.k, p = provider(k), name = b.querySelector("b").textContent;
    if (!p) { $("wErr").textContent = `${name} isn't reachable from this page. On your own domain with the extension installed it connects normally.`; return; }
    try { const res = await p.connect(); const pk = (res && res.publicKey) || p.publicKey; S.wallet = { key: k, name, addr: pk.toString() }; renderWallet(); closeModal(); wire("Wallet", `${esc(name)} connected: ${esc(short(S.wallet.addr))}. Bets will ask it to sign.`); }
    catch (_) { $("wErr").textContent = "The wallet declined. Approve the connection in its popup and try again."; }
  });
}
$("walletBtn").addEventListener("click", () => S.srv ? openAccount() : openWallet());

/* ---------- proofs ---------- */
function openProof(m, k) {
  const tok = tokAny(m), t = TASK[k], spec = PROOF[t.proof];
  modal(`${head(t.name, "$" + tok.s + " squad", avHTML(tok, 28, 2))}
    <p class="fine" style="color:var(--fg)">${esc(t.brief)}</p>
    <label class="lbl" for="pUrl" style="margin-top:14px">${esc(spec.label)}</label>
    <div class="field"><input id="pUrl" class="sm" placeholder="${esc(spec.hint)}" autocomplete="off" inputmode="url"></div>
    <label class="check"><input type="checkbox" id="pOwn"> I posted this from my own account.</label>
    <label class="check"><input type="checkbox" id="pOrig"> It's original work, with no buy or sell instructions.</label>
    <p class="err" id="pErr"></p>
    <button class="btn btn-solid btn-wide" type="button" id="pGo">Post proof</button>
    <p class="fine">${esc(RULES_TASKS)} The squad sees your proof with your name${S.my.h ? " and @" + esc(S.my.h) : ""}.</p>`);
  $("pGo").onclick = async () => {
    if (!$("pOwn").checked || !$("pOrig").checked) { $("pErr").textContent = "Confirm both boxes to post the proof."; return; }
    $("pGo").disabled = true;
    try { await submitProof(m, k, $("pUrl").value); closeModal(); notice("Proof posted · " + t.name); dirty.squads = true; coinSig = ""; }
    catch (e) { $("pErr").textContent = e.message; $("pGo").disabled = false; }
  };
}

/* ---------- rules + data panels ---------- */
function openRules() {
  modal(`${head("How Squad Arena works", "Markets, scoring and squads")}
  <div class="rules">
    <h4>The board</h4><p>pump.fun coins launched in the last 72 hours, filtered for real trading: at least $25K liquidity, a market cap no bigger than 60× its liquidity (fake-cap clones fail this), daily turnover of 25% of market cap, 2,000 trades a day (both adjusted for age) and 300 trades in the last 24 hours. The top 15 by market cap are on the board; the next 10 are on deck and still bettable. A coin leaves when it turns 72 hours old or when the rug filter catches it (liquidity under the floor, or a fall of 80% in 5 minutes). Bets on removed coins are refunded.</p>
    <h4>Rounds</h4><p>15-minute, 30-minute, 1-hour and 24-hour rounds, aligned to the clock. Every round runs the same three markets.</p>
    <h4>Scoring</h4><p>Returns use a time-weighted average price over 3% of the round at the open and at the close, so a single trade can't swing a result. A coin that lists mid-round is measured from its first price.</p>
    <h4>Top gainer</h4><p>The best TWAP return wins. Bets close at 40% of the round.</p>
    <h4>Last coin standing</h4><p>At each sixth of the round the bottom coins are cut: 3, 3, 3, 2, 2 for a full field, then the last two duel to the close. Coins that enter the top 15 mid-round join at the next checkpoint. Bets stay open on any survivor until the duel is scored, with weight <code>1 / (1 + 2 × elapsed share)</code>. Survive 3 checkpoints with your pick and you earn a streak pass: one free move to another survivor.</p>
    <h4>Hype delta</h4><p>Pace growth A compares the recent trade rate with the longer baseline (5 min vs 1 h for short rounds, 1 h vs 6 h for 1-hour rounds, 6 h vs 24 h for daily ones). Most efficient pays the highest <code>R / (1 + max(A, −0.9))</code>. Biggest bust pays the largest <code>A × −R</code> among coins whose pace rose while the price fell, and refunds if none qualifies.</p>
    <h4>Pools</h4><p>Pari-mutuel. Each pool starts with a ${seedNow()} ${CUR} house seed per coin, so the house holds a small stake on every coin. Your share is stake × weight. At settlement the pool minus a ${RAKE * 100}% rake goes to the winning coin's backers. Every settled round shows a SHA-256 receipt of its field, prices and result.</p>
    <h4>Squads</h4><p>Backing a coin in any market makes you a member of its squad. Squads clear tasks together; new tasks unlock at $500K, $2M, $10M and $50M market cap. ${esc(RULES_TASKS)}</p>
    <h4>Money</h4><p>${S.srv ? `Everyone gets practice credits (tSOL).${SRV.cfg && SRV.cfg.money && SRV.cfg.money.enabled ? ` The SOL wallet runs on Solana ${esc(SRV.cfg.money.network)}: deposits go to the arena's treasury wallet, winnings are paid to your arena balance, and withdrawals go back to your own linked wallet.` : ""} Real-money betting is regulated, and some countries block or forbid it.` : "This build uses practice credits. Real SOL needs sign-in, a treasury, geofencing and a gambling licence where required."} None of this is financial advice.</p>
  </div>`, true);
}
function openData() {
  if (S.srv) {
    const c = SRV.cfg || {}, m = c.money || {};
    modal(`${head("Data", "Live")}
      <div class="rules">
      <h4>One shared arena</h4><p>Everyone on this site sees the same arena. A round server watches pump.fun around the clock, prices every coin${c.rpc ? " on every swap through a Solana RPC stream" : " from DEX Screener every few seconds"}, fixes each round's field at the open, runs the bracket cuts and settles every bet. ${TL.size} coins tracked, ${SRV.board.top.length} on the board.</p>
      <h4>Money</h4><p>Practice credits (tSOL) for everyone${m.enabled ? `, plus a SOL wallet on Solana ${esc(m.network)}${m.network === "mainnet" ? "" : " with test SOL"}` : ""}. Deposits and withdrawals go between your own wallet and the arena's treasury.</p>
      </div>`);
    return;
  }
  const live = S.mode !== "replay";
  modal(`${head("Data", live ? "Live" : "Replay")}
    <div class="rules">
    <h4>Now showing</h4><p>${live ? `Live pump.fun data. ${esc(liveSummary())}` : `A replay of a real recorded hour: ${utc(D0, false)}–${utc(REC_END, false)} UTC on ${new Date(REC_END).toUTCString().slice(5, 16)}, 1-minute candles for ${TR.size} coins from GeckoTerminal, with metrics from DEX Screener and launch data from pump.fun. The hour loops on the UTC clock so everyone watching sees the same moment, and rounds settle on the recorded prices.`}</p>
    <h4>Live</h4><p id="liveWhy">${esc(liveAvailability())}</p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${live ? `<button class="btn btn-quiet" type="button" id="dRep">Back to replay</button>` : `<button class="btn btn-solid" type="button" id="dLive"${liveReady() ? "" : " disabled"}>Go live</button>`}</div>
    <p class="err" id="dErr"></p>`);
  if ($("dLive")) $("dLive").onclick = async () => { $("dLive").disabled = true; $("dLive").textContent = "Connecting…"; try { await goLive(); closeModal(); } catch (e) { $("dErr").textContent = e.message || "Live data could not start."; $("dLive").disabled = false; $("dLive").textContent = "Go live"; } };
  if ($("dRep")) $("dRep").onclick = () => { stopLive("You switched back to the replay."); closeModal(); };
}
if ($("modeBtn")) $("modeBtn").addEventListener("click", openData);

/* ---------- chat panel ---------- */
function setChatChan(c) { chatChan = c || "g"; lastChatN = -1; dirty.chat = true; renderChatTabs(); }
function renderChatTabs() {
  const tabs = ["g"]; if (S.coin) tabs.push(S.coin);
  Object.keys(S.my.sq || {}).sort((a, b) => S.my.sq[b] - S.my.sq[a]).slice(0, 2).forEach(m => { if (!tabs.includes(m)) tabs.push(m); });
  if (!tabs.includes(chatChan)) tabs.push(chatChan);
  $("chatTabs").innerHTML = tabs.map(c => { const tok = c === "g" ? null : tokAny(c); return `<button type="button" data-c="${esc(c)}" aria-pressed="${c === chatChan}">${c === "g" ? "Arena" : "$" + esc(tok ? tok.s : short(c))}</button>`; }).join("");
  qsa("#chatTabs button").forEach(b => b.onclick = () => setChatChan(b.dataset.c));
  $("chatIn").placeholder = chatChan === "g" ? "Say something to the arena" : "Message the $" + ((tokAny(chatChan) || {}).s || "") + " squad";
}
function squadTag(uid) {
  const d = uid === S.me.id || uid === "me" ? S.my : S.members.get(uid); if (!d || !d.sq) return "";
  let best = null, bs = -1; const bl = Array.isArray(d.b) ? d.b : []; for (const m of Object.keys(d.sq).slice(0, 50)) { const s = bl.filter(b => b && b.m === m).reduce((a, b) => a + (+b.s || 0), 0); if (s > bs) { bs = s; best = m; } }
  const tok = best && tokAny(best); return tok ? "$" + tok.s : "";
}
function renderChat() {
  const list = $("chatList"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const msgs = chatMessages(chatChan);
  if (lastChatN >= 0 && msgs.length > lastChatN) bumpUnread(msgs.length - lastChatN); lastChatN = msgs.length;
  if (!msgs.length) list.innerHTML = `<div class="empty">${chatChan === "g" ? "No messages yet. Say hi to the arena." : "No messages in this squad yet."}</div>`;
  else list.innerHTML = msgs.map(x => x.sys
    ? `<div class="msg sys">${esc(nameOf(x.by))} ${esc(x.x)} · ${ago(nowW() - x.ts)}</div>`
    : `<div class="msg">${picHTML(x.by)}<div class="who"><b>${esc(nameOf(x.by))}</b><span class="sqt">${esc(squadTag(x.by))}</span><span>${local(x.ts, false)}</span></div><p>${esc(x.x)}</p></div>`).join("");
  if (atBottom || list._first !== false) { list.scrollTop = list.scrollHeight; list._first = false; }
  const n = S.peers ? S.peers.length : 0; $("onlineTxt").textContent = n ? n + " online" : "";
}
function renderChatState() {
  const inp = $("chatIn"), btn = $("chatSend"), note = $("chatNote");
  let why = "";
  if (S.srv) { why = S.me.id ? "" : "Log in to chat. Messages are tied to your account."; inp.disabled = btn.disabled = !!why; note.hidden = !why; note.textContent = why; return; }
  if (!caps.db && !window.claude) why = "Chat runs inside claude.ai, where each message is tied to a signed-in account.";
  else if (!S.me.id) why = "Sign in to claude.ai to chat. Messages are tied to your account.";
  else if (!canShare()) why = "This view is read-only. The owner can give you Contributor access to chat, bet in the shared pools and post proofs.";
  inp.disabled = btn.disabled = !!why; note.hidden = !why; note.textContent = why;
}
$("chatForm").addEventListener("submit", e => { e.preventDefault(); if (!canShare()) return; if (sendChat($("chatIn").value)) $("chatIn").value = ""; });

/* ---------- Claude desk ---------- */
let autoT = null;
function claudeSnapshot() {
  const w = nowW(), r = roundAt(S.tf, w), st = tfOk(S.tf) ? standings(r, w).filter(x => x.R != null) : [], ls = tfOk(S.tf) ? lcs(r, w) : null, z = ls ? lcsZone(r, ls, w) : null;
  const h = tfOk(S.tf) ? hype(r, w).filter(x => x.R != null) : [];
  return { mode: S.mode === "replay" ? "replay of a recorded hour" : "live", round: S.tf, time_left: dur(r.e - w), bets_open: (w - r.s) / r.W < BET_WIN,
    top_gainer: st.slice(0, 6).map(x => ({ coin: x.tok.s, twap_return_pct: +(x.R * 100).toFixed(2), on_deck: !inTop(x.tok.m) })),
    last_coin_standing: ls ? { alive: [...ls.alive].map(m => T.get(m) && T.get(m).s), checkpoint_next: ls.done < 5 ? ls.done + 1 : "final", cut_zone: z ? z.cut.map(m => T.get(m) && T.get(m).s) : [] } : null,
    hype: h.sort((a, b) => b.eff - a.eff).slice(0, 4).map(x => ({ coin: x.tok.s, return_pct: +(x.R * 100).toFixed(2), pace_growth_pct: Math.round(x.A * 100) })),
    rugged: [...T.values()].filter(t => t.rugAt && t.rugAt <= S.rt).map(t => t.s), on_deck: S.board.bench.slice(0, 4).map(t => ({ coin: t.s, mcap_k: Math.round(mcAt(t, S.rt) / 1e3) })) };
}
function fmtClaude(s) {
  const toks = [...T.values()].sort((a, b) => b.s.length - a.s.length), bySym = new Map(toks.map(t => [esc(t.s), t]));
  let h = esc(s);
  if (toks.length) {
    const re = new RegExp("(?<![A-Za-z0-9])\\$?(" + [...bySym.keys()].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z0-9])", "g");
    h = h.replace(re, (all, sym) => bySym.has(sym) ? tkHTML(bySym.get(sym), 13) : all);
  }
  return h.replace(/\n+/g, "<br>");
}
async function askClaude() {
  if (!SAMPLE) return; const btn = $("askBtn"); btn.disabled = true; btn.textContent = "Reading…";
  const ev = wire("Claude", `<span class="caret"></span>`, true), p = ev.querySelector("p");
  try {
    const res = await SAMPLE("You are the desk analyst for Squad Arena, where players bet on pump.fun coins launched in the last 72 hours across three markets: Top gainer (best TWAP return), Last coin standing (elimination bracket) and Hype delta (return relative to trading-pace growth). Read this snapshot and write exactly 3 lines, at most 22 words each: (1) who leads Top gainer and how safe it looks, (2) who is in danger at the next bracket cut and who could survive, (3) the most interesting hype divergence or on-deck coin. Use the coin names exactly as given, without $ signs, and real numbers from the data. Plain sentences. No emojis, hashtags, headings, advice to buy or sell, or disclaimers.\n\nSNAPSHOT:\n" + JSON.stringify(claudeSnapshot()),
      { modelTier: "quick", cache: false, onText: ({ text }) => { p.innerHTML = fmtClaude(text) + '<span class="caret"></span>'; } });
    p.innerHTML = fmtClaude(res.text);
  } catch (err) {
    p.textContent = err && err.code === "rate_limited" ? "Claude is busy. Try again in a minute." : err && err.code === "not_granted" ? "Claude isn't enabled for this page." : "Claude couldn't answer right now.";
    if (err && err.code === "not_granted") { SAMPLE = null; $("askBtn").hidden = $("autoBtn").hidden = true; setAuto(false); }
    if (err && err.code === "rate_limited") setAuto(false);
  }
  btn.disabled = false; btn.textContent = "Ask Claude";
}
function setAuto(on) {
  clearInterval(autoT); autoT = null; $("autoBtn").setAttribute("aria-pressed", String(!!on)); $("autoBtn").textContent = on ? "Auto · on" : "Auto";
  if (on) autoT = setInterval(() => { if (!document.hidden && SAMPLE) askClaude(); }, 240000);
}
$("askBtn").addEventListener("click", askClaude);
$("autoBtn").addEventListener("click", () => { const on = $("autoBtn").getAttribute("aria-pressed") !== "true"; setAuto(on); if (on) askClaude(); });

/* ---------- footer ---------- */
function renderFoot() {
  $("foot").innerHTML = `${S.srv ? "Squad Arena. Coins, prices and launch data are real Solana mainnet data from pump.fun, DEX Screener, GeckoTerminal and the Solana RPC. Practice credits (tSOL) for everyone; SOL bets only where the SOL wallet is on. Nothing here is financial advice. Real-money betting is regulated, and some countries block or forbid it." : "Squad Arena prototype. Coins, prices and launch data are real Solana mainnet data from pump.fun, DEX Screener and GeckoTerminal. Bets use practice credits; no SOL moves and nothing here is financial advice. Real-money prediction markets are regulated, and some countries block unlicensed ones."}
  <br><button type="button" class="link" id="fRules">How it works</button> · <button type="button" class="link" id="fData">Data</button> · <button type="button" class="link" id="fIntro">Replay intro</button>`;
  $("fRules").onclick = openRules; $("fData").onclick = openData; $("fIntro").onclick = () => playIntro(true);
}

/* ---------- collapsible rail ---------- */
let railOff = false, unread = 0, lastChatN = -1;
function setRail(open, animate) {
  railOff = !open; store.set("rail", open ? 1 : 0);
  if (!animate) { document.body.classList.add("no-anim"); requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("no-anim"))); }
  document.body.classList.toggle("rail-off", railOff);
  $("railOpen").setAttribute("aria-hidden", String(!railOff)); $("railOpen").tabIndex = railOff ? 0 : -1;
  const rl = document.querySelector(".rail"); if (rl) rl.inert = railOff;
  if (open) { unread = 0; $("railUnread").textContent = ""; }
  dirty.all = true;
  if (open && animate) setTimeout(() => { if ($("railClose")) $("railClose").focus({ preventScroll: true }); }, 400);
  if (!open && animate) setTimeout(() => $("railOpen").focus({ preventScroll: true }), 500);
}
function bumpUnread(n) { if (!railOff || n <= 0) return; unread += n; $("railUnread").textContent = unread > 99 ? "99+" : String(unread); }
$("railClose").addEventListener("click", () => setRail(false, true));
$("railOpen").addEventListener("click", () => setRail(true, true));
setRail(store.get("rail", 1) !== 0, false);
