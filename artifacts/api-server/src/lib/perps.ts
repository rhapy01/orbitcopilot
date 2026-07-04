import {
  buildContractInvoke,
  enumUnit,
  requirePerpsContract,
  TESTNET_USDC_SAC,
} from "./onchain";
import { getReflectorPrice } from "./reflector";
import { SOROBAN_RPC } from "./stellar";

/** Markets must match on-chain set_market calls in deploy script. */
export const PERP_MARKETS = [
  { symbol: "BTC", maxLeverage: 10 },
  { symbol: "ETH", maxLeverage: 10 },
  { symbol: "XLM", maxLeverage: 5 },
] as const;

/** Price with 1e7 scale for contract. */
export function toPriceE7(price: number): bigint {
  return BigInt(Math.round(price * 1e7));
}

export function fromPriceE7(e7: number | bigint): number {
  return Number(e7) / 1e7;
}

function toUsdcUnits(human: string): string {
  const [w, f = ""] = human.trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt((w || "0") + frac).toString();
}

export function findPerpMarket(hint: string) {
  const h = hint.toUpperCase().replace(/[^A-Z]/g, "");
  const aliases: Record<string, string> = {
    BITCOIN: "BTC",
    BTCUSD: "BTC",
    ETHEREUM: "ETH",
    ETHUSD: "ETH",
    STELLAR: "XLM",
  };
  const sym = aliases[h] ?? h;
  return PERP_MARKETS.find((m) => m.symbol === sym) ?? null;
}

export async function markPrice(symbol: string): Promise<number> {
  const p = await getReflectorPrice(symbol);
  if (p.price != null && p.price > 0) return p.price;
  const fallbacks: Record<string, number> = { BTC: 95000, ETH: 3500, XLM: 0.12 };
  return fallbacks[symbol.toUpperCase()] ?? 1;
}

export async function listPerpMarkets() {
  return PERP_MARKETS.map((m) => ({
    ...m,
    quoteAsset: "USDC",
    status: "open",
    onChain: Boolean(process.env.ORBIT_PERPS_CONTRACT_ID?.startsWith("C")),
  }));
}

export async function preparePerpOpen(input: {
  walletAddress: string;
  marketHint: string;
  side: "long" | "short";
  marginUsdc: string;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
}) {
  const contractId = requirePerpsContract();
  const market = findPerpMarket(input.marketHint);
  if (!market) {
    throw new Error(
      `Unknown market "${input.marketHint}". Available: ${PERP_MARKETS.map((m) => m.symbol).join(", ")}`
    );
  }
  if (input.leverage < 1 || input.leverage > market.maxLeverage) {
    throw new Error(`Leverage must be 1–${market.maxLeverage} for ${market.symbol}`);
  }

  const entry = await markPrice(market.symbol);
  const margin = parseFloat(input.marginUsdc);
  if (!Number.isFinite(margin) || margin <= 0) {
    throw new Error("Margin must be positive USDC");
  }

  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const sideName = input.side === "short" ? "Short" : "Long";
  const sl = input.stopLoss != null ? toPriceE7(input.stopLoss) : 0n;
  const tp = input.takeProfit != null ? toPriceE7(input.takeProfit) : 0n;

  const args = [
    Address.fromString(input.walletAddress).toScVal(),
    nativeToScVal(market.symbol, { type: "string" }),
    await enumUnit(sideName),
    nativeToScVal(BigInt(toUsdcUnits(input.marginUsdc)), { type: "i128" }),
    nativeToScVal(input.leverage, { type: "u32" }),
    nativeToScVal(sl, { type: "i128" }),
    nativeToScVal(tp, { type: "i128" }),
  ];

  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "open_position",
    args,
  });

  const notional = margin * input.leverage;
  const liq =
    input.side === "long"
      ? entry - (entry / input.leverage) * 0.9
      : entry + (entry / input.leverage) * 0.9;

  return {
    type: "perp_open" as const,
    onChain: true,
    contractId,
    positionId: 0, // assigned on-chain; read after confirm via user_positions
    market: market.symbol,
    side: input.side,
    leverage: input.leverage,
    marginUsdc: margin,
    notionalUsdc: notional,
    entryPrice: entry,
    stopLoss: input.stopLoss ?? null,
    takeProfit: input.takeProfit ?? null,
    liquidationPrice: liq,
    marginToken: TESTNET_USDC_SAC,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
  };
}

export async function preparePerpClose(input: {
  walletAddress: string;
  positionId?: number;
  marketHint?: string;
}) {
  const contractId = requirePerpsContract();
  let positionId = input.positionId;

  if (positionId == null) {
    // Resolve latest open position for market from chain
    const ids = await readUserPositionIds(contractId, input.walletAddress);
    if (!ids.length) throw new Error("No on-chain perp positions");
    if (input.marketHint) {
      const market = findPerpMarket(input.marketHint);
      for (const id of [...ids].reverse()) {
        const pos = await readPosition(contractId, id);
        if (pos && pos.symbol === market?.symbol && pos.status === "Open") {
          positionId = id;
          break;
        }
      }
    } else {
      positionId = ids[ids.length - 1];
    }
  }
  if (positionId == null) throw new Error("No open perp position found to close");

  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "close_position",
    args: [
      Address.fromString(input.walletAddress).toScVal(),
      nativeToScVal(positionId, { type: "u32" }),
    ],
  });

  const pos = await readPosition(contractId, positionId);
  const mark = pos ? fromPriceE7(pos.entry_price_e7) : 0;

  return {
    type: "perp_close" as const,
    onChain: true,
    positionId,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Close on-chain perp #${positionId}. Sign to settle margin+PnL from the contract.`,
    entryPrice: pos ? fromPriceE7(pos.entry_price_e7) : undefined,
    market: pos?.symbol,
    side: pos?.side,
  };
}

