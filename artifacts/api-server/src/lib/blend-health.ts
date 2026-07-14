/**
 * Blend position health — educational estimate from live supplies/liabilities.
 */
import { listBlendPositions } from "./blend";
import { getReflectorPrice } from "./reflector";
import {
  calculateHealthFactor,
  formatHealthAnswer,
  type HealthResult,
} from "./defi-math";

const FALLBACK_USD: Record<string, number> = {
  USDC: 1,
  XLM: 0.12,
  BLND: 0.05,
  wETH: 3500,
  wBTC: 95000,
};

/** Conservative educational liquidation threshold (not Blend's on-chain factor). */
const DEFAULT_LT = 0.75;

async function usdPrice(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  if (sym === "USDC" || sym === "CUSDC") return 1;
  try {
    const p = await getReflectorPrice(sym === "WETH" ? "ETH" : sym === "WBTC" ? "BTC" : sym);
    if (p.price != null && p.price > 0) return p.price;
  } catch {
    // fall through
  }
  return FALLBACK_USD[sym] ?? 0;
}

export async function estimateBlendHealth(
  publicKey: string
): Promise<{ result: HealthResult; detail: string } | null> {
  const positions = await listBlendPositions(publicKey);
  if (!positions.length) return null;

  let collateralUsd = 0;
  let debtUsd = 0;
  const lines: string[] = [];

  for (const p of positions) {
    const px = await usdPrice(p.symbol);
    const supply = parseFloat(p.supply) || 0;
    const liability = parseFloat(p.liability) || 0;
    const supplyUsd = supply * px;
    const debtPart = liability * px;
    collateralUsd += supplyUsd;
    debtUsd += debtPart;
    lines.push(
      `• ${p.symbol}: supply ${supply} (≈$${supplyUsd.toFixed(2)}), debt ${liability} (≈$${debtPart.toFixed(2)}) @ ~$${px}`
    );
  }

  const result = calculateHealthFactor({
    collateralUsd,
    debtUsd,
    threshold: DEFAULT_LT,
  });
  if (!result) return null;

  return {
    result,
    detail: ["Blend positions (testnet, educational prices):", ...lines].join("\n"),
  };
}

export async function formatBlendHealthReport(publicKey: string): Promise<string> {
  const est = await estimateBlendHealth(publicKey);
  if (!est) {
    return "No Blend supply/borrow positions found for this wallet on testnet (or the pool read failed). Supply or borrow on Blend first, then ask again.";
  }
  return [est.detail, "", formatHealthAnswer(est.result)].join("\n");
}
