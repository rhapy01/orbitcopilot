import { pgTable, serial, text, timestamp, boolean, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletsTable = pgTable("wallets", {
  id: serial("id").primaryKey(),
  address: text("address").notNull(),
  network: text("network").notNull().default("Stellar"),
  totalValueUsd: doublePrecision("total_value_usd").notNull().default(0),
  xlmBalance: doublePrecision("xlm_balance").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletAssetsTable = pgTable("wallet_assets", {
  id: serial("id").primaryKey(),
  walletId: serial("wallet_id").notNull(),
  assetCode: text("asset_code").notNull(),
  assetIssuer: text("asset_issuer"),
  balance: doublePrecision("balance").notNull().default(0),
  valueUsd: doublePrecision("value_usd").notNull().default(0),
  priceUsd: doublePrecision("price_usd").notNull().default(0),
  change24h: doublePrecision("change_24h").notNull().default(0),
  logoUrl: text("logo_url"),
});

export const insertWalletSchema = createInsertSchema(walletsTable).omit({ id: true, createdAt: true });
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof walletsTable.$inferSelect;

export const insertWalletAssetSchema = createInsertSchema(walletAssetsTable).omit({ id: true });
export type InsertWalletAsset = z.infer<typeof insertWalletAssetSchema>;
export type WalletAsset = typeof walletAssetsTable.$inferSelect;
