// Every setting comes from environment variables (Railway → Variables). Nothing secret lives in the code.
const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const num = (k, d) => { const v = Number(env(k, "")); return Number.isFinite(v) && env(k, "") !== "" ? v : d; };

export const CFG = {
  port: num("PORT", 8080),
  origins: env("ALLOWED_ORIGINS", "https://squadarena.fun,https://www.squadarena.fun,http://localhost:5173").split(",").map(s => s.trim()).filter(Boolean),

  // Privy (login)
  privyAppId: env("PRIVY_APP_ID"),
  privySecret: env("PRIVY_APP_SECRET"),
  devAuth: env("AUTH_DEV") === "1",                     // local testing only: accepts "dev:<id>" tokens. Never set this on Railway.

  // Supabase (storage)
  supabaseUrl: env("SUPABASE_URL").replace(/\/$/, ""),
  supabaseKey: env("SUPABASE_SECRET_KEY"),

  // Market data
  quicknode: env("QUICKNODE_RPC_URL"),                  // mainnet RPC: streams pool balances for prices
  feed: env("FEED", "live"),                            // "live" or "replay" (recorded hour, for local tests)
  discoveryWs: env("DISCOVERY_WS", "wss://api.mainnet-beta.solana.com,wss://solana-rpc.publicnode.com"),   // free Solana WebSockets for the pool stream (new coins), tried in turn; "off" to skip
  gtBackfill: env("GT_BACKFILL", "on") !== "off",       // older chart history from GeckoTerminal, in the background
  gtProxy: env("GT_PROXY", "https://www.squadarena.fun/api/ohlcv"),   // the site's Vercel function in front of GeckoTerminal; "off" to call it directly

  // Money
  network: env("NETWORK", "devnet") === "mainnet" ? "mainnet" : "devnet",
  realMoney: env("REAL_MONEY", "on") !== "off",         // the SOL wallet; "off" leaves only practice credits
  solanaRpc: env("SOLANA_RPC_URL"),                     // money RPC; defaults below
  treasurySecret: env("TREASURY_SECRET"),               // base58 secret key or a JSON byte array
  withdrawMax: num("WITHDRAW_MAX_SOL", 25),
  withdrawDaily: num("WITHDRAW_DAILY_SOL", 50),
  withdrawMin: num("WITHDRAW_MIN_SOL", 0.01),
  depositMin: num("DEPOSIT_MIN_SOL", 0.01),

  // Game rules (the site reads these from /snapshot so both sides agree).
  // SEED_SOL is house money added to every coin in a real-SOL pool; 0 makes the pools pure (the house only earns the rake)
  // and refunds everyone when nobody backed the winner.
  // KOLs: the list from Solana Tracker (free key) or KOL_WALLETS, their trades from a Solana WebSocket and RPC
  solanaTrackerKey: env("SOLANATRACKER_API_KEY"),
  kolPages: num("KOL_PAGES", 3),                         // 100 KOLs per page, most active over the last 7 days first
  kolWs: env("KOL_WS", "wss://api.mainnet-beta.solana.com"),
  kolRpc: env("KOL_RPC", "https://api.mainnet-beta.solana.com"),
  kolPerSocket: num("KOL_PER_SOCKET", 100),
  kolHistDaily: num("KOL_HISTORY_DAILY", 300),          // Solana Tracker requests a day for coin history (free plan: 10,000 a month)
  kolHistEvery: num("KOL_HISTORY_EVERY", 600) * 1000,    // seconds before the same coin's history is asked again
  boardExclude: env("BOARD_EXCLUDE", "PUMP,ANSEM,KIMCHI").split(",").map(x => x.trim().toUpperCase()).filter(Boolean),
  rake: num("RAKE", 0.03),
  seed: { tSOL: num("SEED_TSOL", 0.1), SOL: num("SEED_SOL", 0.01) },
  betWindow: 0.4,
  minStake: { tSOL: 0.05, SOL: num("MIN_STAKE_SOL", 0.01) },
  maxStake: { tSOL: 100, SOL: num("MAX_STAKE_SOL", 10) },
  startBalance: 25
};
if (CFG.discoveryWs === "off") CFG.discoveryWs = "";
if (CFG.gtProxy === "off") CFG.gtProxy = "";
if (CFG.kolWs === "off") CFG.kolWs = "";
CFG.moneyRpc = CFG.solanaRpc || (CFG.network === "mainnet" ? CFG.quicknode : "https://api.devnet.solana.com");

// TIME_SCALE and SCORE_LATE_ROUNDS exist for local tests only (short rounds, score a round the server joined late)
const SCALE = Math.max(1, num("TIME_SCALE", 1));
export const TF = {
  "15m": { k: "15m", W: 15 * 60e3 / SCALE, label: "15 min" },
  "30m": { k: "30m", W: 30 * 60e3 / SCALE, label: "30 min" },
  "1h":  { k: "1h",  W: 3600e3 / SCALE,     label: "1 hour" },
  "24h": { k: "24h", W: 86400e3 / SCALE,    label: "24 hours" }
};
CFG.scoreLate = env("SCORE_LATE_ROUNDS") === "1";
export const TFK = ["15m", "30m", "1h", "24h"];
export const MKS = ["top", "lcs", "eff", "bust"];
export const MAX_AGE = 72 * 3600e3;
export const GATE = { liq: 25e3, turn: 0.25, trades: 2000, tx24: 300, mcLiq: 60 };
export const CURRENCIES = () => CFG.realMoney ? ["tSOL", "SOL"] : ["tSOL"];

export function checkConfig(log) {
  const miss = [];
  if (!CFG.privyAppId) miss.push("PRIVY_APP_ID");
  if (!CFG.privySecret) miss.push("PRIVY_APP_SECRET");
  if (!CFG.supabaseUrl) miss.push("SUPABASE_URL");
  if (!CFG.supabaseKey) miss.push("SUPABASE_SECRET_KEY");
  if (miss.length) log("warn", "missing settings: " + miss.join(", ") + (CFG.supabaseUrl && CFG.supabaseKey ? "" : " (using in-memory storage: nothing survives a restart)"));
  if (!CFG.quicknode) log("warn", "QUICKNODE_RPC_URL not set: prices come from DEX Screener only");
  if (CFG.realMoney && !CFG.treasurySecret) log("warn", "TREASURY_SECRET not set: the SOL wallet is off");
  if (CFG.devAuth) log("warn", "AUTH_DEV=1: test logins are accepted. Never use this in production.");
}
