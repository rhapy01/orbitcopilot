# Orbit Copilot - Smart Contract Integration Map

This document is the cross-check between **Soroban contracts** (`contracts/*/src/lib.rs`)
and **TypeScript callers** (API + frontend).

## Architecture

1. **Contracts** - Rust Soroban crates under `contracts/`
2. **API tx builder** - `@stellar/stellar-sdk` in `artifacts/api-server/src/lib/onchain.ts`
   (`buildContractInvoke`) plus domain modules (`orbit-supply.ts`, `predict.ts`, `perps.ts`, `nft.ts`, `blend.ts`)
3. **Frontend** - `@stellar/stellar-sdk` in:
   - `artifacts/orbit-copilot/src/lib/soroban.ts` (network, Contract, invoke XDR helpers)
   - `artifacts/orbit-copilot/src/lib/contract.ts` (method registry + action mapping)
4. **Wallet** - Freighter / Orbit wallet signs the XDR (`use-wallet.tsx`, `transaction-action-card.tsx`)
5. **CD** - `vercel.json` + `.github/workflows/cd.yml` (build gate + optional Vercel deploy)
6. **CI** - `.github/workflows/ci.yml` (cargo fmt/clippy/test/wasm + pnpm build)

## Contract function -> TypeScript

| Contract | Rust method | TS / chat action | Primary TS file |
|---|---|---|---|
| orbit-predict | `place_bet` | `predict_bet` | `api-server/src/lib/predict.ts` |
| orbit-predict | `claim` | `predict_claim` | `api-server/src/lib/predict.ts` |
| orbit-perps | `open_position` | `perp_open` | `api-server/src/lib/perps.ts` |
| orbit-perps | `close_position` | `perp_close` | `api-server/src/lib/perps.ts` |
| orbit-nft (SEP-50) | `mint` | `nft_mint` | `api-server/src/lib/nft.ts` |
| orbit-nft | `buy` / `list_for_sale` / `cancel_listing` | `nft_buy` / `nft_list` / `nft_cancel` | `api-server/src/lib/nft.ts` |
| orbit-nft | `name` / `symbol` / `token_uri` / `approve`… | SEP-50 reads | Freighter / wallets |
| orbit-nft-factory | `create_collection` | `nft_create_collection` | `api-server/src/lib/nft.ts` |
| classic + SAC | `createStellarAssetContract` / `mint` | `token_deploy` / `token_mint` | `api-server/src/lib/token-launch.ts` |
| orbit-supply | `supply` | `orbit_supply_deposit` | `api-server/src/lib/orbit-supply.ts` + `orbit-copilot/src/lib/contract.ts` |
| orbit-supply | `withdraw` | `orbit_supply_withdraw` | same |
| orbit-supply | `claim` | `orbit_supply_claim` | same |
| orbit-blend-swap | `swap_to_blend` | blend USDC swap path | `api-server/src/lib/blend.ts` |
| Blend (external) | pool `submit` / `claim` | `blend_supply` … `blend_claim` | `api-server/src/lib/blend.ts` |

Frontend method registry (must stay aligned with Rust):
`artifacts/orbit-copilot/src/lib/contract.ts` -> `ORBIT_CONTRACT_METHODS`.

## Deployed testnet (Orbit Supply)

`CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV`

## Local verify

```bash
# Contracts
cd contracts/orbit-supply && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo build --release --target wasm32v1-none

# App (same as Vercel)
pnpm install --ignore-scripts
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/orbit-copilot run build
```
