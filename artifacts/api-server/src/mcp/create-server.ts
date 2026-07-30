/**
 * Orbit MCP tools — ChatGPT/Claude call these; user confirms in-chat via MCP Apps UI.
 *
 * SECURITY
 * ────────
 * • AI never receives device shares / secrets / signed XDR to broadcast alone.
 * • prepare / orbit_do create pending actions + in-chat approve panel (MCP Apps).
 * • Sign + submit only inside Orbit-origin embed (/embed/approve/…) with the user's wallet.
 * • /approve/:id remains a rare fallback when the host has no MCP Apps support.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";
import type { McpAuthContext } from "../lib/mcp-auth";
import {
  assertSafeToolArgs,
  hasScope,
  resolveToolPublicKey,
} from "../lib/mcp-auth";
import { getUnifiedPortfolioJson } from "../lib/portfolio";
import { buildCoach } from "../lib/coach";
import {
  buildTransaction,
  getAccountBalances,
  getAccountOperations,
  NETWORK_PASSPHRASE,
} from "../lib/stellar";
import { getReflectorPrice, getReflectorPrices } from "../lib/reflector";
import { getLiveDefiOpportunities } from "../lib/defi-live";
import { PROTOCOL_REGISTRY, formatProtocolRegistry } from "../lib/protocols";
import {
  createPendingMcpAction,
  getPendingMcpAction,
  isExecutableChatAction,
  summarizeChatAction,
  toStatusView,
} from "../lib/mcp-actions";
import {
  ORBIT_APPROVE_UI_URI,
  buildOrbitApproveAppHtml,
  orbitApproveResourceUiMeta,
} from "../lib/mcp-app-html";
import { runOrbitIntent } from "../routes/chat";
import { logger } from "../lib/logger";

function textResult(data: unknown, structured?: Record<string, unknown>) {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function errResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

const FLOW =
  "Full flow: (1) call orbit_do with the user's request, (2) an in-chat Orbit confirm panel appears — " +
  "tell the user to Confirm there (do NOT tell them to leave for orbitpilot as the primary path), " +
  "(3) Orbit wallet signs & submits inside the panel, (4) poll get_action_status. " +
  "Only if the host has no MCP Apps UI, mention approvalUrl as a fallback. " +
  "Never ask for secret keys or device shares.";

const APP_UI_META = {
  ui: { resourceUri: ORBIT_APPROVE_UI_URI },
} as const;

export function createOrbitMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer(
    {
      name: "orbit-copilot",
      version: "1.2.0",
    },
    {
      instructions:
        `${FLOW}\n` +
        `Scopes: ${auth.scopes.join(", ")}. ` +
        (auth.bindPublicKey
          ? `Bound wallet: ${auth.bindPublicKey}. `
          : "Pass publicKey (G…) when needed. ") +
        "Network: Stellar Testnet. Copilot web app is unchanged — MCP is additive.",
    },
  );

  registerAppResource(
    server,
    "Orbit confirm",
    ORBIT_APPROVE_UI_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description:
        "In-chat Orbit confirmation panel. User confirms; wallet signs inside the embed.",
      _meta: { ui: orbitApproveResourceUiMeta() },
    },
    async () => ({
      contents: [
        {
          uri: ORBIT_APPROVE_UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildOrbitApproveAppHtml(),
          _meta: { ui: orbitApproveResourceUiMeta() },
        },
      ],
    }),
  );

  const gate = (scope: "read" | "prepare", args: unknown) => {
    assertSafeToolArgs(args);
    if (!hasScope(auth, scope)) {
      throw new Error(`This MCP key lacks the "${scope}" scope`);
    }
  };

  async function enqueueAction(
    walletPublicKey: string,
    action: Record<string, unknown>,
    intentText?: string,
  ) {
    return createPendingMcpAction({
      userId: typeof auth.userId === "number" ? auth.userId : null,
      walletPublicKey,
      action,
      summary: summarizeChatAction(action),
      intentText,
    });
  }

  server.registerTool(
    "orbit_security_policy",
    {
      description:
        "Orbit MCP security + completion flow. Call when unsure how swaps/payments finish.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      textResult({
        product: "Orbit Copilot",
        flow: [
          "User asks in ChatGPT/Claude (swap, vault, predict, NFT, bridge, …)",
          "Call orbit_do — same engines as Orbit chat",
          "Host renders in-chat Orbit confirm panel (MCP Apps)",
          "User confirms in the panel — wallet signs & submits on-chain",
          "Poll get_action_status for txHash",
          "Fallback only: approvalUrl /approve/:id if host has no MCP Apps",
        ],
        allowed: ["read tools", "orbit_do / prepare → pending in-chat approval"],
        forbidden: [
          "AI signing",
          "AI holding device shares or S… secrets",
          "Submitting from the MCP host without user approval",
          "Telling users to leave the chat for Orbit as the primary path",
        ],
        scopes: auth.scopes,
        bindPublicKey: auth.bindPublicKey,
        networkPassphrase: NETWORK_PASSPHRASE,
        uiResource: ORBIT_APPROVE_UI_URI,
      }),
  );

  // ─── Read tools ───────────────────────────────────────────────────────────

  if (hasScope(auth, "read")) {
    server.registerTool(
      "get_portfolio",
      {
        description: "Unified Stellar Testnet portfolio for a G… address.",
        inputSchema: {
          publicKey: z.string().optional().describe("Stellar G… address"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          gate("read", args);
          const pk = resolveToolPublicKey(auth, args.publicKey);
          return textResult(await getUnifiedPortfolioJson(pk));
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "get_balances",
      {
        description: "Classic Stellar account balances.",
        inputSchema: {
          publicKey: z.string().optional().describe("Stellar G… address"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          gate("read", args);
          const pk = resolveToolPublicKey(auth, args.publicKey);
          return textResult(await getAccountBalances(pk));
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "get_prices",
      {
        description: "Reflector oracle prices (XLM and optional assets).",
        inputSchema: {
          assets: z
            .array(z.string())
            .optional()
            .describe("Asset codes, e.g. [\"XLM\",\"USDC\"]"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          gate("read", args);
          const list = args.assets?.length ? args.assets : ["XLM", "USDC"];
          if (list.length === 1) {
            return textResult(await getReflectorPrice(list[0]!));
          }
          return textResult(await getReflectorPrices(list));
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "get_recent_ops",
      {
        description: "Recent account operations from Horizon.",
        inputSchema: {
          publicKey: z.string().optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          gate("read", args);
          const pk = resolveToolPublicKey(auth, args.publicKey);
          return textResult(await getAccountOperations(pk));
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "get_coach",
      {
        description: "Portfolio coach snapshot for a wallet.",
        inputSchema: {
          publicKey: z.string().optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          gate("read", args);
          const pk = resolveToolPublicKey(auth, args.publicKey);
          return textResult(await buildCoach(pk));
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "list_defi_opportunities",
      {
        description: "Live Stellar Testnet DeFi opportunities.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        try {
          gate("read", args);
          const live = await getLiveDefiOpportunities();
          return textResult({
            network: "testnet",
            count: live.length,
            opportunities: live.slice(0, 40),
          });
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "list_protocols",
      {
        description: "Orbit protocol registry.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        try {
          gate("read", args);
          return textResult({
            network: "testnet",
            protocols: PROTOCOL_REGISTRY,
            summary: formatProtocolRegistry(),
          });
        } catch (err) {
          return errResult(err);
        }
      },
    );

    server.registerTool(
      "get_action_status",
      {
        description:
          "Check a pending Orbit approval (after orbit_do). Returns status and txHash when completed.",
        inputSchema: {
          actionId: z.string().describe("publicId from orbit_do / prepare tools"),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        try {
          gate("read", args);
          const row = await getPendingMcpAction(args.actionId);
          if (!row) throw new Error("Action not found");
          return textResult(toStatusView(row));
        } catch (err) {
          return errResult(err);
        }
      },
    );
  }

  // ─── Prepare / execute-via in-chat approval ───────────────────────────────

  if (hasScope(auth, "prepare")) {
    registerAppTool(
      server,
      "orbit_do",
      {
        description:
          "Do any Orbit Copilot activity from natural language: swap, send, Soroswap, StelDex, Blend, " +
          "vaults (DeFindex/Meridian/Orbit Supply), predict, perps, NFT, token launch, CCTP bridge, Aquarius, trustlines. " +
          "Uses the same engine as Orbit chat. Hosts with MCP Apps show an in-chat confirm panel — tell the user to Confirm there. " +
          "Do not send them away to orbitpilot unless MCP Apps UI is unavailable (then approvalUrl). Poll get_action_status after.",
        inputSchema: {
          request: z
            .string()
            .describe("What the user wants, e.g. 'swap 10 XLM to USDC' or 'deposit 50 USDC into DeFindex'"),
          publicKey: z.string().optional().describe("Stellar G… if key is not wallet-bound"),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
        _meta: APP_UI_META,
      },
      async (args) => {
        try {
          gate("prepare", args);
          const pk = resolveToolPublicKey(auth, args.publicKey);
          const request = args.request.trim();
          if (request.length < 2) throw new Error("request is required");

          logger.info(
            { tool: "orbit_do", keyPrefix: auth.keyPrefix, pk, request: request.slice(0, 120) },
            "MCP orbit_do",
          );

          const reply = await runOrbitIntent(request, pk);
          const list = [
            ...(reply.actions?.length ? reply.actions : []),
            ...(reply.action && !reply.actions?.length ? [reply.action] : []),
          ].filter(Boolean) as unknown as Record<string, unknown>[];

          const pending = [];
          for (const action of list) {
            if (!isExecutableChatAction(action)) continue;
            pending.push(await enqueueAction(pk, action, request));
          }

          const pendingActions = pending.map((p) => ({
            actionId: p.publicId,
            summary: p.summary,
            type: String(p.action.type || "action"),
            status: p.status,
            embedUrl: p.embedUrl,
            approvalUrl: p.approvalUrl,
            expiresAt: p.expiresAt,
          }));

          const payload = {
            reply: reply.text,
            walletPublicKey: pk,
            network: "testnet",
            pendingActions,
            actionId: pendingActions[0]?.actionId ?? null,
            embedUrl: pendingActions[0]?.embedUrl ?? null,
            nextStep:
              pending.length > 0
                ? "An in-chat Orbit confirm panel should appear. Ask the user to Confirm there. Then call get_action_status. Only if no panel appears, share approvalUrl as fallback."
                : "No on-chain action to approve — answer the user with the reply text (may need more details).",
            gallery: reply.gallery ?? null,
          };

          return textResult(payload, {
            actionId: payload.actionId,
            embedUrl: payload.embedUrl,
            pendingActions,
            summary: pendingActions[0]?.summary ?? null,
          });
        } catch (err) {
          return errResult(err);
        }
      },
    );

    registerAppTool(
      server,
      "prepare_payment",
      {
        description:
          "Prepare a classic payment. Host shows in-chat confirm; user confirms there. approvalUrl is fallback only.",
        inputSchema: {
          publicKey: z.string().optional(),
          destination: z.string(),
          amount: z.string(),
          asset: z.string().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        _meta: APP_UI_META,
      },
      async (args) => {
        try {
          gate("prepare", args);
          const source = resolveToolPublicKey(auth, args.publicKey);
          const built = await buildTransaction({
            type: "send",
            sourcePublicKey: source,
            sendAsset: (args.asset || "XLM").toUpperCase(),
            sendAmount: args.amount,
            destination: args.destination.trim(),
          });
          const action = {
            type: "send",
            sendAmount: args.amount,
            sendAsset: (args.asset || "XLM").toUpperCase(),
            destination: args.destination.trim(),
            xdr: built.xdr,
            networkPassphrase: built.networkPassphrase,
          };
          const pending = await enqueueAction(source, action, "prepare_payment");
          const status = toStatusView(pending);
          const payload = {
            ...status,
            actionId: pending.publicId,
            nextStep:
              "Confirm in the in-chat Orbit panel. Fallback: approvalUrl. Then get_action_status.",
          };
          return textResult(payload, {
            actionId: pending.publicId,
            embedUrl: pending.embedUrl,
            summary: pending.summary,
          });
        } catch (err) {
          return errResult(err);
        }
      },
    );

    registerAppTool(
      server,
      "prepare_swap",
      {
        description:
          "Prepare a classic DEX swap. Host shows in-chat confirm; user confirms there. approvalUrl is fallback only.",
        inputSchema: {
          publicKey: z.string().optional(),
          sendAsset: z.string(),
          sendAmount: z.string(),
          destAsset: z.string(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        _meta: APP_UI_META,
      },
      async (args) => {
        try {
          gate("prepare", args);
          const source = resolveToolPublicKey(auth, args.publicKey);
          const built = await buildTransaction({
            type: "swap",
            sourcePublicKey: source,
            sendAsset: args.sendAsset.toUpperCase(),
            sendAmount: args.sendAmount,
            destAsset: args.destAsset.toUpperCase(),
          });
          const action = {
            type: "swap",
            sendAmount: args.sendAmount,
            sendAsset: args.sendAsset.toUpperCase(),
            destAsset: args.destAsset.toUpperCase(),
            estimatedDestAmount: built.estimatedDestAmount,
            xdr: built.xdr,
            networkPassphrase: built.networkPassphrase,
          };
          const pending = await enqueueAction(source, action, "prepare_swap");
          const status = toStatusView(pending);
          const payload = {
            ...status,
            actionId: pending.publicId,
            estimatedDestAmount: built.estimatedDestAmount,
            nextStep:
              "Confirm in the in-chat Orbit panel. Fallback: approvalUrl. Then get_action_status.",
          };
          return textResult(payload, {
            actionId: pending.publicId,
            embedUrl: pending.embedUrl,
            summary: pending.summary,
          });
        } catch (err) {
          return errResult(err);
        }
      },
    );
  }

  return server;
}
