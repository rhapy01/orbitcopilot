import { getAccountBalances, getAssetPrice } from "./stellar";
import {
  getSteldexFarmPools,
  getSteldexFarmPositions,
  getSteldexOrders,
} from "./steldex";
import { getSoroswapBalances, getSoroswapPositions, soroswapConfigured } from "./soroswap";
import { getBlendContracts } from "./blend";
import { getLiveDefiOpportunities } from "./defi-live";
import { listPredictionPositions } from "./predict";
import { listPerpPositions, markPrice } from "./perps";
import { CacheKeys, CacheTtl, cachedJson } from "./cache";

export type PositionStatus = "earning" | "idle" | "borrowing" | "pending";

export interface PortfolioPosition {
  id: string;
  protocol: string;
  kind: "wallet" | "lp" | "farm" | "lend" | "borrow" | "order";
  label: string;
  asset: string;
  amount: string;
  status: PositionStatus;
  /** Human reason for status */
  note: string;
  /** Suggested next action in natural language */
  suggestion?: string;
  meta?: Record<string, unknown>;
}

export interface RebalanceMove {
  priority: number;
  from: string;
  to: string;
  reason: string;
  /** Chat command the user can paste */
  command: string;
}

export interface PortfolioIntel {
  wallet: string;
  network: "testnet";
  positions: PortfolioPosition[];
  summary: {
    earning: number;
    idle: number;
    borrowing: number;
    pending: number;
  };
  moves: RebalanceMove[];
}

function isPositiveLiquidity(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s || s === "0") return false;
  try {
    return BigInt(s) > 0n;
  } catch {
    return parseFloat(s) > 0;
  }
}

