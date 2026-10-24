<p align="center">
  <img src="og.png" alt="Squad Arena: fifteen pump.fun coins lined up in three chevron stripes, one winner on the tip" width="100%">
</p>

<h1 align="center">Squad Arena</h1>

<p align="center"><b>Fifteen coins enter. One squad wins.</b><br>
Live rounds on the freshest pump.fun coins, with squads behind every coin.</p>

<p align="center">
  <a href="https://squadarena.fun">squadarena.fun</a>
</p>

---

## What it is

Every round, the fifteen strongest pump.fun coins launched in the last 72 hours enter the arena. Up to ten more wait on deck, greyed out but still bettable. Prices stream live, the board re-ranks every few seconds, and a round settles on real market data.

You back coins in three markets:

| Market | You win when |
|---|---|
| **Top gainer** | your coin has the biggest gain when the round closes |
| **Last coin standing** | your coin survives five cuts (3 · 3 · 3 · 2 · 2) and wins the final duel |
| **Hype delta** | your coin's trading pace grows the most (two pools: most efficient, biggest burst) |

Rounds run on **15 minutes, 30 minutes, 1 hour and 24 hours**. Pools are pari-mutuel: earlier bets get a higher weight, and every bet gets a hashed receipt. Bets use practice credits (tSOL) until the on-chain escrow ships.

## Squads

Backing a coin makes you a member of its squad. Each squad gets tasks that unlock as the coin's market cap climbs (Ignition, Lift-off, Breakout, Arena, Legend). Members post proof links from X, verify each other's work, and everyone can see who did what.

## The chart

Every coin page has a full trading chart built on [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/):

- price or market cap, 1m to 4h candles, candles, bars, line or area
- free movement in every direction, axis stretching, log and percent scales
- volume, moving averages, EMA, Bollinger Bands, VWAP, RSI and MACD
- trend lines, horizontal lines, a measure tool and full screen

## Data

| Source | Used for |
|---|---|
| pump.fun / GeckoTerminal | discovering new coins |
| DEX Screener | prices, liquidity, volume and trade counts |
| GeckoTerminal | 1-minute and 5-minute candles |
| Solana RPC (QuickNode) | streaming pool balances on every swap |

A gate keeps out thin or spoofed coins: at least $25K liquidity, real turnover and trade counts, and market cap no more than 60 times liquidity. Coins that rug are pulled from the board mid-round.

## Run it

The app is a single static page with no build step.

```bash
python3 -m http.server 5173
# open http://localhost:5173
```

## Deploy

Vercel serves the repo as a static site (framework preset **Other**, no build command).

`config.js` holds public values only: the Privy App ID, the Supabase URL and the Supabase publishable key. Secrets live in Vercel → Settings → Environment Variables and never in this repo:

| Variable | What it is |
|---|---|
| `PRIVY_APP_ID` | Privy app (public) |
| `PRIVY_APP_SECRET` | Privy server secret |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase server key |
| `QUICKNODE_RPC_URL` | Solana RPC endpoint with its key |

## Roadmap

- [x] Live board, three markets, four round lengths
- [x] Squads, tasks and proofs
- [x] Trading chart with indicators and drawings
- [ ] Privy login: Google creates a Solana wallet per user, Phantom, Solflare and Backpack connect too
- [ ] Supabase storage for squads, proofs, chat and bets, with row-level security
- [ ] Server-side worker for coin discovery and the RPC stream
- [ ] On-chain escrow for real SOL, after an audit
