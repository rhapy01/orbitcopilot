# Orbit Copilot

**Chat-only DeFi control plane on Stellar Testnet.** One conversation for balances, LP, stake/farm, lend/borrow, prediction markets, perps, and NFTs — protocols are backends, not separate app screens. **On-chain is authority**; Postgres and Redis are product infrastructure only (chat, analytics, rate limits, short caches).

**Live demo:** [https://orbitpilot.vercel.app](https://orbitpilot.vercel.app)

## Product

| Capability | How |
|---|---|
| Portfolio intelligence | Live Horizon / protocol reads — earning vs idle, rebalance suggestions |
| Classic DEX | Path payments via Horizon |
| Unicorn StelDex | Swap, LP, farm, orders |
| Soroswap / Aquarius / Blend | Quotes and write paths when available on testnet |
| Orbit Prediction Markets | Soroban — XLM stakes on-chain; claim after resolve |
| Orbit Perpetuals | Soroban — USDC margin on-chain |
| Orbit NFT | Soroban — mint, list, buy, transfer (XLM settlement) |
| Wallets | Freighter **or** Orbit embedded wallet (passkey + recovery) |
| Chat + LLM | Deterministic intents + OpenRouter for free-form |

## Architecture

```
Chat UI (Vite/React)
    │
    ▼
API (Express on Vercel)
    ├── Postgres (Neon)     chat, sessions, wallet_events, feedback, auth
    ├── Redis (Upstash KV)  rate limits, portfolio/price caches (TTL)
    └── Chain               Horizon, Soroban RPC, protocol APIs
            ▲
            │ Freighter or Orbit embedded wallet signs XDR
```

**Never stored as truth:** balances, LP shares, bets, margin, NFT ownership. Those are always read from Stellar.

## Deployed contracts (Testnet)

| Market | Contract ID |
|---|---|
| Prediction | `CBSTVO2UCF2XVMHXFAKS5I2XMURT222MY5OWOXITW45B2AB6R7FHMTDC` |
| Perpetuals | `CC2IDBXQLA5L6NDWMGV3M6JH5NVK6NG26HMQCEYEHLJUJ7Q35KXADT3G` |
| NFT | `CAG4ST6W7I5QYW5SFC4I7YRN32AHD4UH5WTYHJWHHJM6VPTNF3ETSETM` |

Build/deploy notes: [`contracts/README.md`](contracts/README.md)

## Quick start (local)

### Prerequisites

- Node 22+, pnpm 9
- Neon (or local Postgres) + Upstash Redis (`REDIS_URL` / `KV_URL`)
- Freighter on **Testnet**, or use Orbit embedded wallet (passkey)

### Setup

```bash
pnpm install
cp .env.example .env
# Fill DATABASE_URL, REDIS_URL (or KV_URL), SOROSWAP_API_KEY, OPENROUTER_API_KEY,
# contract IDs, KMS_SECRET (embedded wallet), SMTP_* (email OTP)
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
| `DATABASE_URL` | Postgres — chat, events, feedback, auth |
| `REDIS_URL` or `KV_URL` | Upstash Redis (`rediss://…`) |
| `SOROSWAP_API_KEY` | Soroswap aggregator |
| `OPENROUTER_API_KEY` | Optional LLM |
| `ORBIT_PREDICT_CONTRACT_ID` | Predict contract |
| `ORBIT_PERPS_CONTRACT_ID` | Perps contract |
| `ORBIT_NFT_CONTRACT_ID` | NFT marketplace contract |
| `KMS_SECRET` | Envelope encryption for embedded wallet (64 hex chars) |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | Passkeys (must match deploy domain) |
| `SMTP_*` | Google SMTP for email OTP / recovery |

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
2. Connect **Freighter (Testnet)** or create an **Orbit embedded wallet** (passkey)  
3. Checklist: **Fund** (Friendbot) → **Ask Orbit**  
4. Leave feedback via the heart icon — unlocks an **Orbit Beta Tester** NFT (one per wallet)  
5. Claim in the dialog, or chat: "claim my beta NFT"  

### Reliable demo script (3 minutes)

1. Connect Freighter on **Testnet** (Orbit rejects Mainnet Freighter)  
2. Fund via checklist (Friendbot)  
3. `"list sports markets"` → see Chelsea–Arsenal fixtures + timeframes  
4. `"buy yes for Chelsea over Arsenal with 30 XLM"` → pick `1` if asked → sign  
5. Optional: `"swap 200 XLM to pUSDC, cUSDC, EURC each"` → three sign cards  
6. Open `/stats` and show unique wallets + recent txs  

**Seed sports markets (once per contract):** `node artifacts/api-server/scripts/seed-predict-sports.mjs` (needs `ORBIT_ADMIN_SECRET_KEY`).

**Predict claims:** admin must resolve first — `node artifacts/api-server/scripts/resolve-predict.mjs chelsea-arsenal-epl yes` (see `contracts/README.md`), then `"claim yes on chelsea-arsenal-epl"`.

**Avoid in live demos unless pre-tested:** perps without USDC faucet, Soroswap-only pairs when the banner shows aggregator down, embedded-wallet signup on a domain with mismatched WebAuthn env.

## Level 4 (Greenbelt) submission checklist

- [ ] **Live demo:** https://orbitpilot.vercel.app (redeployed with latest contracts/env)  
- [ ] **Analytics UI:** https://orbitpilot.vercel.app/stats  
- [ ] **Wallet proof:** `/api/stats` → `events.uniqueWallets` ≥ 10 and `level4.usersTargetMet: true`  
- [ ] **Feedback:** heart icon → ≥ 5 ratings; `/api/feedback/summary` for writeup  
- [ ] **Contracts:** table above (Predict + Perps + NFT)  
- [ ] **Screenshots:** chat (desktop + mobile), Freighter/Orbit sign, `/stats`, explorer tx  
- [ ] **Smoke:** `pnpm --filter @workspace/api-server run test:smoke`  

## Monorepo layout

```
artifacts/orbit-copilot/   React chat UI
artifacts/api-server/      Express API
api/                       Vercel serverless entry
lib/db/                    Drizzle schema (chat, product, auth, …)
contracts/                 Soroban predict + perps + nft
```

## License

MIT
