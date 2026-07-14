import {
  buildContractInvoke,
  enumUnit,
  NATIVE_XLM_SAC,
  requirePredictContract,
} from "./onchain";
import { SOROBAN_RPC } from "./stellar";

export type PredictCategory = "sports" | "crypto" | "other";

export type PredictMarketMeta = {
  id: number;
  slug: string;
  question: string;
  keywords: string[];
  category: PredictCategory;
  teams?: string[];
  competition?: string;
  closesAt?: string;
  timeframeLabel?: string;
};

/**
 * Market catalog — IDs 0–3 must match the original deploy seed order.
 * IDs 4+ are append-only sports fixtures (seed via seed-predict-sports.mjs).
 */
export const PREDICT_MARKETS: readonly PredictMarketMeta[] = [
  {
    id: 0,
    slug: "brazil-wins",
    question: "Will Brazil win their next major tournament match?",
    keywords: ["brazil", "brasil", "world cup", "football", "soccer"],
    category: "sports",
    teams: ["brazil"],
    competition: "International",
    timeframeLabel: "Next major tournament match",
  },
  {
    id: 1,
    slug: "btc-100k",
    question: "Will Bitcoin trade above $100,000 USD this month?",
    keywords: ["bitcoin", "btc", "100k", "crypto"],
    category: "crypto",
    timeframeLabel: "This calendar month",
  },
  {
    id: 2,
    slug: "xlm-up-week",
    question: "Will XLM finish the week higher than it started?",
    keywords: ["xlm", "stellar", "price"],
    category: "crypto",
    timeframeLabel: "This week",
  },
  {
    id: 3,
    slug: "eth-flip",
    question: "Will ETH outperform BTC over the next 7 days?",
    keywords: ["eth", "ethereum", "btc", "flip"],
    category: "crypto",
    timeframeLabel: "Next 7 days",
  },
  {
    id: 4,
    slug: "chelsea-arsenal-epl",
    question: "Will Chelsea beat Arsenal in the Premier League?",
    keywords: [
      "chelsea",
      "arsenal",
      "epl",
      "premier league",
      "premier",
      "football",
      "soccer",
    ],
    category: "sports",
    teams: ["chelsea", "arsenal"],
    competition: "Premier League",
    closesAt: "2026-04-19T14:00:00.000Z",
    timeframeLabel: "EPL Sun 15:00",
  },
  {
    id: 5,
    slug: "chelsea-arsenal-fa-cup",
    question: "Will Chelsea beat Arsenal in the FA Cup?",
    keywords: [
      "chelsea",
      "arsenal",
      "fa cup",
      "facup",
      "cup",
      "football",
      "soccer",
    ],
    category: "sports",
    teams: ["chelsea", "arsenal"],
    competition: "FA Cup",
    closesAt: "2026-05-03T16:00:00.000Z",
    timeframeLabel: "FA Cup Sat 17:00",
  },
  {
    id: 6,
    slug: "liverpool-city-epl",
    question: "Will Liverpool beat Manchester City in the Premier League?",
    keywords: [
      "liverpool",
      "manchester city",
      "man city",
      "city",
      "epl",
      "premier league",
      "football",
      "soccer",
    ],
    category: "sports",
    teams: ["liverpool", "manchester city"],
    competition: "Premier League",
    closesAt: "2026-04-26T15:30:00.000Z",
    timeframeLabel: "EPL Sat 16:30",
  },
] as const;

/** Markets that must be created on-chain via seed-predict-sports.mjs (append-only). */
export const PREDICT_SPORTS_SEED = PREDICT_MARKETS.filter((m) => m.id >= 4);

function toStroops(human: string): string {
  const [w, f = ""] = human.trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt((w || "0") + frac).toString();
}

function stroopsToXlm(raw: unknown): number {
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 1e7;
}

export function getPredictMarketById(id: number): PredictMarketMeta | null {
  return PREDICT_MARKETS.find((m) => m.id === id) ?? null;
}

export function getPredictMarketBySlug(slug: string): PredictMarketMeta | null {
  const s = slug.trim().toLowerCase();
  return PREDICT_MARKETS.find((m) => m.slug === s) ?? null;
}

