import { logger } from "./logger";

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseMs = opts.baseMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseMs * 2 ** attempt;
      logger.warn(
        { err, attempt, delay, label: opts.label },
        "Retrying after failure"
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
