/**
 * Auth routes - email-aware wallet auth, passkey, TOTP, lost-phone recovery.
 *
 * Email: POST /auth/email/continue (smart: login OTP if known, else signup)
 * Signup: POST /auth/passkey/signup-options | signup-verify
 * Login: POST /auth/passkey/login-options | login-verify
 * POST /auth/send-otp | verify-otp
 * Email bind: POST /auth/email/send-otp | verify (if taken → login OTP + flow:login)
 * TOTP: POST /auth/totp/setup | verify | validate
 * Recover: POST /auth/recover/send-otp | complete (email + TOTP → new device share)
 * Session: GET /auth/me | POST /auth/logout
 * Passkey: POST /auth/passkey/register-options | register-verify (add passkey)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
 usersTable,
 otpCodesTable,
 passkeyCredentialsTable,
 totpSecretsTable,
 webauthnChallengesTable,
} from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { scryptSync } from "node:crypto";
import { generateOtp, encrypt, decrypt, deriveUserKey, assertWalletCryptoReady } from "../lib/crypto";
import { sendEmail, otpEmailHtml } from "../lib/email";
import { createSession, revokeSession, COOKIE_NAME, SESSION_TTL_MS } from "../lib/session";
import {
 createInternalWallet,
 ensureInternalWallet,
 isRecoveryReady,
 recoverWithEmailAndTotp,
} from "../lib/internal-wallet";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function sessionCookieOpts() {
 return {
 httpOnly: true,
 secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
 sameSite: "lax" as const,
 maxAge: SESSION_TTL_MS,
 path: "/",
 };
}

/** Resolve RP ID + accepted origins (supports Vercel when env still says localhost). */
function resolveWebAuthn(req: Request): { rpID: string; origins: string | string[] } {
 const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
 const envRp = process.env.WEBAUTHN_RP_ID?.trim();
 const envOrigin = process.env.WEBAUTHN_ORIGIN?.trim();

 const host = (req.get("x-forwarded-host") || req.get("host") || "")
 .split(",")[0]
 .trim()
 .replace(/:\d+$/, "");
 const originHeader = req.get("origin")?.trim();
 const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();

 let rpID = envRp || "localhost";
 if (isProd && (!envRp || envRp === "localhost") && host && !host.includes("localhost")) {
 rpID = host;
 }

 const origins = new Set<string>();
 if (envOrigin && !(isProd && envOrigin.includes("localhost"))) origins.add(envOrigin);
 if (originHeader) origins.add(originHeader);
 if (host && !host.includes("localhost")) origins.add(`${proto}://${host}`);
 // Always accept the canonical production domain if present
 if (rpID === "orbitpilot.vercel.app") origins.add("https://orbitpilot.vercel.app");
 if (!origins.size) origins.add(envOrigin || "http://localhost:5173");

 const list = [...origins];
 return { rpID, origins: list.length === 1 ? list[0] : list };
}

/** Supports SimpleWebAuthn v10 (flat) and v11+ (nested credential). */
function extractRegistrationCredential(info: Record<string, any>): {
 credId: string;
 pubKey: string;
 counter: number;
 aaguid: string | null;
} {
 const nested = info.credential && typeof info.credential === "object" ? info.credential : null;
 const idRaw = nested?.id ?? info.credentialID;
 const pubRaw = nested?.publicKey ?? info.credentialPublicKey;
 const counter = Number(nested?.counter ?? info.counter ?? 0);
 const aaguid = (info.aaguid as string | undefined) ?? null;

 if (idRaw == null || pubRaw == null) {
 throw new Error("Passkey registration info missing credential id/publicKey");
 }

 const credId =
 typeof idRaw === "string" ? idRaw : Buffer.from(idRaw).toString("base64url");
 const pubKey = Buffer.from(pubRaw).toString("base64url");
 return { credId, pubKey, counter, aaguid };
}

function authErrorMessage(err: unknown): string {
 const msg = err instanceof Error ? err.message : String(err ?? "");
 if (/KMS_SECRET/i.test(msg)) {
 return "Server wallet encryption is not configured (KMS_SECRET). Contact the site admin.";
 }
 if (/user verification/i.test(msg)) {
 return "Passkey could not complete user verification on this device. Try again, or enable Windows Hello (PIN/fingerprint) in Chrome, then retry.";
 }
 if (/origin/i.test(msg) || /rpID|rp id|relying party/i.test(msg)) {
 return "Passkey domain mismatch - set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN to your deploy domain.";
 }
 if (/challenge/i.test(msg)) return "Passkey challenge expired. Try again.";
 return "Passkey signup failed";
}

