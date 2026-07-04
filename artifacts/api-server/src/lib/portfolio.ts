import { getAccountBalances, getAccountOperations } from "./stellar";
import { getSteldexFarmPools, getSteldexFarmPositions, getSteldexOrders } from "./steldex";
import { getSoroswapBalances, getSoroswapPositions, soroswapConfigured } from "./soroswap";
import { getBlendContracts } from "./blend";
import {
  buildPortfolioIntel,
  formatPortfolioIntel,
  formatRebalancePlan,
  formatEarningReport,
} from "./portfolio-intel";
import { CacheKeys, CacheTtl, cachedJson } from "./cache";
import { cacheDel } from "./redis";

export {
  buildPortfolioIntel,
  formatPortfolioIntel,
  formatRebalancePlan,
  formatEarningReport,
};

/** Primary portfolio reply: earning vs idle scoreboard + rebalance plan. */
export async function formatUnifiedPortfolio(publicKey: string): Promise<string> {
  return formatPortfolioIntel(publicKey);
}

async function loadUnifiedPortfolioJson(publicKey: string) {
  const intel = await buildPortfolioIntel(publicKey);
  const classic = await getAccountBalances(publicKey).catch(() => []);
  let soroswap: any[] = [];
  let soroswapLp: any[] = [];
  if (soroswapConfigured()) {
    try {
      const data = await getSoroswapBalances(publicKey);
      soroswap = Array.isArray(data?.balances) ? data.balances : [];
    } catch {
      soroswap = [];
    }
    try {
      soroswapLp = (await getSoroswapPositions(publicKey)) as any[];
      if (!Array.isArray(soroswapLp)) soroswapLp = [];
    } catch {
      soroswapLp = [];
    }
  }
  const [farmPools, positions, orders] = await Promise.all([
    getSteldexFarmPools(publicKey).catch(() => []),
    getSteldexFarmPositions(publicKey).catch(() => []),
    getSteldexOrders(publicKey).catch(() => []),
  ]);
  const blend = await getBlendContracts().catch(() => null);
  const activity = await getAccountOperations(publicKey).catch(() => []);

  return {
    network: "testnet",
    wallet: publicKey,
    intel,
    classic,
    soroswap,
    soroswapLp,
    steldex: { farmPools, positions, orders },
    blend: blend
      ? { pool: blend.ids.TestnetV2, reserves: ["XLM", "USDC", "BLND", "wETH", "wBTC"] }
      : null,
    recentOps: activity.slice(0, 10),
    cachedForSeconds: CacheTtl.portfolioSeconds,
  };
}

/** Unified portfolio JSON — Redis snapshot for API/chat speed. */
export async function getUnifiedPortfolioJson(publicKey: string) {
  return cachedJson(
    CacheKeys.portfolioUnified(publicKey),
    CacheTtl.portfolioSeconds,
    () => loadUnifiedPortfolioJson(publicKey)
  );
}

/** Drop portfolio snapshots after a signed action. */
export async function invalidatePortfolioCache(publicKey: string): Promise<void> {
  await cacheDel(CacheKeys.portfolioIntel(publicKey));
  await cacheDel(CacheKeys.portfolioUnified(publicKey));
}
