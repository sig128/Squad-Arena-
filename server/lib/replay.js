// Local test feed: plays a recorded hour of real pump.fun candles as if it were happening now.
// Used with FEED=replay so the whole stack can run without any outside API.
import fs from "node:fs";
import { TL, makeToken, pushTick, FEED } from "./market.js";
import { now, log } from "./util.js";

function decodeOH(line) {
  const parts = line.split("|"); const t0 = +parts[1] * 1000, B = +parts[2], k = B / 1e4;
  return parts[3].split(";").map(c => { const a = c.split(",").map(Number); return { t: t0 + a[0] * 60000, o: (a[1] + a[2]) * k, h: (a[1] + a[3]) * k, l: (a[1] - a[4]) * k, c: a[1] * k, v: a[5] }; });
}
function pathAt(c, f) {
  const P = c.c >= c.o ? [[0, c.o], [0.3, c.l], [0.7, c.h], [1, c.c]] : [[0, c.o], [0.3, c.h], [0.7, c.l], [1, c.c]];
  for (let k = 1; k < P.length; k++) if (f <= P[k][0]) { const a = P[k - 1], b = P[k]; return a[1] + (b[1] - a[1]) * (f - a[0]) / (b[0] - a[0]); }
  return c.c;
}
export function startReplay(file) {
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  const all = rec.tokens.filter(r => r.oh).map(r => ({ r, C: decodeOH(r.oh) }));
  const end = Math.max(...all.map(x => x.C[x.C.length - 1].t + 60000)), start = end - 3600e3;
  const offset = (now() - 600e3) - start;                      // the recorded hour began 10 minutes ago
  for (const { r, C } of all) {
    const tok = makeToken({ ...r, t: r.t ? r.t + offset : 0 });
    tok.full = C.map(c => ({ ...c, t: c.t + offset })); tok.C = []; tok.gate = true; tok.lastSeen = now(); tok.histAt = tok.hist5At = Infinity;
    // rug rule on the recorded path: a 5-minute drop of 80% or more
    for (let i = 5; i < tok.full.length; i++) { const a = tok.full[i - 5].c, b = tok.full[i].c; if (b / a - 1 <= -0.8) { tok.rugAt = tok.full[i].t; tok.rugWhy = "price fell " + Math.round((1 - b / a) * 100) + "% in 5 min"; break; } }
    TL.set(tok.m, tok);
  }
  FEED.sol = 180;
  const step = () => {
    const t = now();
    for (const tok of TL.values()) {
      const F = tok.full; if (!F) continue;
      tok.C = F.filter(c => c.t + 60000 <= t);
      let i = -1; for (let k = 0; k < F.length; k++) if (F[k].t <= t) i = k;
      if (i < 0) continue;
      const c = F[i], f = (t - c.t) / 60000, p = f >= 1 ? c.c : pathAt(c, f);
      tok.px = p; tok.mc = p * tok.supply; pushTick(tok, t, p);
    }
    FEED.lastPrice = t;
  };
  step(); setInterval(step, 1000);
  log("info", `replay feed: ${TL.size} coins, recorded hour started ${Math.round((now() - start - offset) / 60000)} min ago`);
}
