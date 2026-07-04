import type { Request, Response, NextFunction } from "express";
import { rateLimitIncr } from "./redis";

/** Redis-backed rate limiter (per IP + optional wallet). Part of the data plane. */
export function rateLimit(opts: { windowMs?: number; max?: number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 60;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wallet =
        typeof req.body?.context === "string"
          ? req.body.context
          : typeof req.query?.wallet === "string"
            ? req.query.wallet
            : "";
      const key = `orbit:rl:${req.ip ?? "unknown"}:${wallet || req.path}`;
      const count = await rateLimitIncr(key, windowMs);

      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - count)));

      if (count > max) {
        res.status(429).json({
          error: "Too many requests — slow down and try again.",
        });
        return;
      }
      next();
    } catch (err) {
      req.log?.error?.({ err }, "Rate limit Redis error");
      res.status(503).json({
        error: "Rate limiter unavailable (Redis). Check REDIS_URL.",
      });
    }
  };
}
