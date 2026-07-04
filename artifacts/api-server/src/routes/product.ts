import { Router, type IRouter } from "express";
import {
  getProductStats,
  insertFeedback,
  recordWalletEvent,
} from "../lib/product-store";

const router: IRouter = Router();

const EVENT_TYPES = new Set([
  "page_view",
  "wallet_connect",
  "wallet_disconnect",
  "chat_send",
  "chat_clear",
  "tx_sign",
  "tx_submit",
  "onboarding_step",
  "feedback_open",
  "error",
]);

router.post("/events", async (req, res): Promise<void> => {
  try {
    const eventType =
      typeof req.body?.eventType === "string" ? req.body.eventType.trim() : "";
    if (!eventType || !EVENT_TYPES.has(eventType)) {
      res.status(400).json({
        error: `eventType must be one of: ${[...EVENT_TYPES].join(", ")}`,
      });
      return;
    }

    const wallet =
      typeof req.body?.walletPublicKey === "string"
        ? req.body.walletPublicKey.trim()
        : null;
    if (wallet && !/^G[A-Z2-7]{55}$/.test(wallet)) {
      res.status(400).json({ error: "Invalid walletPublicKey" });
      return;
    }

    const metadata =
      req.body?.metadata && typeof req.body.metadata === "object"
        ? (req.body.metadata as Record<string, unknown>)
        : null;

    await recordWalletEvent({
      walletPublicKey: wallet,
      eventType,
      metadata,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[events] POST failed:", err);
    res.status(503).json({
      error: err instanceof Error ? err.message : "Failed to record event",
    });
  }
});

router.post("/feedback", async (req, res): Promise<void> => {
  try {
    const rating = Number(req.body?.rating);
    const message =
      typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating must be an integer 1–5" });
      return;
    }
    if (message.length < 3 || message.length > 2000) {
      res.status(400).json({ error: "message must be 3–2000 characters" });
      return;
    }

    const wallet =
      typeof req.body?.walletPublicKey === "string"
        ? req.body.walletPublicKey.trim()
        : null;
    if (wallet && !/^G[A-Z2-7]{55}$/.test(wallet)) {
      res.status(400).json({ error: "Invalid walletPublicKey" });
      return;
    }

    await insertFeedback({
      walletPublicKey: wallet,
      rating,
      message,
    });
    await recordWalletEvent({
      walletPublicKey: wallet,
      eventType: "feedback_open",
      metadata: { rating },
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[feedback] POST failed:", err);
    res.status(503).json({
      error: err instanceof Error ? err.message : "Failed to save feedback",
    });
  }
});

/** Public product stats for monitoring screenshots + Level 4 proof. */
router.get("/stats", async (_req, res): Promise<void> => {
  try {
    const stats = await getProductStats();
    res.json(stats);
  } catch (err) {
    console.error("[stats] GET failed:", err);
    res.status(503).json({
      error: err instanceof Error ? err.message : "Stats unavailable",
    });
  }
});

/** Human-readable feedback summary for submission writeups. */
router.get("/feedback/summary", async (_req, res): Promise<void> => {
  try {
    const stats = await getProductStats();
    const lines = [
      `Orbit Copilot — user feedback summary (Testnet)`,
      `Responses: ${stats.feedback.total}`,
      `Average rating: ${stats.feedback.averageRating}/5`,
      `Unique wallets with events: ${stats.events.uniqueWallets}`,
      `Level 4 user target (10+): ${stats.level4.usersTargetMet ? "MET" : "in progress"}`,
      "",
      "Recent comments:",
    ];
    for (const f of stats.feedback.recent.slice(0, 10)) {
      lines.push(`• [${f.rating}/5] ${f.message}`);
    }
    if (stats.feedback.recent.length === 0) {
      lines.push("• (no feedback yet)");
    }
    res.type("text/plain").send(lines.join("\n"));
  } catch (err) {
    res.status(503).type("text/plain").send("Feedback summary unavailable");
  }
});

export default router;
