import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Users ───────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Nullable until bound; required + verified for lost-phone recovery */
  email: text("email").unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ─── OTP codes ────────────────────────────────────────────────────────────────

export const otpCodesTable = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  /** scrypt hash of the 6-digit code */
  codeHash: text("code_hash").notNull(),
  /** login | verify_email | recover */
  purpose: text("purpose").notNull().default("login"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OtpCode = typeof otpCodesTable.$inferSelect;

// ─── Passkey credentials (WebAuthn / FIDO2) ───────────────────────────────────

export const passkeyCredentialsTable = pgTable("passkey_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  aaguid: text("aaguid"),
  counter: integer("counter").notNull().default(0),
  deviceName: text("device_name"),
  transports: jsonb("transports").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type PasskeyCredential = typeof passkeyCredentialsTable.$inferSelect;

// ─── TOTP secrets ─────────────────────────────────────────────────────────────

export const totpSecretsTable = pgTable("totp_secrets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  encryptedSecret: text("encrypted_secret").notNull(),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TotpSecret = typeof totpSecretsTable.$inferSelect;

// ─── Sessions ────────────────────────────────────────────────────────────────

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  deviceInfo: text("device_info"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessionsTable.$inferSelect;

// ─── Internal wallets ─────────────────────────────────────────────────────────

export const internalWalletsTable = pgTable("internal_wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  stellarPublicKey: text("stellar_public_key").notNull().unique(),
  /**
   * Envelope-encrypted server XOR share (v1:… blob).
   * Combined with deviceShare only in memory during sign/export.
   */
  encryptedServerShare: text("encrypted_server_share").notNull(),
  /**
   * Envelope-encrypted FULL secret for lost-phone recovery.
   * Decrypt ONLY after verified email OTP + TOTP. Never use passphrase.
   */
  encryptedRecoveryShare: text("encrypted_recovery_share"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InternalWallet = typeof internalWalletsTable.$inferSelect;

// ─── WebAuthn challenge cache ─────────────────────────────────────────────────

export const webauthnChallengesTable = pgTable("webauthn_challenges", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(),
  challenge: text("challenge").notNull(),
  type: text("type").notNull(), // registration | authentication | signup
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WebauthnChallenge = typeof webauthnChallengesTable.$inferSelect;
