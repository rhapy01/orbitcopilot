import { logger } from "./logger";

const STELDEX_API_BASE = "https://stellar-swap-dex.vercel.app/api/stellar";

export const STELDEX_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const STELDEX_SOROBAN_RPC = "https://soroban-testnet.stellar.org";

/** Full-range ticks for Unicorn StelDex pools (per integration guide). */
export const STELDEX_FULL_RANGE = {
  tickLower: -443580,
  tickUpper: 443580,
} as const;

export const STELDEX_TOKEN_DECIMALS: Record<string, number> = {
  XLM: 7,
  pUSDC: 6,
  PUSDC: 6,
  cUSDC: 7,
  CUSDC: 7,
  EURC: 7,
  STELLAR: 7,
};

export function toSteldexUnits(human: string, decimals: number): string {
  const [wholeRaw, fracRaw = ""] = human.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + frac).toString();
}

export function steldexDecimals(symbol: string): number {
  const key = normalizeSteldexSymbol(symbol);
  return STELDEX_TOKEN_DECIMALS[key] ?? STELDEX_TOKEN_DECIMALS[key.toUpperCase()] ?? 7;
}

/** Canonical StelDex token symbols as used by GET /contracts. */
export function normalizeSteldexSymbol(raw: string): string {
  const u = raw.trim().toUpperCase();
  if (u === "PUSDC") return "pUSDC";
  if (u === "CUSDC") return "cUSDC";
  if (u === "XLM") return "XLM";
  if (u === "EURC") return "EURC";
  if (u === "STELLAR") return "STELLAR";
  return raw.trim();
}

export function isSteldexToken(raw: string): boolean {
  const s = normalizeSteldexSymbol(raw);
  return ["XLM", "pUSDC", "cUSDC", "EURC", "STELLAR"].includes(s);
}

class SteldexApiError extends Error {}

async function steldexFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${STELDEX_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    logger.error({ err, url }, "StelDex API request failed");
    throw new SteldexApiError("Could not reach StelDex (network error)");
  }

  if (!res.ok) {
    let message = `StelDex API error (${res.status})`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "error" in body && typeof (body as any).error === "string") {
        message = (body as any).error;
      }
    } catch {
      // ignore
    }
    throw new SteldexApiError(message);
  }

  return (await res.json()) as T;
}

function steldexGet<T>(path: string): Promise<T> {
  return steldexFetch<T>(path, { method: "GET" });
}

function steldexPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return steldexFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export interface SteldexContractsData {
  factory?: string | null;
  router?: string | null;
  farm?: string | null;
  orders?: string | null;
  tokens: Record<string, string>;
  pools: Array<{ pair: string; contract: string }>;
  contractsReady?: boolean;
  sorobanRpc?: string | null;
  networkPassphrase?: string | null;
  network?: string | null;
}

let _contractsCache: SteldexContractsData | null = null;
let _contractsCacheTime = 0;
const CONTRACTS_TTL_MS = 5 * 60 * 1000;

function tokenMapLookup(tokens: Record<string, string>, symbol: string): string | null {
  const canon = normalizeSteldexSymbol(symbol);
  if (tokens[canon]) return tokens[canon];
  const entry = Object.entries(tokens).find(
    ([k]) => normalizeSteldexSymbol(k) === canon || k.toUpperCase() === canon.toUpperCase()
  );
  return entry?.[1] ?? null;
}

