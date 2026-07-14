/**
 * Production envelope encryption for wallet key material.
 *
 * MODEL
 * ─────
 *   DEK (data encryption key) = random 32 bytes per ciphertext
 *   plaintext  → AES-256-GCM(DEK)
 *   DEK        → AES-256-GCM(KEK) where KEK = HKDF(KMS_SECRET, userId)
 *
 * Stored format (single string):
 *   v1:<wrappedDekB64>:<ivB64>:<tagB64>:<ciphertextB64>
 *
 * Swap getKek() for AWS/GCP KMS Encrypt/Decrypt later without changing callers.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE_VERSION = "v1";

function requireMasterKey(): Buffer {
  const secret = process.env.KMS_SECRET?.trim();
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  if (!secret || secret.length < 64) {
    if (isProd) {
      throw new Error(
        "KMS_SECRET must be set to a 64-char hex string (32 bytes) in production"
      );
    }
    // Local-only fallback — never used when NODE_ENV/VERCEL production
    return Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
  }

  if (!/^[0-9a-fA-F]{64,}$/.test(secret)) {
    throw new Error("KMS_SECRET must be hex (at least 64 chars / 32 bytes)");
  }

  return Buffer.from(secret.slice(0, 64), "hex");
}

/** True when wallet encryption can run (required for passkey signup on Vercel). */
export function isWalletCryptoConfigured(): boolean {
  try {
    requireMasterKey();
    return true;
  } catch {
    return false;
  }
}

/** Throw early with a clear message before WebAuthn / DB work. */
export function assertWalletCryptoReady(): void {
  requireMasterKey();
}

/** Per-user key-encryption key derived from the master secret. */
export function deriveUserKey(userId: number): Buffer {
  const master = requireMasterKey();
  return Buffer.from(
    hkdfSync("sha256", master, `orbit-kek-user-${userId}`, "orbit-wallet-v1", KEY_BYTES)
  );
}

function aesGcmEncrypt(plaintext: Buffer, key: Buffer): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, tag, ciphertext };
}

function aesGcmDecrypt(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Envelope-encrypt a UTF-8 string for a user.
 * Returns an opaque `v1:…` blob safe to store in Postgres.
 */
export function envelopeEncrypt(plaintext: string, userId: number): string {
  const dek = randomBytes(KEY_BYTES);
  const kek = deriveUserKey(userId);

  const body = aesGcmEncrypt(Buffer.from(plaintext, "utf8"), dek);
  const wrapped = aesGcmEncrypt(dek, kek);

  dek.fill(0);

  return [
    ENVELOPE_VERSION,
    wrapped.ciphertext.toString("base64"),
    wrapped.iv.toString("base64"),
    wrapped.tag.toString("base64"),
    body.iv.toString("base64"),
    body.tag.toString("base64"),
    body.ciphertext.toString("base64"),
  ].join(":");
}

/** Decrypt an envelope blob produced by envelopeEncrypt. */
export function envelopeDecrypt(blob: string, userId: number): string {
  const parts = blob.split(":");
  if (parts.length !== 7 || parts[0] !== ENVELOPE_VERSION) {
    // Legacy fallback: old "iv:tag:ciphertext" + deriveUserKey direct encrypt
    return legacyDecrypt(blob, userId);
  }

  const [, wrappedCtB64, wrappedIvB64, wrappedTagB64, ivB64, tagB64, ctB64] = parts;
  const kek = deriveUserKey(userId);

  const dek = aesGcmDecrypt(
    Buffer.from(wrappedCtB64, "base64"),
    kek,
    Buffer.from(wrappedIvB64, "base64"),
    Buffer.from(wrappedTagB64, "base64")
  );

  try {
    const plaintext = aesGcmDecrypt(
      Buffer.from(ctB64, "base64"),
      dek,
      Buffer.from(ivB64, "base64"),
      Buffer.from(tagB64, "base64")
    );
    return plaintext.toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/** @deprecated Legacy non-envelope format — migrate on read. */
function legacyDecrypt(ciphertext: string, userId: number): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, tagB64, dataB64] = parts;
  const key = deriveUserKey(userId);
  const plaintext = aesGcmDecrypt(
    Buffer.from(dataB64, "base64"),
    key,
    Buffer.from(ivB64, "base64"),
    Buffer.from(tagB64, "base64")
  );
  return plaintext.toString("utf8");
}

/** Encrypt plaintext with the user's KEK (for TOTP secrets, small values). */
export function encrypt(plaintext: string, key: Buffer): string {
  const { iv, tag, ciphertext } = aesGcmEncrypt(Buffer.from(plaintext, "utf8"), key);
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, tagB64, dataB64] = parts;
  return aesGcmDecrypt(
    Buffer.from(dataB64, "base64"),
    key,
    Buffer.from(ivB64, "base64"),
    Buffer.from(tagB64, "base64")
  ).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  try {
    const ha = createHmac("sha256", "orbit").update(a).digest();
    const hb = createHmac("sha256", "orbit").update(b).digest();
    return timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function hashToken(token: string): string {
  return createHmac("sha256", requireMasterKey()).update(token).digest("hex");
}

export function generateOtp(): string {
  const rand = randomBytes(4).readUInt32BE(0);
  return String(rand % 1_000_000).padStart(6, "0");
}
