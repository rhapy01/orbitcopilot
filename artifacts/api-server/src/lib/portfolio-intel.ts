import { getAccountBalances, getAssetPrice } from "./stellar";
import {
 getSteldexFarmPools,
 getSteldexFarmPositions,
 getSteldexOrders,
} from "./steldex";
import { getSoroswapBalances, getSoroswapPositions, soroswapConfigured } from "./soroswap";
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
 ? "Sitting in wallet - not earning yield"
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

 // --- StelDex free token balances (Soroban - not visible on Horizon) ---
 try {
 const { getSteldexWalletBalances } = await import("./steldex");
 const steldexBals = await getSteldexWalletBalances(publicKey);
 for (const b of steldexBals) {
 const asset = b.asset.toUpperCase() === "CUSDC" ? "USDC" : b.asset;
 if (
 positions.some(
 (p) =>
 p.id === `wallet-${asset}` ||
 p.asset === asset ||
 (asset === "USDC" &&
 (p.asset === "USDC" ||
 p.asset === "cUSDC" ||
 p.asset === "USDC (Circle)" ||
 p.id === "wallet-USDC"))
 )
 ) {
 continue;
 }
 const price = await getAssetPrice(asset).catch(() => 0);
 positions.push({
 id: `wallet-${asset}`,
 protocol: "StelDex",
 kind: "wallet",
 label: `${asset} balance`,
 asset,
 amount: b.balance.toFixed(4),
 status: "idle",
 note: "Soroban wallet balance (StelDex)",
 suggestion:
 b.balance >= 1
 ? `add liquidity on StelDex with ${asset === "USDC" ? "cUSDC" : asset}`
 : undefined,
 meta: { valueUsd: b.balance * price },
 });
 }
 } catch {
 // ignore
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
 note: "Soroban balance - not in an LP",
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
 note: "Providing liquidity - earning swap fees",
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
 ? "LP tokens not fully staked - missing farm rewards"
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
 const aprRaw =
 Number(
 p.farm?.baseAprPercent ??
 p.farm?.aprPercent ??
 p.baseAprPercent ??
 0
 ) || 0;
 positions.push({
 id: `steldex-farm-${pair}`,
 protocol: "StelDex",
 kind: "farm",
 label: `Farm ${pair}`,
 asset: pair,
 amount: String(p.stakedLiquidity),
 status: "earning",
 note: "Staked in farm - earning STELLAR rewards",
 suggestion: `claim rewards from ${pair}`,
 meta: {
 poolContract,
 ...(aprRaw > 0 && aprRaw < 100_000 ? { aprPercent: aprRaw } : {}),
 },
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
 note: "Active farm stake - earning rewards",
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
 note: `Open order (${o.status ?? "open"}) - capital reserved until fill/cancel`,
 suggestion: `cancel order ${o.orderId}`,
 meta: { orderId: String(o.orderId) },
 });
 }
 } catch {
 // ignore
 }

 // --- Blend live positions (get_positions) + idle opportunity ---
 try {
 const { listBlendPositions } = await import("./blend");
 const blendPositions = await listBlendPositions(publicKey);
 for (const bp of blendPositions) {
 if (parseFloat(bp.supply) > 0) {
 positions.push({
 id: `blend-supply-${bp.symbol}`,
 protocol: "Blend",
 kind: "lend",
 label: `Supply ${bp.symbol}`,
 asset: bp.symbol,
 amount: bp.supply,
 status: "earning",
 note: "Blend lending position (on-chain)",
 suggestion: `withdraw ${bp.supply} ${bp.symbol} on Blend`,
 meta: { pool: bp.poolContract },
 });
 }
 if (parseFloat(bp.liability) > 0) {
 positions.push({
 id: `blend-borrow-${bp.symbol}`,
 protocol: "Blend",
 kind: "borrow",
 label: `Borrow ${bp.symbol}`,
 asset: bp.symbol,
 amount: bp.liability,
 status: "borrowing",
 note: "Blend borrow liability (on-chain)",
 suggestion: `repay ${bp.liability} ${bp.symbol} on Blend`,
 meta: { pool: bp.poolContract },
 });
 }
 }

 const { getBlendPoolId, getBlendReserveBalanceHuman } = await import("./blend");
 const poolId = getBlendPoolId();
 const idleUsdc = positions.find(
 (p) => p.kind === "wallet" && p.asset === "USDC" && p.status === "idle"
 );
 const usdcBal =
 idleUsdc != null
 ? parseFloat(idleUsdc.amount)
 : ((await getBlendReserveBalanceHuman(publicKey, "USDC").catch(() => null)) ?? 0);
 if (
 usdcBal >= 1 &&
 poolId &&
 blendPositions.every((b) => parseFloat(b.supply) === 0)
 ) {
 positions.push({
 id: "blend-opportunity",
 protocol: "Blend",
 kind: "lend",
 label: "Blend lending (available)",
 asset: "USDC",
 amount: usdcBal.toFixed(4),
 status: "idle",
 note: "Idle Circle USDC can be supplied on Blend’s live pool",
 suggestion: `supply ${usdcBal.toFixed(2)} USDC on Blend`,
 meta: { pool: poolId },
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
 label: `${p.outcome.toUpperCase()} - ${p.market?.slug ?? p.marketId}`,
 asset: "XLM",
 amount: String(p.amountXlm),
 status: p.status === "pending" ? "pending" : "earning",
 note:
 p.status === "pending"
 ? "Prediction stake pending confirmation"
 : `Prediction bet on ${p.outcome} - ${p.market?.question ?? ""}`,
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
 const markInfo = p.status === "open" ? await markPrice(sym) : null;
 const mark = markInfo?.price ?? p.entryPrice;
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
 : `uPnL $${uPnL.toFixed(2)} · entry $${p.entryPrice.toFixed(2)} · mark $${mark.toFixed(2)}${markInfo?.stale ? " (oracle fallback)" : ""}`,
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
 reason: "LP is idle - stake to earn farm rewards",
 command: p.suggestion,
 });
 }
 }

 // 2) Idle USDC → Blend supply (live pool uses Circle USDC)
 const idleUsdc = positions.find(
 (p) => p.kind === "wallet" && p.asset === "USDC" && p.status === "idle"
 );
 if (idleUsdc && parseFloat(idleUsdc.amount) >= 1) {
 moves.push({
 priority: priority++,
 from: "Wallet USDC",
 to: "Blend supply",
 reason: "USDC is idle - supply on Blend to earn lending yield",
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
 reason: "Large idle XLM - deploy a portion to LP (keep some for fees)",
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
 reason: "Farm is earning - claim rewards periodically",
 command: p.suggestion,
 });
 }
 }

 // 5) If only idle and no earning - push toward live opportunities
 const earning = positions.filter((p) => p.status === "earning");
 const idle = positions.filter((p) => p.status === "idle" && p.kind === "wallet");
 if (earning.length === 0 && idle.length > 0 && moves.length === 0) {
 moves.push({
 priority: priority++,
 from: "Idle wallet",
 to: "Any yield venue",
 reason: "Nothing is earning yet - start with Blend supply or StelDex LP",
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
 lines.push(`• [${p.protocol}] ${p.label}: ${p.amount} - ${p.note}`);
 }
 lines.push("");
 } else {
 lines.push("EARNING: none - no LP farms, staked positions, or active fee-earning LP detected.");
 lines.push("");
 }

 if (idle.length) {
 lines.push("IDLE (not earning):");
 for (const p of idle) {
 const tip = p.suggestion ? ` → try: "${p.suggestion}"` : "";
 lines.push(`• [${p.protocol}] ${p.label}: ${p.amount} - ${p.note}${tip}`);
 }
 lines.push("");
 }

 if (borrowing.length) {
 lines.push("BORROWING (liabilities):");
 for (const p of borrowing) {
 lines.push(`• [${p.protocol}] ${p.label}: ${p.amount} - ${p.note}`);
 }
 lines.push("");
 }

 if (pending.length) {
 lines.push("PENDING:");
 for (const p of pending) {
 lines.push(`• [${p.protocol}] ${p.label} - ${p.note}`);
 }
 lines.push("");
 }

 if (intel.moves.length) {
 lines.push("REBALANCE PLAN (say these to execute):");
 for (const m of intel.moves) {
 lines.push(`${m.priority}. ${m.from} → ${m.to}`);
 lines.push(` ${m.reason}`);
 lines.push(` Command: "${m.command}"`);
 }
 } else {
 lines.push("REBALANCE: no urgent moves - positions look allocated.");
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
 "Rebalance plan - execute in order (or pick one):",
 "",
 ];
 for (const m of intel.moves) {
 lines.push(`${m.priority}. Move: ${m.from} → ${m.to}`);
 lines.push(` Why: ${m.reason}`);
 lines.push(` Say: "${m.command}"`);
 lines.push("");
 }
 lines.push('After each step, ask "what\'s earning?" to refresh the scoreboard.');
 return lines.join("\n");
}

