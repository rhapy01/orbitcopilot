import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

/**
 * Product validation tables (Level 4) — not on-chain authority.
 * wallet_events: proof of real wallet interactions
 * feedback: user feedback collection
 */

export const walletEventsTable = pgTable("wallet_events", {
  id: serial("id").primaryKey(),
  walletPublicKey: text("wallet_public_key"),
  eventType: text("event_type").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  walletPublicKey: text("wallet_public_key"),
  rating: integer("rating").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WalletEvent = typeof walletEventsTable.$inferSelect;
export type FeedbackRow = typeof feedbackTable.$inferSelect;