function requireAuth(
 req: Request & { userId?: number },
 res: Response
): req is Request & { userId: number } {
 if (!req.userId) {
 res.status(401).json({ error: "Not authenticated" });
 return false;
 }
 return true;
}

function hashOtp(code: string, email: string): string {
 return scryptSync(code.trim(), email, 32).toString("hex");
}

async function issueOtp(email: string, purpose: string, emailPurposeLabel: string) {
 const code = generateOtp();
 const codeHash = hashOtp(code, email);
 const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

 await db
 .delete(otpCodesTable)
 .where(and(eq(otpCodesTable.email, email), eq(otpCodesTable.used, false)));

 await db.insert(otpCodesTable).values({ email, codeHash, purpose, expiresAt });

 await sendEmail({
 to: email,
 subject: "Your Orbit verification code",
 text: `Your code is: ${code}\n\nExpires in 10 minutes.`,
 html: otpEmailHtml(code, emailPurposeLabel),
 });

 return code;
}

async function consumeOtp(email: string, code: string, purpose: string): Promise<boolean> {
 const expectedHash = hashOtp(code, email);
 const otpRecord = await db.query.otpCodesTable.findFirst({
 where: and(
 eq(otpCodesTable.email, email),
 eq(otpCodesTable.purpose, purpose),
 eq(otpCodesTable.used, false),
 gt(otpCodesTable.expiresAt, new Date())
 ),
 orderBy: (t, { desc }) => [desc(t.createdAt)],
 });

 if (!otpRecord || otpRecord.codeHash !== expectedHash) return false;

 await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, otpRecord.id));
 return true;
}

async function verifyTotpCode(userId: number, code: string): Promise<boolean> {
 const totpRow = await db.query.totpSecretsTable.findFirst({
 where: and(eq(totpSecretsTable.userId, userId), eq(totpSecretsTable.verified, true)),
 });
 if (!totpRow) return false;
 const { authenticator } = await import("otplib");
 const secret = decrypt(totpRow.encryptedSecret, deriveUserKey(userId));
 return authenticator.verify({ token: code, secret });
}

async function securityPayload(userId: number) {
 const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
 const totp = await db.query.totpSecretsTable.findFirst({
 where: and(eq(totpSecretsTable.userId, userId), eq(totpSecretsTable.verified, true)),
 });
 const passkeys = await db.query.passkeyCredentialsTable.findMany({
 where: eq(passkeyCredentialsTable.userId, userId),
 });
 const recoveryReady = await isRecoveryReady(userId);
 return {
 user: user
 ? {
 id: user.id,
 email: user.email,
 displayName: user.displayName,
 emailVerified: !!user.emailVerifiedAt,
 }
 : null,
 security: {
 totpEnabled: !!totp,
 passkeyCount: passkeys.length,
 emailVerified: !!user?.emailVerifiedAt,
 recoveryReady,
 requiresRecoverySetup: !recoveryReady,
 },
 };
}

// ─── Passkey-first signup ─────────────────────────────────────────────────────

router.post("/auth/passkey/signup-options", async (req, res): Promise<void> => {
 try {
 // Fail before Windows Hello / Chrome passkey UI if Vercel env is incomplete
 assertWalletCryptoReady();

 const { generateRegistrationOptions } = await import("@simplewebauthn/server");
 const { displayName } = req.body as { displayName?: string };
 const { rpID } = resolveWebAuthn(req);

 // Create stub user (email bound later for recovery)
 const [user] = await db
 .insert(usersTable)
 .values({ displayName: displayName?.trim() || null })
 .returning();

 const options = await generateRegistrationOptions({
 rpName: "Orbit Copilot",
 rpID,
 userName: `orbit-user-${user.id}`,
 userDisplayName: displayName?.trim() || `Orbit User ${user.id}`,
 userID: new TextEncoder().encode(String(user.id)),
 attestationType: "none",
 authenticatorSelection: {
 residentKey: "preferred",
 userVerification: "preferred",
 },
 });

 await db.insert(webauthnChallengesTable).values({
 identifier: `signup:${user.id}`,
 challenge: options.challenge,
 type: "signup",
 expiresAt: new Date(Date.now() + 5 * 60 * 1000),
 });

 res.json({ ...options, userId: user.id });
 } catch (err) {
 logger.error({ err }, "Passkey signup-options failed");
 res.status(500).json({ error: authErrorMessage(err) });
 }
});

