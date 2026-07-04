import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Redis from "ioredis";
import pg from "pg";

const envPath = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(process.cwd(), "../.env"),
].find((p) => existsSync(p));
if (!envPath) throw new Error(".env not found");

for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  if (process.env[k] === undefined) process.env[k] = v;
}

const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
if (!redisUrl) throw new Error("REDIS_URL / KV_URL missing");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");

const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
  family: 4,
  connectTimeout: 15_000,
  maxRetriesPerRequest: 1,
});
console.log("redis", await redis.ping());
await redis.quit();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
  ssl: { rejectUnauthorized: false },
});
const r = await pool.query("select 1 as ok");
console.log("postgres", r.rows[0]);
await pool.end();
console.log("data plane ok");
