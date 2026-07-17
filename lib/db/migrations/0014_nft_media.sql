CREATE TABLE IF NOT EXISTS "nft_media" (
  "id" text PRIMARY KEY NOT NULL,
  "wallet_public_key" text,
  "mime_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sha256" text NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "nft_media_wallet_idx" ON "nft_media" ("wallet_public_key");
CREATE INDEX IF NOT EXISTS "nft_media_sha256_idx" ON "nft_media" ("sha256");
