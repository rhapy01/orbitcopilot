import {
  BlendRequestType,
  resolveBlendReserve,
} from "./blend";
import {
  resolveSoroswapToken,
  isSoroswapPair,
  soroswapConfigured,
} from "./soroswap";
import {
  resolveSteldexPool,
  resolveSteldexToken,
  normalizeSteldexSymbol,
  STELDEX_FULL_RANGE,
} from "./steldex";
import { wrapActionWithTrustlineIfNeeded } from "./stellar";

export type EnrichedAction = {
  type: string;
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
  xdr?: string;
  networkPassphrase?: string;
  pendingAction?: EnrichedAction;
};

/** Fill contracts / pool fields so the UI can execute LLM-proposed actions. */
export async function enrichChatAction(
  raw: Record<string, unknown> | null | undefined,
  opts?: { publicKey?: string | null }
): Promise<EnrichedAction | null> {
  if (!raw || typeof raw.type !== "string") return null;

  const type = raw.type;
  const sendAmount = raw.sendAmount != null ? String(raw.sendAmount) : undefined;
  const sendAsset = raw.sendAsset != null ? String(raw.sendAsset).toUpperCase() : undefined;
  const destAsset = raw.destAsset != null ? String(raw.destAsset).toUpperCase() : undefined;
  const destination = raw.destination != null ? String(raw.destination) : undefined;
  const amountB = raw.amountB != null ? String(raw.amountB) : undefined;
  const liquidity = raw.liquidity != null ? String(raw.liquidity) : undefined;
  const pair = raw.pair != null ? String(raw.pair) : undefined;

  if (type.startsWith("blend_")) {
    if (!sendAmount || !sendAsset) return null;
    const reserve = await resolveBlendReserve(sendAsset);
    if (!reserve) return null;
    const requestType =
      type === "blend_withdraw"
        ? BlendRequestType.Withdraw
        : type === "blend_borrow"
          ? BlendRequestType.Borrow
          : type === "blend_repay"
            ? BlendRequestType.Repay
            : BlendRequestType.Supply;
    return {
      type,
      requestType,
      sendAmount,
      sendAsset: reserve.symbol,
      poolContract: reserve.poolContract,
      token0Contract: reserve.tokenContract,
    };
  }

  if (type === "soroswap_swap") {
    if (!sendAmount || !sendAsset || !destAsset) return null;
    if (!(await isSoroswapPair(sendAsset, destAsset))) return null;
    const from = await resolveSoroswapToken(sendAsset);
    const to = await resolveSoroswapToken(destAsset);
    if (!from || !to) return null;
    return {
      type,
      sendAmount,
      sendAsset,
      destAsset,
      fromTokenContract: from.contract,
      toTokenContract: to.contract,
    };
  }

  if (type === "soroswap_add_liquidity") {
    if (!sendAmount || !amountB || !sendAsset || !destAsset) return null;
    if (!soroswapConfigured() || !(await isSoroswapPair(sendAsset, destAsset))) return null;
    return {
      type,
      sendAmount,
      amountB,
      sendAsset,
      destAsset,
      pair: pair ?? `${sendAsset}/${destAsset}`,
    };
  }

  if (type === "soroswap_remove_liquidity") {
    if (!sendAsset || !destAsset || !liquidity) return null;
    return {
      type,
      sendAsset,
      destAsset,
      liquidity,
      pair: pair ?? `${sendAsset}/${destAsset}`,
    };
  }

  if (type === "steldex_swap") {
    if (!sendAmount || !sendAsset || !destAsset) return null;
    const from = normalizeSteldexSymbol(sendAsset);
    const to = normalizeSteldexSymbol(destAsset);
    const fromC = await resolveSteldexToken(from);
    const toC = await resolveSteldexToken(to);
    if (!fromC || !toC) return null;
    return {
      type,
      sendAmount,
      sendAsset: from,
      destAsset: to,
      fromTokenContract: fromC,
      toTokenContract: toC,
      token0Contract: fromC,
      token1Contract: toC,
    };
  }

  if (
    type === "steldex_add_liquidity" ||
    type === "steldex_stake" ||
    type === "steldex_unstake" ||
    type === "steldex_claim" ||
    type === "steldex_remove_liquidity"
  ) {
    const a = sendAsset ? normalizeSteldexSymbol(sendAsset) : null;
    const b = destAsset ? normalizeSteldexSymbol(destAsset) : null;
    let pool = a && b ? await resolveSteldexPool(a, b) : null;
    if (!pool && pair) {
      const [p0, p1] = pair.split("/");
      if (p0 && p1) pool = await resolveSteldexPool(p0, p1);
    }
    if (!pool) return null;
    return {
      type,
      sendAmount,
      amountB,
      sendAsset: a ?? pool.symbol0,
      destAsset: b ?? pool.symbol1,
      poolContract: pool.poolContract,
      pair: pool.pair,
      token0Contract: pool.token0Contract,
      token1Contract: pool.token1Contract,
      tickLower: STELDEX_FULL_RANGE.tickLower,
      tickUpper: STELDEX_FULL_RANGE.tickUpper,
      liquidity,
      lockWeeks: type === "steldex_stake" ? 52 : undefined,
    };
  }

  if (type === "send") {
    if (!sendAmount || !sendAsset || !destination) return null;
    return { type, sendAmount, sendAsset, destination };
  }

  if (type === "swap") {
    if (!sendAmount || !sendAsset || !destAsset) return null;
    return { type, sendAmount, sendAsset, destAsset };
  }

  // Orbit-native: build unsigned Soroban XDR when wallet is known.
  if (
    type === "predict_bet" ||
    type === "predict_claim" ||
    type === "perp_open" ||
    type === "perp_close" ||
    type === "nft_mint" ||
    type === "nft_list" ||
    type === "nft_buy" ||
    type === "nft_transfer"
  ) {
    const wallet =
      typeof opts?.publicKey === "string" && opts.publicKey.startsWith("G")
        ? opts.publicKey
        : undefined;
    if (!wallet) {
      return { type, sendAmount, sendAsset, destination, destAsset, pair, ...raw } as EnrichedAction;
    }
    try {
      if (type === "nft_mint") {
        const { prepareNftMint } = await import("./nft");
        const mintName =
          typeof raw.pair === "string"
            ? raw.pair
            : typeof raw.marketHint === "string" && !String(raw.marketHint).includes("://")
              ? raw.marketHint
              : sendAsset;
        const metadataUri =
          typeof raw.metadataUri === "string"
            ? raw.metadataUri
            : typeof raw.marketHint === "string" && String(raw.marketHint).includes("://")
              ? raw.marketHint
              : undefined;
        const built = await prepareNftMint({
          walletAddress: wallet,
          name: mintName,
          metadataUri,
        });
        return {
          ...raw,
          type,
          sendAsset: built.name,
          marketHint: built.metadataUri,
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
        } as EnrichedAction;
      }
      if (type === "nft_list") {
        const { prepareNftList } = await import("./nft");
        const tokenId = Number(raw.positionId ?? raw.tokenId);
        const priceXlm = String(raw.priceXlm ?? sendAmount ?? "");
        if (!tokenId || !priceXlm) return { type, ...raw } as EnrichedAction;
        const built = await prepareNftList({ walletAddress: wallet, tokenId, priceXlm });
        return { ...raw, type, tokenId, priceXlm, xdr: built.xdr, networkPassphrase: built.networkPassphrase } as EnrichedAction;
      }
      if (type === "nft_buy") {
        const { prepareNftBuy } = await import("./nft");
        const tokenId = Number(raw.positionId ?? raw.tokenId);
        if (!tokenId) return { type, ...raw } as EnrichedAction;
        const built = await prepareNftBuy({ walletAddress: wallet, tokenId });
        return { ...raw, type, tokenId, xdr: built.xdr, networkPassphrase: built.networkPassphrase } as EnrichedAction;
      }
      if (type === "nft_transfer") {
        const { prepareNftTransfer } = await import("./nft");
        const tokenId = Number(raw.positionId ?? raw.tokenId);
        if (!tokenId || !destination) return { type, ...raw } as EnrichedAction;
        const built = await prepareNftTransfer({ walletAddress: wallet, tokenId, to: destination });
        return { ...raw, type, tokenId, destination, xdr: built.xdr, networkPassphrase: built.networkPassphrase } as EnrichedAction;
      }
      if (type === "predict_claim") {
        const { preparePredictionClaim } = await import("./predict");
        const marketHint = String(raw.marketHint ?? pair ?? "");
        const outcome = String(raw.outcome ?? "yes").toLowerCase() === "no" ? "no" : "yes";
        if (!marketHint) return { type, ...raw } as EnrichedAction;
        const built = await preparePredictionClaim({ walletAddress: wallet, marketHint, outcome });
        return {
          ...raw,
          type,
          marketHint: built.market.slug,
          outcome: built.outcome,
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
        } as EnrichedAction;
      }
      if (type === "predict_bet") {
        const { preparePredictionBet } = await import("./predict");
        const marketHint = String(raw.marketHint ?? pair ?? "");
        const outcome = String(raw.outcome ?? "yes").toLowerCase() === "no" ? "no" : "yes";
        if (!marketHint || !sendAmount) return { type, ...raw } as EnrichedAction;
        const built = await preparePredictionBet({
          walletAddress: wallet,
          marketHint,
          outcome,
          amountXlm: sendAmount,
        });
        return {
          ...raw,
          type,
          sendAmount,
          sendAsset: "XLM",
          marketHint: built.market.slug,
          outcome,
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
        } as EnrichedAction;
      }
      if (type === "perp_close") {
        const { preparePerpClose } = await import("./perps");
        const built = await preparePerpClose({
          walletAddress: wallet,
          positionId: raw.positionId != null ? Number(raw.positionId) : undefined,
          marketHint: String(raw.marketHint ?? pair ?? sendAsset ?? ""),
        });
        return { ...raw, type, xdr: built.xdr, networkPassphrase: built.networkPassphrase } as EnrichedAction;
      }
      if (type === "perp_open") {
        const { preparePerpOpen } = await import("./perps");
        const side = String(raw.side ?? "long").toLowerCase() === "short" ? "short" : "long";
        const leverage = Number(raw.leverage ?? 5);
        const margin = String(raw.marginUsdc ?? sendAmount ?? "");
        const marketHint = String(raw.marketHint ?? pair ?? sendAsset ?? "BTC");
        if (!margin) return { type, ...raw } as EnrichedAction;
        const built = await preparePerpOpen({
          walletAddress: wallet,
          marketHint,
          side,
          leverage,
          marginUsdc: margin,
          stopLoss: raw.stopLoss != null ? Number(raw.stopLoss) : undefined,
          takeProfit: raw.takeProfit != null ? Number(raw.takeProfit) : undefined,
        });
        return { ...raw, type, xdr: built.xdr, networkPassphrase: built.networkPassphrase } as EnrichedAction;
      }
    } catch {
      return { type, sendAmount, sendAsset, destination, destAsset, pair, ...raw } as EnrichedAction;
    }
  }

  return null;
}

/** Enrich LLM/raw action and auto-insert enable-asset (trustline) when needed. */
export async function enrichChatActionWithTrustline(
  raw: Record<string, unknown> | null | undefined,
  opts?: { publicKey?: string | null }
): Promise<{ action: EnrichedAction | null; trustlineText?: string }> {
  const enriched = await enrichChatAction(raw, opts);
  if (!enriched || enriched.type === "add_trustline") {
    return { action: enriched };
  }
  const wrapped = await wrapActionWithTrustlineIfNeeded(opts?.publicKey, enriched);
  return {
    action: wrapped.action as EnrichedAction,
    trustlineText: wrapped.text,
  };
}
