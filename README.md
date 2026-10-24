# Squad Arena

Fifteen pump.fun coins launched in the last 72 hours enter. One squad wins.

This first version is the whole app as one static page (`index.html`). It reads live
prices from DEX Screener and candles from GeckoTerminal straight from the browser,
so it runs on Vercel with no build step.

## Deploy on Vercel

1. vercel.com → **Add New → Project** → import `sig128/Squad-Arena-`.
2. Framework preset: **Other**. No build command, no output directory. Deploy.
3. **Settings → Domains** → add `squadarena.fun` and `www.squadarena.fun`, then copy the
   records Vercel shows into Namecheap → Advanced DNS (A record on `@`, CNAME on `www`).
4. **Settings → Environment Variables** (server-side, never in this repo):
   `PRIVY_APP_SECRET`, `SUPABASE_SECRET_KEY`, `QUICKNODE_RPC_URL`.

## Config

`config.js` holds public values only (Privy App ID, Supabase URL, Supabase publishable key).
Anything secret goes in Vercel environment variables.

## Next

- Privy login: Google creates a Solana wallet per user; Phantom, Solflare and Backpack connect too.
- Supabase tables with row-level security for members, proofs, chat and bets.
- Server-side worker for pump.fun discovery and the QuickNode pool stream.
