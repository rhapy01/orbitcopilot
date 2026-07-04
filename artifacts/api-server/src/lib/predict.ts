import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import {
  buildContractInvoke,
  enumUnit,
  NATIVE_XLM_SAC,
  requirePredictContract,
} from "./onchain";
import { SOROBAN_RPC } from "./stellar";

/** Market catalog — IDs must match on-chain create_market order in deploy script. */
export const PREDICT_MARKETS = [
  {
    id: 0,
    slug: "brazil-wins",
    question: "Will Brazil win their next major tournament match?",
    keywords: ["brazil", "brasil", "world cup", "football", "soccer"],
  },
  {
    id: 1,
    slug: "btc-100k",
    question: "Will Bitcoin trade above $100,000 USD this month?",
    keywords: ["bitcoin", "btc", "100k", "crypto"],
  },
  {
    id: 2,
    slug: "xlm-up-week",
    question: "Will XLM finish the week higher than it started?",
    keywords: ["xlm", "stellar", "price"],
  },
  {
    id: 3,
    slug: "eth-flip",
    question: "Will ETH outperform BTC over the next 7 days?",
    keywords: ["eth", "ethereum", "btc", "flip"],
  },
] as const;

function toStroops(human: string): string {
  const [w, f = ""] = human.trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt((w || "0") + frac).toString();
}

export function findPredictionMarket(hint: string) {
  const h = hint.toLowerCase();
  return (
    PREDICT_MARKETS.find(
      (m) =>
        m.slug.includes(h.replace(/\s+/g, "-")) ||
        m.keywords.some((k) => h.includes(k)) ||
        m.question.toLowerCase().includes(h)
    ) ?? null
  );
}

export async function listPredictionMarkets() {
  // Prefer live on-chain metadata when contract is deployed
  try {
    const contractId = requirePredictContract();
    const count = await simulateU32(contractId, "market_count", []);
    const markets = [];
    for (let id = 0; id < count; id++) {
      const onchain = await simulateMarket(contractId, id);
      const meta = PREDICT_MARKETS.find((m) => m.id === id);
      markets.push({
        id,
        slug: meta?.slug ?? `market-${id}`,
        question: onchain?.question ?? meta?.question ?? `Market #${id}`,
        status: onchain?.status ?? "open",
        yesPool: onchain?.yes_pool,
        noPool: onchain?.no_pool,
        onChain: true,
        contractId,
      });
    }
    return markets;
  } catch {
    return PREDICT_MARKETS.map((m) => ({
      ...m,
      status: "open",
      onChain: false,
      note: "Deploy orbit-predict to enable on-chain bets",
    }));
  }
}

async function simulateU32(contractId: string, method: string, args: any[]): Promise<number> {
  const { Contract, TransactionBuilder, Networks, BASE_FEE, scValToNative, Keypair } =
    await import("@stellar/stellar-sdk");
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const rpc = new Server(SOROBAN_RPC);
  const kp = Keypair.random();
  // Use a known account if possible — simulation source
  let account;
  try {
    const { getDemoKeypair } = await import("./stellar");
    const demo = await getDemoKeypair();
    account = await rpc.getAccount(demo.publicKey());
  } catch {
    await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
    account = await rpc.getAccount(kp.publicKey());
  }
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  if (!retval) return 0;
  return Number(scValToNative(retval));
}

async function simulateMarket(contractId: string, marketId: number) {
  const { Contract, TransactionBuilder, Networks, BASE_FEE, nativeToScVal, scValToNative, Keypair } =
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
    .addOperation(contract.call("get_market", nativeToScVal(marketId, { type: "u32" })))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  if (!retval) return null;
  return scValToNative(retval) as any;
}

/** Build on-chain place_bet invocation (tokens move into the contract). */
export async function preparePredictionBet(input: {
  walletAddress: string;
  marketHint: string;
  outcome: "yes" | "no";
  amountXlm: string;
}) {
  const contractId = requirePredictContract();
  const market = findPredictionMarket(input.marketHint);
  if (!market) {
    const list = PREDICT_MARKETS.map((m) => `• ${m.slug}: ${m.question}`).join("\n");
    throw new Error(`No market matched "${input.marketHint}".\n${list}`);
  }

  const amount = toStroops(input.amountXlm);
  const outcomeName = input.outcome === "no" ? "No" : "Yes";

  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const better = Address.fromString(input.walletAddress);
  const args = [
    better.toScVal(),
    nativeToScVal(market.id, { type: "u32" }),
    await enumUnit(outcomeName),
    nativeToScVal(BigInt(amount), { type: "i128" }),
  ];

  // User must also authorize token transfer — place_bet pulls via token.transfer from better
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "place_bet",
    args,
  });

  return {
    type: "predict_bet" as const,
    onChain: true,
    contractId,
    marketId: market.id,
    market: { id: market.id, slug: market.slug, question: market.question },
    outcome: input.outcome,
    amountXlm: parseFloat(input.amountXlm),
    token: NATIVE_XLM_SAC,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    // No off-chain position id — ledger is source of truth
    positionId: market.id,
  };
}

