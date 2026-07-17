# Orbit Copilot

**Chat-only DeFi control plane on Stellar Testnet.**

One conversation for balances, swaps, LP, stake/farm, lend/borrow, prediction markets, perpetuals, and NFTs. Protocols are backends - not separate app screens. Users ask in natural language; Orbit builds the transaction; the wallet signs; **on-chain is the source of truth**.

| | |
|---|---|
| **Live app** | [https://orbitpilot.vercel.app](https://orbitpilot.vercel.app) |
| **Analytics** | [https://orbitpilot.vercel.app/stats](https://orbitpilot.vercel.app/stats) |
| **Health** | [https://orbitpilot.vercel.app/api/healthz](https://orbitpilot.vercel.app/api/healthz) |
| **Repo** | [https://github.com/rhapy01/orbitcopilot](https://github.com/rhapy01/orbitcopilot) |
| **CI / CD** | [![CI](https://github.com/rhapy01/orbitcopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/rhapy01/orbitcopilot/actions/workflows/ci.yml) [![CD](https://github.com/rhapy01/orbitcopilot/actions/workflows/cd.yml/badge.svg)](https://github.com/rhapy01/orbitcopilot/actions/workflows/cd.yml) · [All runs](https://github.com/rhapy01/orbitcopilot/actions) |
| **Network** | Stellar **Testnet** only (Mainnet Freighter is rejected) |

---

## Why this exists

Stellar DeFi today is fragmented: each protocol has its own UI, wallet flow, and mental model. Orbit collapses that into a single chat surface:

1. **Read** live balances / positions from Horizon + Soroban + protocol APIs 
2. **Plan** deterministic intents (or LLM for free-form questions) 
3. **Build** unsigned XDR / contract invocations 
4. **Sign** in Freighter or Orbit’s embedded passkey wallet 
5. **Confirm** outcomes from chain - never from a local balance sheet 

Postgres and Redis are **product infrastructure only** (chat history, sessions, analytics, rate limits, short TTL caches). They never store balances, LP shares, bets, margin, or NFT ownership as truth.

---

## Product capabilities

| Capability | What reviewers should try | How it works |
|---|---|---|
| **Portfolio intelligence** | `"show my portfolio"`, `"what's idle?"` | Horizon + protocol reads; earning vs idle; rebalance suggestions |
| **Classic DEX** | `"swap 10 XLM to USDC"` | Path payments via Horizon |
| **Unicorn StelDex** | `"swap on steldex…"`, LP / farm / orders | Quote + multi-step XDR submit |
| **Soroswap** | `"faucet USDC"`, aggregator swaps | API quotes + faucet when available |
| **Aquarius / Blend** | Pool quotes, lend/borrow when live | Protocol adapters + health checks |
| **Orbit Prediction Markets** | `"list sports markets"` → bet → claim | Soroban; XLM stakes **in** the contract |
| **Orbit Perpetuals** | `"open a 200 USDC long on bitcoin at 5x"` | Soroban; USDC margin **in** the contract |
| **Orbit NFT (SEP-50)** | create collection, mint with metadata, list / buy / transfer | Soroban SEP-50 + OpenSea-style JSON |
| **Token launch** | `"launch token FOOX supply 1000000"` | Classic asset + SEP-41 SAC |
| **Beta Tester NFT** | Submit feedback → `"claim my beta NFT"` | One mint per wallet after feedback |
| **Wallets** | Freighter **or** Orbit embedded (passkey + email recovery) | Client signs; server never holds user keys (embedded keys are KMS-wrapped) |
| **Chat + LLM** | Deterministic intents first; OpenRouter for free-form | Intents in `chat-intents.ts`; RAG knowledge for explanations |
| **Idle coach** | Connect wallet → coach reply in chat | Suggests next actions from portfolio intel |
| **Onboarding** | Checklist: Fund (Friendbot) → Ask Orbit | In-app checklist + feedback dialog |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Chat UI (Vite / React) - artifacts/orbit-copilot │
│ Freighter · Orbit embedded wallet (WebAuthn + recovery) │
└────────────────────────────┬────────────────────────────────┘
 │ HTTPS /api/*
 ▼
┌─────────────────────────────────────────────────────────────┐
│ Express API (Vercel serverless) - artifacts/api-server │
│ Chat intents · protocol adapters · auth · product events │
└───────┬──────────────────┬──────────────────┬───────────────┘
 │ │ │
 ▼ ▼ ▼
 Postgres (Neon) Redis (Upstash) Stellar Testnet
 chat, sessions, rate limits, Horizon · Soroban RPC
 auth, events, portfolio/price Predict · Perps · NFT
 feedback caches (TTL) StelDex · Blend · …
```

**Production deploy:** one Vercel project - static UI from `artifacts/orbit-copilot/dist/public` + `api/index.mjs` Express handler (60s / 1GB). See `vercel.json`.

---

## Tech stack

| Layer | Stack |
|---|---|
| UI | React, Vite, TypeScript |
| API | Express 5, TypeScript, esbuild |
| DB | Postgres + Drizzle (`lib/db`) |
| Cache | Redis / Upstash (`REDIS_URL` / `KV_URL`) |
| Chain | `@stellar/stellar-sdk`, Horizon, Soroban |
| Auth | WebAuthn (passkeys), email OTP (SMTP), KMS envelope crypto |
| LLM | OpenRouter (optional); deterministic intents always preferred |
| Contracts | Rust / Soroban (`contracts/orbit-predict`, `orbit-perps`, `orbit-nft`, `orbit-supply`) |
| Monorepo | pnpm workspaces |

---

## Judge / reviewer checklist (integration + CI/CD)

These paths address smart-contract integration and pipeline review:

| Criterion | Location |
|---|---|
| **Frontend Stellar SDK** | [`artifacts/orbit-copilot/src/lib/soroban.ts`](artifacts/orbit-copilot/src/lib/soroban.ts) (`@stellar/stellar-sdk`: network, `Contract`, invoke XDR) |
| **Contract method map** | [`artifacts/orbit-copilot/src/lib/contract.ts`](artifacts/orbit-copilot/src/lib/contract.ts) (Rust methods ↔ chat actions) |
| **API tx builder** | [`artifacts/api-server/src/lib/onchain.ts`](artifacts/api-server/src/lib/onchain.ts) (`buildContractInvoke`) |
| **Root discovery pointers** | [`soroban.js`](soroban.js), [`contract.js`](contract.js) |
| **Contract ↔ frontend cross-check** | [`contracts/INTEGRATION.md`](contracts/INTEGRATION.md) |
| **CI** (cargo fmt/clippy/build/test + pnpm install/build) | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) · [workflow runs](https://github.com/rhapy01/orbitcopilot/actions/workflows/ci.yml) |
| **CD** (production build gate + optional Vercel deploy) | [`.github/workflows/cd.yml`](.github/workflows/cd.yml), [`vercel.json`](vercel.json) · [workflow runs](https://github.com/rhapy01/orbitcopilot/actions/workflows/cd.yml) |

**Reviewer links**

- Actions hub: https://github.com/rhapy01/orbitcopilot/actions  
- Latest green **CI** (`9a6b061`): https://github.com/rhapy01/orbitcopilot/actions/runs/29407093355  
- Latest green **CD** (`9a6b061`): https://github.com/rhapy01/orbitcopilot/actions/runs/29407093149  
- **CI** workflow: https://github.com/rhapy01/orbitcopilot/actions/workflows/ci.yml  
- **CD** workflow: https://github.com/rhapy01/orbitcopilot/actions/workflows/cd.yml  

Wallet signing surface: `artifacts/orbit-copilot/src/components/transaction-action-card.tsx` + `use-freighter.tsx` / `use-wallet.tsx`.

---

## Deployed contracts (Testnet)

| Market | Contract ID | Explorer |
|---|---|---|
| **Prediction** | `CBSTVO2UCF2XVMHXFAKS5I2XMURT222MY5OWOXITW45B2AB6R7FHMTDC` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBSTVO2UCF2XVMHXFAKS5I2XMURT222MY5OWOXITW45B2AB6R7FHMTDC) |
| **Perpetuals** | `CC2IDBXQLA5L6NDWMGV3M6JH5NVK6NG26HMQCEYEHLJUJ7Q35KXADT3G` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CC2IDBXQLA5L6NDWMGV3M6JH5NVK6NG26HMQCEYEHLJUJ7Q35KXADT3G) |
| **NFT (SEP-50)** | `CA34E5V5SAV64PPMS7IKARAVUV3B423PLPCMNPJ6WALXP4Q3KS2C64HU` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CA34E5V5SAV64PPMS7IKARAVUV3B423PLPCMNPJ6WALXP4Q3KS2C64HU) |
| **NFT Factory** | `CB6PGYXVPCTJY5PILVFGFMI5WI5GCUI36GG6T7443YVJNV6EZ73FQJ55` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CB6PGYXVPCTJY5PILVFGFMI5WI5GCUI36GG6T7443YVJNV6EZ73FQJ55) |

| Token | Testnet SAC |
|---|---|
| Native XLM | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC (Aquarius) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Build / deploy / resolve instructions: [`contracts/README.md`](contracts/README.md).

**On-chain rule:** `place_bet`, `open_position`, and NFT `buy` pull tokens into contracts via SAC transfer. There is no off-chain balance sheet for markets, perps, or NFT settlement.

---

## Reviewer walkthrough (≈ 3 minutes)

Use this path for demos and Level 4 review:

1. Open **[https://orbitpilot.vercel.app](https://orbitpilot.vercel.app)** 
2. Connect **Freighter on Testnet** (or create an Orbit embedded wallet with a passkey) 
3. Complete checklist: **Fund** via Friendbot → **Ask Orbit** 
4. Try these prompts in order:

| Step | Chat prompt | Expected result |
|---|---|---|
| 1 | `list sports markets` | Chelsea-Arsenal (and related) fixtures + timeframes |
| 2 | `buy yes for Chelsea over Arsenal with 30 XLM` | Confirm market if asked → Freighter/Orbit sign card |
| 3 | `show my portfolio` | Live balances + idle / earning breakdown |
| 4 | `mint an NFT called Orbit Reviewer` | Sign mint → appears in holdings / gallery |
| 5 | Optional | `swap 200 XLM to pUSDC, cUSDC, EURC each` | Three sign cards (multi-action) |
| 6 | Optional | `faucet USDC` then open a small BTC perp | Requires USDC trustline/balance |

5. Leave feedback via the **heart** icon (unlocks Beta Tester NFT) 
6. Open **[/stats](https://orbitpilot.vercel.app/stats)** - unique wallets, events, feedback 
7. Optional proof APIs:
 - `GET /api/stats` → `events.uniqueWallets`, `level4.usersTargetMet`
 - `GET /api/feedback/summary` → plain-text feedback writeup (recent)
 - `GET /api/feedback/export?format=csv` → full feedback CSV (Blue Belt)
 - `GET /api/healthz` → liveness + data-plane status 
 - `GET /api/metrics` → timings / counters 

**Predict claims:** admin must resolve first (`node artifacts/api-server/scripts/resolve-predict.mjs chelsea-arsenal-epl yes`), then chat: `claim yes on chelsea-arsenal-epl`. See [`contracts/README.md`](contracts/README.md).

**Avoid in live demos unless pre-tested:** perps without USDC faucet; Soroswap-only pairs when the aggregator banner shows down; embedded-wallet signup if `WEBAUTHN_*` does not match the live domain.

---

## Example chat intents

Deterministic handlers (preferred over LLM). Full regex set: `artifacts/api-server/src/lib/chat-intents.ts`.

| Intent | Example |
|---|---|
| Predict bet | `buy yes for Chelsea over Arsenal with 30 XLM` |
| Predict claim | `claim yes on chelsea-arsenal-epl` |
| Perps open | `open a 200 USDC long on bitcoin at 5x` |
| Perps close | `close my BTC perp` |
| NFT collection | `create NFT collection Orbit Foxes symbol FOX` |
| NFT mint | `mint an NFT called Stellar Fox image https://… traits Background=Nebula` |
| Token launch | `launch token FOOX supply 1000000` |
| NFT list | `list NFT #1 for 5 XLM` |
| NFT buy | `buy NFT #1` |
| NFT transfer | `transfer NFT #1 to G…` |
| Beta NFT | `claim my beta NFT` |
| Faucet | `faucet USDC` |
| Multi-swap | `swap 200 XLM to pUSDC, cUSDC, EURC each` |
| Portfolio | `what's earning vs idle?` |

Free-form questions use OpenRouter + knowledge RAG when no intent matches.

---

## Wallets & auth

### Freighter
- Must be on **Testnet**. Mainnet accounts are rejected. 
- Signs transaction XDR / Soroban invocations in-extension.

### Orbit embedded wallet
- Passkey signup (WebAuthn) + optional email OTP recovery 
- Secret key material is **KMS envelope-encrypted** at rest (`KMS_SECRET`) 
- Server signs on behalf of the session after auth - user never pastes a secret key into chat 

### Security settings
- In-app **Settings** / security panel for recovery and session controls 

**Production WebAuthn:** `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` must match the deploy domain (e.g. `orbitpilot.vercel.app` / `https://orbitpilot.vercel.app`). Mismatch → passkey signup fails after the browser ceremony.

---

## Monorepo layout

```
artifacts/orbit-copilot/ React chat UI (Vite)
artifacts/api-server/ Express API + protocol libs + smoke scripts
api/ Vercel serverless entry (api/index.mjs)
lib/db/ Drizzle schemas (chat, product, auth, …)
lib/api-zod/ Generated / shared Zod API types
lib/api-spec/ OpenAPI-ish specs
lib/api-client-react/ Typed React API client
contracts/ Soroban: orbit-predict, orbit-perps, orbit-nft
scripts/ Workspace tooling
vercel.json Production build + rewrites
.env.example All required / optional env vars
```

### Notable API modules (`artifacts/api-server/src/lib/`)

| Module | Role |
|---|---|
| `chat-intents.ts` / `chat-tools.ts` | Intent routing + tool execution |
| `knowledge-corpus.ts` / `knowledge-rag.ts` | Explanation / RAG |
| `multi-action.ts` | Multi-step plans (e.g. multi-swap cards) |
| `portfolio-intel.ts` / `coach.ts` | Idle vs earning + coach replies |
| `predict.ts` / `perps.ts` / `nft.ts` | Soroban adapters |
| `steldex.ts` / `blend.ts` / `aquarius.ts` / `soroswap` routes | Protocol backends |
| `network-mode.ts` / `wallet-data.ts` | Network + live wallet reads |
| `internal-wallet.ts` / `crypto.ts` | Embedded wallet + KMS |

### Key HTTP surfaces (`/api/…`)

| Area | Examples |
|---|---|
| Health | `GET /healthz`, `GET /metrics` |
| Chat | `GET/POST /chat/sessions`, `GET/POST /chat/messages` |
| Wallet | `GET /wallet`, `POST /wallet/build-transaction`, `POST /wallet/submit-transaction` |
| Portfolio | `GET /portfolio/intel`, `/unified`, `/coach`, `/rebalance` |
| Predict / Perps / NFT | `/predict/*`, `/perps/*`, `/nft/*` |
| Protocols | `/steldex/*`, `/soroswap/*`, `/aquarius/*`, `/blend/*`, `/defi/*` |
| Auth | `/auth/passkey/*`, `/auth/send-otp`, `/auth/me`, recovery |
| Product | `POST /events`, `POST /feedback`, `GET /stats`, `GET /feedback/summary` |
| Friendbot | `POST /friendbot/fund` |

---

## Quick start (local)

### Prerequisites

- **Node.js 22+** and **pnpm 9** (`packageManager` is pinned in root `package.json`) 
- **Postgres** (Neon or local) and **Redis** (Upstash `rediss://…`) 
- **Freighter** on Testnet, or use Orbit embedded wallet (passkey) 
- Optional: Docker for local data plane; Rust + Stellar CLI for contracts 

### Setup

```bash
pnpm install
cp .env.example .env
# Fill at minimum:
# DATABASE_URL
# REDIS_URL (or KV_URL)
# SOROSWAP_API_KEY
# ORBIT_*_CONTRACT_ID (defaults in .env.example match deployed testnet)
# For embedded wallet locally:
# KMS_SECRET=$(openssl rand -hex 32)
# WEBAUTHN_RP_ID=localhost
# WEBAUTHN_ORIGIN=http://localhost:5173
# Optional: OPENROUTER_API_KEY, SMTP_* for email OTP
```

Push schema (when DB is ready):

```bash
pnpm db:push
# or: pnpm --filter @workspace/api-server run db:sync
```

Optional local Postgres/Redis:

```bash
pnpm data-plane:up # docker compose
pnpm data-plane:down
```

### Run

```bash
# Terminal 1 - API
pnpm --filter @workspace/api-server run build
# Windows PowerShell:
$env:PORT=3001; pnpm --filter @workspace/api-server run start
# macOS/Linux:
PORT=3001 pnpm --filter @workspace/api-server run start

# Terminal 2 - UI
pnpm --filter @workspace/orbit-copilot run dev
```

Open the Vite URL (typically `http://localhost:5173`). Ensure the UI proxies `/api` to the API (or set the API base URL used by the client).

### Smoke tests

```bash
pnpm --filter @workspace/api-server run test:smoke
# intents + knowledge + network mode (no live chain required)

pnpm --filter @workspace/api-server run test:smoke:live
# optional live checks against configured endpoints
```

### Ops scripts (testnet admin)

```bash
# Seed sports prediction markets (needs ORBIT_ADMIN_SECRET_KEY)
pnpm --filter @workspace/api-server run predict:seed-sports

# Resolve a market before users can claim
pnpm --filter @workspace/api-server run predict:resolve -- chelsea-arsenal-epl yes
```

Never commit `ORBIT_ADMIN_SECRET_KEY` or real `.env` files.

---

## Environment reference

Copy from [`.env.example`](.env.example). Summary:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres - chat, auth, events, feedback |
| `REDIS_URL` / `KV_URL` | Yes | Upstash Redis (`rediss://…`, not REST-only) |
| `SOROSWAP_API_KEY` | Yes (for aggregator) | Soroswap quotes / faucet |
| `OPENROUTER_API_KEY` | Optional | Free-form LLM replies |
| `LLM_MODEL` | Optional | Override default OpenRouter model |
| `ORBIT_PREDICT_CONTRACT_ID` | Yes | Predict market contract |
| `ORBIT_PERPS_CONTRACT_ID` | Yes | Perps contract |
| `ORBIT_NFT_CONTRACT_ID` | Yes | NFT contract |
| `STELLAR_NETWORK` | Recommended | `testnet` (Friendbot only on testnet) |
| `KMS_SECRET` | Yes on Vercel for embedded wallet | 64 hex chars - `openssl rand -hex 32` |
| `WEBAUTHN_RP_ID` | Yes for passkeys | Hostname only (`orbitpilot.vercel.app` or `localhost`) |
| `WEBAUTHN_ORIGIN` | Yes for passkeys | Full origin (`https://…` or `http://localhost:5173`) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Optional | Email OTP / recovery (Google App Password) |
| `ORBIT_ADMIN_SECRET_KEY` | Scripts only | Admin S… key for seed/resolve - **never commit** |
| `PORT` | Local | API port (default often 3001) |

---

## Monitoring & analytics (Level 4 proof)

| Endpoint / UI | Use |
|---|---|
| `GET /api/healthz` | Liveness + data-plane status |
| `GET /api/metrics` | Timings, counters, product stats |
| `GET /api/stats` | Unique wallets, events, feedback JSON |
| `GET /api/feedback/summary` | Plain-text feedback writeup |
| `/stats` | In-app analytics dashboard |
| Vercel Analytics | Page views |

Wallet interactions are recorded as `wallet_events` (`wallet_connect`, `chat_send`, `tx_sign`, `tx_submit`, …) for submission proof.

---

## Level 4 (Greenbelt) submission checklist

- [ ] **Live demo:** https://orbitpilot.vercel.app (redeployed with latest contracts/env) 
- [ ] **Analytics UI:** https://orbitpilot.vercel.app/stats 
- [ ] **Wallet proof:** `/api/stats` → `events.uniqueWallets` ≥ 10 and `level4.usersTargetMet: true` 
- [ ] **Feedback:** heart icon → ≥ 5 ratings; `/api/feedback/summary` for writeup 
- [ ] **Contracts:** Predict + Perps + NFT IDs in the table above (with explorer links) 
- [ ] **Screenshots:** chat (desktop + mobile), Freighter/Orbit sign, `/stats`, Stellar Expert tx 
- [ ] **Smoke:** `pnpm --filter @workspace/api-server run test:smoke` 
- [ ] **Repo:** https://github.com/rhapy01/orbitcopilot - README + `contracts/README.md` 

---

## Design principles (for reviewers)

1. **Chat is the UI** - protocols are adapters, not tabs of separate products. 
2. **On-chain is authority** - DB/Redis never invent balances or positions. 
3. **Deterministic first** - regex intents for money moves; LLM for explanation. 
4. **User signs everything** - Freighter or authenticated embedded wallet. 
5. **Testnet-safe defaults** - Friendbot, faucets, Mainnet Freighter rejected. 
6. **Observability built-in** - health, metrics, wallet events, feedback, `/stats`. 

---

## License

MIT
