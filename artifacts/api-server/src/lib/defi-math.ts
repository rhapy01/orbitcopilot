/**
 * Deterministic DeFi math helpers — IL, health/LTV, APR↔APY.
 * Educational approximations (constant-product AMM / simple HF).
 */

export type IlResult = {
  /** New price / old price (e.g. 2 = doubled). */
  priceRatio: number;
  /** IL as fraction of HODL value (negative = loss), e.g. -0.057 = −5.7%. */
  ilFraction: number;
  ilPercent: number;
  /** Value factor of LP vs initial (constant-product, no fees). */
  lpValueFactor: number;
  /** Value factor of HODL vs initial. */
  hodlValueFactor: number;
};

/**
 * Constant-product IL for a 50/50 pool when the relative price changes by `priceRatio`.
 * Formula: IL = 2√r / (1+r) − 1, where r = P1/P0.
 */
export function calculateImpermanentLoss(priceRatio: number): IlResult | null {
  if (!Number.isFinite(priceRatio) || priceRatio <= 0) return null;
  const r = priceRatio;
  const lpValueFactor = (2 * Math.sqrt(r)) / (1 + r);
  const hodlValueFactor = (1 + r) / 2;
  // IL relative to HODL: lp/hodl - 1 == 2√r/(1+r) - 1
  const ilFraction = lpValueFactor - 1;
  return {
    priceRatio: r,
    ilFraction,
    ilPercent: ilFraction * 100,
    lpValueFactor,
    hodlValueFactor,
  };
}

