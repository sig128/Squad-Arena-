/* ================= social: identity, shared store, squads, tasks, chat ================= */
let DB = null, ROOM = null, USER = null, SAMPLE = null, MCP = null;
const PROF = new Map();
const TIERS = [
  { n: "I", name: "Ignition", min: 0 },
  { n: "II", name: "Lift-off", min: 500e3 },
  { n: "III", name: "Breakout", min: 2e6 },
  { n: "IV", name: "Arena", min: 10e6 },
  { n: "V", name: "Legend", min: 50e6 }
];
const tierOf = mc => { let i = 0; TIERS.forEach((t, k) => { if (mc >= t.min) i = k; }); return i; };
const TASKS = [
  { id: "lore", tier: 0, name: "Write the lore", brief: "Post a thread of 3 or more posts that tells the coin's story and why it exists.", proof: "x", goal: 5, viz: "type" },
  { id: "meme", tier: 0, name: "Meme forge", brief: "Post an original meme with the cashtag. Each proof lights up part of the logo.", proof: "x", goal: 12, viz: "pixels" },
  { id: "banner", tier: 0, name: "Banner drop", brief: "Design a 1500×500 community banner and post it.", proof: "x", goal: 3, viz: "blocks" },
  { id: "rally", tier: 1, name: "Rally post", brief: "Quote the squad's rally post with your own take. Your own words: no copy-paste replies and no tagging strangers.", proof: "x", goal: 30, viz: "radar" },
  { id: "stickers", tier: 1, name: "Sticker pack", brief: "Make 5 or more reaction stickers or GIFs and share the pack.", proof: "x", goal: 4, viz: "blocks" },
  { id: "explainer", tier: 1, name: "60-second explainer", brief: "Post a short video that explains the coin to someone new.", proof: "video", goal: 5, viz: "eq" },
  { id: "space", tier: 2, name: "Host an X Space", brief: "Host or co-host a Space about the coin for 20 minutes or more.", proof: "space", goal: 2, viz: "eq" },
  { id: "translate", tier: 2, name: "Translations", brief: "Translate the lore thread into another language. One language per proof.", proof: "x", goal: 6, viz: "scramble" },
  { id: "memewar", tier: 2, name: "Meme war", brief: "Squad against squad: post a meme tagged #SquadArena with your cashtag. The rival is the squad one place above you by market cap.", proof: "x", goal: 40, viz: "tug" },
  { id: "anim", tier: 3, name: "Mascot in motion", brief: "Animate the mascot as a GIF or a short loop.", proof: "x", goal: 4, viz: "orbit" },
  { id: "anthem", tier: 3, name: "Anthem", brief: "Produce an original track or jingle for the squad.", proof: "video", goal: 2, viz: "eq" },
  { id: "collab", tier: 3, name: "Cross-squad collab", brief: "Make a joint post with another squad.", proof: "x", goal: 3, viz: "tug" },
  { id: "doc", tier: 4, name: "Documentary", brief: "A video of 3 minutes or more on the coin's run.", proof: "video", goal: 1, viz: "type" },
  { id: "build", tier: 4, name: "Build something", brief: "Ship a tool, game or site for the community.", proof: "link", goal: 2, viz: "blocks" },
  { id: "irl", tier: 4, name: "IRL sighting", brief: "A photo of original merch or art in the wild, placed legally.", proof: "x", goal: 10, viz: "radar" }
];
const TASK = Object.fromEntries(TASKS.map(t => [t.id, t]));
const PROOF = {
  x: { label: "Link to your X post", re: /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/i, hint: "https://x.com/yourhandle/status/…" },
  space: { label: "Link to the X Space", re: /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/spaces\/[A-Za-z0-9]{6,}(?:[/?#].*)?$/i, hint: "https://x.com/i/spaces/…" },
  video: { label: "Link to the video (X or YouTube)", re: /^https:\/\/(?:(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|shorts\/)[\w-]{6,}|youtu\.be\/[\w-]{6,})(?:[/?#&].*)?$/i, hint: "https://youtu.be/… or an X post" },
  link: { label: "Link to what you built", re: /^https:\/\/[^\s<>"']{4,300}$/i, hint: "https://…" }
};
const RULES_TASKS = "Use your own account. One proof per task per person. No bots, no reply spam, and no buy or sell instructions. Proofs are public and the squad can verify or flag them.";

/* ---------- capabilities ---------- */
const caps = { user: false, db: false, room: false, sample: false, mcp: false };
function useCap(name) { const cl = window.claude; if (!cl || typeof cl.use !== "function") return Promise.resolve(null); try { return cl.use(name).catch(() => null); } catch (_) { return Promise.resolve(null); } }
async function initSocial() {
  USER = await useCap("user"); caps.user = !!USER;
  if (USER) {
    try {
      const me = await USER.me();
      S.me = { id: me.id, name: me.name || "", avatar: me.avatarUrl, color: me.color, isOwner: !!me.isOwner, canWrite: null };
      if (me.id) PROF.set(me.id, { id: me.id, name: me.name || "", avatarUrl: me.avatarUrl, color: me.color });
      S.me.canWrite = await USER.can("data.write");
    } catch (_) {}
  }
  DB = await useCap("db"); caps.db = !!DB;
  if (DB && S.me.id) startSync(); else loadLocal();
  renderChatState();
  ROOM = await useCap("room"); caps.room = !!ROOM;
  if (ROOM) startRoom();
}
function loadLocal() {
  const m = store.get("doc.members", null), p = store.get("doc.proofs", null), c = store.get("doc.posts", null);
  if (m && typeof m.bal === "number") S.my = Object.assign({ v: 1, bal: START_BAL, b: [], sq: {}, h: "" }, m);
  if (p) S.myProofs = Object.assign({ p: [], v: {}, f: {} }, p);
  if (c) S.myPosts = Object.assign({ ms: [] }, c);
  S.dbReady = true; rebuildBetIdx(); renderWallet(); dirty.all = true;
}
const W8 = {};
function persist(name) {
  if (S.srv) return;                     // server mode: every change is its own API call
  const data = name === "members" ? S.my : name === "proofs" ? S.myProofs : S.myPosts;
  if (!DB || !S.me.id || S.localOnly) { store.set("doc." + name, data); return; }
  if (!S.dbReady) { (S.pending || (S.pending = new Set())).add(name); return; }
  const q = W8[name] || (W8[name] = { busy: false, dirty: false });
  if (q.busy) { q.dirty = true; return; }
  q.busy = true;
  DB.doc(name + "/" + S.me.id).set(JSON.parse(JSON.stringify(data)))
    .catch(e => {
      if (e && e.code === "invalid_argument") { S.localOnly = true; S.readOnly = false; store.set("doc." + name, data); renderChatState(); wire("Saved here", "Your bets and proofs are kept in this browser only. This view can't write to the shared arena."); }
      else if (e && e.code === "quota_exceeded") notice("The shared store is full. Old entries need pruning.");
    })
    .finally(() => { q.busy = false; if (q.dirty) { q.dirty = false; persist(name); } });
}
function startSync() {
  let first = { members: true, proofs: true, posts: true };
  const sub = (name, mapRef, onMine) => DB.collection(name).limit(1000).onSnapshot(snap => {
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === "removed") { mapRef.delete(id); continue; }
      const d = ch.doc.data(); if (!d) continue;
      mapRef.set(id, d);
      if (id === S.me.id && first[name]) onMine(d);
    }
    if (first[name]) { first[name] = false; if (!mapRef.has(S.me.id)) onMine(null); }
    if (name === "members") { rebuildBetIdx(); dirty.squads = dirty.bets = true; }
    if (name === "proofs") { dirty.squads = true; detectNewProofs(); }
    if (name === "posts") dirty.chat = true;
    ensureProfiles([...mapRef.keys()]);
  }, e => { if (e && (e.code === "revoked" || e.code === "not_granted")) { DB = null; loadLocal(); } });
  sub("members", S.members, d => {
    if (S.me.canWrite === false) { S.localOnly = true; loadLocal(); renderChatState(); return; }
    if (d && typeof d.bal === "number") S.my = Object.assign({ v: 1, bal: START_BAL, b: [], sq: {}, h: "" }, JSON.parse(JSON.stringify(d)));
    else { const loc = store.get("doc.members", null); if (loc && typeof loc.bal === "number") S.my = Object.assign(S.my, loc); }
    S.dbReady = true; rebuildBetIdx(); renderWallet(); persistIfNew(d, "members"); dirty.all = true;
    if (S.pending) { const p = [...S.pending]; S.pending = null; p.forEach(persist); }
  });
  sub("proofs", S.proofs, d => { if (d && !S.localOnly) S.myProofs = Object.assign({ p: [], v: {}, f: {} }, JSON.parse(JSON.stringify(d))); });
  sub("posts", S.posts, d => { if (d && !S.localOnly) S.myPosts = Object.assign({ ms: [] }, JSON.parse(JSON.stringify(d))); });
}
const canShare = () => S.srv ? !!S.me.id : !!(DB && S.me.id && !S.localOnly && S.me.canWrite !== false);
function persistIfNew(d, name) { if (!d && S.me.canWrite !== false) persist(name); }

/* ---------- people ---------- */
let profBusy = false, profQueue = new Set();
function ensureProfiles(ids) {
  if (!USER) return;
  ids.forEach(id => { if (id && !PROF.has(id)) profQueue.add(id); });
  if (profBusy || !profQueue.size) return;
  profBusy = true; const batch = [...profQueue]; profQueue.clear();
  USER.profiles(batch).then(ps => { for (const id of Object.keys(ps || {})) PROF.set(id, ps[id]); dirty.chat = dirty.squads = true; })
    .catch(() => {}).finally(() => { profBusy = false; if (profQueue.size) ensureProfiles([]); });
}
setInterval(() => { if (USER && PROF.size) USER.profiles([...PROF.keys()]).then(ps => { for (const id of Object.keys(ps || {})) PROF.set(id, ps[id]); }).catch(() => {}); }, 120000);
function nameOf(uid) {
  if (uid && uid === S.me.id) return (PROF.get(uid) && PROF.get(uid).name) || S.me.name || "You";
  if (!uid || uid === "me") return "You";
  const p = PROF.get(uid); return (p && p.name) || "Someone";
}
function picHTML(uid) {
  const p = uid && PROF.get(uid), src = p ? p.avatarUrl : uid === S.me.id ? S.me.avatar : null;
  return src ? `<img src="${esc(src)}" alt="">` : `<span class="pp"></span>`;
}
function handleOf(uid) { const d = uid === S.me.id || uid === "me" ? S.my : S.members.get(uid); return d && d.h ? "@" + d.h : ""; }
function allMemberDocs() {
  const out = [];
  for (const [uid, d] of S.members) if (uid !== S.me.id) out.push([uid, d]);
  out.push([S.me.id || "me", S.my]);
  return out;
}
function allProofs() {
  const out = [], checks = new Map(), flags = new Map();
  const docs = []; for (const [uid, d] of S.proofs) if (uid !== S.me.id) docs.push([uid, d]); docs.push([S.me.id || "me", S.myProofs]);
  for (const [, d] of docs) { for (const id of Object.keys(d.v || {})) checks.set(id, (checks.get(id) || 0) + 1); for (const id of Object.keys(d.f || {})) flags.set(id, (flags.get(id) || 0) + 1); }
  for (const [uid, d] of docs) for (const p of (Array.isArray(d.p) ? d.p : []).slice(0, 300)) if (p && typeof p.id === "string" && TASK[p.k] && typeof p.m === "string" && typeof p.u === "string" && typeof p.ts === "number") out.push({ ...p, uid, checks: checks.get(p.id) || 0, flags: flags.get(p.id) || 0 });
  return out.sort((a, b) => b.ts - a.ts);
}
function squadOf(m) {
  const members = [];
  for (const [uid, d] of allMemberDocs()) {
    if (!d || !d.sq || !d.sq[m]) continue;
    const stake = (Array.isArray(d.b) ? d.b : []).filter(b => b && b.m === m && b.st !== "refund").reduce((a, b) => a + clamp(+b.s || 0, 0, 1000), 0);
    members.push({ uid, since: +d.sq[m] || 0, stake, h: typeof d.h === "string" ? d.h.slice(0, 15) : "" });
  }
  members.sort((a, b) => b.stake - a.stake);
  const proofs = allProofs().filter(p => p.m === m && p.flags < 2);
  const byTask = new Map(); proofs.forEach(p => { let a = byTask.get(p.k); if (!a) byTask.set(p.k, a = []); a.push(p); });
  return { members, proofs, byTask };
}
function isMember(m) { return !!(S.my.sq && S.my.sq[m]); }
function rivalOf(m) {
  const list = S.board.top.concat(S.board.bench), i = list.findIndex(t => t.m === m);
  return i > 0 ? list[i - 1] : list[1] || null;
}
function submitProof(m, k, url) {
  const task = TASK[k], spec = PROOF[task.proof];
  url = String(url || "").trim();
  if (S.srv) {
    if (!S.me.id) return Promise.reject(new Error("Log in first."));
    if (!isMember(m)) return Promise.reject(new Error("Join the squad first: back this coin in any market."));
    if (!spec.re.test(url)) return Promise.reject(new Error("That link doesn't look right. Expected " + spec.hint));
    return api("/proof", { m, k, u: url }).then(o => { hitTask(m, k); wire("Task", `You posted a proof for ${esc(task.name)} in the ${tkHTML(T.get(m) || TL.get(m) || TR.get(m))} squad.`, true); return o; });
  }
  if (!isMember(m)) throw new Error("Join the squad first: back this coin in any market.");
  const mk = url.match(spec.re); if (!mk) throw new Error("That link doesn't look right. Expected " + spec.hint);
  if (S.myProofs.p.some(p => p.m === m && p.k === k)) throw new Error("You already have a proof on this task.");
  if (allProofs().some(p => p.u === url)) throw new Error("Someone already submitted that link.");
  const p = { id: rid(), m, k, u: url.slice(0, 300), ts: nowW() };
  S.myProofs.p.unshift(p); if (S.myProofs.p.length > 200) S.myProofs.p.length = 200;
  if (task.proof === "x" && mk[1] && !S.my.h) { S.my.h = mk[1]; persist("members"); }
  persist("proofs"); dirty.squads = true;
  const tok = T.get(m) || TR.get(m) || TL.get(m);
  postSystem(m, "completed a proof for " + task.name);
  if (ROOM) ROOM.emit("proof", { m, k, id: p.id }).catch(() => {});
  hitTask(m, k);
  wire("Task", `You posted a proof for ${esc(task.name)} in the ${tkHTML(tok)} squad.`, true);
  return p;
}
function checkProof(id, flag) {
  if (S.srv) { api("/mark", { id, kind: flag ? "flag" : "check" }).catch(e => notice(e.message)); return; }
  const bucket = flag ? S.myProofs.f : S.myProofs.v;
  if (bucket[id]) delete bucket[id]; else bucket[id] = nowW();
  persist("proofs"); dirty.squads = true;
}
const seenProof = new Set();
function detectNewProofs() {
  const all = allProofs(), firstRun = !seenProof.size;
  for (const p of all) {
    if (seenProof.has(p.id)) continue; seenProof.add(p.id);
    if (firstRun || p.uid === S.me.id || nowW() - p.ts > 120000) continue;
    const tok = T.get(p.m) || TR.get(p.m) || TL.get(p.m);
    wire("Task", `${esc(nameOf(p.uid))} posted a proof for ${esc(TASK[p.k].name)} in the ${tkHTML(tok)} squad.`);
    hitTask(p.m, p.k);
  }
}

/* ---------- chat ---------- */
let chatChan = "g";
function chatMessages(c) {
  const map = new Map();
  for (const [uid, d] of S.posts) if (uid !== S.me.id && d && Array.isArray(d.ms)) for (const x of d.ms.slice(-100)) if (x && typeof x.id === "string" && x.c === c && typeof x.x === "string" && typeof x.ts === "number") map.set(x.id, { id: x.id, c: x.c, x: x.x.slice(0, 280), ts: x.ts, sys: x.sys ? 1 : 0, by: uid });
  for (const x of S.myPosts.ms) if (x.c === c) map.set(x.id, { ...x, by: S.me.id || "me" });
  for (const [id, x] of S.live) if (x.c === c && !map.has(id)) map.set(id, x);
  return [...map.values()].sort((a, b) => a.ts - b.ts).slice(-120);
}
function sendChat(text) {
  text = String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 280);
  if (!text) return false;
  if (S.srv) { if (!S.me.id) { notice("Log in to chat"); return false; } api("/chat", { c: chatChan, x: text }).catch(e => notice(e.message)); return true; }
  const msg = { id: rid(), c: chatChan, x: text, ts: nowW() };
  S.myPosts.ms.push(msg); if (S.myPosts.ms.length > 80) S.myPosts.ms.splice(0, S.myPosts.ms.length - 80);
  persist("posts"); dirty.chat = true;
  if (ROOM) ROOM.emit("chat", msg).catch(() => {});
  return true;
}
function postSystem(c, text) {
  if (S.srv) return;                     // the server posts squad events itself
  const msg = { id: rid(), c, x: text, ts: nowW(), sys: 1 };
  S.myPosts.ms.push(msg); if (S.myPosts.ms.length > 80) S.myPosts.ms.splice(0, S.myPosts.ms.length - 80);
  persist("posts"); dirty.chat = true;
  if (ROOM) ROOM.emit("chat", msg).catch(() => {});
}
function startRoom() {
  ROOM.on("chat", msg => {
    if (msg.sameTab) return; const d = msg.data || {};
    if (typeof d.id !== "string" || typeof d.x !== "string" || typeof d.c !== "string") return;
    S.live.set(d.id, { id: d.id, c: d.c.slice(0, 64), x: d.x.slice(0, 280), ts: +d.ts || nowW(), sys: d.sys ? 1 : 0, by: msg.by || ("peer:" + msg.peer) });
    if (S.live.size > 400) S.live.delete(S.live.keys().next().value);
    if (msg.by) ensureProfiles([msg.by]);
    dirty.chat = true;
  });
  ROOM.on("proof", msg => { if (msg.sameTab) return; const d = msg.data || {}; if (typeof d.m === "string" && TASK[d.k]) hitTask(d.m, d.k); });
  ROOM.onPeers(ch => { S.peers = ch.peers; ensureProfiles(ch.peers.map(p => p.by).filter(Boolean)); dirty.online = true; });
  setPresence();
}
function setPresence() { if (ROOM) ROOM.presence({ v: S.view, c: S.coin || null }).catch(() => {}); }
function onlineCount(m) {
  const ps = S.peers || []; if (!m) return ps.length;
  return ps.filter(p => p.presence && p.presence.c === m).length;
}
