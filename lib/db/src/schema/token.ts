import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * SEP-1 metadata registry for classic assets launched through Orbit.
 * Asset ownership/supply remains on Stellar; this table powers stellar.toml.
 */
export const launchedTokensTable = pgTable(
  "launched_tokens",
  {
    id: serial("id").primaryKey(),
    issuer: text("issuer").notNull(),
    code: text("code").notNull(),
    contractId: text("contract_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    website: text("website"),
    conditions: text("conditions"),
    decimals: integer("decimals").notNull().default(7),
    deployTxHash: text("deploy_tx_hash"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("launched_tokens_issuer_code_idx").on(table.issuer, table.code),
  ]
);

export type LaunchedToken = typeof launchedTokensTable.$inferSelect;
