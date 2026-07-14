# Orbit on-chain markets (Soroban)

Prediction markets, perpetuals, and NFTs are **fully on-chain**. Stakes, margin, and NFT settlement use Soroban contracts; the user signs contract invocations. There is no off-chain balance sheet.

## Contracts

| Crate | Purpose |
|---|---|
| `orbit-predict` | Binary yes/no markets; `place_bet` pulls XLM SAC into the contract; `claim` pays winners |
| `orbit-perps` | Perps; `open_position` pulls USDC SAC margin; `close_position` returns margin+PnL |
| `orbit-nft` | Mintable NFTs; `list_for_sale` / `buy` settle in native XLM SAC |

## Prerequisites

- [Rust](https://rustup.rs/) (`rustup default stable`)
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli)
- Funded testnet identity: `stellar keys generate orbit-admin --network testnet --fund`

## Build

```bash
cd contracts/orbit-predict
stellar contract build

cd ../orbit-perps
stellar contract build

cd ../orbit-nft
stellar contract build
```

WASM outputs under `target/wasm32-unknown-unknown/release/`.

## Deploy (testnet)

Native XLM SAC (testnet): `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`  
USDC SAC (testnet, Aquarius): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`

### Predict

```bash
PREDICT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/orbit_predict.wasm \
  --source orbit-admin --network testnet)

stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  initialize --admin $(stellar keys address orbit-admin) \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Seed markets (IDs 0..3 must match artifacts/api-server/src/lib/predict.ts)
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will Brazil win their next major tournament match?" --slug "brazil-wins"
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will Bitcoin trade above $100,000 USD this month?" --slug "btc-100k"
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will XLM finish the week higher than it started?" --slug "xlm-up-week"
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will ETH outperform BTC over the next 7 days?" --slug "eth-flip"

# Append sports fixtures (IDs 4+) — or use the JS helper:
#   node artifacts/api-server/scripts/seed-predict-sports.mjs
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will Chelsea beat Arsenal in the Premier League?" --slug "chelsea-arsenal-epl"
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will Chelsea beat Arsenal in the FA Cup?" --slug "chelsea-arsenal-fa-cup"
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  create_market --question "Will Liverpool beat Manchester City in the Premier League?" --slug "liverpool-city-epl"
```

### Perps

```bash
PERPS_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/orbit_perps.wasm \
  --source orbit-admin --network testnet)

stellar contract invoke --id $PERPS_ID --source orbit-admin --network testnet -- \
  initialize --admin $(stellar keys address orbit-admin) \
  --margin_token CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

# Prices use 1e7 scale (e.g. $95,000 → 950000000000)
stellar contract invoke --id $PERPS_ID --source orbit-admin --network testnet -- \
  set_market --symbol BTC --max_leverage 10 --mark_price_e7 950000000000
stellar contract invoke --id $PERPS_ID --source orbit-admin --network testnet -- \
  set_market --symbol ETH --max_leverage 10 --mark_price_e7 35000000000
stellar contract invoke --id $PERPS_ID --source orbit-admin --network testnet -- \
  set_market --symbol XLM --max_leverage 5 --mark_price_e7 1200000
```

Keep mark prices fresh (oracle/keeper):

```bash
stellar contract invoke --id $PERPS_ID --source orbit-admin --network testnet -- \
  set_mark_price --symbol BTC --mark_price_e7 <price_e7>
```

### NFT

```bash
cd contracts/orbit-nft
stellar contract build

NFT_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/orbit_nft.wasm \
  --source orbit-admin --network testnet)

stellar contract invoke --id $NFT_ID --source orbit-admin --network testnet -- \
  initialize --admin $(stellar keys address orbit-admin) \
  --payment_token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

Chat flows: `mint an NFT called Stellar Fox`, `list NFT #1 for 5 XLM`, `buy NFT #1`, `transfer NFT #1 to G…`.

## Resolve prediction markets (required before claims)

Markets stay `Open` until the **admin** calls `resolve_market`. Without this step, `"claim yes on …"` will fail on-chain.

### Stellar CLI

```bash
# market_id: brazil-wins=0, btc-100k=1, xlm-up-week=2, eth-flip=3
# outcome: Yes | No
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
  resolve_market --market_id 0 --outcome Yes
```

### Node script (from repo root)

```bash
# .env must include ORBIT_PREDICT_CONTRACT_ID and ORBIT_ADMIN_SECRET_KEY (admin S… key)
node artifacts/api-server/scripts/resolve-predict.mjs brazil-wins yes
node artifacts/api-server/scripts/resolve-predict.mjs btc-100k no
```

Then in chat: `claim yes on brazil-wins`.

## App env

```env
ORBIT_PREDICT_CONTRACT_ID=C...
ORBIT_PERPS_CONTRACT_ID=C...
ORBIT_NFT_CONTRACT_ID=C...
# Optional — only for resolve-predict.mjs (never commit)
ORBIT_ADMIN_SECRET_KEY=S...
```

Restart the API server. Chat flows (`invest 2 XLM on Brazil to win`, `open a 200 USDC long on bitcoin at 5x`, `mint an NFT called Orbit One`) build **contract invocations**; the connected wallet signs; tokens move **into the contracts**.

## User token approvals

`place_bet` / `open_position` / NFT `buy` pull tokens via SAC `transfer` from the user. The user must have a trustline/balance for USDC SAC when opening perps — in chat ask **`faucet USDC`** (Soroswap faucet) first. XLM uses the native SAC above.
