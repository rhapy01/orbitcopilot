import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

/** Orbit-native prediction markets (binary yes/no). */
export const predictionMarketsTable = pgTable("prediction_markets", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  question: text("question").notNull(),
  category: text("category").notNull().default("general"),
  /** Comma-separated searchable keywords */
  keywords: text("keywords").notNull().default(""),
  status: text("status").notNull().default("open"), // open | resolved | void
  resolvedOutcome: text("resolved_outcome"), // yes | no
  yesPoolXlm: doublePrecision("yes_pool_xlm").notNull().default(0),
  noPoolXlm: doublePrecision("no_pool_xlm").notNull().default(0),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const predictionPositionsTable = pgTable("prediction_positions", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  walletPublicKey: text("wallet_public_key").notNull(),
  outcome: text("outcome").notNull(), // yes | no
  amountXlm: doublePrecision("amount_xlm").notNull(),
  status: text("status").notNull().default("pending"), // pending | active | won | lost | claimed
  stakeTxHash: text("stake_tx_hash"),
  claimTxHash: text("claim_tx_hash"),
  payoutXlm: doublePrecision("payout_xlm"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
