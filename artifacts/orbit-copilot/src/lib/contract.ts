/**
 * Contract registry: Rust contract functions <-> frontend / API call sites.
 *
 * Cross-check table for Orbit-native Soroban contracts.
 * Runtime XDR is built in API `onchain.ts` / domain libs; this file is the
 * typed method map the UI uses for titles, validation, and optional local builds.
 */
import {
  STELLAR_NETWORK_PASSPHRASE,
  buildContractInvokeXdr,
  scAddress,
  scI128,
  scString,
  scU32,
} from "./soroban";

/** Deployed testnet IDs (override via Vite env when re-deploying). */
export const ORBIT_CONTRACT_IDS = {
  predict:
    import.meta.env.VITE_ORBIT_PREDICT_CONTRACT_ID?.trim() ||
    "CBSTVO2UCF2XVMHXFAKS5I2XMURT222MY5OWOXITW45B2AB6R7FHMTDC",
  perps:
    import.meta.env.VITE_ORBIT_PERPS_CONTRACT_ID?.trim() ||
    "CC2IDBXQLA5L6NDWMGV3M6JH5NVK6NG26HMQCEYEHLJUJ7Q35KXADT3G",
  nft:
    import.meta.env.VITE_ORBIT_NFT_CONTRACT_ID?.trim() ||
    "CDABPHCZSEMMW7V5AWCJMFXXNP4OVYPLSZIYHW436YLXSADQH2CR5MMS",
  supply:
    import.meta.env.VITE_ORBIT_SUPPLY_CONTRACT_ID?.trim() ||
    "CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV",
} as const;

/**
 * Methods exported by each Rust contractimpl - keep in sync with
 * contracts/<crate>/src/lib.rs
 */
export const ORBIT_CONTRACT_METHODS = {
  "orbit-predict": [
    "initialize",
    "create_market",
    "place_bet",
    "resolve_market",
    "claim",
    "get_market",
    "market_count",
    "get_position",
    "user_markets",
  ],
  "orbit-perps": [
    "initialize",
    "set_market",
    "set_mark_price",
    "open_position",
    "close_position",
    "get_market",
    "get_position",
    "user_positions",
    "position_count",
  ],
  "orbit-nft": [
    "initialize",
    "name",
    "symbol",
    "token_uri",
    "contract_uri",
    "balance",
    "owner_of",
    "transfer",
    "transfer_from",
    "approve",
    "approve_for_all",
    "get_approved",
    "is_approved_for_all",
    "mint",
    "list_for_sale",
    "cancel_listing",
    "buy",
    "get_listing",
    "tokens_of",
    "total_supply",
    "max_supply",
    "admin",
    "configure_marketplace_fees",
    "set_royalty",
    "sale_fees",
  ],
  "orbit-nft-factory": [
    "initialize",
    "set_wasm_hash",
    "set_platform_fee",
    "create_collection",
    "collections_of",
    "all_collections",
    "collection_count",
    "platform_fee_bps",
    "platform_fee_receiver",
  ],
  "orbit-supply": [
    "initialize",
    "allow_token",
    "disable_token",
    "deposit_reward",
    "supply",
    "withdraw",
    "claim",
    "pending_reward",
    "get_stake",
    "get_last_claim",
    "get_total",
    "reward_balance",
    "get_admin",
    "get_reward_token",
    "allowed_tokens",
    "stakes_for",
  ],
  "orbit-blend-swap": [
    "initialize",
    "fund_blend",
    "admin_withdraw",
    "swap_to_blend",
    "swap_to_circle",
    "blend_inventory",
    "circle_inventory",
  ],
} as const;

/** Chat action type -> contract + method (for cross-check / UI). */
export const ACTION_TO_CONTRACT: Record<
  string,
  { crate: keyof typeof ORBIT_CONTRACT_METHODS; method: string; idKey?: keyof typeof ORBIT_CONTRACT_IDS }
> = {
  predict_bet: { crate: "orbit-predict", method: "place_bet", idKey: "predict" },
  predict_claim: { crate: "orbit-predict", method: "claim", idKey: "predict" },
  perp_open: { crate: "orbit-perps", method: "open_position", idKey: "perps" },
  perp_close: { crate: "orbit-perps", method: "close_position", idKey: "perps" },
  nft_mint: { crate: "orbit-nft", method: "mint", idKey: "nft" },
  nft_buy: { crate: "orbit-nft", method: "buy", idKey: "nft" },
  nft_list: { crate: "orbit-nft", method: "list_for_sale", idKey: "nft" },
  nft_transfer: { crate: "orbit-nft", method: "transfer", idKey: "nft" },
  nft_cancel: { crate: "orbit-nft", method: "cancel_listing", idKey: "nft" },
  nft_create_collection: {
    crate: "orbit-nft-factory",
    method: "create_collection",
  },
  orbit_supply_deposit: { crate: "orbit-supply", method: "supply", idKey: "supply" },
  orbit_supply_withdraw: { crate: "orbit-supply", method: "withdraw", idKey: "supply" },
  orbit_supply_claim: { crate: "orbit-supply", method: "claim", idKey: "supply" },
};

export function assertContractMethod(
  crate: keyof typeof ORBIT_CONTRACT_METHODS,
  method: string
): void {
  const methods = ORBIT_CONTRACT_METHODS[crate] as readonly string[];
  if (!methods.includes(method)) {
    throw new Error(`Unknown method ${method} on ${crate}`);
  }
}

export function resolveActionContract(actionType: string): {
  contractId: string;
  method: string;
  crate: string;
} | null {
  const mapped = ACTION_TO_CONTRACT[actionType];
  if (!mapped?.idKey) return null;
  assertContractMethod(mapped.crate, mapped.method);
  return {
    contractId: ORBIT_CONTRACT_IDS[mapped.idKey],
    method: mapped.method,
    crate: mapped.crate,
  };
}

/** Example client-side build: Orbit Supply claim (usually built by API). */
export async function buildOrbitSupplyClaimXdr(input: {
  walletAddress: string;
  contractId?: string;
}) {
  assertContractMethod("orbit-supply", "claim");
  return buildContractInvokeXdr({
    sourcePublicKey: input.walletAddress,
    contractId: input.contractId ?? ORBIT_CONTRACT_IDS.supply,
    method: "claim",
    args: [scAddress(input.walletAddress)],
  });
}

export async function buildOrbitSupplyDepositXdr(input: {
  walletAddress: string;
  tokenContract: string;
  amountRaw: string;
  contractId?: string;
}) {
  assertContractMethod("orbit-supply", "supply");
  return buildContractInvokeXdr({
    sourcePublicKey: input.walletAddress,
    contractId: input.contractId ?? ORBIT_CONTRACT_IDS.supply,
    method: "supply",
    args: [
      scAddress(input.walletAddress),
      scAddress(input.tokenContract),
      scI128(input.amountRaw),
    ],
  });
}

export {
  STELLAR_NETWORK_PASSPHRASE,
  scAddress,
  scI128,
  scString,
  scU32,
};
