import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
  integer,
} from "drizzle-orm/pg-core";

/** Orbit-native perpetual markets (mark price from Reflector / fallback). */
export const perpMarketsTable = pgTable("perp_markets", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(), // BTC, ETH, XLM
  baseAsset: text("base_asset").notNull(), // BTC
  quoteAsset: text("quote_asset").notNull().default("USDC"),
  maxLeverage: integer("max_leverage").notNull().default(10),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const perpPositionsTable = pgTable("perp_positions", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  walletPublicKey: text("wallet_public_key").notNull(),
  side: text("side").notNull(), // long | short
  leverage: integer("leverage").notNull(),
  /** Margin locked in USDC */
  marginUsdc: doublePrecision("margin_usdc").notNull(),
  /** Notional = margin * leverage */
  notionalUsdc: doublePrecision("notional_usdc").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  stopLoss: doublePrecision("stop_loss"),
  takeProfit: doublePrecision("take_profit"),
  liquidationPrice: doublePrecision("liquidation_price").notNull(),
  status: text("status").notNull().default("pending"), // pending | open | closed | liquidated
  marginTxHash: text("margin_tx_hash"),
  closeTxHash: text("close_tx_hash"),
  exitPrice: doublePrecision("exit_price"),
  realizedPnlUsdc: doublePrecision("realized_pnl_usdc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});