router.post("/auth/passkey/signup-verify", async (req, res): Promise<void> => {
 const { credential, userId, deviceName } = req.body as {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 credential: any;
 userId?: number;
 deviceName?: string;
 };

 if (!userId || !credential) {
 res.status(400).json({ error: "userId and credential required" });
 return;
 }

 try {
 assertWalletCryptoReady();

 const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
 const { rpID, origins } = resolveWebAuthn(req);

 const challengeRow = await db.query.webauthnChallengesTable.findFirst({
 where: and(
 eq(webauthnChallengesTable.identifier, `signup:${userId}`),
 eq(webauthnChallengesTable.type, "signup"),
 gt(webauthnChallengesTable.expiresAt, new Date())
 ),
 orderBy: (t, { desc }) => [desc(t.createdAt)],
 });
 if (!challengeRow) {
 res.status(400).json({ error: "No pending signup challenge" });
 return;
 }

 await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, challengeRow.id));

 const verification = await verifyRegistrationResponse({
 response: credential,
 expectedChallenge: challengeRow.challenge,
 expectedOrigin: origins,
 expectedRPID: rpID,
 // Options use userVerification: "preferred" - Windows Chrome often returns uv=0
 // when Hello PIN/biometrics aren't used. Don't hard-fail registration for that.
 requireUserVerification: false,
 });

 if (!verification.verified || !verification.registrationInfo) {
 res.status(400).json({ error: "Passkey verification failed" });
 return;
 }

 const { credId, pubKey, counter, aaguid } = extractRegistrationCredential(
 verification.registrationInfo as Record<string, any>
 );

 await db.insert(passkeyCredentialsTable).values({
 userId,
 credentialId: credId,
 publicKey: pubKey,
 aaguid,
 counter,
 deviceName: deviceName ?? "Primary passkey",
 transports: credential?.response?.transports ?? [],
 });

 let wallet: { publicKey: string; deviceShareHex: string };
 try {
 wallet = await createInternalWallet(userId);
 } catch (walletErr) {
 // Don't leave a passkey without a wallet
 await db.delete(passkeyCredentialsTable).where(eq(passkeyCredentialsTable.userId, userId));
 throw walletErr;
 }

 const token = await createSession(userId, req);
 res.cookie(COOKIE_NAME, token, sessionCookieOpts());

 const sec = await securityPayload(userId);
 res.json({
 ok: true,
 ...sec,
 publicKey: wallet.publicKey,
 deviceShareHex: wallet.deviceShareHex,
 });
 } catch (err) {
 logger.error({ err }, "Passkey signup-verify failed");
 res.status(500).json({ error: authErrorMessage(err) });
 }
});

// ─── Smart email continue (login vs signup - one entry) ───────────────────────

/**
 * POST /auth/email/continue
 * Existing verified email → send login OTP ({ flow: "login" })
 * Unknown email → client should create passkey then bind ({ flow: "signup" })
 */
router.post("/auth/email/continue", async (req, res): Promise<void> => {
 const { email } = req.body as { email?: string };
 if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 res.status(400).json({ error: "Valid email required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, normalizedEmail),
 });

 if (user?.emailVerifiedAt) {
 try {
 await issueOtp(normalizedEmail, "login", "sign in");
 logger.info({ email: normalizedEmail }, "Continue → login OTP sent");
 res.json({
 ok: true,
 flow: "login",
 message: "We sent a sign-in code to your email.",
 });
 } catch (err) {
 logger.error({ err }, "Failed to send continue/login OTP");
 res.status(500).json({ error: "Failed to send email" });
 }
 return;
 }

 if (user && !user.emailVerifiedAt) {
 // Email reserved on an incomplete account - still send login-style verify is wrong.
 // Treat as signup blocked; ask them to use a different email or contact support.
 // Prefer: send login OTP won't work without verified. Allow re-verify by treating as signup
 // only if no passkey/wallet - for simplicity return signup and let bind claim if same user.
 res.json({
 ok: true,
 flow: "signup",
 message: "Create a passkey to finish setting up this email.",
 });
 return;
 }

 res.json({
 ok: true,
 flow: "signup",
 message: "New email - create a passkey, then we’ll verify this address.",
 });
});