/** Live chain/protocol reads (no cache). */
async function buildPortfolioIntelLive(publicKey: string): Promise<PortfolioIntel> {
  const positions: PortfolioPosition[] = [];

  // --- Wallet balances (idle cash unless we know it's deployed) ---
  const classic = await getAccountBalances(publicKey).catch(() => []);
  for (const b of classic) {
    if (b.balance <= 0) continue;
    const price = await getAssetPrice(b.assetCode, b.assetIssuer ?? undefined).catch(() => 0);
    const value = b.balance * price;
    const idleCash = b.assetCode === "USDC" || b.assetCode === "XLM";
    positions.push({
      id: `wallet-${b.assetCode}`,
      protocol: "Wallet",
      kind: "wallet",
      label: `${b.assetCode} balance`,
      asset: b.assetCode,
      amount: b.balance.toFixed(4),
      status: "idle",
      note:
        idleCash && value >= 1
          ? "Sitting in wallet — not earning yield"
          : "Wallet balance",
      suggestion:
        b.assetCode === "USDC" && b.balance >= 1
          ? `supply ${b.balance.toFixed(2)} USDC on Blend`
          : b.assetCode === "XLM" && b.balance >= 5
            ? `add liquidity ${(b.balance * 0.2).toFixed(2)} XLM and ${(b.balance * 0.2).toFixed(2)} pUSDC`
            : undefined,
      meta: { valueUsd: value },
    });
  }

  // --- Soroswap token balances (idle if not in LP) ---
  if (soroswapConfigured()) {
    try {
      const data = await getSoroswapBalances(publicKey);
      const list = Array.isArray(data?.balances) ? data.balances : [];
      for (const b of list) {
        const code = String(b.asset?.code ?? b.code ?? "?");
        const amount = String(b.amount ?? b.available ?? "0");
        if (!isPositiveLiquidity(amount) && parseFloat(amount) <= 0) continue;
        // Skip duplicates of classic XLM/USDC if same
        if (positions.some((p) => p.id === `wallet-${code}`)) continue;
        positions.push({
          id: `soroswap-bal-${code}`,
          protocol: "Soroswap",
          kind: "wallet",
          label: `${code} (Soroban)`,
          asset: code,
          amount,
          status: "idle",
          note: "Soroban balance — not in an LP",
          suggestion:
            code === "USDC" || code === "XLM"
              ? `add liquidity on Soroswap with ${code}`
              : undefined,
        });
      }
    } catch {
      // ignore
    }

    try {
      const spos = await getSoroswapPositions(publicKey);
      const list = Array.isArray(spos) ? spos : [];
      for (const p of list) {
        const a = p.poolInfo?.tokenA?.symbol ?? "?";
        const b = p.poolInfo?.tokenB?.symbol ?? "?";
        const shares = String(p.userPosition ?? p.userShares ?? "0");
        if (!isPositiveLiquidity(shares) && parseFloat(shares) <= 0) continue;
        positions.push({
          id: `soroswap-lp-${a}-${b}`,
          protocol: "Soroswap",
          kind: "lp",
          label: `LP ${a}/${b}`,
          asset: `${a}/${b}`,
          amount: shares,
          status: "earning",
          note: "Providing liquidity — earning swap fees",
          suggestion: `remove liquidity ${a}/${b} on Soroswap if you want to exit`,
          meta: { pair: `${a}/${b}` },
        });
      }
    } catch {
      // ignore
    }
  }

  // --- StelDex farm pools (LP available vs staked) ---
  try {
    const farmPools = (await getSteldexFarmPools(publicKey)) as any[];
    for (const p of farmPools) {
      const pair = String(p.pair ?? "unknown");
      const poolContract = p.poolContract;

      if (isPositiveLiquidity(p.lpLiquidity)) {
        const unstaked = isPositiveLiquidity(p.availableToStake);
        positions.push({
          id: `steldex-lp-${pair}`,
          protocol: "StelDex",
          kind: "lp",
          label: `LP ${pair}`,
          asset: pair,
          amount: String(p.lpLiquidity),
          status: unstaked ? "idle" : "earning",
          note: unstaked
            ? "LP tokens not fully staked — missing farm rewards"
            : "LP in pool",
          suggestion: unstaked
            ? `stake ${pair}`
            : `remove liquidity ${pair}`,
          meta: {
            poolContract,
            availableToStake: p.availableToStake,
            stakedLiquidity: p.stakedLiquidity,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
          },
        });
      }

      if (isPositiveLiquidity(p.stakedLiquidity)) {
        positions.push({
          id: `steldex-farm-${pair}`,
          protocol: "StelDex",
          kind: "farm",
          label: `Farm ${pair}`,
          asset: pair,
          amount: String(p.stakedLiquidity),
          status: "earning",
          note: "Staked in farm — earning STELLAR rewards",
          suggestion: `claim rewards from ${pair}`,
          meta: { poolContract },
        });
      }
    }
  } catch {
    // ignore
  }

  try {
    const farmPositions = (await getSteldexFarmPositions(publicKey)) as any[];
    for (const p of farmPositions) {
      const pair = String(p.pair ?? p.poolContract ?? "farm");
      const id = `steldex-pos-${pair}-${p.tickLower}-${p.tickUpper}`;
      if (positions.some((x) => x.id === id || x.id === `steldex-farm-${pair}`)) continue;
      const liq = p.stake?.liquidity ?? p.liquidity ?? "0";
      if (!isPositiveLiquidity(liq)) continue;
      positions.push({
        id,
        protocol: "StelDex",
        kind: "farm",
        label: `Farm position ${pair}`,
        asset: pair,
        amount: String(liq),
        status: "earning",
        note: "Active farm stake — earning rewards",
        suggestion: `claim rewards from ${pair}`,
        meta: {
          poolContract: p.poolContract,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
        },
      });
    }
  } catch {
    // ignore
  }

  try {
    const orders = (await getSteldexOrders(publicKey)) as any[];
    for (const o of orders) {
      positions.push({
        id: `steldex-order-${o.orderId}`,
        protocol: "StelDex",
        kind: "order",
        label: `Limit order #${o.orderId}`,
        asset: String(o.pair ?? "order"),
        amount: "1",
        status: "pending",
        note: `Open order (${o.status ?? "open"}) — capital reserved until fill/cancel`,
        suggestion: `cancel order ${o.orderId}`,
        meta: { orderId: String(o.orderId) },
      });
    }
  } catch {
    // ignore
  }

  // --- Blend: we don't have live position reads yet; surface opportunity if idle USDC ---
  try {
    const blend = await getBlendContracts();
    const idleUsdc = positions.find(
      (p) => p.kind === "wallet" && p.asset === "USDC" && p.status === "idle"
    );
    if (idleUsdc && blend.ids.TestnetV2) {
      positions.push({
        id: "blend-opportunity",
        protocol: "Blend",
        kind: "lend",
        label: "Blend lending (available)",
        asset: "USDC/XLM/BLND",
        amount: "0",
        status: "idle",
        note: "No live Blend position detected — idle cash can be supplied to earn",
        suggestion: idleUsdc
          ? `supply ${idleUsdc.amount} USDC on Blend`
          : "supply 10 USDC on Blend",
        meta: { pool: blend.ids.TestnetV2 },
      });
    }
  } catch {
    // ignore
  }

  // --- Orbit prediction positions ---
  try {
    const preds = await listPredictionPositions(publicKey);
    for (const p of preds) {
      if (p.status !== "active" && p.status !== "pending") continue;
      positions.push({
        id: `predict-${p.id}`,
        protocol: "Orbit Predict",
        kind: "order",
        label: `${p.outcome.toUpperCase()} — ${p.market?.slug ?? p.marketId}`,
        asset: "XLM",
        amount: String(p.amountXlm),
        status: p.status === "pending" ? "pending" : "earning",
        note:
          p.status === "pending"
            ? "Prediction stake pending confirmation"
            : `Prediction bet on ${p.outcome} — ${p.market?.question ?? ""}`,
        suggestion: undefined,
        meta: { positionId: p.id, marketId: p.marketId },
      });
    }
  } catch {
    // ignore
  }

  // --- Orbit perp positions ---
  try {
    const perps = await listPerpPositions(publicKey);
    for (const p of perps) {
      if (p.status !== "open" && p.status !== "pending") continue;
      const sym = p.market?.symbol ?? "?";
      const mark = p.status === "open" ? await markPrice(sym) : p.entryPrice;
      const dir = p.side === "long" ? 1 : -1;
      const uPnL =
        p.status === "open"
          ? ((mark - p.entryPrice) / p.entryPrice) * dir * p.notionalUsdc
          : 0;
      positions.push({
        id: `perp-${p.id}`,
        protocol: "Orbit Perps",
        kind: "borrow",
        label: `${p.side.toUpperCase()} ${sym} ${p.leverage}x`,
        asset: sym,
        amount: String(p.marginUsdc),
        status: p.status === "pending" ? "pending" : uPnL >= 0 ? "earning" : "borrowing",
        note:
          p.status === "pending"
            ? "Perp margin pending confirmation"
            : `uPnL $${uPnL.toFixed(2)} · entry $${p.entryPrice.toFixed(2)} · mark $${mark.toFixed(2)}`,
        suggestion: `close my ${sym} perp`,
        meta: {
          positionId: p.id,
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
          liquidationPrice: p.liquidationPrice,
        },
      });
    }
  } catch {
    // ignore
  }

  const summary = {
    earning: positions.filter((p) => p.status === "earning").length,
    idle: positions.filter((p) => p.status === "idle" && p.kind !== "lend").length,
    borrowing: positions.filter((p) => p.status === "borrowing").length,
    pending: positions.filter((p) => p.status === "pending").length,
  };

  const moves = buildRebalanceMoves(positions);

  return {
    wallet: publicKey,
    network: "testnet",
    positions,
    summary,
    moves,
  };
}

