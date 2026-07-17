CREATE TABLE IF NOT EXISTS "nft_metadata" (
  "id" text PRIMARY KEY NOT NULL,
  "wallet_public_key" text,
  "collection_contract" text,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "nft_collections" (
  "id" serial PRIMARY KEY NOT NULL,
  "contract_id" text NOT NULL UNIQUE,
  "creator" text NOT NULL,
  "name" text NOT NULL,
  "symbol" text NOT NULL,
  "base_uri" text,
  "max_supply" integer,
  "open_mint" boolean DEFAULT true,
  "tx_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "nft_collections_creator_idx" ON "nft_collections" ("creator");
CREATE INDEX IF NOT EXISTS "nft_metadata_wallet_idx" ON "nft_metadata" ("wallet_public_key");