router.post("/auth/send-otp", async (req, res): Promise<void> => {
 const { email } = req.body as { email?: string };
 if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 res.status(400).json({ error: "Valid email required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, normalizedEmail),
 });
 if (!user?.emailVerifiedAt) {
 // Don't reveal whether email exists
 res.json({ ok: true, flow: "unknown" });
 return;
 }

 try {
 await issueOtp(normalizedEmail, "login", "sign in");
 logger.info({ email: normalizedEmail }, "Login OTP sent");
 res.json({ ok: true, flow: "login" });
 } catch (err) {
 logger.error({ err }, "Failed to send login OTP");
 res.status(500).json({ error: "Failed to send email" });
 }
});

router.post("/auth/verify-otp", async (req, res): Promise<void> => {
 const { email, code } = req.body as { email?: string; code?: string };
 if (!email || !code) {
 res.status(400).json({ error: "email and code required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 if (!(await consumeOtp(normalizedEmail, code, "login"))) {
 res.status(401).json({ error: "Invalid or expired code" });
 return;
 }

 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, normalizedEmail),
 });
 if (!user) {
 res.status(401).json({ error: "Invalid or expired code" });
 return;
 }

 const wallet = await ensureInternalWallet(user.id);
 const token = await createSession(user.id, req);
 res.cookie(COOKIE_NAME, token, sessionCookieOpts());

 const sec = await securityPayload(user.id);
 res.json({
 ok: true,
 ...sec,
 publicKey: wallet.publicKey,
 ...(wallet.deviceShareHex ? { deviceShareHex: wallet.deviceShareHex } : {}),
 });
});

// ─── Bind / verify email (authenticated) ──────────────────────────────────────

router.post(
 "/auth/email/send-otp",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const { email } = req.body as { email?: string };
 if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 res.status(400).json({ error: "Valid email required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 const taken = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, normalizedEmail),
 });
 if (taken && taken.id !== req.userId) {
 // Existing account owns this email - tell client to switch to login OTP
 if (taken.emailVerifiedAt) {
 try {
 await issueOtp(normalizedEmail, "login", "sign in");
 } catch (err) {
 logger.error({ err }, "Failed to send login OTP after bind conflict");
 res.status(500).json({ error: "Failed to send email" });
 return;
 }
 res.status(409).json({
 ok: false,
 flow: "login",
 error:
 "This email already has an Orbit account. We sent a sign-in code - enter it to open that wallet.",
 });
 return;
 }
 res.status(409).json({
 error: "Email already in use by another account.",
 flow: "blocked",
 });
 return;
 }

 try {
 await issueOtp(normalizedEmail, "verify_email", "verify your email for wallet recovery");
 res.json({ ok: true });
 } catch (err) {
 logger.error({ err }, "Failed to send verify-email OTP");
 res.status(500).json({ error: "Failed to send email - check SMTP settings" });
 }
 }
);