export async function formatPredictionMarkets(): Promise<string> {
  const markets = await listPredictionMarkets();
  const lines = markets.map((m: any) => {
    const pools =
      m.yesPool != null
        ? ` · yes ${m.yesPool} / no ${m.noPool} (stroops)`
        : "";
    const chain = m.onChain ? "on-chain" : "deploy pending";
    return `• ${m.slug} [${chain}]: ${m.question}${pools}`;
  });
  return [
    "Orbit Predict (on-chain Soroban binary markets):",
    "",
    ...lines,
    "",
    'Bet: "invest 2 XLM on Brazil to win" — stakes XLM into the contract.',
    process.env.ORBIT_PREDICT_CONTRACT_ID
      ? `Contract: ${process.env.ORBIT_PREDICT_CONTRACT_ID}`
      : "Set ORBIT_PREDICT_CONTRACT_ID after deploy (see contracts/README.md).",
  ].join("\n");
}

export async function formatPredictionPositions(wallet: string): Promise<string> {
  try {
    const contractId = requirePredictContract();
    const { Address, nativeToScVal, scValToNative, Contract, TransactionBuilder, Networks, BASE_FEE } =
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
      .addOperation(
        contract.call("user_markets", Address.fromString(wallet).toScVal())
      )
      .setTimeout(30)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    const retval = (sim as any)?.result?.retval;
    if (!retval) return "No on-chain prediction positions.";
    const marketIds = scValToNative(retval) as number[];
    if (!marketIds?.length) return "No on-chain prediction positions.";

    const lines: string[] = ["Your on-chain prediction positions:", ""];
    for (const mid of marketIds) {
      const meta = PREDICT_MARKETS.find((m) => m.id === mid);
      for (const outcome of ["Yes", "No"] as const) {
        try {
          const ptx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              contract.call(
                "get_position",
                Address.fromString(wallet).toScVal(),
                nativeToScVal(mid, { type: "u32" }),
                await enumUnit(outcome)
              )
            )
            .setTimeout(30)
            .build();
          const psim = await rpc.simulateTransaction(ptx);
          const prev = (psim as any)?.result?.retval;
          if (!prev) continue;
          const pos = scValToNative(prev) as any;
          if (pos?.amount > 0) {
            lines.push(
              `• Market ${meta?.slug ?? mid}: ${outcome} stake ${pos.amount} stroops` +
                (pos.claimed ? " (claimed)" : "")
            );
          }
        } catch {
          // no position for this outcome
        }
      }
    }
    return lines.length > 2 ? lines.join("\n") : "No on-chain prediction positions.";
  } catch (err: any) {
    return err?.message ?? "Prediction contract not deployed.";
  }
}

// confirm is a no-op for on-chain — ledger is truth after submit
export async function confirmPredictionBet(_positionId: number, txHash: string) {
  return { status: "active", stakeTxHash: txHash, onChain: true };
}

export async function ensurePredictionMarkets() {
  // Markets are created on-chain in deploy script — nothing to seed in DB.
}

/** On-chain positions for portfolio intelligence. */
export async function listPredictionPositions(wallet: string) {
  try {
    const contractId = requirePredictContract();
    const { Address, nativeToScVal, scValToNative, Contract, TransactionBuilder, Networks, BASE_FEE } =
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
      .addOperation(contract.call("user_markets", Address.fromString(wallet).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    const retval = (sim as any)?.result?.retval;
    if (!retval) return [];
    const marketIds = (scValToNative(retval) as number[]) ?? [];
    const out: any[] = [];
    for (const mid of marketIds) {
      const meta = PREDICT_MARKETS.find((m) => m.id === mid);
      for (const outcome of ["Yes", "No"] as const) {
        try {
          const ptx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              contract.call(
                "get_position",
                Address.fromString(wallet).toScVal(),
                nativeToScVal(mid, { type: "u32" }),
                await enumUnit(outcome)
              )
            )
            .setTimeout(30)
            .build();
          const psim = await rpc.simulateTransaction(ptx);
          const prev = (psim as any)?.result?.retval;
          if (!prev) continue;
          const pos = scValToNative(prev) as any;
          if (pos?.amount > 0 && !pos.claimed) {
            out.push({
              id: mid,
              marketId: mid,
              outcome: outcome.toLowerCase(),
              amountXlm: Number(pos.amount) / 1e7,
              status: "active",
              market: { slug: meta?.slug, question: meta?.question, id: mid },
            });
          }
        } catch {
          // no position
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
