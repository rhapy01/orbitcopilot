import {
 db,
 chatMessagesTable,
 chatSessionsTable,
 type ChatMessage,
} from "@workspace/db";
import { eq, isNull, desc, sql, and } from "drizzle-orm";

export type StoredChatMessage = {
 id: number;
 sessionId: number | null;
 walletPublicKey: string | null;
 role: string;
 content: string;
 metadata: unknown;
 createdAt: Date;
};

export type StoredChatSession = {
 id: number;
 walletPublicKey: string | null;
 title: string;
 updatedAt: Date;
 createdAt: Date;
};

function sessionKey(wallet: string | null): string {
 return wallet ?? "";
}

function toStored(row: ChatMessage): StoredChatMessage {
 return {
 id: row.id,
 sessionId: row.sessionId,
 walletPublicKey: row.walletPublicKey,
 role: row.role,
 content: row.content,
 metadata: row.metadata,
 createdAt: row.createdAt,
 };
}

function titleFromContent(content: string): string {
 const t = content.trim().replace(/\s+/g, " ");
 // Extract meaningful title: prefer verb + asset pattern
 const patterns = [
 /\b(swap|send|stake|unstake|claim|borrow|supply|withdraw|repay|add|remove)\b.*?\b([a-zA-Z]{2,8})\b/i,
 /\b(what|whats|how much|show|check)\b.{0,40}/i,
 /\b(portfolio|balance|earning|yield|market|price)\b.{0,30}/i,
 ];
 for (const re of patterns) {
 const m = t.match(re);
 if (m) {
 const candidate = m[0].trim();
 const title = candidate.charAt(0).toUpperCase() + candidate.slice(1);
 return title.length > 52 ? title.slice(0, 52) + "…" : title;
 }
 }
 return t.length > 52 ? t.slice(0, 52) + "…" : t || "New chat";
}

let schemaReady: Promise<void> | null = null;

async function migrateLegacyMessages(): Promise<void> {
 const orphanRows = await db
 .select({ walletPublicKey: chatMessagesTable.walletPublicKey })
 .from(chatMessagesTable)
 .where(isNull(chatMessagesTable.sessionId));

 const wallets = [
 ...new Set(orphanRows.map((r) => r.walletPublicKey ?? null)),
 ];

 for (const wallet of wallets) {
 const key = sessionKey(wallet);
 const [session] = await db
 .insert(chatSessionsTable)
 .values({
 walletPublicKey: key,
 title: "New chat",
 updatedAt: new Date(),
 })
 .returning();

 if (wallet) {
 await db
 .update(chatMessagesTable)
 .set({ sessionId: session.id })
 .where(
 and(
 eq(chatMessagesTable.walletPublicKey, wallet),
 isNull(chatMessagesTable.sessionId)
 )
 );
 } else {
 await db
 .update(chatMessagesTable)
 .set({ sessionId: session.id })
 .where(
 and(
 isNull(chatMessagesTable.walletPublicKey),
 isNull(chatMessagesTable.sessionId)
 )
 );
 }

 const firstUser = await db
 .select()
 .from(chatMessagesTable)
 .where(
 and(
 eq(chatMessagesTable.sessionId, session.id),
 eq(chatMessagesTable.role, "user")
 )
 )
 .orderBy(chatMessagesTable.createdAt)
 .limit(1);

 if (firstUser[0]) {
 await db
 .update(chatSessionsTable)
 .set({ title: titleFromContent(firstUser[0].content) })
 .where(eq(chatSessionsTable.id, session.id));
 }
 }
}