router.post(
 "/auth/email/verify",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const { email, code } = req.body as { email?: string; code?: string };
 if (!email || !code) {
 res.status(400).json({ error: "email and code required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 if (!(await consumeOtp(normalizedEmail, code, "verify_email"))) {
 res.status(401).json({ error: "Invalid or expired code" });
 return;
 }

 await db
 .update(usersTable)
 .set({
 email: normalizedEmail,
 emailVerifiedAt: new Date(),
 updatedAt: new Date(),
 })
 .where(eq(usersTable.id, req.userId));

 const sec = await securityPayload(req.userId);
 res.json({ ok: true, ...sec });
 }
);

// ─── Lost-phone recovery (email + TOTP only) ──────────────────────────────────

router.post("/auth/recover/send-otp", async (req, res): Promise<void> => {
 const { email } = req.body as { email?: string };
 if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 res.status(400).json({ error: "Valid email required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, normalizedEmail),
 });

 // Always return ok to avoid email enumeration; only send if recoverable
 if (user?.emailVerifiedAt && (await isRecoveryReady(user.id))) {
 try {
 await issueOtp(normalizedEmail, "recover", "recover your Orbit wallet");
 } catch (err) {
 logger.error({ err }, "Failed to send recovery OTP");
 res.status(500).json({ error: "Failed to send email" });
 return;
 }
 }

 res.json({ ok: true });
});

router.post("/auth/recover/complete", async (req, res): Promise<void> => {
 const { email, code, totpCode } = req.body as {
 email?: string;
 code?: string;
 totpCode?: string;
 };

 if (!email || !code || !totpCode) {
 res.status(400).json({ error: "email, code, and totpCode required" });
 return;
 }

 const normalizedEmail = email.toLowerCase().trim();
 if (!(await consumeOtp(normalizedEmail, code, "recover"))) {
 res.status(401).json({ error: "Invalid or expired email code" });
 return;
 }

 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, normalizedEmail),
 });
 if (!user?.emailVerifiedAt) {
 res.status(401).json({ error: "Recovery not available for this account" });
 return;
 }

 if (!(await verifyTotpCode(user.id, totpCode))) {
 res.status(401).json({ error: "Invalid authenticator code" });
 return;
 }

 try {
 const recovered = await recoverWithEmailAndTotp(user.id);
 const token = await createSession(user.id, req);
 res.cookie(COOKIE_NAME, token, sessionCookieOpts());

 const sec = await securityPayload(user.id);
 res.json({
 ok: true,
 ...sec,
 publicKey: recovered.publicKey,
 deviceShareHex: recovered.deviceShareHex,
 message: "Device restored. Previous device shares are invalidated.",
 });
 } catch (err: unknown) {
 const message = err instanceof Error ? err.message : "Recovery failed";
 logger.error({ err, userId: user.id }, "Recovery failed");
 res.status(400).json({ error: message });
 }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
 const token = req.cookies?.[COOKIE_NAME];
 if (token) await revokeSession(token);
 res.clearCookie(COOKIE_NAME, { path: "/" });
 res.json({ ok: true });
});

router.get("/auth/me", async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!req.userId) {
 res.status(401).json({ error: "Not authenticated" });
 return;
 }
 const sec = await securityPayload(req.userId);
 if (!sec.user) {
 res.status(404).json({ error: "User not found" });
 return;
 }
 res.json(sec);
});

// ─── Add passkey (authenticated) ──────────────────────────────────────────────

router.post(
 "/auth/passkey/register-options",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 try {
 const { generateRegistrationOptions } = await import("@simplewebauthn/server");
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.id, req.userId),
 });
 if (!user) {
 res.status(404).json({ error: "User not found" });
 return;
 }

 const existing = await db.query.passkeyCredentialsTable.findMany({
 where: eq(passkeyCredentialsTable.userId, req.userId),
 });

 const { rpID } = resolveWebAuthn(req);

 const options = await generateRegistrationOptions({
 rpName: "Orbit Copilot",
 rpID,
 userName: user.email ?? `orbit-user-${user.id}`,
 userDisplayName: user.displayName ?? user.email ?? `Orbit User ${user.id}`,
 userID: new TextEncoder().encode(String(user.id)),
 attestationType: "none",
 excludeCredentials: existing.map((c) => ({
 id: c.credentialId,
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 transports: (c.transports ?? []) as any,
 })),
 authenticatorSelection: {
 residentKey: "preferred",
 userVerification: "preferred",
 },
 });

 await db.insert(webauthnChallengesTable).values({
 identifier: String(req.userId),
 challenge: options.challenge,
 type: "registration",
 expiresAt: new Date(Date.now() + 5 * 60 * 1000),
 });

 res.json(options);
 } catch (err) {
 logger.error({ err }, "Passkey register-options failed");
 res.status(500).json({ error: "Passkey registration unavailable" });
 }
 }
);

