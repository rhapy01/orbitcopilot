/**
 * PayBox-style MCP OAuth: users only add https://orbitpilot.vercel.app/mcp
 * Hosts run OAuth → browser login/consent → bearer token. No pasted API keys.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { getRedis, redisConfigured } from "./redis";
import {
  createMcpApiKey,
  sanitizeScopes,
  parseScopes,
  validateMcpBearer,
  publicMcpBaseUrl,
  type McpScope,
} from "./mcp-auth";
import { logger } from "./logger";
import { db, internalWalletsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateToken } from "./crypto";

const CLIENT_TTL = 30 * 24 * 3600;
const CODE_TTL = 10 * 60;
const REFRESH_TTL = 30 * 24 * 3600;
const CSRF_TTL = 10 * 60;
const PREFIX = "orbit:mcp:oauth:";

async function mintConsentCsrf(userId: number): Promise<string> {
  const token = generateToken(24);
  await getRedis().set(`${PREFIX}csrf:${userId}:${token}`, "1", "EX", CSRF_TTL);
  return token;
}

async function consumeConsentCsrf(userId: number, token: string): Promise<boolean> {
  if (!token || token.length < 16) return false;
  const key = `${PREFIX}csrf:${userId}:${token}`;
  const ok = await getRedis().get(key);
  if (!ok) return false;
  await getRedis().del(key);
  return true;
}

/** Reject cross-site forged consent when Origin is present and wrong. */
function consentOriginAllowed(req: Request): boolean {
  const origin = req.get("origin")?.trim();
  if (!origin) return true; // non-CORS form navigations; CSRF token still required
  try {
    return new URL(origin).origin === new URL(publicMcpBaseUrl()).origin;
  } catch {
    return false;
  }
}

type StoredCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  accessToken: string;
  userId: number;
};

type StoredRefresh = {
  accessToken: string;
  clientId: string;
  scopes: string[];
  userId: number;
};

class RedisClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    if (!redisConfigured()) return undefined;
    const raw = await getRedis().get(`${PREFIX}client:${clientId}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthClientInformationFull;
    } catch {
      return undefined;
    }
  }

  async registerClient(
    client: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    if (!redisConfigured()) {
      throw new Error("Redis required for MCP OAuth client registration");
    }
    await getRedis().set(
      `${PREFIX}client:${client.client_id}`,
      JSON.stringify(client),
      "EX",
      CLIENT_TTL,
    );
    return client;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Map host scopes (mcp / offline_access) → Orbit read|prepare */
export function normalizeMcpOAuthScopes(raw: string[] | undefined): McpScope[] {
  const set = new Set<string>((raw ?? []).map((s) => s.toLowerCase()));
  if (set.has("mcp") || set.size === 0) {
    return ["read", "prepare"];
  }
  return sanitizeScopes(parseScopes([...set]));
}

function consentPage(opts: {
  mode: "login" | "approve";
  clientName: string;
  loginHref?: string;
  formAction?: string;
  hidden?: Record<string, string>;
  walletHint?: string | null;
  error?: string;
}): string {
  const base = publicMcpBaseUrl();
  const title =
    opts.mode === "login"
      ? "Connect Orbit to your AI"
      : `Allow ${opts.clientName}`;

  const body =
    opts.mode === "login"
      ? `<p>Add Orbit once — same idea as PayBox. Sign in with your Orbit wallet, then approve. No API keys to copy.</p>
         <p class="muted">Your AI can <strong>read</strong> portfolio data and <strong>prepare</strong> unsigned txs. It cannot sign or move funds.</p>
         <a class="btn" href="${escapeHtml(opts.loginHref || "/")}">Continue with Orbit</a>`
      : `<p><strong>${escapeHtml(opts.clientName)}</strong> wants Orbit tools (read + prepare only). Signing stays in Orbit / Freighter.</p>
         ${opts.walletHint ? `<p class="mono">Wallet: ${escapeHtml(opts.walletHint)}</p>` : ""}
         <form method="POST" action="${escapeHtml(opts.formAction || "/authorize/consent")}">
           ${Object.entries(opts.hidden || {})
             .map(
               ([k, v]) =>
                 `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}"/>`,
             )
             .join("\n")}
           <button class="btn" type="submit">Allow access</button>
         </form>
         <p class="muted"><a href="${escapeHtml(base)}">Cancel</a></p>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)} · Orbit</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,sans-serif;background:#07090f;color:#e8eaf0;
