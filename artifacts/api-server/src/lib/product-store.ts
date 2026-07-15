import { db, walletEventsTable, feedbackTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

let schemaReady: Promise<void> | null = null;

export async function ensureProductSchema(): Promise<void> {
 if (!schemaReady) {
 schemaReady = (async () => {
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS wallet_events (
 id serial PRIMARY KEY,
 wallet_public_key text,
 event_type text NOT NULL,
 metadata jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
 )
 `);
 await db.execute(sql`
 CREATE INDEX IF NOT EXISTS wallet_events_wallet_idx
 ON wallet_events (wallet_public_key)
 `);
 await db.execute(sql`
 CREATE INDEX IF NOT EXISTS wallet_events_type_idx
 ON wallet_events (event_type)
 `);
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS feedback (
 id serial PRIMARY KEY,
 wallet_public_key text,
 rating integer NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
 )
 `);
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS user_intents (
 id serial PRIMARY KEY,
 wallet_public_key text NOT NULL,
 intent_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
 )
 `);
 await db.execute(sql`
 CREATE INDEX IF NOT EXISTS user_intents_wallet_idx
 ON user_intents (wallet_public_key)
 `);
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS action_outcomes (
 id serial PRIMARY KEY,
 wallet_public_key text NOT NULL,
 summary text NOT NULL,
 tx_hash text,
 before_idle text,
 after_note text,
 created_at timestamptz NOT NULL DEFAULT now()
 )
 `);
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS beta_nft_eligibility (
 wallet_public_key text PRIMARY KEY,
 feedback_id integer,
 whitelisted_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 claim_token_id integer,
 claim_tx_hash text
 )
 `);
 await db.execute(sql`
 CREATE INDEX IF NOT EXISTS beta_nft_eligibility_claimed_idx
 ON beta_nft_eligibility (claimed_at)
 WHERE claimed_at IS NOT NULL
 `);
 })();
 }
 await schemaReady;
}

export type StoredIntent = {
 text: string;
 createdAt: string;
};

export type StoredOutcome = {
 summary: string;
 txHash: string | null;
 beforeIdle: string | null;
 afterNote: string | null;
 createdAt: string;
};

export async function recordIntent(
 walletPublicKey: string,
 intentText: string
): Promise<void> {
 await ensureProductSchema();
 await db.execute(sql`
 INSERT INTO user_intents (wallet_public_key, intent_text)
 VALUES (${walletPublicKey}, ${intentText.slice(0, 500)})
 `);
}

export async function getLastIntent(
 walletPublicKey: string
): Promise<StoredIntent | null> {
 await ensureProductSchema();
 const res = await db.execute(sql`
 SELECT intent_text AS text, created_at AS "createdAt"
 FROM user_intents
 WHERE wallet_public_key = ${walletPublicKey}
 ORDER BY created_at DESC
 LIMIT 1
 `);
 const row = res.rows?.[0] as
 | { text?: string; createdAt?: Date | string }
 | undefined;
 if (!row?.text) return null;
 return {
 text: row.text,
 createdAt:
 row.createdAt instanceof Date
 ? row.createdAt.toISOString()
 : String(row.createdAt),
 };
}

export async function recordOutcome(input: {
 walletPublicKey: string;
 summary: string;
 txHash?: string | null;
 beforeIdle?: string | null;
 afterNote?: string | null;
}): Promise<void> {
 await ensureProductSchema();
 await db.execute(sql`
 INSERT INTO action_outcomes (
 wallet_public_key, summary, tx_hash, before_idle, after_note
 ) VALUES (
 ${input.walletPublicKey},
 ${input.summary.slice(0, 500)},
 ${input.txHash ?? null},
 ${input.beforeIdle ?? null},
 ${input.afterNote ?? null}
 )
 `);
 await recordWalletEvent({
 walletPublicKey: input.walletPublicKey,
 eventType: "tx_submit",
 metadata: {
 outcome: input.summary,
 txHash: input.txHash,
 beforeIdle: input.beforeIdle,
 },
 });
}

export async function getLastOutcome(
 walletPublicKey: string
): Promise<StoredOutcome | null> {
 await ensureProductSchema();
 const res = await db.execute(sql`
 SELECT summary, tx_hash AS "txHash", before_idle AS "beforeIdle",
 after_note AS "afterNote", created_at AS "createdAt"
 FROM action_outcomes
 WHERE wallet_public_key = ${walletPublicKey}
 ORDER BY created_at DESC
 LIMIT 1
 `);
 const row = res.rows?.[0] as
 | {
 summary?: string;
 txHash?: string | null;
 beforeIdle?: string | null;
 afterNote?: string | null;
 createdAt?: Date | string;
 }
 | undefined;
 if (!row?.summary) return null;
 return {
 summary: row.summary,
 txHash: row.txHash ?? null,
 beforeIdle: row.beforeIdle ?? null,
 afterNote: row.afterNote ?? null,
 createdAt:
 row.createdAt instanceof Date
 ? row.createdAt.toISOString()
 : String(row.createdAt),
 };
}

export async function recordWalletEvent(input: {
 walletPublicKey?: string | null;
 eventType: string;
 metadata?: Record<string, unknown> | null;
}): Promise<void> {
 await ensureProductSchema();
 await db.insert(walletEventsTable).values({
 walletPublicKey: input.walletPublicKey ?? null,
 eventType: input.eventType,
 metadata: (input.metadata ?? null) as never,
 });
}

export async function insertFeedback(input: {
 walletPublicKey?: string | null;
 rating: number;
 message: string;
}): Promise<{
 feedbackId: number;
 betaNft: { eligible: boolean; claimed: boolean; whitelisted: boolean };
}> {
 await ensureProductSchema();
 const inserted = await db
 .insert(feedbackTable)
 .values({
 walletPublicKey: input.walletPublicKey ?? null,
 rating: input.rating,
 message: input.message,
 })
 .returning({ id: feedbackTable.id });

 const feedbackId = inserted[0]?.id ?? 0;
 const wallet = input.walletPublicKey?.trim() ?? null;

 if (!wallet || !/^G[A-Z2-7]{55}$/.test(wallet)) {
 return {
 feedbackId,
 betaNft: { eligible: false, claimed: false, whitelisted: false },
 };
 }

 await db.execute(sql`
 INSERT INTO beta_nft_eligibility (wallet_public_key, feedback_id)
 VALUES (${wallet}, ${feedbackId})
 ON CONFLICT (wallet_public_key) DO NOTHING
 `);

 const status = await getBetaNftStatus(wallet);
 return {
 feedbackId,
 betaNft: {
 eligible: status.eligible && !status.claimed,
 claimed: status.claimed,
 whitelisted: status.eligible,
 },
 };
}

export async function getBetaNftClaimedCount(): Promise<number> {
 await ensureProductSchema();
 const res = await db.execute(sql`
 SELECT COUNT(*)::int AS n
 FROM beta_nft_eligibility
 WHERE claimed_at IS NOT NULL
 `);
 const row = res.rows?.[0] as Record<string, unknown> | undefined;
 const v = row?.n;
 return typeof v === "number" ? v : Number(v) || 0;
}

export async function getBetaNftStatus(walletPublicKey: string): Promise<{
 eligible: boolean;
 claimed: boolean;
 claimTxHash: string | null;
 whitelistedAt: string | null;
}> {
 await ensureProductSchema();
 const res = await db.execute(sql`
 SELECT claimed_at AS "claimedAt",
 claim_tx_hash AS "claimTxHash",
 whitelisted_at AS "whitelistedAt"
 FROM beta_nft_eligibility
 WHERE wallet_public_key = ${walletPublicKey}
 LIMIT 1
 `);
 const row = res.rows?.[0] as
 | {
 claimedAt?: Date | string | null;
 claimTxHash?: string | null;
 whitelistedAt?: Date | string | null;
 }
 | undefined;
 if (!row) {
 return {
 eligible: false,
 claimed: false,
 claimTxHash: null,
 whitelistedAt: null,
 };
 }
 return {
 eligible: true,
 claimed: Boolean(row.claimedAt ?? (row as { claimedat?: unknown }).claimedat),
 claimTxHash:
 row.claimTxHash ??
 (row as { claimtxhash?: string | null }).claimtxhash ??
 null,
 whitelistedAt:
 row.whitelistedAt instanceof Date
 ? row.whitelistedAt.toISOString()
 : row.whitelistedAt
 ? String(row.whitelistedAt)
 : (row as { whitelistedat?: string | null }).whitelistedat
 ? String((row as { whitelistedat?: string | null }).whitelistedat)
 : null,
 };
}

/** DB + on-chain claim state; syncs eligibility row when mint is on-chain only. */
export async function resolveBetaNftStatus(walletPublicKey: string): Promise<{
 eligible: boolean;
 claimed: boolean;
 claimTxHash: string | null;
 whitelistedAt: string | null;
}> {
 const status = await getBetaNftStatus(walletPublicKey);
 if (status.claimed) return status;

 const { walletOwnsBetaNft } = await import("./nft");
 const onChain = await walletOwnsBetaNft(walletPublicKey);
 if (!onChain.owned) return status;

 await markBetaNftClaimed({
 walletPublicKey,
 txHash: status.claimTxHash ?? "onchain-sync",
 tokenId: onChain.tokenId,
 });
 return getBetaNftStatus(walletPublicKey);
}

/** One-line status for LLM system prompt - stops “claim claim” after mint. */
export async function formatBetaNftStatusForLlm(
 walletPublicKey: string
): Promise<string | null> {
 try {
 const status = await resolveBetaNftStatus(walletPublicKey);
 if (status.claimed) {
 return `Beta tester NFT: ALREADY CLAIMED for this wallet (one per address). Do NOT propose claim/mint of the beta NFT. Suggest “view my NFTs” instead.`;
 }
 if (status.eligible) {
 return `Beta tester NFT: eligible, not claimed yet. User may claim once via “claim my beta NFT”. Never offer a second claim.`;
 }
 return `Beta tester NFT: not eligible yet - user must submit feedback (heart icon) first. Do not propose minting the beta tester NFT.`;
 } catch {
 return null;
 }
}

/** Mark beta NFT claimed after successful on-chain mint. Idempotent. */
export async function markBetaNftClaimed(input: {
 walletPublicKey: string;
 txHash: string;
 tokenId?: number | null;
}): Promise<{ ok: boolean; alreadyClaimed: boolean }> {
 await ensureProductSchema();
 const status = await getBetaNftStatus(input.walletPublicKey);
 if (!status.eligible) {
 return { ok: false, alreadyClaimed: false };
 }
 if (status.claimed) {
 return { ok: true, alreadyClaimed: true };
 }

 await db.execute(sql`
 UPDATE beta_nft_eligibility
 SET claimed_at = now(),
 claim_tx_hash = ${input.txHash},
 claim_token_id = ${input.tokenId ?? null}
 WHERE wallet_public_key = ${input.walletPublicKey}
 AND claimed_at IS NULL
 `);
 await recordWalletEvent({
 walletPublicKey: input.walletPublicKey,
 eventType: "tx_submit",
 metadata: {
 actionType: "nft_mint",
 betaNft: true,
 txHash: input.txHash,
 tokenId: input.tokenId ?? null,
 },
 });
 return { ok: true, alreadyClaimed: false };
}

function rowNum(row: Record<string, unknown> | undefined, key: string): number {
 if (!row) return 0;
 const v = row[key];
 return typeof v === "number" ? v : Number(v) || 0;
}

export async function getProductStats() {
 await ensureProductSchema();

 const totalEvents = await db.execute(sql`
 SELECT COUNT(*)::int AS n FROM wallet_events
 `);
 const uniqueWalletsRes = await db.execute(sql`
 SELECT COUNT(DISTINCT wallet_public_key)::int AS n
 FROM wallet_events
 WHERE wallet_public_key IS NOT NULL
 `);
 const byTypeRes = await db.execute(sql`
 SELECT event_type AS type, COUNT(*)::int AS n
 FROM wallet_events
 GROUP BY event_type
 `);
 const feedbackAgg = await db.execute(sql`
 SELECT COUNT(*)::int AS n, COALESCE(AVG(rating), 0)::float AS avg
 FROM feedback
 `);

 const recent = await db
 .select({
 id: walletEventsTable.id,
 walletPublicKey: walletEventsTable.walletPublicKey,
 eventType: walletEventsTable.eventType,
 metadata: walletEventsTable.metadata,
 createdAt: walletEventsTable.createdAt,
 })
 .from(walletEventsTable)
 .orderBy(desc(walletEventsTable.createdAt))
 .limit(25);

 const feedbackRecent = await db
 .select({
 id: feedbackTable.id,
 rating: feedbackTable.rating,
 message: feedbackTable.message,
 walletPublicKey: feedbackTable.walletPublicKey,
 createdAt: feedbackTable.createdAt,
 })
 .from(feedbackTable)
 .orderBy(desc(feedbackTable.createdAt))
 .limit(20);

 const total = rowNum(totalEvents.rows?.[0] as Record<string, unknown>, "n");
 const uniqueWallets = rowNum(
 uniqueWalletsRes.rows?.[0] as Record<string, unknown>,
 "n"
 );
 const feedbackTotal = rowNum(
 feedbackAgg.rows?.[0] as Record<string, unknown>,
 "n"
 );
 const avgRating = rowNum(
 feedbackAgg.rows?.[0] as Record<string, unknown>,
 "avg"
 );

 const byType: Record<string, number> = {};
 for (const row of byTypeRes.rows ?? []) {
 const r = row as Record<string, unknown>;
 const type = String(r.type ?? "");
 if (type) byType[type] = rowNum(r, "n");
 }

 const betaAgg = await db.execute(sql`
 SELECT
 COUNT(*)::int AS whitelisted,
 COUNT(*) FILTER (WHERE claimed_at IS NOT NULL)::int AS claimed
 FROM beta_nft_eligibility
 `);
 const betaRow = betaAgg.rows?.[0] as Record<string, unknown> | undefined;

 return {
 network: "testnet" as const,
 events: {
 total,
 uniqueWallets,
 byType,
 recent: recent.map((r) => ({
 id: r.id,
 walletPublicKey: r.walletPublicKey
 ? `${r.walletPublicKey.slice(0, 4)}…${r.walletPublicKey.slice(-4)}`
 : null,
 eventType: r.eventType,
 metadata: r.metadata,
 createdAt: r.createdAt.toISOString(),
 })),
 },
 feedback: {
 total: feedbackTotal,
 averageRating: Math.round(avgRating * 10) / 10,
 recent: feedbackRecent.map((f) => ({
 id: f.id,
 rating: f.rating,
 message: f.message,
 walletPublicKey: f.walletPublicKey
 ? `${f.walletPublicKey.slice(0, 4)}…${f.walletPublicKey.slice(-4)}`
 : null,
 createdAt: f.createdAt.toISOString(),
 })),
 },
 betaNft: {
 whitelisted: rowNum(betaRow, "whitelisted"),
 claimed: rowNum(betaRow, "claimed"),
 },
 level4: {
 minUsersTarget: 10,
 uniqueWallets,
 usersTargetMet: uniqueWallets >= 10,
 },
 };
}
