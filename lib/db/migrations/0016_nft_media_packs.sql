CREATE TABLE IF NOT EXISTS "nft_media_packs" (
  "id" text PRIMARY KEY NOT NULL,
  "creator" text NOT NULL,
  "name" text,
  "collection_contract" text,
  "expected_count" integer NOT NULL DEFAULT 0,
  "item_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'uploading',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "nft_media_packs_creator_idx"
  ON "nft_media_packs" ("creator");
CREATE INDEX IF NOT EXISTS "nft_media_packs_collection_idx"
  ON "nft_media_packs" ("collection_contract");

CREATE TABLE IF NOT EXISTS "nft_media_pack_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "pack_id" text NOT NULL REFERENCES "nft_media_packs"("id") ON DELETE CASCADE,
  "token_index" integer NOT NULL,
  "media_id" text NOT NULL,
  "metadata_id" text NOT NULL,
  "file_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("pack_id", "token_index")
);

CREATE INDEX IF NOT EXISTS "nft_media_pack_items_pack_idx"
  ON "nft_media_pack_items" ("pack_id");
