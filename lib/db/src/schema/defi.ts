import { pgTable, serial, text, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const defiOpportunitiesTable = pgTable("defi_opportunities", {
  id: serial("id").primaryKey(),
  protocol: text("protocol").notNull(),
  type: text("type").notNull(),
  assetCode: text("asset_code").notNull(),
  apy: doublePrecision("apy").notNull(),
  tvlUsd: doublePrecision("tvl_usd").notNull().default(0),
  riskLevel: text("risk_level").notNull().default("medium"),
  description: text("description").notNull(),
  minDeposit: doublePrecision("min_deposit").notNull().default(0),
  rewards: text("rewards").array().notNull().default([]),
});

export const insertDefiOpportunitySchema = createInsertSchema(defiOpportunitiesTable).omit({ id: true });
export type InsertDefiOpportunity = z.infer<typeof insertDefiOpportunitySchema>;
export type DefiOpportunity = typeof defiOpportunitiesTable.$inferSelect;