async function readUserPositionIds(contractId: string, wallet: string): Promise<number[]> {
  const { Address, Contract, TransactionBuilder, Networks, BASE_FEE, scValToNative } =
    await import("@stellar/stellar-sdk");
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const rpc = new Server(SOROBAN_RPC);
  const { getDemoKeypair } = await import("./stellar");
  const demo = await getDemoKeypair();
  const account = await rpc.getAccount(demo.publicKey());
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("user_positions", Address.fromString(wallet).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  if (!retval) return [];
  return (scValToNative(retval) as number[]) ?? [];
}

async function readPosition(contractId: string, positionId: number): Promise<any | null> {
  const { Contract, TransactionBuilder, Networks, BASE_FEE, nativeToScVal, scValToNative } =
    await import("@stellar/stellar-sdk");
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const rpc = new Server(SOROBAN_RPC);
  const { getDemoKeypair } = await import("./stellar");
  const demo = await getDemoKeypair();
  const account = await rpc.getAccount(demo.publicKey());
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("get_position", nativeToScVal(positionId, { type: "u32" })))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  if (!retval) return null;
  return scValToNative(retval);
}

export async function formatPerpMarkets(): Promise<string> {
  const lines = [];
  for (const m of PERP_MARKETS) {
    const px = await markPrice(m.symbol);
    lines.push(
      `• ${m.symbol}-USDC · mark $${px.toFixed(m.symbol === "XLM" ? 4 : 2)} · max ${m.maxLeverage}x · on-chain margin`
    );
  }
  return [
    "Orbit Perps (on-chain Soroban):",
    "",
    ...lines,
    "",
    'Open: "open a 200 USDC long on bitcoin at 5x, stop loss at 90000, take profit at 120000"',
    'Close: "close my BTC perp"',
    process.env.ORBIT_PERPS_CONTRACT_ID
      ? `Contract: ${process.env.ORBIT_PERPS_CONTRACT_ID}`
      : "Set ORBIT_PERPS_CONTRACT_ID after deploy (see contracts/README.md).",
  ].join("\n");
}

export async function formatPerpPositions(wallet: string): Promise<string> {
  try {
    const contractId = requirePerpsContract();
    const ids = await readUserPositionIds(contractId, wallet);
    if (!ids.length) return "No on-chain perpetual positions.";
    const lines = ["Your on-chain perpetual positions:", ""];
    for (const id of ids) {
      const pos = await readPosition(contractId, id);
      if (!pos || pos.status === "Closed" || pos.status === "Liquidated") continue;
      const entry = fromPriceE7(pos.entry_price_e7);
      const mark = await markPrice(String(pos.symbol));
      const dir = pos.side === "Short" || pos.side === 1 ? -1 : 1;
      const notional = Number(pos.notional) / 1e7;
      const margin = Number(pos.margin) / 1e7;
      const uPnL = ((mark - entry) / entry) * dir * notional;
      lines.push(
        `• #${id} ${pos.side} ${pos.symbol} ${pos.leverage}x · margin $${margin.toFixed(2)} · entry $${entry.toFixed(2)} · mark $${mark.toFixed(2)} · uPnL $${uPnL.toFixed(2)}`
      );
    }
    return lines.length > 2 ? lines.join("\n") : "No open on-chain perpetual positions.";
  } catch (err: any) {
    return err?.message ?? "Perps contract not deployed.";
  }
}

export async function listPerpPositions(wallet: string) {
  try {
    const contractId = requirePerpsContract();
    const ids = await readUserPositionIds(contractId, wallet);
    const out = [];
    for (const id of ids) {
      const pos = await readPosition(contractId, id);
      if (!pos) continue;
      out.push({
        id,
        market: { symbol: pos.symbol },
        side: String(pos.side).toLowerCase().includes("short") ? "short" : "long",
        leverage: pos.leverage,
        marginUsdc: Number(pos.margin) / 1e7,
        notionalUsdc: Number(pos.notional) / 1e7,
        entryPrice: fromPriceE7(pos.entry_price_e7),
        stopLoss: pos.stop_loss_e7 ? fromPriceE7(pos.stop_loss_e7) : null,
        takeProfit: pos.take_profit_e7 ? fromPriceE7(pos.take_profit_e7) : null,
        liquidationPrice: 0,
        status: pos.status === "Open" || pos.status === 0 ? "open" : "closed",
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function confirmPerpOpen(_positionId: number, txHash: string) {
  return { status: "open", marginTxHash: txHash, onChain: true };
}

export async function ensurePerpMarkets() {
  // Markets created on-chain in deploy script.
}
