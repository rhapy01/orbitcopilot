/**
 * Internal (embedded) Stellar wallet - production key management.
 *
 * SECURITY MODEL
 * ──────────────
 * Day-to-day signing (2-of-2):
 * secretKey = serverShare XOR deviceShare
 * • serverShare - envelope-encrypted in Postgres (KMS_SECRET wraps DEK)
 * • deviceShare - browser localStorage only (never in DB)
 *
 * Lost-phone recovery (email + TOTP only):
 * • recoveryBlob - envelope-encrypted FULL secret in Postgres
 * • Decrypt is gated by: verified email OTP + verified TOTP
 * • Passkeys are for login convenience, NOT recovery
 * • Without email + TOTP set, recovery is impossible by design
 *
 * Export also requires email verified + TOTP + device share (or recovery path).
 */

import { Keypair } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { envelopeEncrypt, envelopeDecrypt } from "./crypto";
import { db } from "@workspace/db";
import { internalWalletsTable, usersTable, totpSecretsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

function xorBuffers(a: Buffer, b: Buffer): Buffer {
 if (a.length !== b.length) throw new Error("Share length mismatch");
 const out = Buffer.alloc(a.length);
 for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
 return out;
}

function splitSecret(secretBuf: Buffer): { serverShareBuf: Buffer; deviceShareBuf: Buffer } {
 const deviceShareBuf = randomBytes(secretBuf.length);
 const serverShareBuf = xorBuffers(secretBuf, deviceShareBuf);
 return { serverShareBuf, deviceShareBuf };
}

function reconstructFromShares(
 encryptedServerShare: string,
 deviceShareHex: string,
 userId: number,
 expectedPublicKey: string
): Buffer {
 let serverShareHex: string;
 try {
 serverShareHex = envelopeDecrypt(encryptedServerShare, userId);
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 if (/authenticate data|Unsupported state|auth/i.test(msg)) {
 throw new Error(
 "Wallet encryption key mismatch (KMS_SECRET changed after this wallet was created). " +
 "On testnet: ask an admin to reset your embedded wallet, then Continue with email again. " +
 "Do not rotate KMS_SECRET on production without a re-encrypt migration."
 );
 }
 throw err;
 }
 const serverBuf = Buffer.from(serverShareHex, "hex");
 const deviceBuf = Buffer.from(deviceShareHex, "hex");
 if (serverBuf.length !== deviceBuf.length) {
 throw new Error("Device share length mismatch - recover this device with email + authenticator");
 }
 const secretBuf = xorBuffers(serverBuf, deviceBuf);
 serverBuf.fill(0);
 deviceBuf.fill(0);

 // Validate reconstruction against known public key before signing
 try {
 const kp = Keypair.fromRawEd25519Seed(secretBuf);
 if (kp.publicKey() !== expectedPublicKey) {
 secretBuf.fill(0);
 throw new Error(
 "Device share does not match this wallet - use Recover with email + authenticator on this device"
 );
 }
 } catch (err) {
 if (err instanceof Error && /Device share does not match|recover/i.test(err.message)) throw err;
 secretBuf.fill(0);
 throw new Error(
 "Could not reconstruct wallet key - recover this device with email + authenticator"
 );
 }

 return secretBuf;
}

function shouldFriendbot(): boolean {
 const net = (process.env.STELLAR_NETWORK ?? process.env.NETWORK ?? "testnet").toLowerCase();
 return net === "testnet" || net === "test";
}

/** True when email is verified AND TOTP is enabled - required for recovery. */
export async function isRecoveryReady(userId: number): Promise<boolean> {
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.id, userId),
 });
 if (!user?.email || !user.emailVerifiedAt) return false;

 const totp = await db.query.totpSecretsTable.findFirst({
 where: and(eq(totpSecretsTable.userId, userId), eq(totpSecretsTable.verified, true)),
 });
 return !!totp;
}

/** Create a new internal wallet. Always stores an envelope-encrypted recovery blob. */
export async function createInternalWallet(
 userId: number
): Promise<{ publicKey: string; deviceShareHex: string }> {
 const keypair = Keypair.random();
 const secretBuf = Buffer.from(keypair.rawSecretKey());
 const { serverShareBuf, deviceShareBuf } = splitSecret(secretBuf);

 const encryptedServerShare = envelopeEncrypt(serverShareBuf.toString("hex"), userId);
 // Recovery blob = full secret under envelope encryption.
 // Decrypt is ONLY allowed after email OTP + TOTP (enforced at route layer).
 const encryptedRecoveryShare = envelopeEncrypt(secretBuf.toString("hex"), userId);

 await db.insert(internalWalletsTable).values({
 userId,
 stellarPublicKey: keypair.publicKey(),
 encryptedServerShare,
 encryptedRecoveryShare,
 });

 if (shouldFriendbot()) {
 try {
 const resp = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
 if (!resp.ok) logger.warn({ status: resp.status }, "Friendbot returned non-200");
 else logger.info({ publicKey: keypair.publicKey() }, "Internal wallet funded via Friendbot");
 } catch (err) {
 logger.warn({ err }, "Friendbot funding failed (non-fatal)");
 }
 }

 secretBuf.fill(0);
 serverShareBuf.fill(0);

 return {
 publicKey: keypair.publicKey(),
 deviceShareHex: deviceShareBuf.toString("hex"),
 };
}