router.post(
 "/auth/passkey/register-verify",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 try {
 const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
 const { credential, deviceName } = req.body as {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 credential: any;
 deviceName?: string;
 };

 const challengeRow = await db.query.webauthnChallengesTable.findFirst({
 where: and(
 eq(webauthnChallengesTable.identifier, String(req.userId)),
 eq(webauthnChallengesTable.type, "registration"),
 gt(webauthnChallengesTable.expiresAt, new Date())
 ),
 orderBy: (t, { desc }) => [desc(t.createdAt)],
 });
 if (!challengeRow) {
 res.status(400).json({ error: "No pending registration challenge" });
 return;
 }

 await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, challengeRow.id));

 const { rpID, origins } = resolveWebAuthn(req);
 const verification = await verifyRegistrationResponse({
 response: credential,
 expectedChallenge: challengeRow.challenge,
 expectedOrigin: origins,
 expectedRPID: rpID,
 requireUserVerification: false,
 });

 if (!verification.verified || !verification.registrationInfo) {
 res.status(400).json({ error: "Passkey verification failed" });
 return;
 }

 const { credId, pubKey, counter, aaguid } = extractRegistrationCredential(
 verification.registrationInfo as Record<string, any>
 );

 await db.insert(passkeyCredentialsTable).values({
 userId: req.userId,
 credentialId: credId,
 publicKey: pubKey,
 aaguid,
 counter,
 deviceName: deviceName ?? "My passkey",
 transports: credential?.response?.transports ?? [],
 });

 res.json({ ok: true });
 } catch (err) {
 logger.error({ err }, "Passkey register-verify failed");
 res.status(500).json({ error: authErrorMessage(err) });
 }
 }
);

router.post("/auth/passkey/login-options", async (req, res): Promise<void> => {
 const { email } = req.body as { email?: string };

 try {
 const { generateAuthenticationOptions } = await import("@simplewebauthn/server");

 type AllowCred = NonNullable<
 Parameters<typeof generateAuthenticationOptions>[0]["allowCredentials"]
 >[number];
 let allowCredentials: AllowCred[] = [];

 if (email) {
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.email, email.toLowerCase().trim()),
 });
 if (user) {
 const creds = await db.query.passkeyCredentialsTable.findMany({
 where: eq(passkeyCredentialsTable.userId, user.id),
 });
 allowCredentials = creds.map((c) => ({
 id: c.credentialId,
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 transports: (c.transports ?? []) as any,
 }));
 }
 }

 const { rpID } = resolveWebAuthn(req);
 const options = await generateAuthenticationOptions({
 rpID,
 allowCredentials: allowCredentials.length ? allowCredentials : undefined,
 userVerification: "preferred",
 });

 await db.insert(webauthnChallengesTable).values({
 identifier: email?.toLowerCase().trim() ?? "anonymous",
 challenge: options.challenge,
 type: "authentication",
 expiresAt: new Date(Date.now() + 5 * 60 * 1000),
 });

 res.json(options);
 } catch (err) {
 logger.error({ err }, "Passkey login-options failed");
 res.status(500).json({ error: "Passkey login unavailable" });
 }
});

router.post("/auth/passkey/login-verify", async (req, res): Promise<void> => {
 const { credential, email: _email } = req.body as {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 credential: any;
 email?: string;
 };

 try {
 const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
 const credId = (credential?.id ?? "") as string;

 const passkeyRow = await db.query.passkeyCredentialsTable.findFirst({
 where: eq(passkeyCredentialsTable.credentialId, credId),
 });
 if (!passkeyRow) {
 res.status(400).json({ error: "Passkey not found" });
 return;
 }

 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.id, passkeyRow.userId),
 });
 if (!user) {
 res.status(404).json({ error: "User not found" });
 return;
 }

 const candidates = [
 _email?.toLowerCase().trim(),
 user.email?.toLowerCase(),
 "anonymous",
 ].filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i);

 let challengeRow = null;
 for (const identifier of candidates) {
 challengeRow = await db.query.webauthnChallengesTable.findFirst({
 where: and(
 eq(webauthnChallengesTable.identifier, identifier),
 eq(webauthnChallengesTable.type, "authentication"),
 gt(webauthnChallengesTable.expiresAt, new Date())
 ),
 orderBy: (t, { desc }) => [desc(t.createdAt)],
 });
 if (challengeRow) break;
 }
 if (!challengeRow) {
 res.status(400).json({ error: "No pending authentication challenge" });
 return;
 }

 await db.delete(webauthnChallengesTable).where(eq(webauthnChallengesTable.id, challengeRow.id));

 const { rpID, origins } = resolveWebAuthn(req);
 const pubKeyBytes = Buffer.from(passkeyRow.publicKey, "base64url");
 // Support SimpleWebAuthn v10 (`authenticator`) and v11+ (`credential`)
 const verifyArgs: Record<string, unknown> = {
 response: credential,
 expectedChallenge: challengeRow.challenge,
 expectedOrigin: origins,
 expectedRPID: rpID,
 requireUserVerification: false,
 authenticator: {
 credentialID: passkeyRow.credentialId,
 credentialPublicKey: pubKeyBytes,
 counter: passkeyRow.counter,
 transports: (passkeyRow.transports ?? []) as string[],
 },
 credential: {
 id: passkeyRow.credentialId,
 publicKey: pubKeyBytes,
 counter: passkeyRow.counter,
 transports: passkeyRow.transports ?? [],
 },
 };
 const verification = await verifyAuthenticationResponse(verifyArgs as never);

 if (!verification.verified) {
 res.status(401).json({ error: "Passkey authentication failed" });
 return;
 }

 const authInfo = (verification as { authenticationInfo?: { newCounter?: number } })
 .authenticationInfo;
 await db
 .update(passkeyCredentialsTable)
 .set({
 counter: authInfo?.newCounter ?? passkeyRow.counter,
 lastUsedAt: new Date(),
 })
 .where(eq(passkeyCredentialsTable.id, passkeyRow.id));

 const wallet = await ensureInternalWallet(user.id);
 const token = await createSession(user.id, req);
 res.cookie(COOKIE_NAME, token, sessionCookieOpts());

 const sec = await securityPayload(user.id);
 res.json({
 ok: true,
 ...sec,
 publicKey: wallet.publicKey,
 ...(wallet.deviceShareHex ? { deviceShareHex: wallet.deviceShareHex } : {}),
 });
 } catch (err) {
 logger.error({ err }, "Passkey login-verify failed");
 res.status(500).json({ error: authErrorMessage(err) });
 }
});

