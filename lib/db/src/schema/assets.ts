import { pgTable, text, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetsTable = pgTable("assets", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  issuer: text("issuer"),
  priceUsd: doublePrecision("price_usd").notNull().default(0),
  change24h: doublePrecision("change_24h").notNull().default(0),
  marketCapUsd: doublePrecision("market_cap_usd").notNull().default(0),
  volume24hUsd: doublePrecision("volume_24h_usd").notNull().default(0),
  logoUrl: text("logo_url"),
  description: text("description"),
  riskLevel: text("risk_level").notNull().default("medium"),
  isTrusted: boolean("is_trusted").notNull().default(false),
});

export const insertAssetSchema = createInsertSchema(assetsTable);
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