/** Redis-cached portfolio intel (30s). Chain remains authority; cache is UX only. */
export async function buildPortfolioIntel(
  publicKey: string
): Promise<PortfolioIntel> {
  return cachedJson(
    CacheKeys.portfolioIntel(publicKey),
    CacheTtl.portfolioSeconds,
    () => buildPortfolioIntelLive(publicKey)
  );
}

function buildRebalanceMoves(positions: PortfolioPosition[]): RebalanceMove[] {
  const moves: RebalanceMove[] = [];
  let priority = 1;

  // 1) Unstaked LP → stake (highest ROI fix)
  for (const p of positions) {
    if (p.protocol === "StelDex" && p.kind === "lp" && p.status === "idle" && p.suggestion?.startsWith("stake")) {
      moves.push({
        priority: priority++,
        from: p.label,
        to: `Farm ${p.asset}`,
        reason: "LP is idle — stake to earn farm rewards",
        command: p.suggestion,
      });
    }
  }

  // 2) Idle USDC → Blend supply
  const idleUsdc = positions.find(
    (p) => p.kind === "wallet" && p.asset === "USDC" && p.status === "idle"
  );
  if (idleUsdc && parseFloat(idleUsdc.amount) >= 1) {
    moves.push({
      priority: priority++,
      from: "Wallet USDC",
      to: "Blend supply",
      reason: "USDC is idle in wallet — supply on Blend to earn lending yield",
      command: `supply ${idleUsdc.amount} USDC on Blend`,
    });
  }

  // 3) Idle XLM → LP or keep reserve
  const idleXlm = positions.find(
    (p) => p.kind === "wallet" && p.asset === "XLM" && p.status === "idle"
  );
  if (idleXlm && parseFloat(idleXlm.amount) >= 20) {
    const use = (parseFloat(idleXlm.amount) * 0.25).toFixed(2);
    moves.push({
      priority: priority++,
      from: "Wallet XLM",
      to: "StelDex LP XLM/pUSDC",
      reason: "Large idle XLM — deploy a portion to LP (keep some for fees)",
      command: `add liquidity ${use} XLM and ${use} pUSDC`,
    });
  }

  // 4) Earning farm → claim if we have farm positions
  for (const p of positions) {
    if (p.kind === "farm" && p.status === "earning" && p.suggestion?.includes("claim")) {
      moves.push({
        priority: priority++,
        from: p.label,
        to: "Wallet (rewards)",
        reason: "Farm is earning — claim rewards periodically",
        command: p.suggestion,
      });
    }
  }

  // 5) If only idle and no earning — push toward live opportunities
  const earning = positions.filter((p) => p.status === "earning");
  const idle = positions.filter((p) => p.status === "idle" && p.kind === "wallet");
  if (earning.length === 0 && idle.length > 0 && moves.length === 0) {
    moves.push({
      priority: priority++,
      from: "Idle wallet",
      to: "Any yield venue",
      reason: "Nothing is earning yet — start with Blend supply or StelDex LP",
      command: "show yield opportunities",
    });
  }

  return moves.sort((a, b) => a.priority - b.priority);
}

