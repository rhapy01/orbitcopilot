/**
 * Internal (embedded) EVM wallet — secp256k1, same 2-of-2 XOR share model as Stellar.
 * Separate key from Stellar ed25519 (different curve — never derive from Stellar seed).
 */
import { randomBytes } from "node:crypto";
import { envelopeEncrypt, envelopeDecrypt } from "./crypto";
import { logger } from "./logger";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

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

let schemaReady: Promise<void> | null = null;

async function ensureEvmWalletSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS internal_evm_wallets (
          id serial PRIMARY KEY,
          user_id integer NOT NULL UNIQUE,
          evm_address text NOT NULL UNIQUE,
          encrypted_server_share text NOT NULL,
          encrypted_recovery_share text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

type EvmWalletRow = {
  user_id: number;
  evm_address: string;
  encrypted_server_share: string;
  encrypted_recovery_share: string | null;
};

async function getRow(userId: number): Promise<EvmWalletRow | null> {
  await ensureEvmWalletSchema();
  const rows = await db.execute(sql`
    SELECT user_id, evm_address, encrypted_server_share, encrypted_recovery_share
    FROM internal_evm_wallets
    WHERE user_id = ${userId}
    LIMIT 1
  `);
  const row = rows.rows[0] as EvmWalletRow | undefined;
  return row ?? null;
}

function reconstructPrivateKey(
  encryptedServerShare: string,
  deviceShareHex: string,
  userId: number,
  expectedAddress: string
): string {
  let serverShareHex: string;
  try {
    serverShareHex = envelopeDecrypt(encryptedServerShare, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/authenticate data|Unsupported state|auth/i.test(msg)) {
      throw new Error(
        "EVM wallet encryption key mismatch (KMS_SECRET changed). Re-create the Orbit EVM key after admin reset."
      );
    }
    throw err;
  }
  const serverBuf = Buffer.from(serverShareHex, "hex");
  const deviceBuf = Buffer.from(deviceShareHex.replace(/^0x/i, ""), "hex");
  if (serverBuf.length !== deviceBuf.length) {
    throw new Error("EVM device share length mismatch — reconnect Orbit EVM wallet");
  }
  const secretBuf = xorBuffers(serverBuf, deviceBuf);
  serverBuf.fill(0);
  deviceBuf.fill(0);
  const hex = `0x${secretBuf.toString("hex")}`;
  secretBuf.fill(0);

  // Validate address match asynchronously via ethers in callers; sync check with dynamic import not needed here
  // Callers verify with ethers.Wallet
  void expectedAddress;
  return hex;
}

export async function getInternalEvmWallet(
  userId: number
): Promise<{ address: string } | null> {
  const row = await getRow(userId);
  if (!row) return null;
  return { address: row.evm_address };
}

/** Create secp256k1 wallet; returns device share once for localStorage. */
export async function createInternalEvmWallet(
  userId: number
): Promise<{ address: string; deviceShareHex: string }> {
  await ensureEvmWalletSchema();
  const existing = await getRow(userId);
  if (existing) {
    throw new Error("EVM wallet already exists for this account");
  }

  const { ethers } = await import("ethers");
  const wallet = ethers.Wallet.createRandom();
  const secretBuf = Buffer.from(wallet.privateKey.replace(/^0x/i, ""), "hex");
  const { serverShareBuf, deviceShareBuf } = splitSecret(secretBuf);
  const encryptedServerShare = envelopeEncrypt(serverShareBuf.toString("hex"), userId);
  const encryptedRecoveryShare = envelopeEncrypt(secretBuf.toString("hex"), userId);
  secretBuf.fill(0);
  serverShareBuf.fill(0);

  const address = wallet.address;
  const deviceShareHex = deviceShareBuf.toString("hex");
  await db.execute(sql`
    INSERT INTO internal_evm_wallets (user_id, evm_address, encrypted_server_share, encrypted_recovery_share)
    VALUES (${userId}, ${address}, ${encryptedServerShare}, ${encryptedRecoveryShare})
  `);
  deviceShareBuf.fill(0);

  return {
    address,
    deviceShareHex,
  };
}

/** Ensure wallet exists; create if missing. */
export async function ensureInternalEvmWallet(
  userId: number
): Promise<{ address: string; deviceShareHex?: string; justCreated: boolean }> {
  const existing = await getRow(userId);
  if (existing) {
    return { address: existing.evm_address, justCreated: false };
  }
  const created = await createInternalEvmWallet(userId);
  return { ...created, justCreated: true };
}

/**
 * For existing Stellar-only Orbit users (or devices missing the EVM share):
 * create EVM if needed, otherwise re-issue a device share from the recovery blob.
 * Requires proof of Stellar device share so only the same Orbit account/device can claim.
 */
export async function claimInternalEvmForStellarDevice(
  userId: number,
  stellarDeviceShareHex: string
): Promise<{ address: string; deviceShareHex: string; justCreated: boolean }> {
  const { assertOwnsStellarDeviceShare } = await import("./internal-wallet");
  await assertOwnsStellarDeviceShare(userId, stellarDeviceShareHex);

  const existing = await getRow(userId);
  if (!existing) {
    const created = await createInternalEvmWallet(userId);
    logger.info({ userId, address: created.address }, "EVM wallet created for existing Stellar user");
    return { ...created, justCreated: true };
  }

  if (!existing.encrypted_recovery_share) {
    throw new Error("EVM recovery blob missing — cannot provision this device");
  }

  let secretHex: string;
  try {
    secretHex = envelopeDecrypt(existing.encrypted_recovery_share, userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/authenticate data|Unsupported state|auth/i.test(msg)) {
      throw new Error(
        "EVM wallet encryption key mismatch (KMS_SECRET changed). Contact support to reset the EVM key."
      );
    }
    throw err;
  }

  const secretBuf = Buffer.from(secretHex.replace(/^0x/i, ""), "hex");
  // Verify recovery blob still matches stored address before rotating shares
  const { ethers } = await import("ethers");
  const check = new ethers.Wallet(`0x${secretBuf.toString("hex")}`);
  if (check.address.toLowerCase() !== existing.evm_address.toLowerCase()) {
    secretBuf.fill(0);
    throw new Error("EVM recovery blob does not match stored address");
  }

  const { serverShareBuf, deviceShareBuf } = splitSecret(secretBuf);
  const encryptedServerShare = envelopeEncrypt(serverShareBuf.toString("hex"), userId);
  const deviceShareHex = deviceShareBuf.toString("hex");
  secretBuf.fill(0);
  serverShareBuf.fill(0);
  deviceShareBuf.fill(0);

  await db.execute(sql`
    UPDATE internal_evm_wallets
    SET encrypted_server_share = ${encryptedServerShare}
    WHERE user_id = ${userId}
  `);

  logger.info(
    { userId, address: existing.evm_address },
    "EVM device share re-issued for existing Orbit user"
  );

  return {
    address: existing.evm_address,
    deviceShareHex,
    justCreated: false,
  };
}

export async function signAndSendEvmTx(input: {
  userId: number;
  deviceShareHex: string;
  chainId: number;
  rpcUrl: string;
  to: string;
  data: string;
  value?: string;
}): Promise<{ hash: string; from: string }> {
  const row = await getRow(input.userId);
  if (!row) throw new Error("No Orbit EVM wallet — create one first");

  const { ethers } = await import("ethers");
  const pk = reconstructPrivateKey(
    row.encrypted_server_share,
    input.deviceShareHex,
    input.userId,
    row.evm_address
  );
  const provider = new ethers.JsonRpcProvider(input.rpcUrl, input.chainId);
  const wallet = new ethers.Wallet(pk, provider);
  if (wallet.address.toLowerCase() !== row.evm_address.toLowerCase()) {
    throw new Error("EVM device share does not match this wallet");
  }

  try {
    const tx = await wallet.sendTransaction({
      to: input.to,
      data: input.data,
      value: input.value ? BigInt(input.value) : 0n,
      chainId: input.chainId,
    });
    const receipt = await tx.wait();
    return { hash: String(receipt?.hash ?? tx.hash), from: wallet.address };
  } catch (err) {
    logger.warn({ err }, "Internal EVM sendTransaction failed");
    throw err instanceof Error ? err : new Error(String(err));
  }
}
