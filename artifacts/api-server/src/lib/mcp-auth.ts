/**
 * MCP connector auth — Bearer API keys with read | prepare scopes only.
 * Never grants sign / export / submit. Device shares are rejected in tool args.
 */

import { and, desc, eq, isNull, or, gt, sql } from "drizzle-orm";
import { db, mcpApiKeysTable } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";
import { generateToken, hashToken } from "./crypto";
import { logger } from "./logger";

export const MCP_SCOPES = ["read", "prepare"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export type McpAuthContext = {
  /** DB key id, or "env" for bootstrap keys. */
  keyId: number | "env";
  userId: number | null;
  scopes: McpScope[];
  bindPublicKey: string | null;
  keyPrefix: string;
};

declare global {
  namespace Express {
    interface Request {
      mcpAuth?: McpAuthContext;
    }
  }
}

const STELLAR_PK = /^G[A-Z2-7]{55}$/;
const FORBIDDEN_ARG_KEYS = new Set([
  "devicesharehex",
  "deviceshare",
  "secretkey",
  "secret",
  "privatekey",
  "seed",
  "mnemonic",
  "recoveryphrase",
  "signedxdr",
  "signedtx",
]);

export function isMcpScope(s: string): s is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(s);
}

export function parseScopes(raw: unknown): McpScope[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[+,|]/).map((s) => s.trim())
      : [];
  const out = [...new Set(list.filter(isMcpScope))];
  return out.length ? out : ["read"];
}

/** Reject sign-related scopes even if a client tries to request them. */
export function sanitizeScopes(scopes: McpScope[]): McpScope[] {
  return scopes.filter((s) => s === "read" || s === "prepare");
}

export function hasScope(auth: McpAuthContext, scope: McpScope): boolean {
  return auth.scopes.includes(scope);
}

export function assertPublicKey(publicKey: string): string {
  const pk = publicKey.trim();
  if (!STELLAR_PK.test(pk)) {
    throw new Error("Invalid Stellar public key (expected G… address)");
  }
  return pk;
}

/** Enforce optional wallet binding on a key. */
export function resolveToolPublicKey(
  auth: McpAuthContext,
  requested?: string | null,
): string {
  const bound = auth.bindPublicKey;
  if (bound) {
    if (requested && requested.trim() && requested.trim() !== bound) {
      throw new Error(
        "This MCP key is bound to a different wallet. Use the bound public key only.",
      );
    }
    return bound;
  }
  if (!requested?.trim()) {
    throw new Error("publicKey is required (G… Stellar address)");
  }
  return assertPublicKey(requested);
}

