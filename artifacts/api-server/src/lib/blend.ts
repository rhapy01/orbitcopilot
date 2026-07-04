import { logger } from "./logger";
import { NETWORK_PASSPHRASE, SOROBAN_RPC } from "./stellar";
import { withRetry } from "./retry";

const CONTRACTS_URL =
  "https://cdn.jsdelivr.net/gh/blend-capital/blend-utils@main/testnet.contracts.json";

export interface BlendContracts {
  ids: Record<string, string>;
  hashes: Record<string, string>;
}

/** Blend Pool RequestType enum (v2). */
export const BlendRequestType = {
  Supply: 0,
  Withdraw: 1,
  SupplyCollateral: 2,
  WithdrawCollateral: 3,
  Borrow: 4,
  Repay: 5,
} as const;

let _cache: BlendContracts | null = null;
let _cacheTime = 0;
const TTL = 10 * 60 * 1000;

export async function getBlendContracts(): Promise<BlendContracts> {
  const now = Date.now();
  if (_cache && now - _cacheTime < TTL) return _cache;

  try {
    const res = await withRetry(() => fetch(CONTRACTS_URL), { label: "blend.contracts" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cache = (await res.json()) as BlendContracts;
    _cacheTime = now;
    return _cache;
  } catch (err) {
    logger.error({ err }, "Failed to load Blend testnet contracts");
    throw new Error("Could not load Blend testnet contracts");
  }
}

export function blendReserveSymbols(contracts: BlendContracts): string[] {
  return Object.keys(contracts.ids).filter((k) =>
    ["XLM", "USDC", "BLND", "wETH", "wBTC"].includes(k)
  );
}

export async function formatBlendMarkets(): Promise<string> {
  const contracts = await getBlendContracts();
  const reserves = blendReserveSymbols(contracts);
  const pool = contracts.ids.TestnetV2;
  const lines = reserves.map((s) => `• ${s}: ${contracts.ids[s]}`);

  return [
    "Blend Protocol (Stellar Testnet) — lending markets:",
    "",
    `Pool (TestnetV2): ${pool}`,
    "",
    "Reserves:",
    ...lines,
    "",
    'Actions: "supply 10 USDC on Blend", "withdraw 5 USDC on Blend", "borrow 2 XLM on Blend", "repay 1 XLM on Blend".',
  ].join("\n");
}

export async function resolveBlendReserve(symbol: string): Promise<{
  symbol: string;
  tokenContract: string;
  poolContract: string;
} | null> {
  const contracts = await getBlendContracts();
  const key = Object.keys(contracts.ids).find(
    (k) => k.toLowerCase() === symbol.trim().toLowerCase()
  );
  if (!key || !["XLM", "USDC", "BLND", "wETH", "wBTC"].includes(key)) return null;
  const poolContract = contracts.ids.TestnetV2;
  if (!poolContract) return null;
  return {
    symbol: key,
    tokenContract: contracts.ids[key],
    poolContract,
  };
}

const DECIMALS: Record<string, number> = {
  XLM: 7,
  USDC: 7,
  BLND: 7,
  wETH: 7,
  wBTC: 7,
};

export function toBlendUnits(human: string, symbol: string): string {
  const decimals = DECIMALS[symbol.toUpperCase()] ?? 7;
  const [wholeRaw, fracRaw = ""] = human.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + frac).toString();
}

/**
 * Build an unsigned Blend pool.submit transaction for Freighter.
 * Request types: Supply / Withdraw / Borrow / Repay (and collateral variants).
 */
export async function buildBlendSubmitTx(input: {
  walletAddress: string;
  requestType: number;
  symbol: string;
  amount: string;
}): Promise<{ xdr: string; networkPassphrase: string; poolContract: string; tokenContract: string }> {
  const reserve = await resolveBlendReserve(input.symbol);
  if (!reserve) {
    throw new Error(`Unknown Blend reserve "${input.symbol}" (XLM, USDC, BLND, wETH, wBTC)`);
  }

  const amount = toBlendUnits(input.amount, reserve.symbol);
  const {
    Contract,
    TransactionBuilder,
    Networks,
    BASE_FEE,
    Address,
    nativeToScVal,
    xdr,
  } = await import("@stellar/stellar-sdk");
  const { Server } = await import("@stellar/stellar-sdk/rpc");

  const rpc = new Server(SOROBAN_RPC);
  const account = await rpc.getAccount(input.walletAddress);
  const contract = new Contract(reserve.poolContract);

  const walletSc = Address.fromString(input.walletAddress).toScVal();
  const tokenSc = Address.fromString(reserve.tokenContract).toScVal();
  const amountSc = nativeToScVal(BigInt(amount), { type: "i128" });

  // Request struct as ScMap — keys must be sorted for Soroban struct encoding
  const request = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("address"),
      val: tokenSc,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("amount"),
      val: amountSc,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("request_type"),
      val: xdr.ScVal.scvU32(input.requestType),
    }),
  ]);

  const requests = xdr.ScVal.scvVec([request]);

  // submit(from, spender, to, requests)
  const op = contract.call("submit", walletSc, walletSc, walletSc, requests);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();

  const simulated = await rpc.simulateTransaction(tx);
  const simErr = (simulated as any)?.error;
  if (simErr) {
    throw new Error(`Blend simulation failed: ${simErr}`);
  }

  const { assembleTransaction } = await import("@stellar/stellar-sdk/rpc");
  const assembled = assembleTransaction(tx, simulated).build();

  return {
    xdr: assembled.toXDR(),
    networkPassphrase: NETWORK_PASSPHRASE,
    poolContract: reserve.poolContract,
    tokenContract: reserve.tokenContract,
  };
}
