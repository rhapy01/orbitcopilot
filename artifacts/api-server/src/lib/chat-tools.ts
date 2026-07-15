import { getAccountOperations, getXlmPriceUsd } from "./stellar";
import { getSteldexContracts, getSteldexPools, formatSteldexHoldings } from "./steldex";
import { formatSoroswapStatus, soroswapConfigured } from "./soroswap";
import { formatUnifiedPortfolio } from "./portfolio";
import { formatLiveDefiCatalog } from "./defi-live";
import { formatProtocolRegistry } from "./protocols";
import { formatReflectorPrices } from "./reflector";

export async function formatPortfolioSummary(publicKey: string): Promise<string> {
 return formatUnifiedPortfolio(publicKey);
}

export async function formatRecentActivity(publicKey: string): Promise<string> {
 const ops = await getAccountOperations(publicKey);
 if (!ops.length) {
 return "No recent on-chain activity for this wallet on testnet.";
 }

 const lines = ops.slice(0, 8).map((op) => {
 const when = op.created_at ? new Date(op.created_at).toLocaleString() : "unknown time";
 const label = op.type.replace(/_/g, " ");
 const asset =
 op.asset_code ??
 (op.asset_type === "native" ? "XLM" : op.selling_asset_code ?? op.buying_asset_code ?? "");
 const amount = op.amount ?? op.starting_balance ?? "";
 const detail = [amount, asset].filter(Boolean).join(" ");
 return `• ${label}${detail ? ` - ${detail}` : ""} (${when})`;
 });

 return ["Recent activity (Stellar Testnet):", "", ...lines].join("\n");
}

export async function formatYieldOpportunities(assetFilter?: string): Promise<string> {
 let live = await formatLiveDefiCatalog();
 if (assetFilter) {
 const code = assetFilter.toUpperCase();
 const filtered = live
 .split("\n")
 .filter((line) => !line.startsWith("•") || line.toUpperCase().includes(code));
 live = filtered.join("\n");
 }
 return live;
}

export async function formatMarketOverview(assetCode?: string): Promise<string> {
 if (assetCode) {
 return formatReflectorPrices([assetCode.toUpperCase()]);
 }
 try {
 return await formatReflectorPrices(["XLM", "USDC", "BTC", "ETH"]);
 } catch {
 const xlmPrice = await getXlmPriceUsd();
 return `XLM ≈ $${xlmPrice.toFixed(4)} (Horizon testnet order book).`;
 }
}

export async function formatSteldexPools(): Promise<string> {
 const contracts = await getSteldexContracts();
 const pools = contracts.pools.length
 ? contracts.pools
 : ((await getSteldexPools()) as any[]).map((p) => ({
 pair: p.pair ?? `${p.symbol0}/${p.symbol1}`,
 contract: p.contract ?? p.address,
 }));

 if (!pools.length) {
 return "I couldn't load StelDex pools right now.";
 }

 const tokens = Object.keys(contracts.tokens).join(", ") || "XLM, pUSDC, cUSDC, EURC, STELLAR";
 const lines = pools.slice(0, 12).map((p: any) => `• ${p.pair}`);

 return [
 "Unicorn StelDex (Testnet):",
 "",
 `Tokens: ${tokens}`,
 "",
 "Pools:",
 ...lines,
 "",
 'Examples: "Swap 10 XLM to pUSDC", "add liquidity 10 XLM and 10 pUSDC", "stake XLM/pUSDC for 52 weeks".',
 ].join("\n");
}

export async function formatEcosystemOverview(): Promise<string> {
 const parts = [formatProtocolRegistry(), ""];
 try {
 parts.push(await formatSoroswapStatus());
 } catch {
 // ignore
 }
 return parts.join("\n");
}

export { formatSteldexHoldings };

export const CAPABILITIES_TEXT = [
 "I'm Orbit Copilot on Stellar Testnet. Chat is the only UI - protocols run as backends.",
 "",
 "── DeFi CONCEPTS ──",
 "",
 "Staking (single asset): deposit one token to earn rewards.",
 "Liquidity provision: deposit TWO assets into a pool to earn trading fees.",
 "Yield farming: stake LP tokens in a farm for extra rewards.",
 "",
 "── WHAT I CAN DO ──",
 "",
 "Portfolio: LP, farms, lending, predictions, NFTs",
 "Trading: swaps (including multi-swap in one prompt), Aquarius quotes",
 "Predictions: list sports markets, bet XLM, claim after resolve",
 "Perps: open/close (SL/TP not enforced on-chain yet)",
 "Lending: Blend supply / withdraw / borrow / repay / claim rewards (Circle USDC + XLM)",
 "Orbit Supply: deposit USDC / pUSDC / EURC → claim XLM yield every 24h (10 XLM per 1M)",
 "NFTs: mint, list for XLM, buy, transfer",
 "",
 "── LEARN ──",
 "",
 "Ask concepts anytime: \"What is DeFi?\", \"Explain impermanent loss\", \"CeFi vs DeFi\", \"staking vs LP\"",
 "Math: \"calculate IL if price doubles\", \"health if collateral 100 debt 40\", \"10% APR to APY\"",
 "Risk: \"blend health\" (connected wallet) · Mainnet execution is disabled - testnet only",
 "Answers cite Orbit's knowledge base / concept graph (blockchain, DeFi, CeFi, Stellar, risk).",
 "",
 "── EXAMPLES ──",
 "",
 "• \"List sports markets\"",
 "• \"Buy yes for Chelsea over Arsenal with 30 XLM\" (I'll ask which fixture if several match)",
 "• \"Swap 200 XLM to pUSDC, cUSDC, EURC each\" - three cards, 200 XLM each",
 "• \"Swap 10 XLM to pUSDC on StelDex\"",
 "• \"What's earning?\" / \"Rebalance\"",
 "• \"Supply 100 USDC on Blend\" / \"Borrow 5 XLM on Blend\" / \"Claim Blend rewards\"",
 "• \"Supply 100 USDC on orbit-supply\" / \"Claim my yield\"",
 "• \"What is staking vs liquidity provision?\"",
 "• \"Claim yes on chelsea-arsenal-epl\" (only after the market is resolved on-chain)",
 "• \"Claim my beta NFT\" - only if feedback unlocked it and you have not claimed yet (one per wallet)",
 "• \"View my NFTs\" / \"Mint an NFT called Stellar Fox\" / \"List NFT #1 for 5 XLM\"",
 "",
 "Connect Freighter or your Orbit embedded wallet (passkey) to get started.",
].join("\n");