// ─── TOTP ─────────────────────────────────────────────────────────────────────

router.post(
 "/auth/totp/setup",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 try {
 const { authenticator } = await import("otplib");
 const user = await db.query.usersTable.findFirst({
 where: eq(usersTable.id, req.userId),
 });
 if (!user) {
 res.status(404).json({ error: "User not found" });
 return;
 }

 const secret = authenticator.generateSecret();
 const encryptedSecret = encrypt(secret, deriveUserKey(req.userId));

 await db
 .insert(totpSecretsTable)
 .values({ userId: req.userId, encryptedSecret, verified: false })
 .onConflictDoUpdate({
 target: totpSecretsTable.userId,
 set: { encryptedSecret, verified: false },
 });

 const label = user.email ?? `user-${user.id}`;
 const otpauthUrl = authenticator.keyuri(label, "Orbit", secret);
 res.json({ secret, otpauthUrl });
 } catch (err) {
 logger.error({ err }, "TOTP setup failed");
 res.status(500).json({ error: "TOTP unavailable" });
 }
 }
);

router.post(
 "/auth/totp/verify",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const { code } = req.body as { code?: string };
 if (!code) {
 res.status(400).json({ error: "code required" });
 return;
 }

 try {
 const { authenticator } = await import("otplib");
 const totpRow = await db.query.totpSecretsTable.findFirst({
 where: eq(totpSecretsTable.userId, req.userId),
 });
 if (!totpRow) {
 res.status(400).json({ error: "TOTP not set up" });
 return;
 }

 const secret = decrypt(totpRow.encryptedSecret, deriveUserKey(req.userId));
 if (!authenticator.verify({ token: code, secret })) {
 res.status(401).json({ error: "Invalid TOTP code" });
 return;
 }

 await db
 .update(totpSecretsTable)
 .set({ verified: true })
 .where(eq(totpSecretsTable.userId, req.userId));

 const sec = await securityPayload(req.userId);
 res.json({ ok: true, ...sec });
 } catch (err) {
 logger.error({ err }, "TOTP verify failed");
 res.status(500).json({ error: "TOTP verification failed" });
 }
 }
);

router.post(
 "/auth/totp/validate",
 async (req: Request & { userId?: number }, res): Promise<void> => {
 if (!requireAuth(req, res)) return;

 const { code } = req.body as { code?: string };
 if (!code) {
 res.status(400).json({ error: "code required" });
 return;
 }

 if (!(await verifyTotpCode(req.userId, code))) {
 res.status(401).json({ error: "Invalid TOTP code" });
 return;
 }
 res.json({ ok: true });
 }
);

export default router;
