/**
 * Pending MCP actions — prepared for ChatGPT/Claude, signed only in Orbit UI.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, mcpPendingActionsTable, internalWalletsTable } from "@workspace/db";
import { generateToken } from "./crypto";
import { publicMcpBaseUrl } from "./mcp-auth";
import { horizon } from "./stellar";
import { logger } from "./logger";

const TTL_MS = 60 * 60 * 1000; // 1 hour
const STELLAR_TX_HASH_RE = /^[a-fA-F0-9]{64}$/;

let _schemaReady = false;

function embedTokenSecret(): string {
  const secret =
    process.env.MCP_EMBED_SECRET?.trim() ||
    process.env.KMS_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "";
  const isProd =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  if (!secret || secret.length < 32) {
    if (isProd) {
      throw new Error(
        "MCP_EMBED_SECRET or KMS_SECRET (min 32 chars) required for embed tokens in production",
      );
    }
    return "orbit-mcp-embed-dev-local-only-do-not-use-prod";
  }
  return secret;
}

/** Short-lived HMAC token so embed iframes can load/complete without first-party cookies alone. */
export function mintEmbedToken(publicId: string, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const body = `${publicId}.${exp}`;
  const sig = createHmac("sha256", embedTokenSecret())
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyEmbedToken(publicId: string, token: string | null | undefined): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const body = `${publicId}.${exp}`;
  const expected = createHmac("sha256", embedTokenSecret())
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(parts[1]!);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isValidStellarTxHash(hash: string | null | undefined): boolean {
  return typeof hash === "string" && STELLAR_TX_HASH_RE.test(hash);
}

/** Soft Horizon check — reject wrong-source txs; tolerate brief indexing lag. */
export async function assertTxHashPlausible(
  txHash: string,
  walletPublicKey: string,
): Promise<void> {
  if (!isValidStellarTxHash(txHash)) {
    throw new Error("Invalid transaction hash format");
  }
  try {
    const tx = await horizon.transactions().transaction(txHash).call();
    const src = (tx as { source_account?: string }).source_account;
    if (src && src !== walletPublicKey) {
      throw new Error("Transaction source does not match action wallet");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("source does not match")) {
      throw err instanceof Error ? err : new Error(msg);
    }
    // 404 / lag: authorized callers may complete with a well-formed hash only
    if (/Not Found|404|not found/i.test(msg)) {
      logger.info({ txHash }, "Horizon has not indexed tx yet; accepting hash shape");
      return;
    }
    if (msg.includes("Invalid transaction")) {
      throw err instanceof Error ? err : new Error(msg);
    }
    logger.warn({ err: msg, txHash }, "Horizon tx verify skipped");
  }
}

export async function ensureMcpActionsSchema(): Promise<void> {
  if (_schemaReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mcp_pending_actions (
      id serial PRIMARY KEY,
      public_id text NOT NULL UNIQUE,
      user_id integer,
      wallet_public_key text NOT NULL,
      action jsonb NOT NULL,
      summary text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'pending',
      tx_hash text,
      error text,
      intent_text text,
      expires_at timestamptz NOT NULL,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  _schemaReady = true;
}

export type PendingActionInput = {
  userId: number | null;
  walletPublicKey: string;
  action: Record<string, unknown>;
  summary: string;
  intentText?: string;
};

export type PendingActionView = {
  publicId: string;
  status: string;
  summary: string;
  walletPublicKey: string;
  /** Owning Orbit user when known (not sent to AI hosts) */
  userId: number | null;
  action: Record<string, unknown>;
  approvalUrl: string;
  /** In-chat iframe URL (preferred UX) */
  embedUrl: string;
  /** HMAC for embed session (query `et`) */
  embedToken: string;
  txHash: string | null;
  error: string | null;
  expiresAt: string;
  intentText: string | null;
};

/** Safe for AI hosts — no XDR / embed secrets */
export type PendingActionStatusView = {
  publicId: string;
  status: string;
  summary: string;
  walletPublicKey: string;
  txHash: string | null;
  error: string | null;
  expiresAt: string;
  intentText: string | null;
  approvalUrl: string;
  embedUrl: string;
};

function toView(row: {
  publicId: string;
  status: string;
  summary: string;
  walletPublicKey: string;
  userId?: number | null;
  action: Record<string, unknown>;
  txHash: string | null;
  error: string | null;
  expiresAt: Date;
  intentText: string | null;
}): PendingActionView {
  const base = publicMcpBaseUrl();
  const embedToken = mintEmbedToken(row.publicId, row.expiresAt);
  const et = encodeURIComponent(embedToken);
  return {
    publicId: row.publicId,
    status: row.status,
    summary: row.summary,
    walletPublicKey: row.walletPublicKey,
    userId: row.userId ?? null,
    action: row.action,
    approvalUrl: `${base}/approve/${row.publicId}?et=${et}`,
    embedUrl: `${base}/embed/approve/${row.publicId}?et=${et}`,
    embedToken,
    txHash: row.txHash,
    error: row.error,
    expiresAt: row.expiresAt.toISOString(),
    intentText: row.intentText,
  };
}

export function toStatusView(view: PendingActionView): PendingActionStatusView {
  return {
    publicId: view.publicId,
    status: view.status,
    summary: view.summary,
    walletPublicKey: view.walletPublicKey,
    txHash: view.txHash,
    error: view.error,
    expiresAt: view.expiresAt,
    intentText: view.intentText,
    approvalUrl: view.approvalUrl,
    embedUrl: view.embedUrl,
  };
}

export function summarizeChatAction(action: Record<string, unknown>): string {
  const type = String(action.type || "action");
  const amount = action.sendAmount ? String(action.sendAmount) : "";
  const asset = action.sendAsset ? String(action.sendAsset) : "";
  const dest = action.destAsset ? String(action.destAsset) : "";
  const to = action.destination ? String(action.destination) : "";
  const market = action.marketHint ? String(action.marketHint) : "";
  switch (type) {
    case "send":
      return `Send ${amount} ${asset || "XLM"} to ${to.slice(0, 8)}…`;
    case "swap":
    case "soroswap_swap":
    case "steldex_swap":
    case "aquarius_swap":
    case "blend_usdc_swap":
      return `Swap ${amount} ${asset} → ${dest || "…"}`;
    case "predict_bet":
      return `Predict bet ${amount} XLM on ${market || "market"} (${action.outcome || "?"})`;
    case "cctp_bridge":
    case "cctp_bridge_in":
      return `CCTP bridge ${amount} ${asset || "USDC"}`;
    default:
      return `${type.replace(/_/g, " ")}${amount ? ` ${amount}` : ""}${asset ? ` ${asset}` : ""}`.trim();
  }
}

export async function createPendingMcpAction(
  input: PendingActionInput,
): Promise<PendingActionView> {
  await ensureMcpActionsSchema();
  const publicId = generateToken(16);
  const expiresAt = new Date(Date.now() + TTL_MS);
  const summary = input.summary || summarizeChatAction(input.action);

  await db.insert(mcpPendingActionsTable).values({
    publicId,
    userId: input.userId,
    walletPublicKey: input.walletPublicKey,
    action: input.action,
    summary,
    status: "pending",
    intentText: input.intentText ?? null,
    expiresAt,
  });

  return toView({
    publicId,
    status: "pending",
    summary,
    walletPublicKey: input.walletPublicKey,
    userId: input.userId,
    action: input.action,
    txHash: null,
    error: null,
    expiresAt,
    intentText: input.intentText ?? null,
  });
}

export async function getPendingMcpAction(
  publicId: string,
): Promise<PendingActionView | null> {
  await ensureMcpActionsSchema();
  const row = await db.query.mcpPendingActionsTable.findFirst({
    where: eq(mcpPendingActionsTable.publicId, publicId),
  });
  if (!row) return null;

  if (row.status === "pending" && row.expiresAt < new Date()) {
    await db
      .update(mcpPendingActionsTable)
      .set({ status: "expired" })
      .where(eq(mcpPendingActionsTable.publicId, publicId));
    return toView({
      ...row,
      status: "expired",
      userId: row.userId,
      action: row.action as Record<string, unknown>,
    });
  }

  return toView({
    publicId: row.publicId,
    status: row.status,
    summary: row.summary,
    walletPublicKey: row.walletPublicKey,
    userId: row.userId,
    action: row.action as Record<string, unknown>,
    txHash: row.txHash,
    error: row.error,
    expiresAt: row.expiresAt,
    intentText: row.intentText,
  });
}

/** Session user may complete if they own the row or the bound wallet. */
export async function sessionOwnsPendingAction(
  userId: number,
  row: { userId?: number | null; walletPublicKey: string },
): Promise<boolean> {
  if (row.userId != null && row.userId === userId) return true;
  try {
    const w = await db.query.internalWalletsTable.findFirst({
      where: eq(internalWalletsTable.userId, userId),
    });
    return Boolean(w?.stellarPublicKey && w.stellarPublicKey === row.walletPublicKey);
  } catch {
    return false;
  }
}

export async function completePendingMcpAction(
  publicId: string,
  opts: {
    txHash?: string | null;
    error?: string | null;
    userId?: number | null;
    /** Caller already proved embed token or session ownership */
    authorized: boolean;
  },
): Promise<PendingActionView | null> {
  if (!opts.authorized) {
    throw new Error("Not authorized to complete this action");
  }
  await ensureMcpActionsSchema();
  const row = await db.query.mcpPendingActionsTable.findFirst({
    where: eq(mcpPendingActionsTable.publicId, publicId),
  });
  if (!row) return null;
  if (opts.userId != null && row.userId != null && row.userId !== opts.userId) {
    throw new Error("Not allowed to complete this action");
  }

  const txHash = opts.txHash?.trim() || null;
  const error = opts.error?.trim() || null;
  if (txHash && !error) {
    await assertTxHashPlausible(txHash, row.walletPublicKey);
  }

  const status = error ? "failed" : "completed";
  await db
    .update(mcpPendingActionsTable)
    .set({
      status,
      txHash,
      error,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(mcpPendingActionsTable.publicId, publicId),
        eq(mcpPendingActionsTable.status, "pending"),
      ),
    );

  return getPendingMcpAction(publicId);
}

/** True if this ChatAction is something the user must approve to execute. */
export function isExecutableChatAction(action: Record<string, unknown> | null | undefined): boolean {
  if (!action || typeof action !== "object") return false;
  const type = String(action.type || "");
  if (!type || type === "connect_wallet") return false;
  return true;
}