/** Score markets for a free-text hint (teams, competition, timeframe, keywords). */
export function scorePredictionMarkets(hint: string): Array<{
  market: PredictMarketMeta;
  score: number;
}> {
  const h = hint.toLowerCase().trim();
  if (!h) return [];

  const slugHint = h.replace(/\s+/g, "-");
  const scored: Array<{ market: PredictMarketMeta; score: number }> = [];

  for (const m of PREDICT_MARKETS) {
    let score = 0;
    if (m.slug === h || m.slug === slugHint) score += 100;
    if (m.slug.includes(slugHint) || slugHint.includes(m.slug)) score += 40;
    if (m.question.toLowerCase().includes(h)) score += 25;

    for (const k of m.keywords) {
      if (h.includes(k)) score += k.length >= 5 ? 12 : 8;
    }
    if (m.teams?.length) {
      const hits = m.teams.filter((t) => h.includes(t.toLowerCase()));
      score += hits.length * 18;
      if (hits.length >= 2) score += 30; // both sides named
    }
    if (m.competition) {
      const c = m.competition.toLowerCase();
      if (h.includes(c) || (c.includes("premier") && /\bepl\b|premier/.test(h))) {
        score += 22;
      }
      if (/\bfa\s*cup\b/.test(h) && c.includes("fa cup")) score += 28;
    }
    if (m.timeframeLabel) {
      const tf = m.timeframeLabel.toLowerCase();
      if (h.includes("sunday") && tf.includes("sun")) score += 15;
      if (h.includes("saturday") && tf.includes("sat")) score += 15;
      if (h.includes("weekend") && (tf.includes("sat") || tf.includes("sun"))) score += 10;
      if (h.includes("epl") && tf.includes("epl")) score += 12;
      if (h.includes("fa cup") && tf.includes("fa cup")) score += 18;
    }
    if (score > 0) scored.push({ market: m, score });
  }

  scored.sort((a, b) => b.score - a.score || a.market.id - b.market.id);
  return scored;
}

export type ResolvePredictionResult =
  | { status: "none"; hint: string }
  | { status: "unique"; market: PredictMarketMeta }
  | { status: "ambiguous"; markets: PredictMarketMeta[]; hint: string };

/**
 * Resolve a user hint to zero, one, or many markets.
 * Unique if top score clearly leads, or exact slug match.
 */
export function resolvePredictionMarkets(hint: string): ResolvePredictionResult {
  const h = hint.trim();
  if (!h) return { status: "none", hint: h };

  const exact = getPredictMarketBySlug(h) ?? getPredictMarketBySlug(h.replace(/\s+/g, "-"));
  if (exact) return { status: "unique", market: exact };

  const scored = scorePredictionMarkets(h);
  if (!scored.length) return { status: "none", hint: h };

  const top = scored[0]!;
  const second = scored[1];
  // Clear winner: alone, or meaningfully ahead of #2
  if (!second || top.score >= second.score + 15) {
    return { status: "unique", market: top.market };
  }
  // Near-ties among top cluster
  const cluster = scored.filter((s) => s.score >= top.score - 10).map((s) => s.market);
  if (cluster.length === 1) return { status: "unique", market: cluster[0]! };
  return { status: "ambiguous", markets: cluster, hint: h };
}

/** @deprecated Prefer resolvePredictionMarkets — kept for callers expecting a single hit. */
export function findPredictionMarket(hint: string): PredictMarketMeta | null {
  const r = resolvePredictionMarkets(hint);
  return r.status === "unique" ? r.market : null;
}

export function formatAmbiguousMarkets(
  markets: PredictMarketMeta[],
  hint?: string
): string {
  const lines = markets.map((m, i) => {
    const tf = m.timeframeLabel ? ` · ${m.timeframeLabel}` : "";
    const comp = m.competition ? ` (${m.competition})` : "";
    return `${i + 1}. **${m.slug}**${comp}${tf}\n   ${m.question}`;
  });
  return [
    hint
      ? `Several markets match “${hint.trim()}”. Which one?`
      : "Several markets match. Which one?",
    "",
    ...lines,
    "",
    'Reply with a number (e.g. "1"), the slug, or a timeframe ("the EPL one").',
  ].join("\n");
}

