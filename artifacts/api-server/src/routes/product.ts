import { Router, type IRouter } from "express";
import {
 getProductStats,
 insertFeedback,
 listAllFeedback,
 listAllPlatformTransactions,
 recordWalletEvent,
 resolveBetaNftStatus,
} from "../lib/product-store";

const router: IRouter = Router();

const EVENT_TYPES = new Set([
 "page_view",
 "wallet_connect",
 "wallet_disconnect",
 "chat_send",
 "chat_new",
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
 res.status(400).json({ error: "rating must be an integer 1-5" });
 return;
 }
 if (message.length < 3 || message.length > 2000) {
 res.status(400).json({ error: "message must be 3-2000 characters" });
 return;
 }

 const wallet =
 typeof req.body?.walletPublicKey === "string"
 ? req.body.walletPublicKey.trim()
 : null;
 if (!wallet || !/^G[A-Z2-7]{55}$/.test(wallet)) {
 res.status(400).json({
 error: "Connect a wallet first - feedback unlocks your Orbit Beta Tester NFT",
 });
 return;
 }

 const result = await insertFeedback({
 walletPublicKey: wallet,
 rating,
 message,
 });
 await recordWalletEvent({
 walletPublicKey: wallet,
 eventType: "feedback_open",
 metadata: { rating, betaNftWhitelisted: result.betaNft.whitelisted },
 });
 res.status(201).json({
 ok: true,
 feedbackId: result.feedbackId,
 betaNft: result.betaNft,
 });
 } catch (err) {
 console.error("[feedback] POST failed:", err);
 res.status(503).json({
 error: err instanceof Error ? err.message : "Failed to save feedback",
 });
 }
});

router.get("/nft/beta-status", async (req, res): Promise<void> => {
 const wallet =
 typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
 if (!wallet || !/^G[A-Z2-7]{55}$/.test(wallet)) {
 res.status(400).json({ error: "wallet query required" });
 return;
 }
 try {
 const status = await resolveBetaNftStatus(wallet);
 res.json({
 ...status,
 canClaim: status.eligible && !status.claimed,
 });
 } catch (err) {
 res.status(503).json({
 error: err instanceof Error ? err.message : "Status unavailable",
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
 `Orbit Copilot - user feedback summary (Testnet)`,
 `Responses: ${stats.feedback.total}`,
 `Average rating: ${stats.feedback.averageRating}/5`,
 `Unique wallets with events: ${stats.events.uniqueWallets}`,
 `Beta NFT whitelisted: ${stats.betaNft?.whitelisted ?? 0}`,
 `Beta NFT claimed: ${stats.betaNft?.claimed ?? 0}`,
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

/**
 * Full feedback export for Blue Belt / judges.
 * - GET /api/feedback/export → JSON (default)
 * - GET /api/feedback/export?format=csv → CSV download
 * - GET /api/feedback/export?format=txt → plain-text writeup of ALL rows
 */
router.get("/feedback/export", async (req, res): Promise<void> => {
 try {
 const format =
 typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "json";
 const rows = await listAllFeedback();
 const avg =
 rows.length === 0
 ? 0
 : Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10;

 if (format === "csv") {
 const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
 const lines = [
 "id,rating,wallet_public_key,created_at,message",
 ...rows.map((r) =>
 [
 r.id,
 r.rating,
 esc(r.walletPublicKey ?? ""),
 esc(r.createdAt),
 esc(r.message),
 ].join(",")
 ),
 ];
 res.setHeader("Content-Disposition", 'attachment; filename="orbit-feedback.csv"');
 res.type("text/csv").send(lines.join("\n"));
 return;
 }

 if (format === "txt") {
 const lines = [
 `Orbit Copilot - full user feedback export (Testnet)`,
 `Responses: ${rows.length}`,
 `Average rating: ${avg}/5`,
 `Exported: ${new Date().toISOString()}`,
 "",
 ];
 for (const f of rows) {
 const wallet = f.walletPublicKey ?? "(no wallet)";
 lines.push(`--- #${f.id} | ${f.rating}/5 | ${wallet} | ${f.createdAt}`);
 lines.push(f.message);
 lines.push("");
 }
 if (rows.length === 0) lines.push("(no feedback yet)");
 res.setHeader("Content-Disposition", 'attachment; filename="orbit-feedback.txt"');
 res.type("text/plain").send(lines.join("\n"));
 return;
 }

 res.json({
 network: "testnet",
 total: rows.length,
 averageRating: avg,
 exportedAt: new Date().toISOString(),
 feedback: rows,
 });
 } catch (err) {
 console.error("[feedback/export] GET failed:", err);
 res.status(503).json({
 error: err instanceof Error ? err.message : "Feedback export unavailable",
 });
 }
});

/**
 * Full platform transaction export for testnet traction submissions.
 * - GET /api/transactions/export → JSON
 * - GET /api/transactions/export?format=csv → CSV download
 * Dedupes by txHash when present (prefers action_outcome / richer rows).
 */
router.get("/transactions/export", async (req, res): Promise<void> => {
 try {
 const format =
 typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "json";
 const all = await listAllPlatformTransactions();

 // Prefer rows with hashes; collapse duplicate hashes keeping richest summary.
 const byHash = new Map<string, (typeof all)[number]>();
 const noHash: typeof all = [];
 for (const row of all) {
 if (!row.txHash) {
 noHash.push(row);
 continue;
 }
 const key = row.txHash.toLowerCase();
 const prev = byHash.get(key);
 if (!prev) {
 byHash.set(key, row);
 continue;
 }
 const score = (r: typeof row) =>
 (r.summary ? 2 : 0) + (r.actionType ? 1 : 0) + (r.source === "action_outcome" ? 1 : 0);
 if (score(row) > score(prev)) byHash.set(key, row);
 }
 const unique = [...byHash.values(), ...noHash].sort((a, b) =>
 a.createdAt < b.createdAt ? 1 : -1
 );

 if (format === "csv") {
 const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
 const lines = [
 "id,source,event_type,action_type,wallet_public_key,tx_hash,explorer_url,summary,created_at",
 ...unique.map((r) =>
 [
 r.id,
 esc(r.source),
 esc(r.eventType),
 esc(r.actionType ?? ""),
 esc(r.walletPublicKey ?? ""),
 esc(r.txHash ?? ""),
 esc(r.explorerUrl ?? ""),
 esc(r.summary ?? ""),
 esc(r.createdAt),
 ].join(",")
 ),
 ];
 res.setHeader(
 "Content-Disposition",
 'attachment; filename="orbit-platform-transactions.csv"'
 );
 res.type("text/csv").send(lines.join("\n"));
 return;
 }

 res.json({
 network: "testnet",
 totalRows: all.length,
 uniqueWithHash: byHash.size,
 unsignedOrNoHash: noHash.length,
 exportedAt: new Date().toISOString(),
 transactions: unique,
 });
 } catch (err) {
 console.error("[transactions/export] GET failed:", err);
 res.status(503).json({
 error: err instanceof Error ? err.message : "Transaction export unavailable",
 });
 }
});

export default router;