export async function signWithInternalWallet(
 userId: number,
 deviceShareHex: string,
 unsignedXdr: string,
 networkPassphrase: string
): Promise<string> {
 const wallet = await db.query.internalWalletsTable.findFirst({
 where: eq(internalWalletsTable.userId, userId),
 });
 if (!wallet) throw new Error("Internal wallet not found");

 const secretBuf = reconstructFromShares(
 wallet.encryptedServerShare,
 deviceShareHex,
 userId,
 wallet.stellarPublicKey
 );

 let signedXdr: string;
 try {
 const keypair = Keypair.fromRawEd25519Seed(secretBuf);
 const { TransactionBuilder } = await import("@stellar/stellar-sdk");
 const tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
 tx.sign(keypair);
 signedXdr = tx.toXDR();
 } finally {
 secretBuf.fill(0);
 }

 logger.info({ userId, publicKey: wallet.stellarPublicKey }, "Internal wallet signed transaction");
 return signedXdr;
}

export async function exportInternalWalletSecret(
 userId: number,
 deviceShareHex: string
): Promise<{ secretKey: string; publicKey: string }> {
 if (!(await isRecoveryReady(userId))) {
 throw new Error("Set and verify email + authenticator before exporting");
 }

 const wallet = await db.query.internalWalletsTable.findFirst({
 where: eq(internalWalletsTable.userId, userId),
 });
 if (!wallet) throw new Error("Internal wallet not found");

 const secretBuf = reconstructFromShares(
 wallet.encryptedServerShare,
 deviceShareHex,
 userId,
 wallet.stellarPublicKey
 );

 try {
 const keypair = Keypair.fromRawEd25519Seed(secretBuf);
 logger.info({ userId, publicKey: wallet.stellarPublicKey }, "Internal wallet secret exported");
 return { secretKey: keypair.secret(), publicKey: keypair.publicKey() };
 } finally {
 secretBuf.fill(0);
 }
}

/**
 * Lost-phone recovery: decrypt recovery blob (after email+TOTP gate),
 * re-split, invalidate old device share, return new deviceShareHex.
 */
export async function recoverWithEmailAndTotp(
 userId: number
): Promise<{ deviceShareHex: string; publicKey: string }> {
 if (!(await isRecoveryReady(userId))) {
 throw new Error("Recovery requires a verified email and authenticator app");
 }

 const wallet = await db.query.internalWalletsTable.findFirst({
 where: eq(internalWalletsTable.userId, userId),
 });
 if (!wallet?.encryptedRecoveryShare) {
 throw new Error("No recovery blob - wallet cannot be restored");
 }

 let secretHex: string;
 try {
 secretHex = envelopeDecrypt(wallet.encryptedRecoveryShare, userId);
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 if (/authenticate data|Unsupported state|auth/i.test(msg)) {
 throw new Error(
 "Wallet encryption key mismatch (KMS_SECRET changed after this wallet was created). " +
 "Recovery cannot decrypt the old blob. On testnet: ask an admin to reset your embedded wallet."
 );
 }
 throw err;
 }
 const secretBuf = Buffer.from(secretHex, "hex");

 try {
 const keypair = Keypair.fromRawEd25519Seed(secretBuf);
 if (keypair.publicKey() !== wallet.stellarPublicKey) {
 throw new Error("Recovery data does not match wallet");
 }

 const { serverShareBuf, deviceShareBuf } = splitSecret(secretBuf);
 const encryptedServerShare = envelopeEncrypt(serverShareBuf.toString("hex"), userId);
 // Re-seal recovery blob under fresh envelope
 const encryptedRecoveryShare = envelopeEncrypt(secretBuf.toString("hex"), userId);

 await db
 .update(internalWalletsTable)
 .set({ encryptedServerShare, encryptedRecoveryShare })
 .where(eq(internalWalletsTable.userId, userId));

 serverShareBuf.fill(0);

 logger.info({ userId }, "Wallet recovered via email+TOTP - device share rotated");
 return {
 deviceShareHex: deviceShareBuf.toString("hex"),
 publicKey: wallet.stellarPublicKey,
 };
 } finally {
 secretBuf.fill(0);
 }
}

export async function getInternalWallet(userId: number) {
 return db.query.internalWalletsTable.findFirst({
 where: eq(internalWalletsTable.userId, userId),
 });
}

export async function ensureInternalWallet(
 userId: number
): Promise<{ publicKey: string; deviceShareHex?: string; justCreated: boolean }> {
 const existing = await getInternalWallet(userId);
 if (existing) {
 return { publicKey: existing.stellarPublicKey, justCreated: false };
 }
 const created = await createInternalWallet(userId);
 return {
 publicKey: created.publicKey,
 deviceShareHex: created.deviceShareHex,
 justCreated: true,
 };
}

/**
 * Testnet-only: delete encrypted wallet rows so the next login recreates
 * under the current KMS_SECRET. Use when KMS was rotated and old blobs are unreadable.
 * Does NOT migrate funds from the old G-address.
 */
export async function resetInternalWalletForTestnet(userId: number): Promise<{
 deletedPublicKey: string | null;
}> {
 if (!shouldFriendbot()) {
 throw new Error("resetInternalWalletForTestnet is only allowed on testnet");
 }
 const existing = await getInternalWallet(userId);
 await db.delete(internalWalletsTable).where(eq(internalWalletsTable.userId, userId));
 logger.warn(
 { userId, deletedPublicKey: existing?.stellarPublicKey ?? null },
 "Internal wallet reset (testnet) - next login will create a new keypair"
 );
 return { deletedPublicKey: existing?.stellarPublicKey ?? null };
}
