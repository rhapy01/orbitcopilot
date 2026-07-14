-- Migration: internal wallet auth tables
-- Run with: pnpm --filter @workspace/db drizzle-kit push
-- or apply manually against your DATABASE_URL

-- Users
CREATE TABLE IF NOT EXISTS "users" (
  "id"           SERIAL PRIMARY KEY,
  "email"        TEXT NOT NULL UNIQUE,
  "display_name" TEXT,
  "avatar_url"   TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OTP codes
CREATE TABLE IF NOT EXISTS "otp_codes" (
  "id"         SERIAL PRIMARY KEY,
  "email"      TEXT NOT NULL,
  "code_hash"  TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used"       BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "otp_codes_email_idx" ON "otp_codes" ("email");

-- Passkey credentials (WebAuthn/FIDO2)
CREATE TABLE IF NOT EXISTS "passkey_credentials" (
  "id"            SERIAL PRIMARY KEY,
  "user_id"       INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credential_id" TEXT NOT NULL UNIQUE,
  "public_key"    TEXT NOT NULL,
  "aaguid"        TEXT,
  "counter"       INTEGER NOT NULL DEFAULT 0,
  "device_name"   TEXT,
  "transports"    JSONB,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_used_at"  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "passkey_user_idx" ON "passkey_credentials" ("user_id");

-- TOTP secrets
CREATE TABLE IF NOT EXISTS "totp_secrets" (
  "id"               SERIAL PRIMARY KEY,
  "user_id"          INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "encrypted_secret" TEXT NOT NULL,
  "verified"         BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions
CREATE TABLE IF NOT EXISTS "sessions" (
  "id"          SERIAL PRIMARY KEY,
  "user_id"     INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash"  TEXT NOT NULL UNIQUE,
  "expires_at"  TIMESTAMPTZ NOT NULL,
  "device_info" TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" ("expires_at");

-- Internal wallets (embedded key shares)
CREATE TABLE IF NOT EXISTS "internal_wallets" (
  "id"                       SERIAL PRIMARY KEY,
  "user_id"                  INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "stellar_public_key"       TEXT NOT NULL UNIQUE,
  "encrypted_server_share"   TEXT NOT NULL,
  "encrypted_recovery_share" TEXT,
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WebAuthn challenge cache
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  "id"         SERIAL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "challenge"  TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "webauthn_challenges_identifier_idx" ON "webauthn_challenges" ("identifier");

-- Cleanup job hint: DELETE FROM webauthn_challenges WHERE expires_at < NOW();
-- Cleanup job hint: DELETE FROM otp_codes WHERE expires_at < NOW();
-- Cleanup job hint: DELETE FROM sessions WHERE expires_at < NOW();
