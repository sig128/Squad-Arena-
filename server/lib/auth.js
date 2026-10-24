// Login check: every request that changes something carries the Privy access token (a signed JWT).
// The server checks the signature against Privy's public keys, then reads the user's linked wallets from Privy.
import { CFG } from "./config.js";
import { getJSON, log, isAddress } from "./util.js";

const b64u = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
let jwks = { keys: [], at: 0 };
async function keyFor(kid) {
  if (!jwks.keys.length || Date.now() - jwks.at > 3600e3 || !jwks.keys.some(k => k.kid === kid)) {
    const j = await getJSON(`https://auth.privy.io/api/v1/apps/${CFG.privyAppId}/jwks.json`);
    jwks = { keys: await Promise.all((j.keys || []).map(async k => ({ kid: k.kid, key: await crypto.subtle.importKey("jwk", { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]) }))), at: Date.now() };
  }
  const k = jwks.keys.find(x => !kid || x.kid === kid) || jwks.keys[0];
  if (!k) throw new Error("no signing key");
  return k.key;
}
export async function verifyToken(tok) {
  const parts = String(tok || "").split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const head = JSON.parse(b64u(parts[0]).toString()), body = JSON.parse(b64u(parts[1]).toString());
  if (head.alg !== "ES256") throw new Error("bad token algorithm");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await keyFor(head.kid), b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("bad token signature");
  const t = Date.now() / 1000;
  if (body.iss !== "privy.io") throw new Error("bad token issuer");
  if (body.aud !== CFG.privyAppId) throw new Error("token is for another app");
  if (!(body.exp > t - 30)) throw new Error("token expired");
  if (typeof body.sub !== "string" || !body.sub) throw new Error("bad token subject");
  return body.sub;
}

// the user's name and Solana wallets, cached for 10 minutes
const users = new Map();
export async function privyUser(did, fresh) {
  const c = users.get(did); if (c && !fresh && Date.now() - c.at < 600e3) return c.u;
  const auth = "Basic " + Buffer.from(CFG.privyAppId + ":" + CFG.privySecret).toString("base64");
  const j = await getJSON(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, { headers: { authorization: auth, "privy-app-id": CFG.privyAppId } });
  const acc = j.linked_accounts || [];
  const g = acc.find(a => a.type === "google_oauth"), em = acc.find(a => a.type === "email");
  const sol = acc.filter(a => a.type === "wallet" && a.chain_type === "solana" && isAddress(a.address));
  const embedded = sol.find(a => a.wallet_client_type === "privy" || a.connector_type === "embedded");
  const wallets = [...new Set(sol.map(a => a.address))];
  const email = (g && g.email) || (em && em.address) || null;
  const wallet = (embedded && embedded.address) || wallets[0] || null;
  const name = (g && g.name) || (email ? email.split("@")[0] : wallet ? wallet.slice(0, 4) + "…" + wallet.slice(-4) : "Player");
  const u = { id: did, name: String(name).slice(0, 40), email, wallet, wallets };
  users.set(did, { u, at: Date.now() }); if (users.size > 50000) users.clear();
  return u;
}

// returns the user for a request, or throws (401)
export async function authed(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok) throw Object.assign(new Error("Log in first."), { status: 401 });
  if (CFG.devAuth && tok.startsWith("dev:")) {
    const id = "did:privy:dev-" + tok.slice(4).replace(/[^\w-]/g, "").slice(0, 24), w = (tok.split(":")[2] || "").trim();
    return { id, name: "Tester " + tok.slice(4, 10), email: null, wallet: isAddress(w) ? w : null, wallets: isAddress(w) ? [w] : [] };
  }
  if (!CFG.privyAppId) throw Object.assign(new Error("Login is not configured on the server."), { status: 503 });
  let did;
  try { did = await verifyToken(tok); } catch (e) { throw Object.assign(new Error("Your login expired. Log in again."), { status: 401, detail: e.message }); }
  try { return await privyUser(did); }
  catch (e) { log("warn", "privy user lookup failed: " + e.message); return { id: did, name: "Player", email: null, wallet: null, wallets: [] }; }
}
