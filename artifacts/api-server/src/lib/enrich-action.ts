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
};

/** Fill contracts / pool fields so the UI can execute LLM-proposed actions. */
export async function enrichChatAction(
  raw: Record<string, unknown> | null | undefined
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

  return null;
}