/** Strip / reject any attempt to smuggle key material into tool args. */
export function assertSafeToolArgs(args: unknown): void {
  if (!args || typeof args !== "object") return;
  const walk = (obj: unknown, depth: number) => {
    if (depth > 6 || !obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const nk = k.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (FORBIDDEN_ARG_KEYS.has(nk)) {
        throw new Error(
          `Forbidden argument "${k}". MCP cannot accept secrets, device shares, or signed transactions.`,
        );
      }
      if (typeof v === "string" && /^S[A-Z2-7]{55}$/.test(v.trim())) {
        throw new Error(
          "Secret keys must never be sent to MCP. Sign only inside Orbit Copilot or Freighter.",
        );
      }
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(args, 0);
}

function parseBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerKey = req.headers["x-api-key"] ?? req.headers["x-orbit-mcp-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }
  return null;
}

/** Env bootstrap: MCP_API_KEYS=orb_mcp_xxx:read+prepare[:G…],orb_mcp_yyy:read */
function matchEnvKey(raw: string): McpAuthContext | null {
  const blob = process.env.MCP_API_KEYS?.trim();
  if (!blob) return null;
  for (const part of blob.split(",")) {
    const [token, scopePart, bind] = part.trim().split(":");
    if (!token || raw !== token) continue;
    return {
      keyId: "env",
      userId: null,
      scopes: sanitizeScopes(parseScopes(scopePart || "read")),
      bindPublicKey: bind && STELLAR_PK.test(bind) ? bind : null,
      keyPrefix: token.slice(0, 16),
    };
  }
  return null;
}

export async function validateMcpBearer(
  raw: string,
): Promise<McpAuthContext | null> {
  if (!raw || raw.length < 24) return null;

  const envHit = matchEnvKey(raw);
  if (envHit) return envHit;

  let tokenHash: string;
  try {
    tokenHash = hashToken(raw);
  } catch {
    return null;
  }

  try {
    await ensureMcpSchema();
    const now = new Date();
    const row = await db.query.mcpApiKeysTable.findFirst({
      where: and(
        eq(mcpApiKeysTable.tokenHash, tokenHash),
        isNull(mcpApiKeysTable.revokedAt),
        or(isNull(mcpApiKeysTable.expiresAt), gt(mcpApiKeysTable.expiresAt, now)),
      ),
    });
    if (!row) return null;

    // Fire-and-forget last-used stamp
    void db
      .update(mcpApiKeysTable)
      .set({ lastUsedAt: now })
      .where(eq(mcpApiKeysTable.id, row.id))
      .catch(() => undefined);

    return {
      keyId: row.id,
      userId: row.userId,
      scopes: sanitizeScopes(parseScopes(row.scopes)),
      bindPublicKey: row.bindPublicKey,
      keyPrefix: row.keyPrefix,
    };
  } catch (err) {
    logger.warn({ err }, "MCP key lookup failed");
    return null;
  }
}

export async function mcpAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const resourceMeta = `${publicMcpBaseUrl()}/.well-known/oauth-protected-resource`;
  const www = `Bearer realm="Orbit MCP", resource_metadata="${resourceMeta}"`;

  const raw = parseBearer(req);
  if (!raw) {
    res.setHeader("WWW-Authenticate", www);
    res.status(401).json({
      error: "unauthorized",
      error_description:
        "MCP access requires an OAuth 2.1 access token. Add https://orbitpilot.vercel.app/mcp as a connector — no API key to paste.",
    });
    return;
  }

  const ctx = await validateMcpBearer(raw);
  if (!ctx) {
    res.setHeader(
      "WWW-Authenticate",
      `${www}, error="invalid_token", error_description="Invalid or revoked token"`,
    );
    res.status(401).json({
      error: "unauthorized",
      error_description: "Invalid or revoked token",
    });
    return;
  }

  req.mcpAuth = ctx;
  next();
}

export type CreateMcpKeyInput = {
  userId: number;
  label?: string;
  scopes?: McpScope[];
  bindPublicKey?: string | null;
  /** Days until expiry; default 90. Cap 365. */
  expiresInDays?: number;
};

let _mcpSchemaReady = false;

export async function ensureMcpSchema(): Promise<void> {
  if (_mcpSchemaReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mcp_api_keys (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      token_hash text NOT NULL UNIQUE,
      key_prefix text NOT NULL,
      label text NOT NULL DEFAULT 'MCP connector',
      scopes jsonb NOT NULL DEFAULT '["read"]'::jsonb,
      bind_public_key text,
      last_used_at timestamptz,
      revoked_at timestamptz,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  _mcpSchemaReady = true;
}

export async function createMcpApiKey(input: CreateMcpKeyInput): Promise<{
  id: number;
  rawKey: string;
  keyPrefix: string;
  scopes: McpScope[];
  bindPublicKey: string | null;
  expiresAt: Date;
}> {
  await ensureMcpSchema();
  const scopes = sanitizeScopes(
    input.scopes?.length ? input.scopes : (["read"] as McpScope[]),
  );
  if (!scopes.length) throw new Error("At least one scope (read or prepare) is required");

  let bind: string | null = null;
  if (input.bindPublicKey?.trim()) {
    bind = assertPublicKey(input.bindPublicKey);
  }

  const days = Math.min(365, Math.max(1, input.expiresInDays ?? 90));
  const rawKey = `orb_mcp_${generateToken(24)}`;
  const tokenHash = hashToken(rawKey);
  const keyPrefix = rawKey.slice(0, 16);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(mcpApiKeysTable)
    .values({
      userId: input.userId,
      tokenHash,
      keyPrefix,
      label: (input.label?.trim() || "MCP connector").slice(0, 80),
      scopes,
      bindPublicKey: bind,
      expiresAt,
    })
    .returning({ id: mcpApiKeysTable.id });

  return {
    id: row.id,
    rawKey,
    keyPrefix,
    scopes,
    bindPublicKey: bind,
    expiresAt,
  };
}

export async function listMcpApiKeys(userId: number) {
  await ensureMcpSchema();
  return db
    .select({
      id: mcpApiKeysTable.id,
      keyPrefix: mcpApiKeysTable.keyPrefix,
      label: mcpApiKeysTable.label,
      scopes: mcpApiKeysTable.scopes,
      bindPublicKey: mcpApiKeysTable.bindPublicKey,
      lastUsedAt: mcpApiKeysTable.lastUsedAt,
      revokedAt: mcpApiKeysTable.revokedAt,
      expiresAt: mcpApiKeysTable.expiresAt,
      createdAt: mcpApiKeysTable.createdAt,
    })
    .from(mcpApiKeysTable)
    .where(eq(mcpApiKeysTable.userId, userId))
    .orderBy(desc(mcpApiKeysTable.createdAt));
}

export async function revokeMcpApiKey(
  userId: number,
  keyId: number,
): Promise<boolean> {
  await ensureMcpSchema();
  const updated = await db
    .update(mcpApiKeysTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpApiKeysTable.id, keyId),
        eq(mcpApiKeysTable.userId, userId),
        isNull(mcpApiKeysTable.revokedAt),
      ),
    )
    .returning({ id: mcpApiKeysTable.id });
  return updated.length > 0;
}

export function publicMcpBaseUrl(): string {
  const fromEnv = process.env.ORBIT_PUBLIC_URL?.trim()?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(
    /^https?:\/\//,
    "",
  );
  if (prodHost) return `https://${prodHost}`;
  // Stable production host when Vercel only injects the deployment URL
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production") {
    return "https://orbitpilot.vercel.app";
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }
  return "http://localhost:3001";
}