/** Parse user phrasing into a price ratio. */
export function parsePriceRatioFromText(content: string): number | null {
  const lower = content.toLowerCase();

  if (/\bdoubles?\b|\b2x\b|\btwice\b/.test(lower)) return 2;
  if (/\btriples?\b|\b3x\b/.test(lower)) return 3;
  if (/\bhalves?\b|\bhalf\b/.test(lower)) return 0.5;
  if (/\bquadruples?\b|\b4x\b/.test(lower)) return 4;

  const pctDrop = lower.match(
    /(?:drops?|falls?|down|crashes?|declines?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/
  );
  if (pctDrop) {
    const p = parseFloat(pctDrop[1]);
    if (p > 0 && p < 100) return 1 - p / 100;
  }

  const pctRise = lower.match(
    /(?:rises?|pumps?|up|gains?|increases?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/
  );
  if (pctRise) {
    const p = parseFloat(pctRise[1]);
    if (p > 0) return 1 + p / 100;
  }

  const genericPct = lower.match(
    /(?:price\s+)?(?:change|moves?|moves?\s+by)?\s*[+\-]?(\d+(?:\.\d+)?)\s*%/
  );
  if (genericPct && /\bil\b|impermanent/.test(lower)) {
    const p = parseFloat(genericPct[1]);
    if (lower.includes("-") || /drop|fall|down|loss/.test(lower)) {
      if (p > 0 && p < 100) return 1 - p / 100;
    }
    if (p > 0) return 1 + p / 100;
  }

  const ratio = lower.match(/\bratio\s+(?:of\s+)?(\d+(?:\.\d+)?)\b/);
  if (ratio) {
    const r = parseFloat(ratio[1]);
    if (r > 0) return r;
  }

  return null;
}

export function formatIlAnswer(priceRatio: number): string | null {
  const r = calculateImpermanentLoss(priceRatio);
  if (!r) return null;

  const moveDesc =
    priceRatio > 1
      ? `price rises to ${(priceRatio * 100).toFixed(0)}% of start (${priceRatio.toFixed(2)}×)`
      : priceRatio < 1
        ? `price falls to ${(priceRatio * 100).toFixed(0)}% of start (${priceRatio.toFixed(2)}×)`
        : "price unchanged";

  return [
    "**Impermanent loss (constant-product AMM, 50/50, ignoring fees)**",
    "",
    `Scenario: ${moveDesc}`,
    `IL vs HODL: **${r.ilPercent.toFixed(2)}%**`,
    `LP value factor: ${r.lpValueFactor.toFixed(4)}× initial`,
    `HODL value factor: ${r.hodlValueFactor.toFixed(4)}× initial`,
    "",
    "Notes:",
    "• Fees earned in the pool can offset IL — this calc excludes fees.",
    "• IL is realized when you withdraw after the move.",
    "• Ask Orbit to add liquidity on StelDex to try LP on testnet.",
    "",
    "── Sources ──",
    "1. Constant-product AMM identity — Orbit DeFi Math",
  ].join("\n");
}

export type HealthResult = {
  collateralUsd: number;
  debtUsd: number;
  /** Liquidation threshold (0–1), e.g. 0.75. */
  threshold: number;
  ltv: number;
  healthFactor: number;
  status: "safe" | "caution" | "danger" | "liquidatable";
};

/**
 * Educational health factor: HF = (collateral × threshold) / debt.
 * HF < 1 ≈ liquidatable under this simplified model.
 */
export function calculateHealthFactor(input: {
  collateralUsd: number;
  debtUsd: number;
  threshold?: number;
}): HealthResult | null {
  const collateralUsd = input.collateralUsd;
  const debtUsd = input.debtUsd;
  const threshold = input.threshold ?? 0.75;
  if (
    !Number.isFinite(collateralUsd) ||
    !Number.isFinite(debtUsd) ||
    collateralUsd < 0 ||
    debtUsd < 0 ||
    threshold <= 0 ||
    threshold > 1
  ) {
    return null;
  }
  if (debtUsd === 0) {
    return {
      collateralUsd,
      debtUsd,
      threshold,
      ltv: 0,
      healthFactor: Number.POSITIVE_INFINITY,
      status: "safe",
    };
  }
  const ltv = debtUsd / collateralUsd;
  const healthFactor = (collateralUsd * threshold) / debtUsd;
  let status: HealthResult["status"] = "safe";
  if (healthFactor < 1) status = "liquidatable";
  else if (healthFactor < 1.25) status = "danger";
  else if (healthFactor < 1.5) status = "caution";
  return { collateralUsd, debtUsd, threshold, ltv, healthFactor, status };
}

export function formatHealthAnswer(h: HealthResult): string {
  const hfLabel = Number.isFinite(h.healthFactor)
    ? h.healthFactor.toFixed(2)
    : "∞ (no debt)";
  return [
    "**Health factor (educational model)**",
    "",
    `Collateral: $${h.collateralUsd.toFixed(2)}`,
    `Debt: $${h.debtUsd.toFixed(2)}`,
    `Assumed liquidation threshold: ${(h.threshold * 100).toFixed(0)}%`,
    `LTV: ${(h.ltv * 100).toFixed(1)}%`,
    `Health factor: **${hfLabel}** → ${h.status}`,
    "",
    "Rule of thumb: keep HF comfortably above 1.5 on volatile collateral.",
    "Blend/perps use protocol-specific parameters — this is a teaching estimate, not on-chain truth.",
    "",
    "── Sources ──",
    "1. HF ≈ (collateral × LT) / debt — Orbit DeFi Math",
  ].join("\n");
}

/** Parse "health if collateral 100 debt 40" style prompts. */
export function parseHealthFromText(content: string): HealthResult | null {
  const lower = content.toLowerCase();
  if (!/\bhealth\b|\bltv\b|\bliquidat/.test(lower)) return null;

  const coll =
    lower.match(/collateral(?:\s+(?:of|is|=|:))?\s*\$?\s*([\d.]+)/)?.[1] ??
    lower.match(/\$\s*([\d.]+)\s+collateral/)?.[1];
  const debt =
    lower.match(/debt(?:\s+(?:of|is|=|:))?\s*\$?\s*([\d.]+)/)?.[1] ??
    lower.match(/\$\s*([\d.]+)\s+debt/)?.[1] ??
    lower.match(/borrow(?:ed|ing)?(?:\s+(?:of|is|=|:))?\s*\$?\s*([\d.]+)/)?.[1];

  if (!coll || !debt) return null;
  const thresholdMatch = lower.match(/threshold\s*([\d.]+)\s*%?/);
  let threshold = 0.75;
  if (thresholdMatch) {
    const t = parseFloat(thresholdMatch[1]);
    threshold = t > 1 ? t / 100 : t;
  }

  return calculateHealthFactor({
    collateralUsd: parseFloat(coll),
    debtUsd: parseFloat(debt),
    threshold,
  });
}

export function aprToApy(apr: number, compoundsPerYear = 365): number {
  // apr as fraction (0.1 = 10%)
  return Math.pow(1 + apr / compoundsPerYear, compoundsPerYear) - 1;
}

export function formatAprApyAnswer(aprPercent: number): string {
  const apr = aprPercent / 100;
  const apy = aprToApy(apr);
  return [
    "**APR → APY (daily compounding estimate)**",
    "",
    `APR: ${aprPercent.toFixed(2)}%`,
    `APY ≈ ${(apy * 100).toFixed(2)}% (365 compounds)`,
    "",
    "DeFi displays often mix APR/APY and include temporary reward emissions.",
    "",
    "── Sources ──",
    "1. APY = (1 + APR/n)^n − 1 — Orbit DeFi Math",
  ].join("\n");
}

export function parseAprFromText(content: string): number | null {
  const lower = content.toLowerCase();
  if (!/\bapr\b/.test(lower) || !/\bapy\b/.test(lower)) return null;
  const m = lower.match(/(\d+(?:\.\d+)?)\s*%?\s*apr/);
  if (!m) return null;
  return parseFloat(m[1]);
}

/** Unified math intent router for chat. */
export function tryDefiMathAnswer(content: string): string | null {
  const lower = content.toLowerCase();

  if (/\bil\b|impermanent\s+loss/.test(lower)) {
    const ratio = parsePriceRatioFromText(content);
    if (ratio != null) {
      const ans = formatIlAnswer(ratio);
      if (ans) return ans;
    }
  }

  const health = parseHealthFromText(content);
  if (health) return formatHealthAnswer(health);

  const apr = parseAprFromText(content);
  if (apr != null) return formatAprApyAnswer(apr);

  return null;
}
