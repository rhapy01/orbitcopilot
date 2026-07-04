import { logger } from "./logger";
import { SOROBAN_RPC, getAssetPrice, getXlmPriceUsd, getDemoKeypair } from "./stellar";
import { CacheKeys, CacheTtl, cachedJson } from "./cache";

/**
 * Reflector oracles (SEP-40) on Stellar Testnet.
 * https://developers.stellar.org/docs/data/oracles/oracle-providers
 */
export const REFLECTOR_ORACLES = {
  stellarDex: "CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP",
  external: "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63",
  fiat: "CCSSOHTBL3LEWUCBBEB5NJFC2OKFRC74OWEIJIZLRJBGAAU4VMU5NV4W",
} as const;

export interface ReflectorPrice {
  symbol: string;
  price: number | null;
  source: "reflector" | "horizon" | "none";
  oracle?: string;
  error?: string;
}

async function tryReflectorLastPrice(
  symbol: string,
  oracle: string
): Promise<number | null> {
  try {
    const { Contract, xdr, scValToNative, TransactionBuilder, Networks, BASE_FEE } =
      await import("@stellar/stellar-sdk");
    const { Server } = await import("@stellar/stellar-sdk/rpc");
    const rpc = new Server(SOROBAN_RPC);
    const kp = await getDemoKeypair();
    const account = await rpc.getAccount(kp.publicKey());

    const assetOther = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Other"),
      xdr.ScVal.scvSymbol(symbol.slice(0, 32)),
    ]);

    const contract = new Contract(oracle);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("lastprice", assetOther))
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    const retval = (sim as any)?.result?.retval;
    if (!retval) return null;

    const native = scValToNative(retval);
    if (native && typeof native === "object" && (native as any).price != null) {
      return Number((native as any).price) / 1e14;
    }
    return null;
  } catch (err) {
    return null;
  }
}

export async function getReflectorPrice(symbol: string): Promise<ReflectorPrice> {
  const sym = symbol.trim().toUpperCase();

  // Fiat symbols → fiat oracle; crypto → external CEX oracle
  const oracle = ["USD", "EUR", "GBP", "JPY", "CHF"].includes(sym)
    ? REFLECTOR_ORACLES.fiat
    : REFLECTOR_ORACLES.external;

  const onChain = await tryReflectorLastPrice(sym, oracle);
  if (onChain != null && Number.isFinite(onChain) && onChain > 0) {
    return { symbol: sym, price: onChain, source: "reflector", oracle };
  }

  // Horizon / known fallbacks (still testnet-only data sources)
  try {
    if (sym === "XLM") {
      return { symbol: sym, price: await getXlmPriceUsd(), source: "horizon" };
    }
    if (sym === "USDC" || sym === "USD") {
      return { symbol: sym, price: 1, source: "horizon" };
    }
    const p = await getAssetPrice(sym);
    if (p > 0) return { symbol: sym, price: p, source: "horizon" };
  } catch {
    // ignore
  }

  return { symbol: sym, price: null, source: "none", error: "No price feed" };
}

export async function getReflectorPrices(symbols: string[]): Promise<ReflectorPrice[]> {
  const list = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const key = CacheKeys.prices(list.slice().sort().join(","));
  return cachedJson(key, CacheTtl.pricesSeconds, async () => {
    const out: ReflectorPrice[] = [];
    for (const s of list) {
      out.push(await getReflectorPrice(s));
    }
    return out;
  });
}

export async function formatReflectorPrices(symbols?: string[]): Promise<string> {
  const list = symbols?.length ? symbols : ["XLM", "BTC", "ETH", "USDC"];
  const prices = await getReflectorPrices(list);
  const lines = prices.map((p) => {
    if (p.price != null && Number.isFinite(p.price)) {
      const display = p.price < 0.01 ? p.price.toPrecision(4) : p.price.toFixed(4);
      return `• ${p.symbol}: $${display} (${p.source})`;
    }
    return `• ${p.symbol}: unavailable`;
  });
  return [
    "Prices (Reflector oracle + Horizon fallback, Testnet):",
    "",
    ...lines,
  ].join("\n");
}