/** Ensure chat tables exist (idempotent; runs once per process). */
export async function ensureChatSchema(): Promise<void> {
 if (!schemaReady) {
 schemaReady = (async () => {
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS chat_sessions (
 id serial PRIMARY KEY,
 wallet_public_key text NOT NULL DEFAULT '',
 title text NOT NULL DEFAULT 'New chat',
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
 )
 `);
 await db.execute(sql`DROP INDEX IF EXISTS chat_sessions_wallet_uidx`);
 await db.execute(sql`
 CREATE TABLE IF NOT EXISTS chat_messages (
 id serial PRIMARY KEY,
 wallet_public_key text,
 role text NOT NULL,
 content text NOT NULL,
 metadata jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
 )
 `);
 await db.execute(sql`
 ALTER TABLE chat_messages
 ADD COLUMN IF NOT EXISTS session_id integer
 `);
 await migrateLegacyMessages();
 })();
 }
 await schemaReady;
}

async function updateSessionActivity(
 sessionId: number,
 userContent?: string
): Promise<void> {
 const existing = await db
 .select()
 .from(chatSessionsTable)
 .where(eq(chatSessionsTable.id, sessionId))
 .limit(1);

 if (!existing[0]) return;

 const title =
 userContent && existing[0].title === "New chat"
 ? titleFromContent(userContent)
 : existing[0].title;

 await db
 .update(chatSessionsTable)
 .set({
 title,
 updatedAt: new Date(),
 })
 .where(eq(chatSessionsTable.id, sessionId));
}

export async function createChatSession(
 wallet: string | null
): Promise<StoredChatSession> {
 await ensureChatSchema();
 const [row] = await db
 .insert(chatSessionsTable)
 .values({
 walletPublicKey: sessionKey(wallet),
 title: "New chat",
 updatedAt: new Date(),
 })
 .returning();

 return {
 id: row.id,
 walletPublicKey: row.walletPublicKey || null,
 title: row.title,
 updatedAt: row.updatedAt,
 createdAt: row.createdAt,
 };
}

export async function getChatSession(
 sessionId: number
): Promise<StoredChatSession | null> {
 await ensureChatSchema();
 const rows = await db
 .select()
 .from(chatSessionsTable)
 .where(eq(chatSessionsTable.id, sessionId))
 .limit(1);
 const row = rows[0];
 if (!row) return null;
 return {
 id: row.id,
 walletPublicKey: row.walletPublicKey || null,
 title: row.title,
 updatedAt: row.updatedAt,
 createdAt: row.createdAt,
 };
}

export async function listChatMessages(
 sessionId: number
): Promise<StoredChatMessage[]> {
 await ensureChatSchema();
 const rows = await db
 .select()
 .from(chatMessagesTable)
 .where(eq(chatMessagesTable.sessionId, sessionId))
 .orderBy(chatMessagesTable.createdAt);
 return rows.map(toStored);
}

/**
 * Prior user/assistant turns for LLM context (excludes the latest user message
 * that was just inserted before getAiResponse runs).
 */
export async function listPriorChatTurns(
 sessionId: number,
 maxMessages = 8
): Promise<{ role: "user" | "assistant"; content: string }[]> {
 const all = await listChatMessages(sessionId);
 if (all.length <= 1) return [];
 const prior = all.slice(0, -1);
 const recent = prior.slice(-maxMessages);
 return recent
 .filter((m) => m.role === "user" || m.role === "assistant")
 .map((m) => ({
 role: m.role as "user" | "assistant",
 content:
 m.content.length > 2000 ? `${m.content.slice(0, 2000)}…` : m.content,
 }));
}

export async function insertChatMessage(input: {
 walletPublicKey: string | null;
 sessionId: number;
 role: string;
 content: string;
 metadata?: unknown;
}): Promise<StoredChatMessage> {
 await ensureChatSchema();
 const [row] = await db
 .insert(chatMessagesTable)
 .values({
 sessionId: input.sessionId,
 walletPublicKey: input.walletPublicKey,
 role: input.role,
 content: input.content,
 metadata: (input.metadata ?? null) as never,
 })
 .returning();

 if (input.role === "user") {
 await updateSessionActivity(input.sessionId, input.content);
 } else {
 await updateSessionActivity(input.sessionId);
 }

 return toStored(row);
}

export async function deleteChatMessage(id: number): Promise<void> {
 await ensureChatSchema();
 await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id));
}

/** @deprecated Prefer createChatSession - starts a fresh thread without deleting history. */
export async function clearChatMessages(
 wallet: string | null
): Promise<StoredChatSession> {
 return createChatSession(wallet);
}

export async function listRecentSessions(
 wallet: string | null,
 limit = 20
): Promise<StoredChatSession[]> {
 await ensureChatSchema();
 // Never return anonymous sessions to unauthenticated users -
 // anon sessions are shared across all visitors with no wallet
 if (!wallet) return [];

 const rows = await db
 .select()
 .from(chatSessionsTable)
 .where(eq(chatSessionsTable.walletPublicKey, wallet))
 .orderBy(desc(chatSessionsTable.updatedAt))
 .limit(limit);

 return rows.map((r) => ({
 id: r.id,
 walletPublicKey: r.walletPublicKey || null,
 title: r.title,
 updatedAt: r.updatedAt,
 createdAt: r.createdAt,
 }));
}
