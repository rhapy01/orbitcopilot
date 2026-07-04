import { logger } from "./logger";
import {
  formatUnifiedPortfolio,
  formatEarningReport,
  formatRebalancePlan,
} from "./portfolio";
import { formatLiveDefiCatalog } from "./defi-live";
import {
  formatRecentActivity,
  formatMarketOverview,
  formatEcosystemOverview,
  formatSteldexPools,
} from "./chat-tools";
import { formatSteldexHoldings } from "./steldex";
import { formatAquariusPools, formatAquariusQuote } from "./aquarius";
import { formatBlendMarkets } from "./blend";
import { formatSoroswapStatus, formatSoroswapPositions } from "./soroswap";
import { formatReflectorPrices } from "./reflector";
import { formatProtocolRegistry } from "./protocols";
import { fundWithFriendbot } from "./friendbot";
import { timed } from "./metrics";
import { enrichChatAction } from "./enrich-action";

export function llmConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY?.trim() ||
      process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.LLM_API_KEY?.trim()
  );
}

function llmConfig() {
  const openRouter = process.env.OPENROUTER_API_KEY?.trim();
  const openai = process.env.OPENAI_API_KEY?.trim();
  const generic = process.env.LLM_API_KEY?.trim();
  if (openRouter) {
    return {
      provider: "openrouter" as const,
      apiKey: openRouter,
      baseUrl: "https://openrouter.ai/api/v1",
      model: process.env.LLM_MODEL?.trim() || "openai/gpt-4o-mini",
    };
  }
  if (openai || generic) {
    return {
      provider: "openai" as const,
      apiKey: (openai || generic)!,
      baseUrl: process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
      model: process.env.LLM_MODEL?.trim() || "gpt-4o-mini",
    };
  }
  return null;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_portfolio",
      description:
        "Full portfolio intelligence: earning vs idle positions, farms, LP, wallet, and rebalance plan",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_earning_report",
      description: "What is earning yield vs idle capital only",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rebalance_plan",
      description:
        "Suggested moves: stake idle LP, supply idle USDC, deploy idle XLM, claim rewards — with chat commands",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_activity",
      description: "Recent on-chain activity for the wallet",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_yield",
      description: "Live DeFi opportunities on testnet",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_markets",
      description: "Market / price snapshot",
      parameters: {
        type: "object",
        properties: { asset: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ecosystem",
      description: "List integrated protocols and status",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_steldex",
      description: "StelDex pools or user positions",
      parameters: {
        type: "object",
        properties: { positions: { type: "boolean" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_blend",
      description: "Blend lending markets",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_aquarius",
      description: "Aquarius AMM pools on testnet",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "aquarius_quote",
      description: "Live Aquarius find-path quote (XLM, USDC, AQUA)",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "string" },
          fromAsset: { type: "string" },
          toAsset: { type: "string" },
        },
        required: ["amount", "fromAsset", "toAsset"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reflector_prices",
      description: "Reflector oracle prices (with Horizon fallback)",
      parameters: {
        type: "object",
        properties: {
          symbols: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fund_wallet",
      description: "Fund the connected wallet with testnet XLM via Friendbot",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_soroswap",
      description: "Soroswap aggregator status or LP positions",
      parameters: {
        type: "object",
        properties: { positions: { type: "boolean" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_action",
      description:
        "Propose a structured on-chain action for the user to sign. Prefer exact amounts and asset codes.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "send",
              "swap",
              "soroswap_swap",
              "soroswap_add_liquidity",
              "soroswap_remove_liquidity",
              "steldex_swap",
              "steldex_add_liquidity",
              "steldex_remove_liquidity",
              "steldex_stake",
              "steldex_unstake",
              "steldex_claim",
              "blend_supply",
              "blend_withdraw",
              "blend_borrow",
              "blend_repay",
            ],
          },
          sendAmount: { type: "string" },
          sendAsset: { type: "string" },
          destAsset: { type: "string" },
          destination: { type: "string" },
          amountB: { type: "string" },
          pair: { type: "string" },
          liquidity: { type: "string" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
];

async function runTool(
  name: string,
  args: Record<string, unknown>,
  publicKey: string | null
): Promise<string> {
  const needsWallet = [
    "get_portfolio",
    "get_earning_report",
    "get_rebalance_plan",
    "get_activity",
    "fund_wallet",
  ].includes(name);
  if (needsWallet && !publicKey) {
    return "Wallet not connected. Ask the user to connect Freighter on Testnet.";
  }
  if (name === "get_steldex" && args.positions && !publicKey) {
    return "Wallet not connected. Ask the user to connect Freighter on Testnet.";
  }
  if (name === "get_soroswap" && args.positions && !publicKey) {
    return "Wallet not connected. Ask the user to connect Freighter on Testnet.";
  }

  switch (name) {
    case "get_portfolio":
      return formatUnifiedPortfolio(publicKey!);
    case "get_earning_report":
      return formatEarningReport(publicKey!);
    case "get_rebalance_plan":
      return formatRebalancePlan(publicKey!);
    case "get_activity":
      return formatRecentActivity(publicKey!);
    case "get_yield":
      return formatLiveDefiCatalog();
    case "get_markets":
      return formatMarketOverview(typeof args.asset === "string" ? args.asset : undefined);
    case "get_ecosystem":
      return formatProtocolRegistry() + "\n\n" + (await formatEcosystemOverview());
    case "get_steldex":
      return args.positions ? formatSteldexHoldings(publicKey!) : formatSteldexPools();
    case "get_blend":
      return formatBlendMarkets();
    case "get_aquarius":
      return formatAquariusPools();
    case "aquarius_quote":
      return formatAquariusQuote(
        String(args.fromAsset),
        String(args.toAsset),
        String(args.amount)
      );
    case "get_reflector_prices":
      return formatReflectorPrices(
        Array.isArray(args.symbols) ? (args.symbols as string[]) : undefined
      );
    case "fund_wallet": {
      const result = await fundWithFriendbot(publicKey!);
      return result.message;
    }
    case "get_soroswap":
      return args.positions
        ? formatSoroswapPositions(publicKey!)
        : formatSoroswapStatus();
    case "propose_action":
      return JSON.stringify({ action: args });
    default:
      return `Unknown tool ${name}`;
  }
}

function actionSummary(action: Record<string, unknown>): string {
  const type = String(action.type ?? "action");
  const amount = action.sendAmount ? `${action.sendAmount} ` : "";
  const asset = action.sendAsset ?? "";
  const dest = action.destAsset ? ` → ${action.destAsset}` : "";
  const to = action.destination
    ? ` to ${String(action.destination).slice(0, 6)}…`
    : "";
  return `I've prepared **${type.replace(/_/g, " ")}** ${amount}${asset}${dest}${to}. Review the card below and sign with Freighter (Testnet).`;
}

export async function runLlmCopilot(
  userMessage: string,
  publicKey: string | null
): Promise<{ text: string; action: Record<string, unknown> | null } | null> {
  const cfg = llmConfig();
  if (!cfg) return null;

  const system = [
    "You are Orbit Copilot on Stellar Testnet only.",
    "Use tools for portfolio, yield, markets, and protocol status.",
    "For sends/swaps/lend/borrow/LP, call propose_action with structured fields (amounts as strings).",
    "Asset codes: XLM, USDC (classic/Soroswap), pUSDC (StelDex), BLND (Blend).",
    "Orbit also has prediction markets and perpetuals — use get_portfolio for positions.",
    "For predictions/perps, tell the user the exact chat command (invest … / open a … USDC long …).",
    "Never invent transaction hashes. Never ask for secret keys.",
    "Be concise and actionable.",
    publicKey ? `User wallet: ${publicKey}` : "User has not connected a wallet yet.",
  ].join(" ");

  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: userMessage },
  ];

  let action: Record<string, unknown> | null = null;
  const toolNotes: string[] = [];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL?.trim() || "https://orbit-copilot.local";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME?.trim() || "Orbit Copilot";
  }

  try {
    for (let round = 0; round < 5; round++) {
      const res = await timed("llm.chat", () =>
        fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: cfg.model,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.2,
          }),
        })
      );

      if (!res.ok) {
        const errText = await res.text();
        logger.warn({ status: res.status, errText: errText.slice(0, 500) }, "LLM request failed");
        return null;
      }

      const data: any = await res.json();
      const choice = data.choices?.[0]?.message;
      if (!choice) return null;

      const toolCalls = choice.tool_calls;
      if (!toolCalls?.length) {
        const text = choice.content?.trim();
        if (action) {
          const enriched = await enrichChatAction(action);
          return {
            text: text || actionSummary(enriched ?? action),
            action: enriched ?? action,
          };
        }
        if (toolNotes.length && !text) {
          return { text: toolNotes.join("\n\n"), action: null };
        }
        return text ? { text, action: null } : null;
      }

      messages.push(choice);

      for (const call of toolCalls) {
        const name = call.function?.name as string;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }

        if (name === "propose_action") {
          action = { ...args };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Action accepted. Tell the user to review and sign the card in the UI.",
          });
          continue;
        }

        const result = await runTool(name, args, publicKey);
        toolNotes.push(result);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.slice(0, 8000),
        });
      }

      // If we only proposed an action, one more turn for a short confirmation is enough
      if (action && toolCalls.every((c: any) => c.function?.name === "propose_action")) {
        const enriched = await enrichChatAction(action);
        return {
          text: actionSummary(enriched ?? action),
          action: enriched ?? action,
        };
      }
    }

    if (action) {
      const enriched = await enrichChatAction(action);
      return {
        text: actionSummary(enriched ?? action),
        action: enriched ?? action,
      };
    }
    if (toolNotes.length) {
      return { text: toolNotes.join("\n\n"), action: null };
    }
    return null;
  } catch (err) {
    logger.error({ err }, "LLM copilot failed");
    return null;
  }
}
