// HTTP: public reads (/health, /snapshot, /stream) and logged-in actions (POST).
import http from "node:http";
import zlib from "node:zlib";
import { CFG } from "./config.js";
import { DB } from "./db.js";
import { authed } from "./auth.js";
import { attach, online } from "./hub.js";
import { log, rateOk } from "./util.js";
import * as A from "./actions.js";
import { TL, FEED, applyPairs, chartC, quickHistory } from "./market.js";
import { kolOut, kolHistory } from "./kol.js";
import { pfIngest, pfList, pfSquad } from "./pfsquads.js";
import { getJSON, isAddress } from "./util.js";

const POST = {
  "/bet": A.placeBet, "/squad": A.joinSquadAction, "/pass": A.streakPass, "/topup": A.topup, "/profile": A.setHandle, "/proof": A.postProof, "/mark": A.markProof, "/chat": A.chat,
  "/deposit/prepare": A.depositPrepare, "/deposit/submit": A.depositSubmit, "/deposit/confirm": A.depositConfirm, "/withdraw": A.withdrawOut
};
const GET_AUTH = { "/me": A.me, "/money": A.money };

function allowOrigin(origin) {
  if (!origin) return null;
  if (CFG.origins.includes("*") || CFG.origins.includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;     // Vercel preview links
  return null;
}
function send(req, res, status, obj, origin) {
  let body = Buffer.from(JSON.stringify(obj));
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "origin, accept-encoding" };
  if (origin) headers["access-control-allow-origin"] = origin;
  if (body.length > 2048 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { body = zlib.gzipSync(body, { level: 6 }); headers["content-encoding"] = "gzip"; }
  headers["content-length"] = body.length;
  res.writeHead(status, headers); res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => { n += c.length; if (n > 16384) { reject(Object.assign(new Error("Request too large."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (_) { reject(Object.assign(new Error("Bad JSON."), { status: 400 })); } });
    req.on("error", reject);
  });
}
async function userOf(req) {
  const u = await authed(req);
  if (!u.wallets.length) { try { const p = await DB.getProfile(u.id); if (p && p.wallets && p.wallets.length) { u.wallets = p.wallets; u.wallet = p.wallet || p.wallets[0]; } } catch (_) {} }
  return u;
}

export function makeServer({ snapshot, health }) {
  return http.createServer(async (req, res) => {
    const origin = allowOrigin(req.headers.origin), url = new URL(req.url, "http://x"), path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": origin || "null", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400", vary: "origin" });
      return res.end();
    }
    // the pump.fun squad copy is uploaded from a pump.fun page (token-protected, any origin)
    if (req.method === "POST" && path === "/admin/pf-copy") { try { return await pfIngest(req, res, (st, o) => send(req, res, st, o, null)); } catch (e) { return send(req, res, e.status || 500, { error: e.message }, null); } }
    if (req.headers.origin && !origin) return send(req, res, 403, { error: "This site isn't allowed to use the arena API." }, null);
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    try {
      if (req.method === "GET" && path === "/") return send(req, res, 200, { name: "Squad Arena round server", health: "/health" }, origin);
      if (req.method === "GET" && path === "/health") return send(req, res, 200, { ...health(), online: online() }, origin);
      if (req.method === "GET" && path === "/snapshot") { if (!rateOk("snap:" + ip, 30, 10)) throw Object.assign(new Error("Too many requests."), { status: 429 }); return send(req, res, 200, snapshot(), origin); }
      if (req.method === "GET" && path === "/stream") { if (!rateOk("sse:" + ip, 20, 8)) throw Object.assign(new Error("Too many connections."), { status: 429 }); return attach(req, res, origin); }
      if (req.method === "GET" && path === "/candles") {
        if (!rateOk("candles:" + ip, 30, 10)) throw Object.assign(new Error("Too many requests."), { status: 429 });
        const m = String(url.searchParams.get("m") || ""); if (!isAddress(m)) throw Object.assign(new Error("Not a coin address."), { status: 400 });
        let tok = TL.get(m);
        if (!tok) { try { applyPairs(await getJSON("https://api.dexscreener.com/tokens/v1/solana/" + m), Date.now()); } catch (_) {} tok = TL.get(m); }
        if (!tok || !tok.pool) throw Object.assign(new Error("Couldn't find that coin trading on Solana."), { status: 404 });
        // answers straight away with what the server has; opening the page keeps the coin live (prices, candles) for 10 minutes
        FEED.viewed.set(m, Date.now());
        if (!tok.C.length && !tok.CH.length) await quickHistory(tok);
        const c = x => [x.t, x.o, x.h, x.l, x.c, Math.round(x.v || 0)];
        return send(req, res, 200, { m, C: chartC(tok, false).slice(-300).map(c), C5: chartC(tok, true).map(c) }, origin);
      }
      if (req.method === "GET" && path === "/pf") { if (!rateOk("pf:" + ip, 60, 10)) throw Object.assign(new Error("Too many requests."), { status: 429 }); return send(req, res, 200, pfList(url.searchParams.get("since")), origin); }
      if (req.method === "GET" && path === "/pf/squad") {
        if (!rateOk("pfs:" + ip, 60, 10)) throw Object.assign(new Error("Too many requests."), { status: 429 });
        const o = pfSquad(String(url.searchParams.get("id") || ""), url.searchParams.get("since")); if (!o) throw Object.assign(new Error("No such squad."), { status: 404 });
        return send(req, res, 200, o, origin);
      }
      if (req.method === "GET" && path === "/kols") {
        if (!rateOk("kols:" + ip, 60, 10)) throw Object.assign(new Error("Too many requests."), { status: 429 });
        const m = String(url.searchParams.get("m") || ""); if (!isAddress(m)) throw Object.assign(new Error("Not a coin address."), { status: 400 });
        // the coin's KOL history comes in with the first answer (a fresh coin waits up to 5 s for it)
        const h = kolHistory(m); if (h) await Promise.race([h, new Promise(r => setTimeout(r, 5000))]);
        return send(req, res, 200, { m, ...kolOut(m) }, origin);
      }
      if (req.method === "GET" && GET_AUTH[path]) { const u = await userOf(req); return send(req, res, 200, await GET_AUTH[path](u), origin); }
      if (req.method === "POST" && POST[path]) { const body = await readBody(req); const u = await userOf(req); return send(req, res, 200, await POST[path](u, body), origin); }
      return send(req, res, 404, { error: "Not found." }, origin);
    } catch (e) {
      const st = e.status || 500;
      if (st >= 500) log("error", `${req.method} ${path}: ${e.stack || e.message}`);
      return send(req, res, st, { error: st >= 500 && !e.status ? "Something went wrong on the server. Try again." : e.message }, origin);
    }
  });
}
