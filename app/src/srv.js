/* ================= server mode: the round server decides, the page shows ================= */
// On squadarena.fun the page reads one shared arena from the round server: coins and prices (streamed),
// each round's field, bracket cuts, pools and results, plus everyone's bets, proofs and chat.
// Logged-in actions (bets, proofs, chat, deposits, withdrawals) go through the server, which checks every rule.
const SRV = { url: String((window.SA_CONFIG && window.SA_CONFIG.api) || "").replace(/\/+$/, ""), cfg: null, rounds: new Map(), results: new Map(),
  board: { top: [], bench: [] }, es: null, ready: false, lastMsg: 0, bal: { tSOL: 0, SOL: 0 }, me: null, allBets: [], money: null, errs: 0, reloadAt: 0 };
S.srv = !!SRV.url && typeof window.claude === "undefined";
const PV = { ready: false, auth: false, user: null, api: null, wallets: [], signTx: null, loading: null, failed: "" };

/* ---------- requests ---------- */
async function api(path, body) {
  const headers = { "content-type": "application/json" };
  const dev = window.SA_CONFIG && window.SA_CONFIG.devAuth;
  if (PV.auth && PV.api) { const t = await PV.api.getAccessToken(); if (t) headers.authorization = "Bearer " + t; }
  else if (dev) headers.authorization = "Bearer dev:" + dev;          // local testing against a server started with AUTH_DEV=1
  let r;
  try { r = await fetch(SRV.url + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (_) { throw new Error("The round server didn't answer. Check your connection and try again."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "The server answered " + r.status + "."), { status: r.status });
  return j;
}
const loggedIn = () => !!S.me.id;

/* ---------- arena data from the server ---------- */
const cIn = a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] });
function srvToken(o) {
  let tok = TL.get(o.m);
  if (!tok) { tok = makeToken({ m: o.m, s: o.s, n: o.n, t: o.born }); TL.set(o.m, tok); }
  for (const k of ["s", "n", "born", "supply", "px", "mc", "liq", "vol", "tx", "bs", "ch", "pool", "dex", "quote", "pa", "x", "tg", "dc", "w", "ds", "gate", "rugAt", "rugWhy"]) if (o[k] !== undefined && o[k] !== null) tok[k] = o[k];
  if (o.rugAt === 0) { tok.rugAt = 0; tok.rugWhy = ""; }
  if (o.logo && !LOGO[o.m]) tok.logo = o.logo;
  if (o.C) tok.C = o.C.map(cIn);
  if (o.C5) tok.C5 = o.C5.map(cIn);
  if (o.ticks) { const last = tok.ticks.length ? tok.ticks[tok.ticks.length - 1].t : -Infinity; const fresh = o.ticks.map(k => ({ t: k[0], p: k[1] })); tok.ticks = fresh.concat(tok.ticks.filter(k => k.t > (fresh.length ? fresh[fresh.length - 1].t : -Infinity))); if (!fresh.length && last > -Infinity) {} }
  tok.lastSeen = nowW(); tok.rpcAt = o.rpc ? nowW() : tok.rpcAt; tok.firstT = firstTime(tok);
  return tok;
}
function srvRound(st) {
  if (!st || !st.key) return;
  SRV.rounds.set(st.key, st);
  if (SRV.rounds.size > 60) { const keys = [...SRV.rounds.keys()].sort((a, b) => +a.split(".")[2] - +b.split(".")[2]); for (const k of keys.slice(0, SRV.rounds.size - 50)) SRV.rounds.delete(k); }
  S.fields.delete(st.key); dirty.bets = true; dirty.all = true;
}
function srvDocs(d) {
  if (!d) return;
  for (const [id, x] of Object.entries(d.members || {})) S.members.set(id, x);
  for (const [id, x] of Object.entries(d.proofs || {})) S.proofs.set(id, x);
  for (const [id, x] of Object.entries(d.posts || {})) S.posts.set(id, x);
  srvMine(); rebuildBetIdx(); detectNewProofs(); dirty.squads = dirty.bets = dirty.chat = true;
}
// my own documents come from the same stream; the balance comes from /me
function srvMine() {
  if (!S.me.id) return;
  const m = S.members.get(S.me.id), p = S.proofs.get(S.me.id), c = S.posts.get(S.me.id);
  if (m) { SRV.allBets = m.b || []; S.my.sq = m.sq || {}; S.my.h = m.h || ""; }
  S.my.b = SRV.allBets.filter(b => (b.cur || "tSOL") === CUR);
  S.my.bal = +(SRV.bal[CUR] || 0);
  if (p) S.myProofs = { p: p.p || [], v: p.v || {}, f: p.f || {} };
  if (c) S.myPosts = { ms: c.ms || [] };
}
async function srvSnapshot() {
  let snap;
  try { const r = await fetch(SRV.url + "/snapshot", { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status); snap = await r.json(); }
  catch (e) { SRV.errs++; throw new Error("The round server isn't reachable right now (" + e.message + ")."); }
  SRV.cfg = snap.cfg;
  for (const o of snap.tokens || []) srvToken(o);
  SRV.board = snap.board || { top: [], bench: [] };
  SRV.rounds.clear(); for (const st of Object.values(snap.rounds || {})) srvRound(st);
  SRV.results.clear(); for (const [k, res] of Object.entries(snap.results || {})) SRV.results.set(k, res);
  S.members.clear(); S.proofs.clear(); S.posts.clear(); srvDocs(snap.docs);
  for (const [id, p] of Object.entries(snap.people || {})) PROF.set(id, { id, name: p.name, avatarUrl: p.avatarUrl });
  if (!SRV.cfg.currencies.includes(CUR)) setCurrency("tSOL");
  SRV.ready = true; SRV.lastMsg = nowW(); S.results.clear(); dirty.all = true;
}
function srvStream() {
  if (SRV.es) try { SRV.es.close(); } catch (_) {}
  const es = new EventSource(SRV.url + "/stream"); SRV.es = es;
  let dropped = false;
  const on = (ev, fn) => es.addEventListener(ev, e => { SRV.lastMsg = nowW(); let d; try { d = JSON.parse(e.data); } catch (_) { return; } try { fn(d); } catch (err) { console.warn("stream " + ev, err); } });
  es.onopen = () => { if (dropped) { dropped = false; srvSnapshot().catch(() => {}); } };
  es.onerror = () => { dropped = true; };
  on("tick", list => { for (const [m, t, p] of list) { const tok = TL.get(m); if (!tok) continue; const K = tok.ticks; if (!K.length || t > K[K.length - 1].t) K.push({ t, p }); if (K.length > 5000) K.splice(0, 1000); tok.px = p; tok.lastSeen = nowW(); } dirty.coin = dirty.race = true; });
  on("token", o => { srvToken(o); dirty.all = true; });
  on("meta", list => { list.forEach(srvToken); });
  on("candles", d => { const tok = TL.get(d.m); if (!tok) return; if (d.five) tok.C5 = d.C.map(cIn); else tok.C = d.C.map(cIn); tok.firstT = firstTime(tok); dirty.coin = dirty.race = true; });
  on("board", b => { SRV.board = b; });
  on("round", srvRound);
  on("results", d => { for (const [mk, res] of Object.entries(d.res || {})) SRV.results.set(d.key + "|" + mk, res); dirty.settled = dirty.bets = true; });
  on("doc", d => { const map = d.coll === "members" ? S.members : d.coll === "proofs" ? S.proofs : S.posts; map.set(d.id, d.data); if (d.id === S.me.id) srvMine(); if (d.coll === "members") { rebuildBetIdx(); dirty.squads = dirty.bets = true; } if (d.coll === "proofs") { dirty.squads = true; detectNewProofs(); } if (d.coll === "posts") dirty.chat = true; });
  on("people", m => { for (const [id, p] of Object.entries(m)) PROF.set(id, { id, name: p.name, avatarUrl: p.avatarUrl }); dirty.chat = dirty.squads = true; });
  on("chat", x => { if (typeof x.id !== "string") return; S.live.set(x.id, { id: x.id, c: String(x.c).slice(0, 64), x: String(x.x).slice(0, 280), ts: +x.ts || nowW(), sys: 0, by: x.by }); if (S.live.size > 400) S.live.delete(S.live.keys().next().value); dirty.chat = true; });
  on("proof", d => { if (typeof d.m === "string" && TASK[d.k]) hitTask(d.m, d.k); });
  on("paid", d => {
    if (d.uid !== S.me.id) return;
    const tok = (() => { const b = SRV.allBets.find(x => x.id === d.bet); return b ? TL.get(b.m) : null; })();
    if (d.st === "won") { wire("You won", `${tok ? tkHTML(tok) + " · " : ""}paid ${fmtAmt(d.pay, d.cur)}.`, true); notice("You won " + fmtAmt(d.pay, d.cur)); }
    else if (d.st === "refund") wire("Refund", `${tok ? tkHTML(tok) + ": " : ""}your stake is back.`, true);
    refreshMe();
  });
}
const fmtAmt = (v, cur) => (Math.abs(v) < 100 ? (+v).toFixed(cur === "SOL" ? 4 : 2) : Math.round(v).toLocaleString("en-US")) + " " + cur;

/* ---------- my account ---------- */
async function refreshMe() {
  if (!PV.auth && !(window.SA_CONFIG && window.SA_CONFIG.devAuth)) return;
  try {
    const me = await api("/me");
    SRV.me = me; SRV.bal = me.bal; SRV.money = me.money; SRV.allBets = me.bets || SRV.allBets;
    S.me = { id: me.id, name: me.name, avatar: null, color: "", isOwner: false, canWrite: true };
    PROF.set(me.id, { id: me.id, name: me.name, avatarUrl: (PROF.get(me.id) || {}).avatarUrl || null });
    srvMine(); rebuildBetIdx(); renderWallet(); renderChatState(); dirty.all = true;
  } catch (e) { if (e.status === 401 && PV.api) { wire("Account", "Your login expired. Log in again from the wallet button."); } else console.warn("me", e.message); }
}
function setCurrency(c) {
  if (S.srv && SRV.cfg && !SRV.cfg.currencies.includes(c)) c = "tSOL";
  CUR = c; store.set("cur", c);
  srvMine(); rebuildBetIdx(); renderWallet(); dirty.all = true;
}

/* ---------- Privy: Google login with a Solana wallet per user, plus Phantom, Solflare and Backpack ---------- */
function loadPrivy() {
  if (PV.loading) return PV.loading;
  const appId = window.SA_CONFIG && window.SA_CONFIG.privyAppId;
  if (!appId) { PV.failed = "Login isn't configured on this site."; return Promise.reject(new Error(PV.failed)); }
  PV.loading = (async () => {
    const V = "3.51.0", dep = "?deps=react@18.3.1,react-dom@18.3.1";
    const [R, D, P, PS] = await Promise.all([import("https://esm.sh/react@18.3.1"), import("https://esm.sh/react-dom@18.3.1/client"),
      import(`https://esm.sh/@privy-io/react-auth@${V}${dep}`), import(`https://esm.sh/@privy-io/react-auth@${V}/solana${dep}`)]);
    let first = true;
    function Bridge() {
      const p = P.usePrivy(), sw = PS.useWallets(), st = PS.useSignTransaction();
      R.useEffect(() => {
        const was = PV.auth; PV.api = p; PV.wallets = (sw && sw.wallets) || []; PV.signTx = st && st.signTransaction;
        PV.ready = !!p.ready; PV.auth = !!(p.ready && p.authenticated); PV.user = p.user;
        if (PV.ready && (first || was !== PV.auth)) { first = false; onPrivy(was); }
      });
      return null;
    }
    const host = document.createElement("div"); host.id = "privyHost"; document.body.appendChild(host);
    const dark = getComputedStyle(document.documentElement).getPropertyValue("--mode").trim() === "dark";
    D.createRoot(host).render(R.createElement(P.PrivyProvider, { appId, config: {
      loginMethods: ["google", "wallet"],
      appearance: { theme: dark ? "dark" : "light", walletChainType: "solana-only", showWalletLoginFirst: false, landingHeader: "Log in to Squad Arena", loginMessage: "Google creates a Solana wallet for you. Or connect Phantom, Solflare or Backpack." },
      embeddedWallets: { solana: { createOnLogin: "users-without-wallets" }, ethereum: { createOnLogin: "off" } },
      externalWallets: { solana: { connectors: PS.toSolanaWalletConnectors() } } } }, R.createElement(Bridge)));
  })().catch(e => { PV.failed = "Login couldn't load (" + (e && e.message || e) + ")."; PV.loading = null; throw e; });
  return PV.loading;
}
function onPrivy(was) {
  if (PV.auth) { refreshMe().then(() => { if (!was) { wire("Account", `Logged in as ${esc(S.me.name || "you")}.`); notice("Logged in"); } }); }
  else {
    if (was) { wire("Account", "Logged out."); }
    S.me = { id: null, name: "", avatar: "", color: "", isOwner: false, canWrite: null }; SRV.me = null; SRV.bal = { tSOL: 0, SOL: 0 }; SRV.allBets = [];
    S.my = { v: 1, bal: 0, b: [], sq: {}, h: "" }; S.myProofs = { p: [], v: {}, f: {} }; S.myPosts = { ms: [] };
    rebuildBetIdx(); renderWallet(); renderChatState(); dirty.all = true;
  }
}
async function srvLogin() {
  try { await loadPrivy(); } catch (e) { notice(PV.failed || "Login couldn't load"); return; }
  for (let i = 0; i < 40 && !PV.ready; i++) await sleep(150);
  if (PV.auth) return;
  try { PV.api.login(); } catch (e) { notice("Login didn't open: " + e.message); }
}
async function srvLogout() { try { await PV.api.logout(); } catch (_) {} onPrivy(true); }
function solWallet(addr) { return PV.wallets.find(w => w.address === addr) || PV.wallets[0] || null; }

/* ---------- money: deposit (signed in your wallet, sent by the server) and withdraw ---------- */
const b64ToU8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const u8ToB64 = u => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
// config.js pins the arena wallet; the site only asks you to sign a plain transfer to that address
const pinnedTreasury = () => String((window.SA_CONFIG && window.SA_CONFIG.treasury) || "").trim();
const treasuryOk = m => !pinnedTreasury() || (m && m.treasury === pinnedTreasury());
function checkDepositTx(u8, from, lamports) {
  const bad = () => { throw new Error("That deposit doesn't go to the arena wallet, so it wasn't signed."); };
  const pin = pinnedTreasury(); let o = 0;
  if (u8[o++] !== 1) bad(); o += 64;
  if (u8[o] !== 1 || u8[o + 1] !== 0) bad(); o += 3;
  const nk = u8[o++]; if (nk > 8) bad();
  const keys = []; for (let i = 0; i < nk; i++) { keys.push(b58enc(u8.slice(o, o + 32))); o += 32; }
  o += 32;
  const nix = u8[o++]; if (nix < 1 || nix > 2) bad();
  for (let i = 0; i < nix; i++) {
    const prog = keys[u8[o++]], na = u8[o++], acc = []; for (let j = 0; j < na; j++) acc.push(keys[u8[o++]]);
    const dl = u8[o++], data = u8.slice(o, o + dl); o += dl;
    if (i === 0) {
      if (prog !== "11111111111111111111111111111111" || na !== 2 || acc[0] !== from || (pin && acc[1] !== pin) || dl !== 12) bad();
      if (data[0] !== 2 || data[1] || data[2] || data[3]) bad();
      if (new DataView(data.buffer, data.byteOffset + 4, 8).getBigUint64(0, true) !== BigInt(lamports)) bad();
    } else if (prog !== "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" || na !== 0) bad();
  }
  if (o !== u8.length) bad();
}
async function srvDeposit(sol, from) {
  const w = solWallet(from || (SRV.me && SRV.me.wallet));
  if (!w) throw new Error("No Solana wallet is connected to this login yet.");
  if (!treasuryOk(SRV.money || (SRV.cfg && SRV.cfg.money))) throw new Error("Deposits are paused while the arena wallet is set up.");
  const prep = await api("/deposit/prepare", { sol, from: w.address });
  const unsigned = b64ToU8(prep.tx);
  checkDepositTx(unsigned, w.address, prep.lamports);
  const res = await PV.signTx({ transaction: unsigned, wallet: w });
  let signed = res && res.signedTransaction;
  if (!signed) throw new Error("The wallet didn't sign.");
  if (signed.length === 64) { const t = unsigned.slice(); t.set(signed, 1); signed = t; }    // sign-only wallets return just the signature
  const out = await api("/deposit/submit", { tx: u8ToB64(signed) });
  await refreshMe();
  return out;
}
async function srvWithdraw(sol, to) { const out = await api("/withdraw", { sol, to }); await refreshMe(); return out; }

/* ---------- start ---------- */
async function srvStart() {
  CUR = store.get("cur", "tSOL") === "SOL" ? "SOL" : "tSOL";
  S.mode = "live"; T = TL; LIVE.on = false; resetMemos();
  S.my = { v: 1, bal: 0, b: [], sq: {}, h: "" }; S.dbReady = true;
  renderTf(); renderMode();
  wire("Live", "Connecting to the round server…");
  try { await srvSnapshot(); }
  catch (e) { wire("Live", esc(e.message) + " Retrying."); setTimeout(srvStart, 8000); return; }
  srvStream();
  tick(true);
  wire("Live", `Live: ${SRV.board.top.length} coins on the board. One shared arena: rounds, cuts and payouts are decided by the round server${SRV.cfg.rpc ? ", prices stream on every swap" : ""}.`, true);
  if (window.SA_CONFIG && window.SA_CONFIG.devAuth) refreshMe();
  else loadPrivy().catch(() => {});
  // a stream that went quiet gets a fresh snapshot
  setInterval(() => { if (SRV.ready && nowW() - SRV.lastMsg > 20000 && nowW() - SRV.reloadAt > 20000) { SRV.reloadAt = nowW(); srvSnapshot().then(srvStream).catch(() => {}); } }, 5000);
  setInterval(() => { if (loggedIn()) refreshMe(); }, 30000);
}

/* ---------- account sheet (replaces the wallet sheet in server mode) ---------- */
function openAccount() {
  const m = SRV.money || (SRV.cfg && SRV.cfg.money) || {}, me = SRV.me, solOn = SRV.cfg && SRV.cfg.currencies.includes("SOL");
  if (!loggedIn()) {
    modal(`${head("Log in", "Squad Arena account")}
      <p class="fine" style="color:var(--fg);margin-top:14px">Log in with Google and you get your own Solana wallet, made for you on the spot. Already have Phantom, Solflare or Backpack? Connect it instead.</p>
      <p class="fine">Everyone starts with ${SRV.cfg ? SRV.cfg.startBalance : 25} tSOL of practice credits.${solOn ? ` Real SOL bets run on Solana ${esc(m.network || "devnet")}.` : ""}</p>
      <p class="err" id="lgErr">${esc(PV.failed)}</p>
      <button class="btn btn-solid btn-wide" type="button" id="lgGo">Log in</button>`);
    $("lgGo").onclick = async () => { $("lgGo").disabled = true; $("lgGo").textContent = "Opening…"; closeModal(); await srvLogin(); };
    return;
  }
  const net = m.network === "mainnet" ? "Solana mainnet" : "Solana devnet (test SOL)";
  modal(`${head("Account", me ? me.name : "")}
    <div class="seg" id="curSeg" role="group" aria-label="Currency" style="margin-top:14px"><button type="button" data-c="tSOL" aria-pressed="${CUR === "tSOL"}">Practice · tSOL</button>${solOn ? `<button type="button" data-c="SOL" aria-pressed="${CUR === "SOL"}">SOL</button>` : ""}</div>
    <div class="m-px" style="display:flex;align-items:baseline;gap:10px;margin:14px 0 4px"><b style="font-size:24px;font-weight:500" class="tab-n">${fmtAmt(SRV.bal[CUR] || 0, CUR)}</b><span class="dim">${CUR === "SOL" ? "in the arena · " + esc(net) : "practice credits"}</span></div>
    ${me && me.wallet ? `<p class="fine" style="margin:0 0 6px">Wallet <code>${esc(short(me.wallet))}</code> <button class="btn btn-quiet btn-xs" type="button" id="acCopy">Copy address</button></p>` : `<p class="fine">No Solana wallet on this login yet.</p>`}
    ${CUR === "SOL" ? `
      <hr class="divider">
      ${treasuryOk(m) ? `<label class="lbl" for="dAmt">Deposit from your wallet</label>
      <div style="display:flex;gap:8px"><div class="field" style="flex:1"><input id="dAmt" type="number" inputmode="decimal" min="${m.depositMin || 0.01}" step="0.01" value="0.1"><span>SOL</span></div><button class="btn btn-solid" type="button" id="dGo">Deposit</button></div>` : `<p class="fine" style="color:var(--fg)">Deposits are paused while the arena wallet is set up.</p>`}
      <label class="lbl" for="wAmt" style="margin-top:12px">Withdraw to your wallet</label>
      <div style="display:flex;gap:8px"><div class="field" style="flex:1"><input id="wAmt" type="number" inputmode="decimal" min="${m.withdrawMin || 0.01}" step="0.01" value=""><span>SOL</span></div><button class="btn btn-quiet" type="button" id="wGo">Withdraw</button></div>
      <p class="fine">${m.network === "mainnet" ? "Real SOL." : "Devnet: test SOL with no value. Get some free at faucet.solana.com."} Withdrawals go to your own linked wallet, up to ${m.withdrawMax || 25} SOL at a time and ${m.withdrawDaily || 50} SOL a day.</p>`
      : `${SRV.me && SRV.me.topupOk ? `<button class="btn btn-quiet" type="button" id="acTop" style="margin-top:10px">Top up to ${SRV.cfg.startBalance} tSOL</button>` : ""}`}
    <p class="err" id="acErr"></p><p class="fine" id="acOk" style="color:var(--up)"></p>
    <hr class="divider">
    <label class="lbl" for="xHandle">Your X handle (shown on your proofs)</label>
    <div class="field"><span>@</span><input id="xHandle" class="sm" maxlength="15" value="${esc(S.my.h || "")}" placeholder="handle" autocomplete="off"></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-quiet" type="button" id="acOut">Log out</button></div>`);
  qsa("#curSeg button", root).forEach(b => b.onclick = () => { setCurrency(b.dataset.c); openAccount(); });
  if ($("acCopy")) $("acCopy").onclick = () => copyText(me.wallet, $("acCopy"));
  const busy = (btn, on, label) => { btn.disabled = on; btn.textContent = on ? "Working…" : label; };
  if ($("dGo")) $("dGo").onclick = async () => {
    const a = parseFloat($("dAmt").value) || 0, b = $("dGo"); $("acErr").textContent = ""; $("acOk").textContent = ""; busy(b, true);
    try { const r = await srvDeposit(a); $("acOk").textContent = r.pending ? "Sent. It will be credited as soon as the network confirms it." : `Deposited ${fmtAmt(r.lamports / 1e9, "SOL")}.`; wire("Wallet", `Deposit of ${fmtAmt(a, "SOL")} ${r.pending ? "sent" : "credited"}.`, true); }
    catch (e) { $("acErr").textContent = e.message || "The deposit didn't go through."; }
    finally { busy(b, false, "Deposit"); const bb = document.querySelector(".m-px b"); if (bb) bb.textContent = fmtAmt(SRV.bal[CUR] || 0, CUR); }
  };
  if ($("wGo")) $("wGo").onclick = async () => {
    const a = parseFloat($("wAmt").value) || 0, b = $("wGo"); $("acErr").textContent = ""; $("acOk").textContent = ""; busy(b, true);
    try { const r = await srvWithdraw(a); $("acOk").textContent = r.status === "confirmed" ? `Sent ${fmtAmt(r.lamports / 1e9, "SOL")} to your wallet.` : "Sent. Waiting for the network to confirm."; wire("Wallet", `Withdrawal of ${fmtAmt(a, "SOL")} ${r.status === "confirmed" ? "confirmed" : "sent"}.`, true); }
    catch (e) { $("acErr").textContent = e.message || "The withdrawal didn't go through."; }
    finally { busy(b, false, "Withdraw"); const bb = document.querySelector(".m-px b"); if (bb) bb.textContent = fmtAmt(SRV.bal[CUR] || 0, CUR); }
  };
  if ($("acTop")) $("acTop").onclick = async () => { try { await api("/topup", {}); await refreshMe(); closeModal(); notice("Practice balance topped up"); } catch (e) { $("acErr").textContent = e.message; } };
  $("xHandle").addEventListener("change", async e => { const v = e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15); e.target.value = v; try { await api("/profile", { h: v }); S.my.h = v; notice(v ? "Handle saved: @" + v : "Handle cleared"); } catch (er) { $("acErr").textContent = er.message; } });
  $("acOut").onclick = async () => { closeModal(); await srvLogout(); };
}

