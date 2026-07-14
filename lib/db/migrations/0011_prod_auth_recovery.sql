-- Migration: production auth — nullable email, email verification, OTP purpose
-- Apply against DATABASE_URL (Neon)

-- Allow passkey-first signup (email bound later)
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ;

-- OTP purpose: login | verify_email | recover
ALTER TABLE "otp_codes" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'login';

-- Ensure recovery blob column exists (already in 0010 as encrypted_recovery_share)
-- Envelope format is opaque text — no column type change required.