export async function getSteldexContracts(): Promise<SteldexContractsData> {
  const now = Date.now();
  if (_contractsCache && now - _contractsCacheTime < CONTRACTS_TTL_MS) {
    return _contractsCache;
  }

  const raw = await steldexGet<Record<string, unknown>>("/contracts");
  const tokens = (raw.tokens && typeof raw.tokens === "object" ? raw.tokens : {}) as Record<
    string,
    string
  >;
  const poolsRaw = Array.isArray(raw.pools) ? raw.pools : [];
  const pools = poolsRaw
    .map((p: any) => ({
      pair: String(p.pair ?? ""),
      contract: String(p.contract ?? p.address ?? p.poolContract ?? ""),
    }))
    .filter((p) => p.pair && p.contract);

  _contractsCache = {
    factory: (raw.factory as string) ?? null,
    router: (raw.router as string) ?? null,
    farm: (raw.farm as string) ?? null,
    orders: (raw.orders as string) ?? null,
    tokens,
    pools,
    contractsReady: Boolean(raw.contractsReady),
    sorobanRpc: (raw.sorobanRpc as string) ?? STELDEX_SOROBAN_RPC,
    networkPassphrase: (raw.networkPassphrase as string) ?? STELDEX_NETWORK_PASSPHRASE,
    network: (raw.network as string) ?? "testnet",
  };
  _contractsCacheTime = now;
  return _contractsCache;
}

export async function getSteldexPools() {
  const result = await steldexGet<{ pools?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    "/pools"
  );
  return Array.isArray(result) ? result : (result.pools ?? []);
}

export function getSteldexFarmPools(wallet: string) {
  return steldexGet<Record<string, unknown>[]>(`/farm-pools?wallet=${encodeURIComponent(wallet)}`);
}

export function getSteldexFarmPositions(wallet: string) {
  return steldexGet<Record<string, unknown>[]>(
    `/farm-positions?wallet=${encodeURIComponent(wallet)}`
  );
}

export function getSteldexOrders(wallet: string) {
  return steldexGet<Record<string, unknown>[]>(`/orders?wallet=${encodeURIComponent(wallet)}`);
}

export function getSteldexSwapQuote(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/swap/quote", body);
}

export function postSteldexSwap(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/swap", body);
}

export function postSteldexAddLiquidity(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/add-liquidity", body);
}

export function postSteldexRemoveLiquidity(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/remove-liquidity", body);
}

export function postSteldexStake(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/stake", body);
}

export function postSteldexClaim(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/claim", body);
}

export function postSteldexUnstake(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/unstake", body);
}

export function postSteldexLimitOrder(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/limit-order", body);
}

export function postSteldexCancelOrder(body: Record<string, unknown>) {
  return steldexPost<Record<string, unknown>>("/cancel-order", body);
}

export interface SteldexPoolInfo {
  poolContract: string;
  pair: string;
  token0Contract: string;
  token1Contract: string;
  symbol0: string;
  symbol1: string;
}

