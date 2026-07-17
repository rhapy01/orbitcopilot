import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  customType,
} from "drizzle-orm/pg-core";

/**
 * Off-chain SEP-50 / OpenSea metadata + collection registry for the chat launchpad.
 * On-chain truth remains the Soroban SEP-50 contracts.
 */

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const nftMediaTable = pgTable("nft_media", {
  id: text("id").primaryKey(),
  walletPublicKey: text("wallet_public_key"),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const nftMetadataTable = pgTable("nft_metadata", {
  id: text("id").primaryKey(),
  walletPublicKey: text("wallet_public_key"),
  collectionContract: text("collection_contract"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const nftCollectionsTable = pgTable("nft_collections", {
  id: serial("id").primaryKey(),
  contractId: text("contract_id").notNull().unique(),
  creator: text("creator").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  baseUri: text("base_uri"),
  maxSupply: integer("max_supply"),
  openMint: boolean("open_mint").default(true),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NftMetadataRow = typeof nftMetadataTable.$inferSelect;
export type NftCollectionRow = typeof nftCollectionsTable.$inferSelect;
export type NftMediaRow = typeof nftMediaTable.$inferSelect;
