import {
  db,
  chatMessagesTable,
  chatSessionsTable,
  type ChatMessage,
} from "@workspace/db";
import { eq, isNull, desc, sql } from "drizzle-orm";

export type StoredChatMessage = {
  id: number;
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
    walletPublicKey: row.walletPublicKey,
    role: row.role,
    content: row.content,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

function titleFromContent(content: string): string {
  const t = content.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "New chat";
}

let schemaReady: Promise<void> | null = null;

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
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_sessions_wallet_uidx
        ON chat_sessions (wallet_public_key)
      `);
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
    })();
  }
  await schemaReady;
}

async function upsertSession(
  wallet: string | null,
  userContent: string
): Promise<void> {
  const key = sessionKey(wallet);
  const title = titleFromContent(userContent);
  const existing = await db
    .select()
    .from(chatSessionsTable)
    .where(eq(chatSessionsTable.walletPublicKey, key))
    .limit(1);

  if (existing[0]) {
    await db
      .update(chatSessionsTable)
      .set({
        title: existing[0].title === "New chat" ? title : existing[0].title,
        updatedAt: new Date(),
      })
      .where(eq(chatSessionsTable.id, existing[0].id));
    return;
  }

  await db.insert(chatSessionsTable).values({
    walletPublicKey: key,
    title,
    updatedAt: new Date(),
  });
}

export async function listChatMessages(
  wallet: string | null
): Promise<StoredChatMessage[]> {
  await ensureChatSchema();
  const rows = wallet
    ? await db
        .select()
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.walletPublicKey, wallet))
        .orderBy(chatMessagesTable.createdAt)
    : await db
        .select()
        .from(chatMessagesTable)
        .where(isNull(chatMessagesTable.walletPublicKey))
        .orderBy(chatMessagesTable.createdAt);
  return rows.map(toStored);
}

export async function insertChatMessage(input: {
  walletPublicKey: string | null;
  role: string;
  content: string;
  metadata?: unknown;
}): Promise<StoredChatMessage> {
  await ensureChatSchema();
  const [row] = await db
    .insert(chatMessagesTable)
    .values({
      walletPublicKey: input.walletPublicKey,
      role: input.role,
      content: input.content,
      metadata: (input.metadata ?? null) as never,
    })
    .returning();

  if (input.role === "user") {
    await upsertSession(input.walletPublicKey, input.content);
  } else {
    const key = sessionKey(input.walletPublicKey);
    await db
      .update(chatSessionsTable)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessionsTable.walletPublicKey, key));
  }

  return toStored(row);
}

export async function deleteChatMessage(id: number): Promise<void> {
  await ensureChatSchema();
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id));
}

export async function clearChatMessages(wallet: string | null): Promise<void> {
  await ensureChatSchema();
  if (wallet) {
    await db
      .delete(chatMessagesTable)
      .where(eq(chatMessagesTable.walletPublicKey, wallet));
  } else {
    await db
      .delete(chatMessagesTable)
      .where(isNull(chatMessagesTable.walletPublicKey));
  }
  await db
    .delete(chatSessionsTable)
    .where(eq(chatSessionsTable.walletPublicKey, sessionKey(wallet)));
}

export async function listRecentSessions(
  wallet: string | null,
  limit = 20
): Promise<StoredChatSession[]> {
  await ensureChatSchema();
  const rows = await db
    .select()
    .from(chatSessionsTable)
    .where(eq(chatSessionsTable.walletPublicKey, sessionKey(wallet)))
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
