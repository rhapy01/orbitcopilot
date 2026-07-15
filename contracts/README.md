# Orbit Copilot contracts (Stellar Testnet)

Deploy with the `orbit-admin` Freighter/CLI key. Set contract IDs in the API `.env` and restart.

## Prerequisites

```bash
stellar keys add orbit-admin --secret-key # or use existing
stellar keys fund $(stellar keys address orbit-admin) --network testnet
```

### Orbit Predict

```bash
cd contracts/orbit-predict && stellar contract build
PREDICT_ID=$(stellar contract deploy \
 --wasm target/wasm32v1-none/release/orbit_predict.wasm \
 --source orbit-admin --network testnet)
# initialize + create markets as needed
```

### Orbit Perps

```bash
cd contracts/orbit-perps && stellar contract build
PERPS_ID=$(stellar contract deploy \
 --wasm target/wasm32v1-none/release/orbit_perps.wasm \
 --source orbit-admin --network testnet)
```

### Orbit NFT

```bash
cd contracts/orbit-nft && stellar contract build
NFT_ID=$(stellar contract deploy \
 --wasm target/wasm32v1-none/release/orbit_nft.wasm \
 --source orbit-admin --network testnet)
```

### Orbit Supply (yield) - deployed testnet

**Contract ID (reward XLM treasury):** `CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV`

Fund more rewards (stroops; 1000 XLM = `10000000000`):

```bash
SUPPLY_ID=CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV

# Preferred: deposit_reward pulls XLM SAC from admin into the contract
stellar contract invoke --id $SUPPLY_ID --source orbit-admin --network testnet -- \
  deposit_reward --from $(stellar keys address orbit-admin) --amount 10000000000

# Or transfer native XLM SAC directly to $SUPPLY_ID (same treasury)
```

Env:

```env
ORBIT_SUPPLY_CONTRACT_ID=CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV
```

Allowed deposits: Circle USDC, pUSDC, EURC. Rate: 10 XLM / 1M / 24h.

Chat: `supply 100 USDC on orbit-supply` · `claim my yield`

Rebuild / redeploy (if you change the contract):

```bash
cd contracts/orbit-supply && stellar contract build

SUPPLY_ID=$(stellar contract deploy \
 --wasm target/wasm32v1-none/release/orbit_supply.wasm \
 --source orbit-admin --network testnet)

# Reward token = native XLM SAC
stellar contract invoke --id $SUPPLY_ID --source orbit-admin --network testnet -- \
 initialize --admin $(stellar keys address orbit-admin) \
 --reward_token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Allow Circle USDC (7 decimals)
stellar contract invoke --id $SUPPLY_ID --source orbit-admin --network testnet -- \
 allow_token --token CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA --decimals 7

# Allow pUSDC (6 decimals) and EURC (7) - use live StelDex SAC addresses
# stellar contract invoke --id $SUPPLY_ID --source orbit-admin --network testnet -- \
# allow_token --token <PUSDC_SAC> --decimals 6
# stellar contract invoke --id $SUPPLY_ID --source orbit-admin --network testnet -- \
# allow_token --token <EURC_SAC> --decimals 7

# Fund reward treasury (1000 XLM = 10000000000 stroops)
stellar contract invoke --id $SUPPLY_ID --source orbit-admin --network testnet -- \
 deposit_reward --from $(stellar keys address orbit-admin) --amount 10000000000
```

**Yield math:** `10 XLM * (stake_human / 1_000_000)` per full 24h period, summed across deposits. Example: 100,000 USDC -> 1 XLM/day.

Chat:

- `supply 100 USDC on orbit-supply`
- `supply 50 pUSDC on orbit-supply`
- `withdraw 20 EURC from orbit-supply`
- `claim my yield`
- `orbit supply` (status)

### Orbit Blend Swap (optional / legacy)

Live Blend pool `CAPBMXIQ...` already accepts Circle USDC as collateral, so this bridge is usually not needed. Keep for older mock-USDC pools only.

```bash
cd contracts/orbit-blend-swap && stellar contract build

SWAP_ID=$(stellar contract deploy \
 --wasm target/wasm32v1-none/release/orbit_blend_swap.wasm \
 --source orbit-admin --network testnet)

stellar contract invoke --id $SWAP_ID --source orbit-admin --network testnet -- \
 initialize \
 --admin $(stellar keys address orbit-admin) \
 --circle_usdc CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
 --blend_usdc CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU

# Fund bridge with Blend USDC (get some from https://testnet.blend.capital faucet first)
stellar contract invoke --id $SWAP_ID --source orbit-admin --network testnet -- \
 fund_blend --from $(stellar keys address orbit-admin) --amount 1000000000000
```

Chat: `swap 100 USDC to Blend USDC` · `convert 100 USDC and supply on Blend`

## Resolve prediction markets

```bash
stellar contract invoke --id $PREDICT_ID --source orbit-admin --network testnet -- \
 resolve_market --market_id 0 --outcome Yes
```

## App env

```env
ORBIT_PREDICT_CONTRACT_ID=C...
ORBIT_PERPS_CONTRACT_ID=C...
ORBIT_NFT_CONTRACT_ID=C...
ORBIT_SUPPLY_CONTRACT_ID=CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV
# ORBIT_BLEND_SWAP_CONTRACT_ID=C...  # optional
```

Restart the API after setting env. Users sign Freighter/Orbit wallet txs; tokens move into the contracts.
