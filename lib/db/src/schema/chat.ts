import { pgTable, serial, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Postgres: durable chat UX only.
 * Wallet balances / positions are never stored here — read from chain.
 */

/** One active thread metadata row per wallet (empty string = anonymous). */
export const chatSessionsTable = pgTable(
  "chat_sessions",
  {
    id: serial("id").primaryKey(),
    /** G… wallet, or "" for anonymous */
    walletPublicKey: text("wallet_public_key").notNull().default(""),
    title: text("title").notNull().default("New chat"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("chat_sessions_wallet_uidx").on(t.walletPublicKey)]
);

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  /** Wallet that owns this message (G…); null = anonymous */
  walletPublicKey: text("wallet_public_key"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type ChatSession = typeof chatSessionsTable.$inferSelect;
