import { logger } from "./logger";
import { withRetry } from "./retry";

/**
 * Aquarius AMM — https://docs.aqua.network/developers/code-examples/prerequisites-and-basics
 * Testnet API: https://amm-api-testnet.aqua.network/api/external/v1
 */
const AQUA_API = "https://amm-api-testnet.aqua.network/api/external/v1";

/** Aquarius router (updated Feb 2026 per Aquarius docs). */
export const AQUARIUS_ROUTER = "CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD";

/** Well-known SAC addresses on Aquarius testnet pools. */
export const AQUARIUS_TOKENS: Record<string, { contract: string; decimals: number; label: string }> =
  {
    XLM: {
      contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      decimals: 7,
      label: "native",
    },
    USDC: {
      contract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      decimals: 7,
      label: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
    AQUA: {
      contract: "CDNVQW44C3HALYNVQ4SOBXY5EWYTGVYXX6JPESOLQDABJI5FC5LTRRUE",
      decimals: 7,
      label: "AQUA:GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER",
    },
  };

export interface AquariusPool {
  address: string;
  tokens_str: string[];
  tokens_addresses: string[];
  pool_type: string;
  fee: string;
  tx_count: number | null;
  total_volume: number;
}

export interface AquariusPathQuote {
  success: boolean;
  pools: string[];
  tokens: string[];
  tokens_addresses: string[];
  amountOut: string;
  amountOutHuman: string;
  amountWithFee: string;
  swapChainXdr: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
}

async function aquaGet<T>(path: string): Promise<T> {
  const url = `${AQUA_API}${path}`;
  try {
    const res = await withRetry(() => fetch(url), { label: "aquarius.get" });
    if (!res.ok) throw new Error(`Aquarius HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    logger.error({ err, url }, "Aquarius request failed");
    throw new Error("Could not reach Aquarius testnet API");
  }
}

async function aquaPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${AQUA_API}${path}`;
  try {
    const res = await withRetry(
      () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      { label: "aquarius.post" }
    );
    if (!res.ok) {
      let message = `Aquarius HTTP ${res.status}`;
      try {
        const data: any = await res.json();
        message = data.detail || JSON.stringify(data) || message;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.error({ err, url }, "Aquarius POST failed");
    throw err instanceof Error ? err : new Error("Aquarius request failed");
  }
}

export function resolveAquariusToken(symbol: string) {
  return AQUARIUS_TOKENS[symbol.trim().toUpperCase()] ?? null;
}

export function isAquariusPair(from: string, to: string): boolean {
  return Boolean(resolveAquariusToken(from) && resolveAquariusToken(to));
}

function toUnits(human: string, decimals: number): string {
  const [wholeRaw, fracRaw = ""] = human.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + frac).toString();
}

function fromUnits(raw: string | number, decimals: number): string {
  const s = String(raw);
  const padded = s.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export async function getAquariusPools(limit = 20): Promise<AquariusPool[]> {
  const data = await aquaGet<{ results?: AquariusPool[] }>(`/pools/?limit=${limit}`);
  return data.results ?? [];
}

/** POST /find-path/ — best Aquarius route (strict send). */
export async function findAquariusPath(input: {
  fromSymbol: string;
  toSymbol: string;
  amount: string;
}): Promise<AquariusPathQuote> {
  const from = resolveAquariusToken(input.fromSymbol);
  const to = resolveAquariusToken(input.toSymbol);
  if (!from || !to) {
    throw new Error(
      `Aquarius supports: ${Object.keys(AQUARIUS_TOKENS).join(", ")}. Got ${input.fromSymbol}/${input.toSymbol}.`
    );
  }

  const amountIn = toUnits(input.amount, from.decimals);
  const data = await aquaPost<{
    success?: boolean;
    swap_chain_xdr?: string;
    pools?: string[];
    tokens?: string[];
    tokens_addresses?: string[];
    amount?: number | string;
    amount_with_fee?: number | string;
  }>("/find-path/", {
    token_in_address: from.contract,
    token_out_address: to.contract,
    amount: amountIn,
  });

  if (!data.success || data.amount == null) {
    throw new Error("Aquarius found no path for this pair/amount");
  }

  return {
    success: true,
    pools: data.pools ?? [],
    tokens: data.tokens ?? [],
    tokens_addresses: data.tokens_addresses ?? [],
    amountOut: String(data.amount),
    amountOutHuman: fromUnits(data.amount, to.decimals),
    amountWithFee: String(data.amount_with_fee ?? data.amount),
    swapChainXdr: data.swap_chain_xdr ?? "",
    tokenIn: input.fromSymbol.toUpperCase(),
    tokenOut: input.toSymbol.toUpperCase(),
    amountIn,
  };
}

export async function formatAquariusPools(): Promise<string> {
  const pools = await getAquariusPools(50);
  const ranked = [...pools]
    .filter((p) => (p.total_volume ?? 0) > 0)
    .sort((a, b) => (b.total_volume ?? 0) - (a.total_volume ?? 0))
    .slice(0, 10);

  if (!ranked.length) {
    return "Aquarius testnet AMM is reachable but no active volume pools were returned.";
  }

  const lines = ranked.map((p) => {
    const pair = (p.tokens_str ?? []).join(" / ");
    return `• ${pair} (${p.pool_type}, fee ${p.fee}) — vol ${p.total_volume}`;
  });

  return [
    "Aquarius AMM (Stellar Testnet)",
    `Router: ${AQUARIUS_ROUTER}`,
    `Tokens: ${Object.keys(AQUARIUS_TOKENS).join(", ")}`,
    "",
    "Top pools:",
    ...lines,
    "",
    'Quote: "Aquarius quote 10 XLM to USDC" — live find-path route + amount out.',
  ].join("\n");
}

export async function formatAquariusQuote(
  fromSymbol: string,
  toSymbol: string,
  amount: string
): Promise<string> {
  const quote = await findAquariusPath({ fromSymbol, toSymbol, amount });
  return [
    `Aquarius route: ${amount} ${quote.tokenIn} → ~${quote.amountOutHuman} ${quote.tokenOut}`,
    `Pools: ${quote.pools.length} hop(s)`,
    `Path: ${quote.tokens.join(" → ")}`,
    "",
    "Execution: use \"Swap …\" to route via Soroswap (includes Aquarius) when the aggregator is up, or classic DEX for XLM/USDC.",
  ].join("\n");
}
