/**
 * Orbit off-chain data plane (integrated, not optional fallbacks).
 *
 * On-chain (Horizon / Soroban / protocol APIs) remains the authority for
 * balances, positions, markets, and settlement. Off-chain stores never settle.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ PostgreSQL (DATABASE_URL) — durable app state                       │
 * │  • chat_messages     — conversation history per wallet              │
 * │  • chat_sessions     — recents titles / last activity                │
 * │  Never: balances, LP, stakes, bets, margin, or “you own X”          │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ Redis (REDIS_URL) — hot path                                        │
 * │  • rate limits       — per IP / wallet                              │
 * │  • portfolio cache   — short TTL snapshots for chat speed           │
 * │  • price cache       — Reflector/Horizon quotes (short TTL)         │
 * │  Signing paths always rebuild from live chain, never from cache.    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { pool } from "@workspace/db";
import { pingRedis, redisConfigured } from "./redis";

export type DataPlaneStatus = {
  postgres: { configured: boolean; ok: boolean; error?: string };
  redis: { configured: boolean; ok: boolean; error?: string };
  ready: boolean;
};

export async function getDataPlaneStatus(): Promise<DataPlaneStatus> {
  const postgresConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const redisConfiguredFlag = redisConfigured();

  let postgresOk = false;
  let postgresError: string | undefined;
  if (postgresConfigured) {
    try {
      await pool.query("select 1");
      postgresOk = true;
    } catch (err) {
      postgresError = err instanceof Error ? err.message : String(err);
    }
  } else {
    postgresError = "DATABASE_URL is not set";
  }

  let redisOk = false;
  let redisError: string | undefined;
  if (redisConfiguredFlag) {
    try {
      redisOk = await pingRedis();
      if (!redisOk) redisError = "PING failed";
    } catch (err) {
      redisError = err instanceof Error ? err.message : String(err);
    }
  } else {
    redisError = "REDIS_URL or KV_URL is not set";
  }

  return {
    postgres: {
      configured: postgresConfigured,
      ok: postgresOk,
      error: postgresError,
    },
    redis: {
      configured: redisConfiguredFlag,
      ok: redisOk,
      error: redisError,
    },
    ready: postgresOk && redisOk,
  };
}

/** Fail fast when a route requires the full data plane. */
export async function assertDataPlaneReady(): Promise<void> {
  const status = await getDataPlaneStatus();
  if (status.ready) return;
  const parts: string[] = [];
  if (!status.postgres.ok) {
    parts.push(`postgres: ${status.postgres.error ?? "unavailable"}`);
  }
  if (!status.redis.ok) {
    parts.push(`redis: ${status.redis.error ?? "unavailable"}`);
  }
  throw new Error(`Data plane not ready (${parts.join("; ")})`);
}
