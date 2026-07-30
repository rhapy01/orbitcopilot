export interface ChatAction {
  type:
    | "send"
    | "swap"
    | "soroswap_swap"
    | "soroswap_add_liquidity"
    | "soroswap_remove_liquidity"
    | "steldex_swap"
    | "steldex_stake"
    | "steldex_claim"
    | "steldex_unstake"
    | "steldex_add_liquidity"
    | "steldex_remove_liquidity"
    | "steldex_limit_order"
    | "steldex_cancel_order"
    | "blend_supply"
    | "blend_withdraw"
    | "blend_borrow"
    | "blend_repay"
    | "blend_claim"
    | "blend_usdc_swap"
    | "predict_bet"
    | "predict_claim"
    | "perp_open"
    | "perp_close"
    | "nft_mint"
    | "nft_list"
    | "nft_buy"
    | "nft_transfer"
    | "nft_cancel"
    | "nft_create_collection"
    | "nft_set_mint_stages"
    | "nft_set_mint_prices"
    | "nft_allowlist"
    | "nft_media_pack"
    | "token_deploy"
    | "token_mint"
    | "orbit_supply_deposit"
    | "orbit_supply_withdraw"
    | "orbit_supply_claim"
    | "defindex_deposit"
    | "defindex_withdraw"
    | "meridian_deposit"
    | "meridian_withdraw"
    | "cctp_bridge"
    | "cctp_bridge_in"
    | "aquarius_swap"
    | "connect_wallet"
    | "add_trustline";
  requestType?: number;
  sendAmount?: string;
  sendAsset?: string;
  destination?: string;
  destAsset?: string;
  poolContract?: string;
  pair?: string;
  amountB?: string;
  token0Contract?: string;
  token1Contract?: string;
  fromTokenContract?: string;
  toTokenContract?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  lockWeeks?: number;
  limitPrice?: string;
  orderType?: string;
  orderId?: string;
  amount0Min?: string;
  amount1Min?: string;
  /** Human-readable estimated receive (from quote). */
  estimatedDestAmount?: string;
  positionId?: number;
  marketHint?: string;
  outcome?: string;
  side?: string;
  leverage?: number;
  marginUsdc?: string;
  stopLoss?: number;
  takeProfit?: number;
  entryPrice?: number;
  liquidationPrice?: number;
  notionalUsdc?: number;
  tokenId?: number;
  metadataUri?: string;
  tokenName?: string;
  description?: string;
  imageUrl?: string;
  website?: string;
  /** Local file as base64 data URL (preferred over imageUrl when set). */
  imageDataUrl?: string;
  animationDataUrl?: string;
  bannerImageDataUrl?: string;
  maxSupply?: number;
  royaltyBps?: number;
  publicMintPriceXlm?: string;
  allowlistMintPriceXlm?: string;
  maxMintPerWallet?: number;
  allowlistActive?: boolean;
  publicMintActive?: boolean;
  /** User explicitly set max supply (including 0 = unlimited). */
  supplySpecified?: boolean;
  mediaPackId?: string;
  collectionContract?: string;
  /** When true, mint next asset from media pack. */
  useMediaPack?: boolean;
  priceXlm?: string;
  markPriceStale?: boolean;
  xdr?: string;
  networkPassphrase?: string;
  /** For add_trustline / CCTP approve: next action after this step */
  pendingAction?: ChatAction;
  /** CCTP out: approve then burn; CCTP in: evm_approve → evm_burn → mint_and_forward */
  cctpStep?: "approve" | "burn" | "evm_approve" | "evm_burn" | "mint_and_forward";
  /** Bridge-in source chain (arc/base/…) */
  sourceChain?: string;
  chainId?: number;
  /** Prepared EVM calldata for bridge-in */
  evmTx?: { to: string; data: string; value: string; chainId: number };
  /** Iris payload for mint_and_forward */
  irisMessage?: string;
  irisAttestation?: string;
}

export type CompletedOutcome = {
  hash: string | null;
  summary: string;
};