function pairSymbols(pair: string): [string, string] | null {
  const parts = pair.split("/").map((s) => normalizeSteldexSymbol(s.trim()));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

function pairMatches(pair: string, symbolA: string, symbolB: string): boolean {
  const parts = pairSymbols(pair);
  if (!parts) return false;
  const a = normalizeSteldexSymbol(symbolA);
  const b = normalizeSteldexSymbol(symbolB);
  return (
    (parts[0] === a && parts[1] === b) ||
    (parts[0] === b && parts[1] === a)
  );
}

/** Resolve a pool + token contracts from cached GET /contracts. */
export async function resolveSteldexPool(
  symbolA: string,
  symbolB: string
): Promise<SteldexPoolInfo | null> {
  const contracts = await getSteldexContracts();
  const a = normalizeSteldexSymbol(symbolA);
  const b = normalizeSteldexSymbol(symbolB);

  let pool = contracts.pools.find((p) => pairMatches(p.pair, a, b));

  // Fallback: /pools may include token0/token1/symbol fields
  if (!pool) {
    const pools = await getSteldexPools();
    const match = pools.find((p: any) => {
      const pair = String(p.pair ?? "");
      if (pair && pairMatches(pair, a, b)) return true;
      const s0 = normalizeSteldexSymbol(String(p.symbol0 ?? p.token0Symbol ?? ""));
      const s1 = normalizeSteldexSymbol(String(p.symbol1 ?? p.token1Symbol ?? ""));
      return (s0 === a && s1 === b) || (s0 === b && s1 === a);
    }) as any;
    if (match) {
      const pair =
        match.pair ??
        `${match.symbol0 ?? match.token0Symbol}/${match.symbol1 ?? match.token1Symbol}`;
      const contract = String(match.contract ?? match.address ?? match.poolContract ?? "");
      if (contract) pool = { pair, contract };
    }
  }

  if (!pool) return null;

  const symbols = pairSymbols(pool.pair);
  if (!symbols) return null;
  const [symbol0, symbol1] = symbols;

  const token0Contract =
    tokenMapLookup(contracts.tokens, symbol0) ??
    (await lookupTokenFromPools(symbol0));
  const token1Contract =
    tokenMapLookup(contracts.tokens, symbol1) ??
    (await lookupTokenFromPools(symbol1));

  if (!token0Contract || !token1Contract) return null;

  return {
    poolContract: pool.contract,
    pair: pool.pair,
    token0Contract,
    token1Contract,
    symbol0,
    symbol1,
  };
}

async function lookupTokenFromPools(symbol: string): Promise<string | null> {
  const contracts = await getSteldexContracts();
  return tokenMapLookup(contracts.tokens, symbol);
}

export async function resolveSteldexToken(symbol: string): Promise<string | null> {
  const contracts = await getSteldexContracts();
  return tokenMapLookup(contracts.tokens, symbol);
}

export function findRowForPair<T extends { pair?: string | null }>(
  rows: T[],
  symbolA: string,
  symbolB: string
): T | null {
  return rows.find((r) => r.pair && pairMatches(r.pair, symbolA, symbolB)) ?? null;
}

export async function formatSteldexHoldings(wallet: string): Promise<string> {
  const [farmPools, positions, orders] = await Promise.all([
    getSteldexFarmPools(wallet),
    getSteldexFarmPositions(wallet),
    getSteldexOrders(wallet),
  ]);

  const lines: string[] = ["Your StelDex positions (Stellar Testnet):", ""];

  const lpRows = (farmPools as any[]).filter(
    (p) => p.lpLiquidity && p.lpLiquidity !== "0"
  );
  if (lpRows.length) {
    lines.push("Liquidity:");
    for (const p of lpRows) {
      lines.push(
        `• ${p.pair}: LP ${p.lpLiquidity}` +
          (p.availableToStake && p.availableToStake !== "0"
            ? ` (available to stake: ${p.availableToStake})`
            : "") +
          (p.stakedLiquidity && p.stakedLiquidity !== "0"
            ? ` (staked: ${p.stakedLiquidity})`
            : "")
      );
    }
    lines.push("");
  }

  const posRows = (positions as any[]).filter(Boolean);
  if (posRows.length) {
    lines.push("Farm stakes:");
    for (const p of posRows) {
      const liq = p.stake?.liquidity ?? p.liquidity ?? "?";
      lines.push(
        `• ${p.pair ?? p.poolContract}: liquidity ${liq} (ticks ${p.tickLower}…${p.tickUpper})`
      );
    }
    lines.push("");
  }

  const orderRows = (orders as any[]).filter(Boolean);
  if (orderRows.length) {
    lines.push("Open orders:");
    for (const o of orderRows) {
      lines.push(`• #${o.orderId ?? "?"} ${o.pair ?? ""} ${o.status ?? ""}`.trim());
    }
    lines.push("");
  }

  if (lpRows.length === 0 && posRows.length === 0 && orderRows.length === 0) {
    return "No StelDex LP, farm, or open orders for this wallet on testnet. Try adding liquidity: \"add liquidity 10 XLM and 10 pUSDC\".";
  }

  lines.push(
    'Actions: "remove liquidity XLM/pUSDC", "stake XLM/pUSDC", "claim XLM/pUSDC", "unstake XLM/pUSDC".'
  );
  return lines.join("\n");
}
