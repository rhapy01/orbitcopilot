/**
 * MCP HTTP surface (alongside existing /api — does not replace Copilot).
 *
 * Canonical URLs (production):
 *   https://orbitpilot.vercel.app/mcp
 *   https://orbitpilot.vercel.app/api/mcp
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createOrbitMcpServer } from "../mcp/create-server";
import {
  createMcpApiKey,
  listMcpApiKeys,
  mcpAuthMiddleware,
  parseScopes,
  publicMcpBaseUrl,
  revokeMcpApiKey,
  sanitizeScopes,
  type McpScope,
} from "../lib/mcp-auth";
import {
  OrbitMcpOAuthProvider,
  handleMcpConsentPost,
  mcpOAuthAvailable,
} from "../lib/mcp-oauth";
import { logger } from "../lib/logger";

function requireUser(req: Request, res: Response): number | null {
  const userId = (req as Request & { userId?: number }).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return userId;
}

function oauthProtectedResourceDoc() {
  const base = publicMcpBaseUrl();
  return {
    resource: `${base}/mcp`,
    authorization_servers: [`${base}`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp", "read", "prepare", "offline_access"],
    resource_documentation: `${base}/docs/mcp`,
  };
}

/** Well-known + MCP transport (mounted at app root). */
export const mcpHttpRouter: IRouter = Router();

/** OAuth AS + consent (when Redis is configured). */
export function createMcpOAuthRouter(): IRouter | null {
  if (!mcpOAuthAvailable()) {
    logger.warn("MCP OAuth disabled — Redis not configured; Bearer API keys still work");
    return null;
  }

  const base = publicMcpBaseUrl();
  const provider = new OrbitMcpOAuthProvider();
  const router: IRouter = Router();

  router.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(base),
      baseUrl: new URL(base),
      serviceDocumentationUrl: new URL(`${base}/docs/mcp`),
      scopesSupported: ["mcp", "offline_access", "read", "prepare"],
      resourceServerUrl: new URL(`${base}/mcp`),
      resourceName: "Orbit Copilot",
    }),
  );

  router.post("/authorize/consent", (req, res) => {
    void handleMcpConsentPost(req, res, provider);
  });

  return router;
}

mcpHttpRouter.get(
  "/.well-known/oauth-protected-resource",
  (_req, res): void => {
    res.json(oauthProtectedResourceDoc());
  },
);

mcpHttpRouter.get(
  "/.well-known/oauth-protected-resource/mcp",
  (_req, res): void => {
    res.json(oauthProtectedResourceDoc());
  },
);

/** Fallback metadata when full OAuth router is off */
mcpHttpRouter.get(
  "/.well-known/oauth-authorization-server",
  (_req, res): void => {
    if (mcpOAuthAvailable()) {
      // mcpAuthRouter already serves this; if we hit this, OAuth wasn't mounted
      res.status(404).json({ error: "OAuth router not mounted" });
      return;
    }
    const base = publicMcpBaseUrl();
    res.json({
      issuer: base,
      // Point hosts at Bearer keys when full OAuth isn't up
      token_endpoint: `${base}/api/mcp/keys`,
      authorization_endpoint: `${base}/`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["read", "prepare"],
      token_endpoint_auth_methods_supported: ["none"],
      note: "Prefer Authorization: Bearer orb_mcp_… from Orbit Security → MCP",
    });
  },
);

async function handleMcp(req: Request, res: Response): Promise<void> {
  const auth = req.mcpAuth;
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Hosts sometimes send Accept that confuses older stacks — ensure JSON path works
  res.setHeader("X-Orbit-MCP", "1");

  const server = createOrbitMcpServer(auth);
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (err) {
    logger.error({ err }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP error" },
        id: null,
      });
    }
  }
}

function mountMcpPaths(router: IRouter, path: string) {
  router.options(path, (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, X-Api-Key, X-Orbit-Mcp-Key",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.status(204).end();
  });
  router.post(path, mcpAuthMiddleware, (req, res) => {
    void handleMcp(req, res);
  });
  router.get(path, mcpAuthMiddleware, (req, res) => {
    void handleMcp(req, res);
  });
  router.delete(path, mcpAuthMiddleware, (_req, res): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Orbit MCP is stateless; DELETE sessions are not used.",
      },
      id: null,
    });
  });
}

mountMcpPaths(mcpHttpRouter, "/mcp");
mountMcpPaths(mcpHttpRouter, "/api/mcp");

/** Key management for logged-in Orbit users (browser session). */
export const mcpKeysRouter: IRouter = Router();

mcpKeysRouter.get("/mcp/keys", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const keys = await listMcpApiKeys(userId);
    res.json({
      keys,
      connectorUrl: `${publicMcpBaseUrl()}/mcp`,
      alternateUrl: `${publicMcpBaseUrl()}/api/mcp`,
      scopesAvailable: ["read", "prepare"],
      oauth: mcpOAuthAvailable(),
      note: "PayBox-style: add the connector URL in Claude/ChatGPT (OAuth). Connections appear after Allow.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to list MCP keys" });
  }
});