/* ---------- bets through the server ---------- */
const minStake = () => S.srv && SRV.cfg ? +SRV.cfg.minStake[CUR] : MIN_STAKE;
const seedNow = () => S.srv && SRV.cfg ? +(SRV.cfg.seed[CUR] ?? SEED) : SEED;
async function srvPlaceBet(r, mk, m, s) {
  if (!S.me.id) throw new Error("Log in to place a bet.");
  if (!(s >= minStake())) throw new Error("The minimum stake is " + fmtSol(minStake()) + ".");
  if (s > S.my.bal + 1e-9) throw new Error("You have " + fmtSol(S.my.bal) + ". Lower the stake" + (CUR === "SOL" ? " or deposit more SOL." : "."));
  const out = await api("/bet", { tf: r.tfk, mk, m, s, cur: CUR, rk: r.key });
  SRV.bal = out.bal; SRV.allBets.unshift(out.bet); if (out.joined) S.my.sq[m] = out.bet.ts;
  srvMine(); rebuildBetIdx(); renderWallet(); dirty.bets = dirty.squads = true;
  const tok = T.get(m);
  wire("You", `${fmtSol(out.bet.s)} on ${tkHTML(tok)} · ${esc(MK[mk].label)} · ${r.tf.label} · weight ${out.bet.w.toFixed(2)} · quote ${fmtX(out.bet.q)}.`, true);
  if (out.joined) wire("Squad", `You joined the ${tkHTML(tok)} squad. Its tasks are on the coin page.`);
  return out.bet;
}
