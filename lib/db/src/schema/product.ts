import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

/**
 * Product validation tables (Level 4) — not on-chain authority.
 * wallet_events: proof of real wallet interactions
 * feedback: user feedback collection
 * beta_nft_eligibility: feedback → whitelist → one claimable beta NFT per wallet
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

export const betaNftEligibilityTable = pgTable("beta_nft_eligibility", {
  walletPublicKey: text("wallet_public_key").primaryKey(),
  feedbackId: integer("feedback_id"),
  whitelistedAt: timestamp("whitelisted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimTokenId: integer("claim_token_id"),
  claimTxHash: text("claim_tx_hash"),
});

export type WalletEvent = typeof walletEventsTable.$inferSelect;
export type FeedbackRow = typeof feedbackTable.$inferSelect;
export type BetaNftEligibility = typeof betaNftEligibilityTable.$inferSelect;