export async function formatEarningReport(publicKey: string): Promise<string> {
 const intel = await buildPortfolioIntel(publicKey);
 const earning = intel.positions.filter((p) => p.status === "earning");
 const idle = intel.positions.filter((p) => p.status === "idle" && p.kind === "wallet");

 // Compute total wallet USD value
 const walletPositions = intel.positions.filter((p) => p.kind === "wallet");
 const totalWalletUsd = walletPositions.reduce((sum, p) => {
 const v = (p.meta?.valueUsd as number) ?? 0;
 return sum + v;
 }, 0);

 const lines: string[] = [];

 if (totalWalletUsd > 0) {
 lines.push(`Portfolio wallet value: $${totalWalletUsd.toFixed(2)} USD`);
 lines.push("");
 }

 lines.push(`Earning positions: ${earning.length}`);
 if (earning.length) {
 for (const p of earning) {
 const apr = (p.meta?.aprPercent as number | undefined);
 const aprStr = apr != null && apr > 0 && apr < 100000
 ? ` - APR ~${apr.toFixed(1)}%`
 : "";
 const valueUsd = (p.meta?.valueUsd as number | undefined);
 const valueStr = valueUsd != null && valueUsd > 0 ? ` ($${valueUsd.toFixed(2)})` : "";
 lines.push(` • ${p.protocol} ${p.label}${valueStr}${aprStr} - ${p.note}`);
 }
 } else {
 lines.push(" None - your capital is not earning yield right now.");
 }

 lines.push("");
 lines.push(`Idle capital: ${idle.length} wallet holding${idle.length !== 1 ? "s" : ""}`);
 for (const p of idle) {
 const valueUsd = (p.meta?.valueUsd as number | undefined);
 const valueStr = valueUsd != null && valueUsd > 0 ? ` ($${valueUsd.toFixed(2)})` : "";
 lines.push(` • ${p.amount} ${p.asset}${valueStr}${p.suggestion ? ` - try: "${p.suggestion}"` : ""}`);
 }

 if (intel.moves[0]) {
 lines.push("");
 lines.push(`Best next move: "${intel.moves[0].command}"`);
 if (intel.moves[0].reason) {
 lines.push(`Reason: ${intel.moves[0].reason}`);
 }
 }

 return lines.join("\n");
}