background-image:radial-gradient(ellipse 80% 50% at 50% -20%,#4c1d9540,transparent)}
main{max-width:420px;margin:12vh auto;padding:28px;border:1px solid #2a2d3e;border-radius:16px;background:#0e111a}
h1{font-size:1.35rem;margin:0 0 12px;letter-spacing:-.02em}
p{color:#9aa3b5;line-height:1.55;font-size:.95rem}
.muted{font-size:.85rem;color:#6b7280}
.mono{font-family:ui-monospace,monospace;font-size:.75rem;word-break:break-all;color:#a78bfa}
.btn{display:block;text-align:center;text-decoration:none;width:100%;box-sizing:border-box;margin-top:20px;padding:14px 16px;
border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:600;font-size:1rem;cursor:pointer}
.btn:hover{background:#6d28d9}
.err{color:#f87171}
.brand{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:#a78bfa;margin-bottom:8px}
</style></head><body><main>
<div class="brand">Orbit Copilot</div>
<h1>${escapeHtml(title)}</h1>
${opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : ""}
${body}
</main></body></html>`;
}

export class OrbitMcpOAuthProvider implements OAuthServerProvider {
  clientsStore = new RedisClientsStore();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      res.status(400).send("Unregistered redirect_uri");
      return;
    }

    const req = res.req as Request & { userId?: number };
    const scopes = normalizeMcpOAuthScopes(params.scopes);
    const clientName = client.client_name || client.client_id || "AI assistant";
    const base = publicMcpBaseUrl();

    // Rebuild authorize URL so login can return here with cookies
    const authorizeUrl = new URL("/authorize", base);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", params.redirectUri);
    authorizeUrl.searchParams.set("code_challenge", params.codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    if (params.state) authorizeUrl.searchParams.set("state", params.state);
    if (params.scopes?.length) {
      authorizeUrl.searchParams.set("scope", params.scopes.join(" "));
    }
    if (params.resource) {
      authorizeUrl.searchParams.set("resource", params.resource.toString());
    }

    if (!req?.userId) {
      const login = new URL("/", base);
      login.searchParams.set("mcp_return", authorizeUrl.toString());
      login.searchParams.set("connect", "1");
      res
        .status(200)
        .type("html")
        .send(
          consentPage({
            mode: "login",
            clientName,
            loginHref: login.toString(),
          }),
        );
      return;
    }

    let walletHint: string | null = null;
    try {
      const w = await db.query.internalWalletsTable.findFirst({
        where: eq(internalWalletsTable.userId, req.userId),
      });
      walletHint = w?.stellarPublicKey ?? null;
    } catch {
      /* ignore */
    }

    let csrf = "";
    try {
      csrf = await mintConsentCsrf(req.userId);
    } catch (err) {
      logger.error({ err }, "MCP consent CSRF mint failed");
      res.status(503).send("Consent temporarily unavailable");
      return;
    }

    res.status(200).type("html").send(
      consentPage({
        mode: "approve",
        clientName,
        walletHint,
        formAction: "/authorize/consent",
        hidden: {
          client_id: client.client_id,
          redirect_uri: params.redirectUri,
          state: params.state || "",
          code_challenge: params.codeChallenge,
          scope: scopes.join(" "),
          resource: params.resource?.toString() || "",
          approve: "1",
          csrf,
        },
      }),
    );
  }

  async issueCodeAndRedirect(
    res: Response,
    data: StoredCode & { state?: string },
  ): Promise<void> {
    const code = randomUUID();
    const { state, ...stored } = data;
    await getRedis().set(
      `${PREFIX}code:${code}`,
      JSON.stringify(stored),
      "EX",
      CODE_TTL,
    );
    const target = new URL(data.redirectUri);
    target.searchParams.set("code", code);
    if (state) target.searchParams.set("state", state);
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const raw = await getRedis().get(`${PREFIX}code:${authorizationCode}`);
    if (!raw) throw new Error("Invalid authorization code");
    const data = JSON.parse(raw) as StoredCode;
    return data.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const key = `${PREFIX}code:${authorizationCode}`;
    const raw = await getRedis().get(key);
    if (!raw) throw new Error("Invalid authorization code");
    await getRedis().del(key);

    const data = JSON.parse(raw) as StoredCode;
    if (data.clientId !== client.client_id) {
      throw new Error("Authorization code client mismatch");
    }

    const ctx = await validateMcpBearer(data.accessToken);
    if (!ctx) throw new Error("MCP token invalid or revoked");

    const refreshToken = `orb_ref_${randomUUID().replace(/-/g, "")}`;
    await getRedis().set(
      `${PREFIX}refresh:${refreshToken}`,
      JSON.stringify({
        accessToken: data.accessToken,
        clientId: client.client_id,
        scopes: data.scopes,
        userId: data.userId,
      } satisfies StoredRefresh),
      "EX",
      REFRESH_TTL,
    );

    logger.info(
      { clientId: client.client_id, keyPrefix: ctx.keyPrefix, userId: data.userId },
      "MCP OAuth token issued",
    );

    return {
      access_token: data.accessToken,
      token_type: "bearer",
      expires_in: REFRESH_TTL,
      refresh_token: refreshToken,
      scope: ["mcp", "offline_access", ...data.scopes].join(" "),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const raw = await getRedis().get(`${PREFIX}refresh:${refreshToken}`);
    if (!raw) throw new Error("Invalid refresh token");
    const data = JSON.parse(raw) as StoredRefresh;
    if (data.clientId !== client.client_id) {
      throw new Error("Refresh token client mismatch");
    }

    const ctx = await validateMcpBearer(data.accessToken);
    if (!ctx) throw new Error("Underlying MCP key revoked — reconnect Orbit");

    const nextScopes = scopes?.length
      ? normalizeMcpOAuthScopes(scopes)
      : (data.scopes as McpScope[]);

    return {
      access_token: data.accessToken,
      token_type: "bearer",
      expires_in: REFRESH_TTL,
      refresh_token: refreshToken,
      scope: ["mcp", "offline_access", ...nextScopes].join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const ctx = await validateMcpBearer(token);
    if (!ctx) throw new Error("Invalid or revoked token");
    return {
      token,
      clientId: typeof ctx.keyId === "number" ? `mcp-key-${ctx.keyId}` : "mcp-env",
      scopes: ["mcp", ...ctx.scopes],
    };
  }
}

export function mcpOAuthAvailable(): boolean {
  return redisConfigured();
}

/** POST /authorize/consent — logged-in user clicks Allow (PayBox-style) */
export async function handleMcpConsentPost(
  req: Request,
  res: Response,
  provider: OrbitMcpOAuthProvider,
): Promise<void> {
  try {
    if (!consentOriginAllowed(req)) {
      res.status(403).send("Invalid origin");
      return;
    }

    const userId = (req as Request & { userId?: number }).userId;
    const body = req.body || {};
    const clientId = String(body.client_id || "");
    const redirectUri = String(body.redirect_uri || "");
    const state = body.state ? String(body.state) : undefined;
    const codeChallenge = String(body.code_challenge || "");
    const csrf = String(body.csrf || "");
    const scopes = normalizeMcpOAuthScopes(
      String(body.scope || "mcp").split(/\s+/).filter(Boolean),
    );

    const client = await provider.clientsStore.getClient(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      res.status(400).send("Invalid client or redirect_uri");
      return;
    }

    if (!userId) {
      const base = publicMcpBaseUrl();
      const authorizeUrl = new URL("/authorize", base);
      authorizeUrl.searchParams.set("client_id", clientId);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("response_type", "code");
      if (state) authorizeUrl.searchParams.set("state", state);
      const login = new URL("/", base);
      login.searchParams.set("mcp_return", authorizeUrl.toString());
      res.redirect(login.toString());
      return;
    }

    const csrfOk = await consumeConsentCsrf(userId, csrf);
    if (!csrfOk) {
      res.status(403).type("html").send(
        consentPage({
          mode: "approve",
          clientName: client.client_name || client.client_id || "AI assistant",
          error: "Consent expired or invalid. Restart connect from your AI host.",
          formAction: "/authorize/consent",
          hidden: {},
        }),
      );
      return;
    }

    let bindPublicKey: string | null = null;
    try {
      const w = await db.query.internalWalletsTable.findFirst({
        where: eq(internalWalletsTable.userId, userId),
      });
      bindPublicKey = w?.stellarPublicKey ?? null;
    } catch {
      /* ignore */
    }

    const created = await createMcpApiKey({
      userId,
      label: `AI:${(client.client_name || client.client_id).slice(0, 40)}`,
      scopes,
      bindPublicKey,
      expiresInDays: 30,
    });

    await provider.issueCodeAndRedirect(res, {
      clientId,
      redirectUri,
      codeChallenge,
      scopes,
      accessToken: created.rawKey,
      userId,
      state,
      resource: body.resource ? String(body.resource) : undefined,
    });
  } catch (err: any) {
    logger.error({ err }, "MCP consent failed");
    res.status(500).send(err?.message ?? "Consent failed");
  }
}
