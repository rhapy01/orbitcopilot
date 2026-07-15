import { formatBlendMarkets, getBlendPoolId, blendReserveSymbols } from "./blend";
import { AQUARIUS_TOKENS, getAquariusPools } from "./aquarius";
import { getSteldexContracts } from "./steldex";
import { getSoroswapTokens, soroswapConfigured, formatSoroswapStatus } from "./soroswap";
import { REFLECTOR_ORACLES } from "./reflector";

export interface LiveOpportunity {
 id: string;
 protocol: string;
 type: string;
 assetCode: string;
 apy: number;
 tvlUsd: number;
 riskLevel: string;
 description: string;
 minDeposit: number;
 rewards: string[];
}

/** Live DeFi catalog from ecosystem backends (not DB seeds). */
export async function getLiveDefiOpportunities(): Promise<LiveOpportunity[]> {
 const out: LiveOpportunity[] = [];

 try {
 const { blendReserveSymbols, getBlendPoolId } = await import("./blend");
 for (const symbol of blendReserveSymbols()) {
 out.push({
 id: `blend-supply-${symbol}`,
 protocol: "Blend",
 type: "lending",
 assetCode: symbol,
 apy: 0,
 tvlUsd: 0,
 riskLevel: "medium",
 description: `Supply ${symbol} on Blend live pool ${getBlendPoolId()}`,
 minDeposit: 0,
 rewards: ["BLND"],
 });
 }
 } catch {
 // skip
 }

 try {
 const pools = await getAquariusPools(20);
 const ranked = [...pools]
 .filter((p) => (p.total_volume ?? 0) > 0)
 .sort((a, b) => (b.total_volume ?? 0) - (a.total_volume ?? 0))
 .slice(0, 8);
 ranked.forEach((p, i) => {
 const pair = (p.tokens_str ?? []).join("/");
 out.push({
 id: `aqua-${p.address ?? i}`,
 protocol: "Aquarius",
 type: "amm",
 assetCode: pair || "LP",
 apy: 0,
 tvlUsd: p.total_volume ?? 0,
 riskLevel: "medium",
 description: `Aquarius ${p.pool_type} pool fee ${p.fee} - ${pair}`,
 minDeposit: 0,
 rewards: ["AQUA"],
 });
 });
 } catch {
 // skip
 }

 try {
 const { getDemoKeypair } = await import("./stellar");
 const { getSteldexFarmPools } = await import("./steldex");
 const demo = await getDemoKeypair();
 const farmPools = (await getSteldexFarmPools(demo.publicKey())) as any[];
 const seen = new Set<string>();
 for (const pool of farmPools.slice(0, 12)) {
 const pair = String(pool.pair ?? pool.poolContract ?? "pool");
 if (seen.has(pair)) continue;
 seen.add(pair);
 const apr = Number(
 pool.farm?.baseAprPercent ??
 pool.farm?.aprPercent ??
 pool.baseAprPercent ??
 0
 );
 const tvl = Number(pool.tvlUsd ?? pool.userValueUsd ?? 0) || 0;
 out.push({
 id: `steldex-${pool.poolContract ?? pair}`,
 protocol: "StelDex",
 type: "farm",
 assetCode: pair,
 apy: Number.isFinite(apr) && apr > 0 && apr < 100_000 ? apr : 0,
 tvlUsd: tvl,
 riskLevel: "medium",
 description: `StelDex pool ${pair} - LP, stake, claim STELLAR rewards`,
 minDeposit: 0,
 rewards: ["STELLAR"],
 });
 }
 } catch {
 try {
 const contracts = await getSteldexContracts();
 for (const pool of contracts.pools.slice(0, 8)) {
 out.push({
 id: `steldex-${pool.contract}`,
 protocol: "StelDex",
 type: "farm",
 assetCode: pool.pair,
 apy: 0,
 tvlUsd: 0,
 riskLevel: "medium",
 description: `StelDex pool ${pool.pair} - LP, stake, claim STELLAR rewards`,
 minDeposit: 0,
 rewards: ["STELLAR"],
 });
 }
 } catch {
 // skip
 }
 }

 if (soroswapConfigured()) {
 try {
 const tokens = await getSoroswapTokens();
 out.push({
 id: "soroswap-agg",
 protocol: "Soroswap",
 type: "aggregator",
 assetCode: Object.keys(tokens).slice(0, 4).join("/"),
 apy: 0,
 tvlUsd: 0,
 riskLevel: "low",
 description: "Soroswap aggregator routes across Soroswap AMM and Aquarius when the testnet indexer is live",
 minDeposit: 0,
 rewards: [],
 });
 } catch {
 // skip
 }
 }

 out.push({
 id: "aquarius-route",
 protocol: "Aquarius",
 type: "amm-route",
 assetCode: Object.keys(AQUARIUS_TOKENS).join("/"),
 apy: 0,
 tvlUsd: 0,
 riskLevel: "medium",
 description: "Live find-path quotes for XLM/USDC/AQUA - ask \"Aquarius quote 10 XLM to USDC\"",
 minDeposit: 0,
 rewards: ["AQUA"],
 });

 out.push({
 id: "reflector-oracle",
 protocol: "Reflector",
 type: "oracle",
 assetCode: "XLM/BTC/ETH",
 apy: 0,
 tvlUsd: 0,
 riskLevel: "low",
 description: `Price oracles on testnet (${REFLECTOR_ORACLES.external.slice(0, 8)}…)`,
 minDeposit: 0,
 rewards: [],
 });

 return out;
}

export async function formatLiveDefiCatalog(): Promise<string> {
 const opps = await getLiveDefiOpportunities();
 if (!opps.length) {
 return "No live DeFi listings right now. Try StelDex, Blend, or Aquarius individually.";
 }
 const lines = opps.map((o) => {
 const apyLabel =
 o.apy > 0
 ? `${o.apy.toFixed(2)}% APY`
 : "APY not published on this testnet feed";
 const tvlLabel =
 o.tvlUsd > 0 ? ` · volume/TVL signal ~$${Math.round(o.tvlUsd)}` : "";
 return `• ${o.protocol} - ${o.type} ${o.assetCode} (${apyLabel}${tvlLabel}): ${o.description}`;
 });
 let extra = "";
 try {
 extra = "\n\n" + (await formatSoroswapStatus());
 } catch {
 // ignore
 }
 try {
 extra += "\n\n" + (await formatBlendMarkets());
 } catch {
 // ignore
 }
 return (
 [
 "Live DeFi on Stellar Testnet:",
 "",
 "Note: many testnet indexes do not expose reliable APY - treat rates as unknown unless stated.",
 "",
 ...lines,
 ].join("\n") + extra
 );
}
