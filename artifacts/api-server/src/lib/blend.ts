import { logger } from "./logger";
import { NETWORK_PASSPHRASE, SOROBAN_RPC } from "./stellar";
import { withRetry } from "./retry";
import { resolveAssetCode } from "./fuzzy-normalize";

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
  const fuzzy = resolveAssetCode(symbol);
  const needle = (fuzzy ?? symbol).trim().toLowerCase();
  const key = Object.keys(contracts.ids).find((k) => k.toLowerCase() === needle);
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

/** Best-effort live Blend positions via pool.get_positions. */
export async function listBlendPositions(wallet: string): Promise<
  {
    symbol: string;
    supply: string;
    liability: string;
    poolContract: string;
  }[]
> {
  try {
    const contracts = await getBlendContracts();
    const poolId = contracts.ids.TestnetV2;
    if (!poolId) return [];

    const {
      Contract,
      TransactionBuilder,
      Networks,
      BASE_FEE,
      Address,
      scValToNative,
    } = await import("@stellar/stellar-sdk");
    const { Server } = await import("@stellar/stellar-sdk/rpc");
    const { getDemoKeypair } = await import("./stellar");

    const rpc = new Server(SOROBAN_RPC);
    const demo = await getDemoKeypair();
    const account = await rpc.getAccount(demo.publicKey());
    const contract = new Contract(poolId);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_positions", Address.fromString(wallet).toScVal()))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    const retval = (sim as any)?.result?.retval;
    if (!retval) return [];

    const raw = scValToNative(retval) as any;
    const out: {
      symbol: string;
      supply: string;
      liability: string;
      poolContract: string;
    }[] = [];

    const collateral = raw?.collateral ?? raw?.Collateral ?? {};
    const liabilities = raw?.liabilities ?? raw?.Liabilities ?? {};

    const reserveByContract = new Map<string, string>();
    for (const sym of blendReserveSymbols(contracts)) {
      reserveByContract.set(contracts.ids[sym], sym);
    }

    const pushFromMap = (map: any, kind: "supply" | "liability") => {
      if (!map || typeof map !== "object") return;
      const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
      for (const [key, val] of entries) {
        const addr = typeof key === "string" ? key : String(key);
        const sym = reserveByContract.get(addr) ?? addr.slice(0, 6);
        const amount = Number(val) / 1e7;
        if (!Number.isFinite(amount) || amount === 0) continue;
        const existing = out.find((o) => o.symbol === sym);
        if (existing) {
          if (kind === "supply") existing.supply = String(amount);
          else existing.liability = String(amount);
        } else {
          out.push({
            symbol: sym,
            supply: kind === "supply" ? String(amount) : "0",
            liability: kind === "liability" ? String(amount) : "0",
            poolContract: poolId,
          });
        }
      }
    };

    pushFromMap(collateral, "supply");
    pushFromMap(liabilities, "liability");
    return out;
  } catch (err) {
    logger.warn({ err }, "Blend get_positions failed");
    return [];
  }
}
