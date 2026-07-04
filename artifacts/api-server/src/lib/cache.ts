import { cacheGet, cacheSet } from "./redis";

/** Redis-backed JSON cache. Misses always call `load` (live chain / protocol APIs). */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>
): Promise<T> {
  const hit = await cacheGet(key);
  if (hit != null) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // corrupt entry — reload
    }
  }
  const value = await load();
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
  return value;
}

/** Cache key prefixes — keep namespaced so invalidation stays precise. */
export const CacheKeys = {
  portfolioIntel: (wallet: string) => `orbit:portfolio:intel:${wallet}`,
  portfolioUnified: (wallet: string) => `orbit:portfolio:unified:${wallet}`,
  prices: (symbols: string) => `orbit:prices:${symbols}`,
  portfolioPattern: (wallet: string) => `orbit:portfolio:*:${wallet}`,
} as const;

/** Short TTLs: UX speed only. Signing always rebuilds from chain. */
export const CacheTtl = {
  portfolioSeconds: 30,
  pricesSeconds: 15,
} as const;
