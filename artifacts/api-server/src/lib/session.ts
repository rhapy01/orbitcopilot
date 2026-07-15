/**
 * Session management: create, validate, and revoke server-side sessions.
 * Tokens are random 32-byte hex strings; only the SHA-256 hash is stored in DB.
 */

import { db } from "@workspace/db";
import { sessionsTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { generateToken, hashToken } from "./crypto";
import type { Request, Response, NextFunction } from "express";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "orbit_session";

export async function createSession(
 userId: number,
 req: Request
): Promise<string> {
 const token = generateToken(32);
 const tokenHash = hashToken(token);
 const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
 const deviceInfo = (req.headers["user-agent"] ?? "").slice(0, 200);

 await db.insert(sessionsTable).values({ userId, tokenHash, expiresAt, deviceInfo });

 return token;
}

export async function validateSession(
 token: string
): Promise<{ userId: number } | null> {
 if (!token) return null;
 const tokenHash = hashToken(token);

 const session = await db.query.sessionsTable.findFirst({
 where: and(
 eq(sessionsTable.tokenHash, tokenHash),
 gt(sessionsTable.expiresAt, new Date())
 ),
 });

 return session ? { userId: session.userId } : null;
}

export async function revokeSession(token: string): Promise<void> {
 const tokenHash = hashToken(token);
 await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash));
}

/** Express middleware - attaches req.userId if session cookie is valid. */
export async function sessionMiddleware(
 req: Request & { userId?: number },
 _res: Response,
 next: NextFunction
): Promise<void> {
 try {
 const token =
 req.cookies?.[COOKIE_NAME] ??
 req.headers["x-orbit-session"];

 if (token && typeof token === "string") {
 const result = await validateSession(token);
 if (result) req.userId = result.userId;
 }
 } catch {
 // Non-fatal - just continue unauthenticated
 }
 next();
}

export { COOKIE_NAME, SESSION_TTL_MS };
