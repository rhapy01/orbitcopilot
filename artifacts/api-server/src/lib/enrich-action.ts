import {
  BlendRequestType,
  preflightBlendWalletSpend,
  resolveBlendReserve,
} from "./blend";
import {
  resolveSoroswapToken,
  isSoroswapPair,
  soroswapConfigured,
  matchSoroswapAddLiquidityAmounts,
} from "./soroswap";
import {
  resolveSteldexPool,
  resolveSteldexToken,
  normalizeSteldexSymbol,
  STELDEX_FULL_RANGE,
  matchSteldexAddLiquidityAmounts,
} from "./steldex";
import { isLpAutoAmount } from "./defi-math";
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
    if (type === "blend_claim") {
      const wallet = opts?.publicKey;
      if (!wallet) return null;
      try {
        const { buildBlendClaimTx } = await import("./blend");
        const built = await buildBlendClaimTx({ walletAddress: wallet });
        return {
          type,
          sendAsset: "BLND",
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
          poolContract: built.poolContract,
        };
      } catch {
        return null;
      }
    }
    if (type === "blend_usdc_swap") {
      const wallet = opts?.publicKey;
      if (!wallet || !sendAmount) return null;
      try {
        const { prepareCircleToBlendUsdcSwap } = await import("./blend");
        const built = await prepareCircleToBlendUsdcSwap({
          walletAddress: wallet,
          amount: sendAmount,
        });
        return {
          type,
          sendAmount: built.sendAmount,
          sendAsset: "USDC",
          destAsset: "Blend USDC",
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
        };
      } catch {
        return null;
      }
    }
    if (!sendAmount || !sendAsset) return null;
    const reserve = await resolveBlendReserve(sendAsset);
    if (!reserve) return null;
    const requestType =
      type === "blend_withdraw"
        ? BlendRequestType.WithdrawCollateral
        : type === "blend_borrow"
          ? BlendRequestType.Borrow
          : type === "blend_repay"
            ? BlendRequestType.Repay
            : BlendRequestType.SupplyCollateral;
    return {
      type,
      requestType,
      sendAmount,
      sendAsset: reserve.symbol,
      poolContract: reserve.poolContract,
      token0Contract: reserve.tokenContract,
    };
  }

  if (
    type === "orbit_supply_deposit" ||
    type === "orbit_supply_withdraw" ||
    type === "orbit_supply_claim"
  ) {
    const wallet = opts?.publicKey;
    if (!wallet) return null;
    try {
      if (type === "orbit_supply_claim") {
        const { prepareOrbitSupplyClaim } = await import("./orbit-supply");
        const built = await prepareOrbitSupplyClaim({ walletAddress: wallet });
        return {
          type,
          sendAmount: built.sendAmount,
          sendAsset: "XLM",
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
        };
      }
      if (!sendAmount || !sendAsset) return null;
      if (type === "orbit_supply_deposit") {
        const { prepareOrbitSupplyDeposit } = await import("./orbit-supply");
        const built = await prepareOrbitSupplyDeposit({
          walletAddress: wallet,
          amount: sendAmount,
          asset: sendAsset,
        });
        return {
          type,
          sendAmount: built.sendAmount,
          sendAsset: built.sendAsset,
          token0Contract: built.tokenContract,
          xdr: built.xdr,
          networkPassphrase: built.networkPassphrase,
        };
      }
      const { prepareOrbitSupplyWithdraw } = await import("./orbit-supply");
      const built = await prepareOrbitSupplyWithdraw({
        walletAddress: wallet,
        amount: sendAmount,
        asset: sendAsset,
      });
      return {
        type,
        sendAmount: built.sendAmount,
        sendAsset: built.sendAsset,
        token0Contract: built.tokenContract,
        xdr: built.xdr,
        networkPassphrase: built.networkPassphrase,
      };
    } catch {
      return null;
    }
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
    if (!sendAmount || !sendAsset || !destAsset) return null;
    if (!soroswapConfigured() || !(await isSoroswapPair(sendAsset, destAsset))) return null;
    const oneSided = isLpAutoAmount(amountB);
    if (!oneSided && !amountB) return null;
    const matched = await matchSoroswapAddLiquidityAmounts({
      symbolA: sendAsset,
      symbolB: destAsset,
      amountAMax: sendAmount,
      amountBMax: oneSided ? "AUTO" : amountB!,
      anchorSide: oneSided ? 0 : undefined,
    });
    return {
      type,
      sendAmount: matched?.amount0 ?? sendAmount,
      amountB: matched?.amount1 ?? (oneSided ? undefined : amountB),
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

    let outAmount = sendAmount;
    let outAmountB = amountB;
    if (type === "steldex_add_liquidity" && sendAmount && a && b) {
      const oneSided = isLpAutoAmount(amountB);
      // Map user amounts onto pool token0/token1 order, then match ratio.
      // One-sided: keep the user-stated asset amount and derive the other.
      const user0 = oneSided
        ? a === pool.symbol0
          ? sendAmount
          : "AUTO"
        : a === pool.symbol0
          ? sendAmount
          : amountB!;
      const user1 = oneSided
        ? a === pool.symbol0
          ? "AUTO"
          : sendAmount
        : a === pool.symbol0
          ? amountB!
          : sendAmount;
      const anchorSide: 0 | 1 | undefined = oneSided
        ? a === pool.symbol0
          ? 0
          : 1
        : undefined;
      const matched = await matchSteldexAddLiquidityAmounts({
        symbol0: pool.symbol0,
        symbol1: pool.symbol1,
        token0Contract: pool.token0Contract,
        token1Contract: pool.token1Contract,
        amount0Max: user0,
        amount1Max: user1,
        anchorSide,
      });
      if (matched) {
        outAmount = matched.amount0;
        outAmountB = matched.amount1;
      } else if (!oneSided) {
        outAmount = user0;
        outAmountB = user1;
      }
    }

    return {
      type,
      sendAmount: outAmount,
      amountB: outAmountB,
      sendAsset: pool.symbol0,
      destAsset: pool.symbol1,
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
          mediaPackId:
            typeof raw.mediaPackId === "string" ? raw.mediaPackId : undefined,
          useMediaPack: raw.useMediaPack === true,
          collectionContract:
            typeof raw.collectionContract === "string"
              ? raw.collectionContract
              : typeof raw.marketHint === "string" &&
                  String(raw.marketHint).startsWith("C")
                ? raw.marketHint
                : undefined,
        });
        return {
          ...raw,
          type,
          sendAsset: built.name,
          marketHint: built.metadataUri,
          mediaPackId: built.mediaPackId,
          tokenId: built.tokenId,
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
): Promise<{ action: EnrichedAction | null; trustlineText?: string; blockText?: string }> {
  const enriched = await enrichChatAction(raw, opts);
  if (!enriched || enriched.type === "add_trustline") {
    return { action: enriched };
  }

  if (
    opts?.publicKey &&
    (enriched.type === "blend_supply" || enriched.type === "blend_repay") &&
    enriched.sendAmount &&
    enriched.sendAsset
  ) {
    const check = await preflightBlendWalletSpend({
      walletAddress: opts.publicKey,
      symbol: enriched.sendAsset,
      amount: enriched.sendAmount,
      op: enriched.type === "blend_repay" ? "repay" : "supply",
    });
    if (!check.ok) {
      return { action: null, blockText: check.message };
    }
  }

  const wrapped = await wrapActionWithTrustlineIfNeeded(opts?.publicKey, enriched);
  return {
    action: wrapped.action as EnrichedAction,
    trustlineText: wrapped.text,
  };
}