/** Pending clarify-bet keyed by session or wallet (serverless-safe within instance). */
type PendingPredictBet = {
  amountXlm: string;
  outcome: "yes" | "no";
  markets: PredictMarketMeta[];
  createdAt: number;
};

const pendingPredictBets = new Map<string, PendingPredictBet>();
const PENDING_TTL_MS = 15 * 60 * 1000;

export function setPendingPredictBet(
  key: string,
  pending: Omit<PendingPredictBet, "createdAt">
): void {
  pendingPredictBets.set(key, { ...pending, createdAt: Date.now() });
}

export function clearPendingPredictBet(key: string): void {
  pendingPredictBets.delete(key);
}

export function getPendingPredictBet(key: string): PendingPredictBet | null {
  const p = pendingPredictBets.get(key);
  if (!p) return null;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    pendingPredictBets.delete(key);
    return null;
  }
  return p;
}

/** Parse "1", "2", "the epl one", or a slug after a clarify turn. */
export function pickPendingMarket(
  content: string,
  pending: PendingPredictBet
): PredictMarketMeta | null {
  const t = content.trim().toLowerCase();
  const num = t.match(/^#?(\d+)\.?$/);
  if (num) {
    const idx = Number(num[1]) - 1;
    return pending.markets[idx] ?? null;
  }
  const bySlug = pending.markets.find(
    (m) => m.slug === t || m.slug === t.replace(/\s+/g, "-")
  );
  if (bySlug) return bySlug;

  const scored = pending.markets
    .map((m) => {
      let score = 0;
      if (m.competition && t.includes(m.competition.toLowerCase())) score += 20;
      if (/\bepl\b|premier/.test(t) && m.competition?.toLowerCase().includes("premier")) {
        score += 25;
      }
      if (/\bfa\s*cup\b/.test(t) && m.competition?.toLowerCase().includes("fa cup")) {
        score += 25;
      }
      if (m.timeframeLabel && t.includes(m.timeframeLabel.toLowerCase())) score += 15;
      for (const team of m.teams ?? []) {
        if (t.includes(team)) score += 5;
      }
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1 || (scored[0] && scored[0].score > (scored[1]?.score ?? 0))) {
    return scored[0]!.m;
  }
  return null;
}

export async function listPredictionMarkets(opts?: {
  category?: PredictCategory | "all";
}) {
  const category = opts?.category ?? "all";
  const filterMeta = (m: PredictMarketMeta) =>
    category === "all" ? true : m.category === category;

  try {
    const contractId = requirePredictContract();
    const count = await simulateU32(contractId, "market_count", []);
    const markets = [];
    for (let id = 0; id < count; id++) {
      const onchain = await simulateMarket(contractId, id);
      const meta = PREDICT_MARKETS.find((m) => m.id === id);
      if (meta && !filterMeta(meta)) continue;
      if (!meta && category !== "all") continue;
      const yesPool = onchain?.yes_pool;
      const noPool = onchain?.no_pool;
      markets.push({
        id,
        slug: meta?.slug ?? `market-${id}`,
        question: onchain?.question ?? meta?.question ?? `Market #${id}`,
        status: String(onchain?.status ?? "open").toLowerCase(),
        yesPool,
        noPool,
        yesXlm: stroopsToXlm(yesPool),
        noXlm: stroopsToXlm(noPool),
        category: meta?.category ?? "other",
        competition: meta?.competition,
        timeframeLabel: meta?.timeframeLabel,
        teams: meta?.teams,
        onChain: true,
        contractId,
      });
    }
    // Include catalog sports not yet on-chain so listing still teaches the UX
    for (const meta of PREDICT_MARKETS) {
      if (!filterMeta(meta)) continue;
      if (markets.some((m) => m.id === meta.id)) continue;
      markets.push({
        id: meta.id,
        slug: meta.slug,
        question: meta.question,
        status: "open",
        yesPool: undefined,
        noPool: undefined,
        yesXlm: 0,
        noXlm: 0,
        category: meta.category,
        competition: meta.competition,
        timeframeLabel: meta.timeframeLabel,
        teams: meta.teams,
        onChain: false,
        contractId,
        note: "Seed with seed-predict-sports.mjs to enable on-chain bets",
      });
    }
    return markets.sort((a, b) => a.id - b.id);
  } catch {
    return PREDICT_MARKETS.filter(filterMeta).map((m) => ({
      ...m,
      status: "open",
      yesXlm: 0,
      noXlm: 0,
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
    .addOperation(contract.call("get_market", nativeToScVal(marketId, { type: "u32" })))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  if (!retval) return null;
  return scValToNative(retval) as any;
}

function requireUniqueMarket(hint: string): PredictMarketMeta {
  const resolved = resolvePredictionMarkets(hint);
  if (resolved.status === "unique") return resolved.market;
  if (resolved.status === "ambiguous") {
    throw new Error(formatAmbiguousMarkets(resolved.markets, hint));
  }
  const list = PREDICT_MARKETS.map((m) => `• ${m.slug}: ${m.question}`).join("\n");
  throw new Error(
    `No market matched "${hint}". Try "list sports markets" or "list prediction markets".\n${list}`
  );
}

/** Build on-chain place_bet invocation (tokens move into the contract). */
export async function preparePredictionBet(input: {
  walletAddress: string;
  marketHint: string;
  outcome: "yes" | "no";
  amountXlm: string;
  /** When set, skip resolve and use this catalog row (after disambiguation). */
  marketId?: number;
}) {
  const contractId = requirePredictContract();
  const market =
    input.marketId != null
      ? getPredictMarketById(input.marketId)
      : requireUniqueMarket(input.marketHint);
  if (!market) {
    throw new Error(`Unknown market id ${input.marketId}`);
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
    market: {
      id: market.id,
      slug: market.slug,
      question: market.question,
      timeframeLabel: market.timeframeLabel,
      competition: market.competition,
    },
    outcome: input.outcome,
    amountXlm: parseFloat(input.amountXlm),
    token: NATIVE_XLM_SAC,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    positionId: market.id,
  };
}

/** Claim winnings after a market is resolved on-chain. */
export async function preparePredictionClaim(input: {
  walletAddress: string;
  marketHint: string;
  outcome: "yes" | "no";
}) {
  const contractId = requirePredictContract();
  const market = requireUniqueMarket(input.marketHint);

  const outcomeName = input.outcome === "no" ? "No" : "Yes";
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const claimer = Address.fromString(input.walletAddress);
  const args = [
    claimer.toScVal(),
    nativeToScVal(market.id, { type: "u32" }),
    await enumUnit(outcomeName),
  ];

  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "claim",
    args,
  });

  return {
    type: "predict_claim" as const,
    onChain: true,
    contractId,
    marketId: market.id,
    market: { id: market.id, slug: market.slug, question: market.question },
    outcome: input.outcome,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    positionId: market.id,
    message: `Claim ${input.outcome.toUpperCase()} on ${market.slug}. Markets must be resolved on-chain first — if unresolved or you lost, the contract will reject. Sign only if you expect a payout.`,
  };
}

function formatMarketLine(m: any): string {
  const status = String(m.status ?? "open").toUpperCase();
  const yes = m.yesXlm ?? stroopsToXlm(m.yesPool);
  const no = m.noXlm ?? stroopsToXlm(m.noPool);
  const total = yes + no;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : null;
  const pools =
    total > 0
      ? ` · pool ${yes.toFixed(2)} / ${no.toFixed(2)} XLM` +
        (yesPct != null ? ` (≈${yesPct}% yes)` : "")
      : "";
  const tf = m.timeframeLabel ? ` · ${m.timeframeLabel}` : "";
  const chain = m.onChain ? "on-chain" : "seed pending";
  return `• **${m.slug}** [${status}] [${chain}]${tf}\n  ${m.question}${pools}`;
}

export async function formatPredictionMarkets(opts?: {
  category?: PredictCategory | "all";
}): Promise<string> {
  const category = opts?.category ?? "all";
  const markets = await listPredictionMarkets({ category });
  const title =
    category === "sports"
      ? "Orbit Predict — sports markets:"
      : category === "crypto"
        ? "Orbit Predict — crypto markets:"
        : "Orbit Predict (on-chain Soroban binary markets):";

  const lines = markets.map(formatMarketLine);
  return [
    title,
    "",
    ...(lines.length ? lines : ["(no markets in this category yet)"]),
    "",
    'Bet: "buy yes for Chelsea over Arsenal with 30 XLM" or "bet 2 XLM yes on chelsea-arsenal-epl".',
    'List: "list sports markets" · Claim after resolve: "claim yes on chelsea-arsenal-epl".',
    'Admin resolve: `node artifacts/api-server/scripts/resolve-predict.mjs <slug> yes`',
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
      .addOperation(contract.call("user_markets", Address.fromString(wallet).toScVal()))
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
            const xlm = (Number(pos.amount) / 1e7).toFixed(4);
            lines.push(
              `• ${meta?.slug ?? mid}${meta?.timeframeLabel ? ` (${meta.timeframeLabel})` : ""}: ${outcome} ${xlm} XLM` +
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

export async function confirmPredictionBet(_positionId: number, txHash: string) {
  return { status: "active", stakeTxHash: txHash, onChain: true };
}

export async function ensurePredictionMarkets() {
  // Markets are created on-chain in deploy / seed scripts — nothing to seed in DB.
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

/**
 * Parse natural-language sports / predict bets.
 * Returns null if not a bet intent.
 */
export function parsePredictBetIntent(content: string): {
  amountXlm: string;
  outcome: "yes" | "no";
  hint: string;
} | null {
  const c = content.trim();

  // bet/invest 30 xlm yes on chelsea-arsenal-epl
  const yesNo = c.match(
    /\b(?:bet|invest)\s+([\d.]+)\s*xlm\s+(yes|no)\s+on\s+([a-z0-9\-]+)\b/i
  );
  if (yesNo) {
    return {
      amountXlm: yesNo[1]!,
      outcome: yesNo[2]!.toLowerCase() === "no" ? "no" : "yes",
      hint: yesNo[3]!,
    };
  }

  // invest/bet/predict 30 xlm on Brazil to win
  const toWin = c.match(
    /\b(?:invest|bet|predict)\s+([\d.]+)\s*xlm\s+(?:on\s+)?(.+?)\s+to\s+win\b/i
  );
  if (toWin) {
    return { amountXlm: toWin[1]!, outcome: "yes", hint: toWin[2]!.trim() };
  }

  // buy yes for chelsea … with 30 xlm  /  buy yes chelsea over arsenal with 30 xlm
  const buyYes = c.match(
    /\bbuy\s+(yes|no)\s+(?:for\s+)?(.+?)\s+(?:with|for)\s+([\d.]+)\s*xlm\b/i
  );
  if (buyYes) {
    return {
      amountXlm: buyYes[3]!,
      outcome: buyYes[1]!.toLowerCase() === "no" ? "no" : "yes",
      hint: buyYes[2]!.trim(),
    };
  }

  // predict chelsea to win over arsenal with 30 xlm
  const predictOver = c.match(
    /\bpredict\s+(.+?)\s+to\s+win\s+over\s+(.+?)\s+(?:with|for)\s+([\d.]+)\s*xlm\b/i
  );
  if (predictOver) {
    return {
      amountXlm: predictOver[3]!,
      outcome: "yes",
      hint: `${predictOver[1]!.trim()} ${predictOver[2]!.trim()}`,
    };
  }

  // chelsea to win over arsenal — 30 xlm yes
  const teamOver = c.match(
    /\b(.+?)\s+to\s+win\s+over\s+(.+?)(?:\s+with|\s+for)?\s+([\d.]+)\s*xlm\b/i
  );
  if (teamOver && /\b(predict|bet|buy|yes|no)\b/i.test(c)) {
    return {
      amountXlm: teamOver[3]!,
      outcome: /\bbuy\s+no\b|\bno\b/i.test(c) && !/\bbuy\s+yes\b/i.test(c) ? "no" : "yes",
      hint: `${teamOver[1]!.trim()} ${teamOver[2]!.trim()}`,
    };
  }

  return null;
}
