import { logger } from "./logger";

const STELDEX_API_BASE = "https://stellar-swap-dex.vercel.app/api/stellar";

export const STELDEX_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const STELDEX_SOROBAN_RPC = "https://soroban-testnet.stellar.org";

export const STELDEX_TOKEN_DECIMALS: Record<string, number> = {
  XLM: 7,
  PUSDC: 6,
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

class SteldexApiError extends Error {}

async function steldexFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
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
      // ignore body parse errors
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

export function getSteldexContracts() {
  return steldexGet<Record<string, unknown>>("/contracts");
}

export async function getSteldexPools() {
  const result = await steldexGet<{ pools?: Record<string, unknown>[] } | Record<string, unknown>[]>("/pools");
  return Array.isArray(result) ? result : (result.pools ?? []);
}

export function getSteldexFarmPools(wallet: string) {
  return steldexGet<Record<string, unknown>[]>(`/farm-pools?wallet=${encodeURIComponent(wallet)}`);
}

export function getSteldexFarmPositions(wallet: string) {
  return steldexGet<Record<string, unknown>[]>(`/farm-positions?wallet=${encodeURIComponent(wallet)}`);
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
