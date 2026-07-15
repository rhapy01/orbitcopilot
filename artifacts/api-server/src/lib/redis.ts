import Redis from "ioredis";

let _client: Redis | null = null;

/** Strip optional surrounding quotes from env values. */
function cleanEnv(value: string | undefined): string | undefined {
 if (!value) return undefined;
 let v = value.trim();
 if (
 (v.startsWith('"') && v.endsWith('"')) ||
 (v.startsWith("'") && v.endsWith("'"))
 ) {
 v = v.slice(1, -1);
 }
 return v.trim() || undefined;
}

/**
 * Resolve Redis URL from standard or Vercel KV / Upstash env names.
 * REDIS_URL and KV_URL are the TCP (rediss://) endpoints we use with ioredis.
 * KV_REST_API_* are REST-only and not required for this client.
 */
export function resolveRedisUrl(): string | undefined {
 return cleanEnv(process.env.REDIS_URL) ?? cleanEnv(process.env.KV_URL);
}

export function redisConfigured(): boolean {
 return Boolean(resolveRedisUrl());
}

/** Shared Redis client - required for rate limits and read caches. */
export function getRedis(): Redis {
 if (_client) return _client;
 const url = resolveRedisUrl();
 if (!url) {
 throw new Error(
 "REDIS_URL or KV_URL must be set (Upstash rediss://… from Vercel KV)."
 );
 }

 const isTls = url.startsWith("rediss://");
 _client = new Redis(url, {
 maxRetriesPerRequest: 2,
 enableReadyCheck: true,
 lazyConnect: false,
 connectTimeout: 10_000,
 // Upstash / Vercel KV use TLS (rediss://)
 ...(isTls ? { tls: { rejectUnauthorized: true } } : {}),
 // Prefer IPv4 on some serverless hosts
 family: 4,
 });
 _client.on("error", (err) => {
 console.error("[redis]", err.message);
 });
 return _client;
}

export async function pingRedis(): Promise<boolean> {
 const pong = await getRedis().ping();
 return pong === "PONG";
}

export async function cacheGet(key: string): Promise<string | null> {
 return getRedis().get(key);
}

export async function cacheSet(
 key: string,
 value: string,
 ttlSeconds: number
): Promise<void> {
 await getRedis().set(key, value, "EX", ttlSeconds);
}

export async function cacheDel(patternOrKey: string): Promise<void> {
 if (!patternOrKey.includes("*")) {
 await getRedis().del(patternOrKey);
 return;
 }
 const redis = getRedis();
 let cursor = "0";
 do {
 const [next, keys] = await redis.scan(
 cursor,
 "MATCH",
 patternOrKey,
 "COUNT",
 100
 );
 cursor = next;
 if (keys.length) await redis.del(...keys);
 } while (cursor !== "0");
}

/**
 * Rate-limit counter: INCR + expire window on first hit.
 * Returns current count in the window.
 */
export async function rateLimitIncr(
 key: string,
 windowMs: number
): Promise<number> {
 const redis = getRedis();
 const count = await redis.incr(key);
 if (count === 1) {
 await redis.pexpire(key, windowMs);
 }
 return count;
}
