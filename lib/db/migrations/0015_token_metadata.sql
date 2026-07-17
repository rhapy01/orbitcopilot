CREATE TABLE IF NOT EXISTS "launched_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "issuer" text NOT NULL,
  "code" text NOT NULL,
  "contract_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "image_url" text,
  "website" text,
  "conditions" text,
  "decimals" integer DEFAULT 7 NOT NULL,
  "deploy_tx_hash" text,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "launched_tokens_issuer_code_idx"
  ON "launched_tokens" ("issuer", "code");
