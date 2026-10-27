/* ================= walkthrough: a few pop-ups pointing at the parts of the arena ================= */
// Shown once after the intro (and from the footer's "Tour" link). Each step points at something already on the page;
// nothing covers the screen, so the page stays usable while it runs.
const TOUR_STEPS = [
  { el: () => $("raceMode"), title: "Squads or coins", body: "The arena opens on pump.fun's squads. Switch to Coins to race the newest pump.fun coins instead." },
  { el: () => $("race"), title: "The race", body: "Each line is a squad's all-time profit, live. Hover to compare at any moment, click a line to open that squad." },
  { el: () => $("strip"), title: "24-hour rounds", body: "Every bet runs for 24 hours. A new round opens every hour and takes bets until the next one opens." },
  { el: () => $("boardH").closest(".sec-h"), title: "The leaderboard", body: "Every squad ranked by profit, with members, top coins and PnL. Click a row for the full page; Back puts it in your bet slip." },
  { el: () => $("slip"), title: "Your bet slip", body: "Pick a squad or coin, set a stake and see what it pays before you place it. The squad that gains the most over the 24 hours wins the pool.", place: "left" },
  { el: () => document.querySelector('#railTabs [data-rt="wire"]'), title: "The wire", body: "Live notes from the arena: big moves, leaders changing and results as they happen." },
  { el: () => $("walletBtn"), title: "Log in", body: "Log in with Google or connect Phantom, Solflare or Backpack, then deposit SOL from your wallet. Every bet is real SOL on Solana mainnet." }
];
const TOUR = { i: -1, box: null, on: null, raf: 0 };

function startTour() {
  if (TOUR.box || S.view !== "arena") return;
  if (railOff) setRail(true, false);
  if (typeof SLIP !== "undefined" && SLIP.tab !== "bet") setRailTab("bet");
  const box = document.createElement("div"); box.className = "tour"; box.setAttribute("role", "dialog"); box.setAttribute("aria-live", "polite");
  box.innerHTML = `<i class="tour-arrow"></i><div class="tour-h"><span class="tour-n" id="tourN"></span><button type="button" class="tour-x" id="tourSkip">Skip tour</button></div>
    <h4 id="tourT"></h4><p id="tourB"></p><div class="tour-f"><button type="button" class="btn btn-quiet btn-xs" id="tourBack">Back</button><button type="button" class="btn btn-solid btn-xs" id="tourNext">Next</button></div>`;
  document.body.appendChild(box); TOUR.box = box;
  $("tourSkip").onclick = () => endTour(); $("tourBack").onclick = () => tourGo(TOUR.i - 1, -1); $("tourNext").onclick = () => tourGo(TOUR.i + 1, 1);
  addEventListener("keydown", tourKey); addEventListener("resize", tourPlace); addEventListener("scroll", tourPlace, { passive: true });
  tourGo(0, 1);
}
function tourKey(e) { if (!TOUR.box) return; if (e.key === "Escape") endTour(); else if (e.key === "ArrowRight") tourGo(TOUR.i + 1, 1); else if (e.key === "ArrowLeft") tourGo(TOUR.i - 1, -1); }
const tourOk = el => el && el.getClientRects().length > 0 && !el.closest("[hidden]");
function tourGo(i, dir) {
  // skip steps whose target isn't on screen in this layout
  while (i >= 0 && i < TOUR_STEPS.length && !tourOk(TOUR_STEPS[i].el())) i += dir || 1;
  if (i < 0) return; if (i >= TOUR_STEPS.length) { endTour(); return; }
  TOUR.i = i; const st = TOUR_STEPS[i], el = st.el();
  if (TOUR.on) TOUR.on.classList.remove("tour-on"); TOUR.on = el; el.classList.add("tour-on");
  $("tourN").textContent = (i + 1) + " / " + TOUR_STEPS.length; $("tourT").textContent = st.title; $("tourB").textContent = st.body;
  $("tourBack").hidden = i === 0; $("tourNext").textContent = i === TOUR_STEPS.length - 1 ? "Done" : "Next";
  const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: r.height > innerHeight * .6 ? "start" : "center", behavior: reduced ? "auto" : "smooth" });
  TOUR.box.classList.remove("in"); void TOUR.box.offsetWidth; TOUR.box.classList.add("in");
  tourPlace(); $("tourNext").focus({ preventScroll: true });
}
// the pop-up sits beside its target (below by default), kept inside the window, its arrow pointing at the target
function tourPlace() {
  if (!TOUR.box || !TOUR.on) return; cancelAnimationFrame(TOUR.raf);
  TOUR.raf = requestAnimationFrame(() => {
    const b = TOUR.box, r = TOUR.on.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight, m = 12, gap = 12, st = TOUR_STEPS[TOUR.i] || {};
    const vis = { top: Math.max(r.top, 56), bottom: Math.min(r.bottom, innerHeight) };       // the part of a tall target that's on screen
    const fits = { bottom: innerHeight - r.bottom - gap >= bh + m, top: r.top - gap - 56 >= bh + m, left: r.left - gap >= bw + m, right: innerWidth - r.right - gap >= bw + m };
    let side = [st.place, "bottom", "top", "left", "right"].find(s => s && fits[s]) || "inside";
    let x, y;
    if (side === "bottom" || side === "top") { x = r.left + r.width / 2 - bw / 2; y = side === "bottom" ? r.bottom + gap : r.top - gap - bh; }
    else if (side === "left" || side === "right") { x = side === "left" ? r.left - gap - bw : r.right + gap; y = (vis.top + vis.bottom) / 2 - bh / 2; }
    else { x = r.left + m; y = vis.top + m; }
    x = clamp(x, m, innerWidth - bw - m); y = clamp(y, 56 + m, innerHeight - bh - m);
    b.style.left = Math.round(x) + "px"; b.style.top = Math.round(y) + "px"; b.dataset.side = side;
    const a = b.querySelector(".tour-arrow");
    if (side === "bottom" || side === "top") { a.style.left = clamp(r.left + r.width / 2 - x - 6, 14, bw - 26) + "px"; a.style.top = ""; }
    else if (side === "left" || side === "right") { a.style.top = clamp((vis.top + vis.bottom) / 2 - y - 6, 14, bh - 26) + "px"; a.style.left = ""; }
  });
}
function endTour() {
  store.set("tour", 1);
  if (TOUR.on) TOUR.on.classList.remove("tour-on"); TOUR.on = null;
  if (TOUR.box) TOUR.box.remove(); TOUR.box = null; TOUR.i = -1;
  removeEventListener("keydown", tourKey); removeEventListener("resize", tourPlace); removeEventListener("scroll", tourPlace);
}
// once per visitor, after the intro (or a moment after the page loads when the intro doesn't play)
function maybeTour(delay) { if (store.get("tour", 0) === 1) return; setTimeout(() => { if (store.get("tour", 0) !== 1 && $("intro").hidden) startTour(); }, delay); }
