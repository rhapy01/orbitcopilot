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
    return `• ${label}${detail ? ` — ${detail}` : ""} (${when})`;
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
  "I'm Orbit Copilot on Stellar Testnet. Chat is the only UI — protocols run as backends.",
  "",
  "Portfolio intelligence: all positions — LP, farms, lend, predictions, perps",
  "Rebalance: move capital between venues from chat",
  "Trading: swap, Aquarius quotes, Orbit perps (long/short + SL/TP)",
  "Predictions: bet XLM on yes/no markets (Orbit-native)",
  "Credit: Blend supply / withdraw / borrow / repay",
  "",
  "Examples:",
  "• \"What's in my portfolio?\" / \"What's earning?\" / \"Rebalance\"",
  "• \"Invest 2 XLM on Brazil to win\"",
  "• \"Open a 200 USDC long on bitcoin at 5x, stop loss at 90000, take profit at 120000\"",
  "• \"Close my BTC perp\" / \"Supply 10 USDC on Blend\"",
  "",
  "Connect Freighter on Testnet. OpenRouter/OpenAI optional for free-form chat.",
].join("\n");