export async function formatPortfolioIntel(publicKey: string): Promise<string> {
  const intel = await buildPortfolioIntel(publicKey);
  const short = `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;

  const lines: string[] = [
    `Portfolio intelligence for ${short}`,
    `Earning: ${intel.summary.earning} · Idle: ${intel.summary.idle} · Borrowing: ${intel.summary.borrowing} · Pending: ${intel.summary.pending}`,
    "",
  ];

  const earning = intel.positions.filter((p) => p.status === "earning");
  const idle = intel.positions.filter((p) => p.status === "idle");
  const borrowing = intel.positions.filter((p) => p.status === "borrowing");
  const pending = intel.positions.filter((p) => p.status === "pending");

  if (earning.length) {
    lines.push("EARNING (deployed capital):");
    for (const p of earning) {
      lines.push(`• [${p.protocol}] ${p.label}: ${p.amount} — ${p.note}`);
    }
    lines.push("");
  } else {
    lines.push("EARNING: none — no LP farms, staked positions, or active fee-earning LP detected.");
    lines.push("");
  }

  if (idle.length) {
    lines.push("IDLE (not earning):");
    for (const p of idle) {
      const tip = p.suggestion ? ` → try: "${p.suggestion}"` : "";
      lines.push(`• [${p.protocol}] ${p.label}: ${p.amount} — ${p.note}${tip}`);
    }
    lines.push("");
  }

  if (borrowing.length) {
    lines.push("BORROWING (liabilities):");
    for (const p of borrowing) {
      lines.push(`• [${p.protocol}] ${p.label}: ${p.amount} — ${p.note}`);
    }
    lines.push("");
  }

  if (pending.length) {
    lines.push("PENDING:");
    for (const p of pending) {
      lines.push(`• [${p.protocol}] ${p.label} — ${p.note}`);
    }
    lines.push("");
  }

  if (intel.moves.length) {
    lines.push("REBALANCE PLAN (say these to execute):");
    for (const m of intel.moves) {
      lines.push(`${m.priority}. ${m.from} → ${m.to}`);
      lines.push(`   ${m.reason}`);
      lines.push(`   Command: "${m.command}"`);
    }
  } else {
    lines.push("REBALANCE: no urgent moves — positions look allocated.");
  }

  // Optional: top external opportunities for idle capital
  try {
    const opps = await getLiveDefiOpportunities();
    const lend = opps.filter((o) => o.type === "lending" || o.type === "farm").slice(0, 3);
    if (lend.length && idle.length) {
      lines.push("");
      lines.push("Other venues if you want to deploy idle capital:");
      for (const o of lend) {
        lines.push(`• ${o.protocol} ${o.type} ${o.assetCode}`);
      }
    }
  } catch {
    // ignore
  }

  return lines.join("\n");
}

export async function formatRebalancePlan(publicKey: string): Promise<string> {
  const intel = await buildPortfolioIntel(publicKey);
  if (!intel.moves.length) {
    return "No rebalance needed right now. Your capital is either earning or too small to deploy.";
  }
  const lines = [
    "Rebalance plan — execute in order (or pick one):",
    "",
  ];
  for (const m of intel.moves) {
    lines.push(`${m.priority}. Move: ${m.from} → ${m.to}`);
    lines.push(`   Why: ${m.reason}`);
    lines.push(`   Say: "${m.command}"`);
    lines.push("");
  }
  lines.push('After each step, ask "what\'s earning?" to refresh the scoreboard.');
  return lines.join("\n");
}

export async function formatEarningReport(publicKey: string): Promise<string> {
  const intel = await buildPortfolioIntel(publicKey);
  const earning = intel.positions.filter((p) => p.status === "earning");
  const idle = intel.positions.filter((p) => p.status === "idle" && p.kind === "wallet");

  const lines = [
    `Earning vs idle for ${publicKey.slice(0, 4)}…${publicKey.slice(-4)}:`,
    "",
    `✓ Earning positions: ${earning.length}`,
  ];
  if (earning.length) {
    for (const p of earning) {
      lines.push(`  • ${p.protocol} ${p.label} (${p.amount}) — ${p.note}`);
    }
  } else {
    lines.push("  (none)");
  }
  lines.push("");
  lines.push(`○ Idle capital: ${idle.length} wallet holdings`);
  for (const p of idle) {
    lines.push(`  • ${p.amount} ${p.asset}${p.suggestion ? ` — "${p.suggestion}"` : ""}`);
  }
  if (intel.moves[0]) {
    lines.push("");
    lines.push(`Next best move: "${intel.moves[0].command}"`);
  }
  return lines.join("\n");
}
