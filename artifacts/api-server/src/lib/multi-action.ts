/**
 * Multi-action parsers — e.g. "swap 200 XLM to pUSDC, cUSDC, EURC each"
 * "each" = full amount per destination (N swaps).
 */

const MAX_MULTI_ACTIONS = 5;

/** Normalize asset codes used in chat. */
export function normalizeAssetCode(raw: string): string {
  const a = raw.trim().toUpperCase().replace(/^\$/, "");
  if (a === "PUSDC") return "pUSDC";
  if (a === "CUSDC") return "cUSDC";
  if (a === "STELLAR") return "STELLAR";
  return a;
}

/**
 * Parse: swap 200 XLM to pUSDC, cUSDC, EURC each
 * Also: swap 200 xlm into pusdc and eurc each
 */
export function parseMultiSwapEach(content: string): {
  amount: string;
  fromAsset: string;
  toAssets: string[];
} | null {
  const m = content.match(
    /\bswap\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|into|for)\s+(.+?)\s+each\b/i
  );
  if (!m) return null;

  const amount = m[1]!;
  const fromAsset = normalizeAssetCode(m[2]!);
  const destRaw = m[3]!;
  const parts = destRaw
    .split(/\s*(?:,|\/|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(normalizeAssetCode)
    .filter((a) => a.length >= 2 && a.length <= 12);

  const toAssets = [...new Set(parts)].slice(0, MAX_MULTI_ACTIONS);
  if (toAssets.length < 2) return null;
  if (toAssets.some((a) => a === fromAsset)) return null;

  return { amount, fromAsset, toAssets };
}

export { MAX_MULTI_ACTIONS };