mcpKeysRouter.post("/mcp/keys", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  try {
    const scopes = sanitizeScopes(
      parseScopes(req.body?.scopes) as McpScope[],
    );
    const created = await createMcpApiKey({
      userId,
      label: typeof req.body?.label === "string" ? req.body.label : undefined,
      scopes,
      bindPublicKey:
        typeof req.body?.bindPublicKey === "string"
          ? req.body.bindPublicKey
          : null,
      expiresInDays:
        typeof req.body?.expiresInDays === "number"
          ? req.body.expiresInDays
          : undefined,
    });
    res.status(201).json({
      id: created.id,
      keyPrefix: created.keyPrefix,
      scopes: created.scopes,
      bindPublicKey: created.bindPublicKey,
      expiresAt: created.expiresAt,
      apiKey: created.rawKey,
      connectorUrl: `${publicMcpBaseUrl()}/mcp`,
      alternateUrl: `${publicMcpBaseUrl()}/api/mcp`,
      note: "PayBox-style: add https://orbitpilot.vercel.app/mcp in Claude/ChatGPT — OAuth signs you in. No key to paste.",
      howToConnect: {
        step1: "Copy connector URL: https://orbitpilot.vercel.app/mcp",
        claude: "Settings → Connectors → Add custom connector → paste URL → Connect (OAuth)",
        chatgpt:
          "Developer mode → Plugins → New → Server URL → Authentication: OAuth → Connect",
      },
      warning:
        "Orbit MCP never signs. Revoke AI access anytime via DELETE /api/mcp/keys/:id",
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to create MCP key" });
  }
});

mcpKeysRouter.delete("/mcp/keys/:id", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid key id" });
    return;
  }
  try {
    const ok = await revokeMcpApiKey(userId, id);
    if (!ok) {
      res.status(404).json({ error: "Key not found or already revoked" });
      return;
    }
    res.json({ ok: true, revokedId: id });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to revoke key" });
  }
});

mcpKeysRouter.get("/mcp/actions/:publicId", async (req, res): Promise<void> => {
  try {
    const {
      getPendingMcpAction,
      verifyEmbedToken,
      sessionOwnsPendingAction,
    } = await import("../lib/mcp-actions");
    const publicId = String(req.params.publicId);
    const row = await getPendingMcpAction(publicId);
    if (!row) {
      res.status(404).json({ error: "Action not found" });
      return;
    }
    const userId = (req as Request & { userId?: number }).userId;
    const et =
      typeof req.query.et === "string"
        ? req.query.et
        : typeof req.headers["x-orbit-embed-token"] === "string"
          ? req.headers["x-orbit-embed-token"]
          : null;
    const embedOk = Boolean(et && verifyEmbedToken(publicId, et));
    if (et && !embedOk) {
      res.status(403).json({ error: "Invalid or expired embed token" });
      return;
    }
    const sessionOk =
      typeof userId === "number" &&
      (await sessionOwnsPendingAction(userId, {
        userId: row.userId,
        walletPublicKey: row.walletPublicKey,
      }));
    if (!embedOk && !sessionOk) {
      res.status(401).json({ error: "Embed token or Orbit session required" });
      return;
    }
    // Never echo userId to browser unnecessarily
    const { userId: _uid, ...safe } = row;
    res.json(safe);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load action" });
  }
});

mcpKeysRouter.post(
  "/mcp/actions/:publicId/complete",
  async (req, res): Promise<void> => {
    try {
      const {
        completePendingMcpAction,
        getPendingMcpAction,
        verifyEmbedToken,
        sessionOwnsPendingAction,
        isValidStellarTxHash,
      } = await import("../lib/mcp-actions");
      const publicId = String(req.params.publicId);
      const existing = await getPendingMcpAction(publicId);
      if (!existing) {
        res.status(404).json({ error: "Action not found" });
        return;
      }
      const userId = (req as Request & { userId?: number }).userId;
      const et =
        typeof req.body?.embedToken === "string"
          ? req.body.embedToken
          : typeof req.headers["x-orbit-embed-token"] === "string"
            ? req.headers["x-orbit-embed-token"]
            : typeof req.query.et === "string"
              ? req.query.et
              : null;
      const embedOk = Boolean(et && verifyEmbedToken(publicId, et));
      if (et && !embedOk) {
        res.status(403).json({ error: "Invalid or expired embed token" });
        return;
      }
      const sessionOk =
        typeof userId === "number" &&
        (await sessionOwnsPendingAction(userId, {
          userId: existing.userId,
          walletPublicKey: existing.walletPublicKey,
        }));
      if (!embedOk && !sessionOk) {
        res.status(401).json({
          error: "Valid embed token or owning Orbit session required",
        });
        return;
      }

      const txHash =
        typeof req.body?.txHash === "string" ? req.body.txHash.trim() : null;
      const error =
        typeof req.body?.error === "string" ? req.body.error : null;
      if (txHash && !error && !isValidStellarTxHash(txHash)) {
        res.status(400).json({ error: "Invalid transaction hash format" });
        return;
      }

      const updated = await completePendingMcpAction(publicId, {
        txHash,
        error,
        userId: sessionOk ? userId! : null,
        authorized: true,
      });
      if (updated) {
        const { userId: _uid, ...safe } = updated;
        res.json(safe);
      } else {
        res.json(updated);
      }
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? "Failed to complete action" });
    }
  },
);

export default mcpHttpRouter;
