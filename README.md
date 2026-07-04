# Orbit Copilot

**Chat-only DeFi control plane on Stellar Testnet.** One conversation for balances, LP, stake/farm, lend/borrow, prediction markets, and perps — protocols are backends, not separate app screens. **On-chain is authority**; Postgres and Redis are product infrastructure only (chat, analytics, rate limits, short caches).

**Live demo:** [https://orbitpilot.vercel.app](https://orbitpilot.vercel.app)

## Product

| Capability | How |
|---|---|
| Portfolio intelligence | Live Horizon / protocol reads — earning vs idle, rebalance suggestions |
| Classic DEX | Path payments via Horizon |
| Unicorn StelDex | Swap, LP, farm, orders (sign in Freighter) |
| Soroswap / Aquarius / Blend | Quotes and write paths when available on testnet |
| Orbit Prediction Markets | Soroban contract — XLM stakes on-chain |
| Orbit Perpetuals | Soroban contract — USDC margin on-chain |
| Chat + LLM | Deterministic intents + OpenRouter for free-form |

## Architecture

```
Chat UI (Vite/React)
    │
    ▼
API (Express on Vercel)
    ├── Postgres (Neon)     chat, sessions, wallet_events, feedback
    ├── Redis (Upstash KV)  rate limits, portfolio/price caches (TTL)
    └── Chain               Horizon, Soroban RPC, protocol APIs
            ▲
            │ Freighter signs XDR
```

**Never stored as truth:** balances, LP shares, bets, margin. Those are always read from Stellar.

## Deployed contracts (Testnet)

| Market | Contract ID |
|---|---|
| Prediction | `CBSTVO2UCF2XVMHXFAKS5I2XMURT222MY5OWOXITW45B2AB6R7FHMTDC` |
| Perpetuals | `CC2IDBXQLA5L6NDWMGV3M6JH5NVK6NG26HMQCEYEHLJUJ7Q35KXADT3G` |

Build/deploy notes: [`contracts/README.md`](contracts/README.md)

## Quick start (local)

### Prerequisites

- Node 22+, pnpm 9
- Neon (or local Postgres) + Upstash Redis (`REDIS_URL` / `KV_URL`)
- Freighter wallet on **Testnet**

### Setup

```bash
pnpm install
cp .env.example .env
# Fill DATABASE_URL, REDIS_URL (or KV_URL), SOROSWAP_API_KEY, OPENROUTER_API_KEY, contract IDs
```

Optional local data plane:

```bash
pnpm data-plane:up   # requires Docker
```

### Run

```bash
# API
pnpm --filter @workspace/api-server run build
PORT=3001 pnpm --filter @workspace/api-server run start

# UI (proxy /api to the API in vite config if needed)
pnpm --filter @workspace/orbit-copilot run dev
```

Production is a single Vercel project: static UI + `api/index.mjs` serverless Express.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres — chat, events, feedback |
| `REDIS_URL` or `KV_URL` | Upstash Redis (`rediss://…`) |
| `SOROSWAP_API_KEY` | Soroswap aggregator |
| `OPENROUTER_API_KEY` | Optional LLM |
| `ORBIT_PREDICT_CONTRACT_ID` | Predict contract |
| `ORBIT_PERPS_CONTRACT_ID` | Perps contract |

## Monitoring & analytics

| Endpoint / UI | Use |
|---|---|
| `GET /api/healthz` | Liveness + data-plane status |
| `GET /api/metrics` | Timings, counters, product stats |
| `GET /api/stats` | Unique wallets, events, feedback (JSON) |
| `GET /api/feedback/summary` | Plain-text feedback writeup |
| `/stats` | In-app analytics dashboard |
| Vercel Analytics | Page views |

Wallet interactions are recorded as `wallet_events` (`wallet_connect`, `chat_send`, `tx_sign`, `tx_submit`, …) for Level 4 proof.

## User onboarding

1. Open the live app  
2. Connect Freighter (Testnet)  
3. Use the checklist: **Fund** (Friendbot via chat) → **Ask Orbit**  
4. Leave feedback via the heart icon in the header  

## Level 4 submission notes

- **Live demo:** https://orbitpilot.vercel.app  
- **Analytics UI:** https://orbitpilot.vercel.app/stats  
- **Contracts:** see table above  
- **Feedback summary:** https://orbitpilot.vercel.app/api/feedback/summary  
- **Wallet proof:** `/api/stats` → `events.uniqueWallets` and `events.recent`  

Screenshots to capture: chat UI (desktop + mobile), `/stats` dashboard, Freighter connect/sign.

## Monorepo layout

```
artifacts/orbit-copilot/   React chat UI
artifacts/api-server/      Express API
api/                       Vercel serverless entry
lib/db/                    Drizzle schema (chat, product, …)
contracts/                 Soroban predict + perps
```

## License

MIT
