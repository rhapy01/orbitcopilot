/**
 * Internal wallet routes (authenticated):
 *
 * GET /api/internal-wallet - wallet info + recovery readiness
 * POST /api/internal-wallet/sign - sign XDR (device share required)
 * POST /api/internal-wallet/export - export S… secret (email+TOTP required)
 *
 * Lost-phone recovery lives under /api/auth/recover/* (email OTP + TOTP).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
 signWithInternalWallet,
 getInternalWallet,
 exportInternalWalletSecret,
 isRecoveryReady,
 ensureOrbitWallets,
} from "../lib/internal-wallet";
import {
 signAndSendEvmTx,
} from "../lib/internal-evm-wallet";
import { decrypt, deriveUserKey } from "../lib/crypto";
import { db } from "@workspace/db";
import { totpSecretsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { resolveCctpDest, getEvmCctpChain } from "../lib/cctp";

const router: IRouter = Router();

function requireAuth(req: Request & { userId?: number }, res: Response): boolean {
 if (!req.userId) {
 res.status(401).json({ error: "Not authenticated" });
 return false;
 }
 return true;
}

/** TOTP is always required for export once recovery is set up. */
async function requireTotp(userId: number, totpCode: string | undefined, res: Response): Promise<boolean> {
 const totpRow = await db.query.totpSecretsTable.findFirst({
 where: and(eq(totpSecretsTable.userId, userId), eq(totpSecretsTable.verified, true)),
 });
 if (!totpRow) {
 res.status(403).json({ error: "Authenticator app required", totpRequired: true });
 return false;
 }
 if (!totpCode) {
 res.status(403).json({ error: "TOTP code required", totpRequired: true });
 return false;
 }
 try {
 const { authenticator } = await import("otplib");
 const secret = decrypt(totpRow.encryptedSecret, deriveUserKey(userId));
 if (!authenticator.verify({ token: totpCode, secret })) {
 res.status(401).json({ error: "Invalid TOTP code" });
 return false;
 }
 return true;
 } catch (err) {
 logger.error({ err }, "TOTP check failed");
 res.status(500).json({ error: "TOTP validation failed" });
 return false;
 }
}

router.get(
 "/internal-wallet",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const recoveryReady = await isRecoveryReady(req.userId!);
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.id, req.userId!),
 });

 try {
  const wallets = await ensureOrbitWallets(req.userId!);
  const existing = await getInternalWallet(req.userId!);
  res.json({
   publicKey: wallets.publicKey,
   ...(wallets.deviceShareHex ? { deviceShareHex: wallets.deviceShareHex } : {}),
   justCreated: wallets.justCreated,
   recoveryReady,
   emailVerified: !!user?.emailVerifiedAt,
   hasRecoveryBlob: !!existing?.encryptedRecoveryShare,
   evmAddress: wallets.evmAddress,
   ...(wallets.evmDeviceShareHex
    ? { evmDeviceShareHex: wallets.evmDeviceShareHex }
    : {}),
   ...(wallets.justCreated
    ? { message: "Wallet created. Store deviceShareHex in localStorage." }
    : {}),
  });
 } catch (err) {
  logger.error({ err }, "Failed to load Orbit wallets");
  res.status(500).json({ error: "Failed to create internal wallet" });
 }
 }
);

router.post(
 "/internal-wallet/sign",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const { deviceShareHex, unsignedXdr, networkPassphrase } = req.body as {
 deviceShareHex?: string;
 unsignedXdr?: string;
 networkPassphrase?: string;
 };

 if (!deviceShareHex || !unsignedXdr || !networkPassphrase) {
 res.status(400).json({
 error: "deviceShareHex, unsignedXdr, and networkPassphrase are required",
 });
 return;
 }

 try {
 const signedXdr = await signWithInternalWallet(
 req.userId!,
 deviceShareHex,
 unsignedXdr,
 networkPassphrase
 );
 res.json({ signedXdr });
 } catch (err: unknown) {
 const message = err instanceof Error ? err.message : "Signing failed";
 logger.error({ err, userId: req.userId }, "Internal wallet sign failed");
 res.status(400).json({ error: message });
 }
 }
);

router.post(
 "/internal-wallet/export",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const { deviceShareHex, totpCode } = req.body as {
 deviceShareHex?: string;
 totpCode?: string;
 };

 if (!deviceShareHex) {
 res.status(400).json({ error: "deviceShareHex required" });
 return;
 }

 if (!(await isRecoveryReady(req.userId!))) {
 res.status(403).json({
 error: "Verify email and set up authenticator before exporting",
 requiresRecoverySetup: true,
 });
 return;
 }

 if (!(await requireTotp(req.userId!, totpCode, res))) return;

 try {
 const result = await exportInternalWalletSecret(req.userId!, deviceShareHex);
 res.json(result);
 } catch (err: unknown) {
 const message = err instanceof Error ? err.message : "Export failed";
 logger.error({ err, userId: req.userId }, "Internal wallet export failed");
 res.status(400).json({ error: message });
 }
 }
);

/** Orbit embedded EVM address — same account as Stellar; prefer GET /internal-wallet. */
router.get(
 "/internal-wallet/evm",
 async (req: Request & { userId?: number }, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  try {
   const wallets = await ensureOrbitWallets(req.userId!);
   res.json({
    address: wallets.evmAddress,
    deviceShareHex: wallets.evmDeviceShareHex,
    justCreated: wallets.evmJustCreated,
   });
  } catch (err: unknown) {
   logger.error({ err }, "EVM wallet get/create failed");
   res.status(500).json({
    error: err instanceof Error ? err.message : "Failed to load EVM wallet",
   });
  }
 }
);

/** Sign + broadcast an EVM tx with the Orbit secp256k1 key. */
router.post(
 "/internal-wallet/evm/send",
 async (req: Request & { userId?: number }, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const {
   deviceShareHex,
   to,
   data,
   value,
   chainId,
   destChain,
  } = req.body as {
   deviceShareHex?: string;
   to?: string;
   data?: string;
   value?: string;
   chainId?: number;
   destChain?: string;
  };
  if (!deviceShareHex || !to || !data) {
   res.status(400).json({ error: "deviceShareHex, to, and data are required" });
   return;
  }
  try {
   const chain = getEvmCctpChain(resolveCctpDest(destChain));
   const cid = typeof chainId === "number" ? chainId : chain.chainId;
   const result = await signAndSendEvmTx({
    userId: req.userId!,
    deviceShareHex,
    chainId: cid,
    rpcUrl: chain.rpc,
    to,
    data,
    value: value ?? "0",
   });
   res.json(result);
  } catch (err: unknown) {
   const message = err instanceof Error ? err.message : "EVM send failed";
   logger.error({ err, userId: req.userId }, "Internal EVM send failed");
   res.status(400).json({ error: message });
  }
 }
);

export default router;
