import { logger } from "./logger";
import {
 formatUnifiedPortfolio,
 formatEarningReport,
 formatRebalancePlan,
} from "./portfolio";
import { fetchWalletBalances } from "./wallet-data";
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
import { formatCoachBriefForLlm } from "./coach";
import {
 formatKnowledgeForTool,
 searchKnowledge,
} from "./knowledge-rag";
import { tryConceptAnswer, lookupConcept, formatConcept, compareConcepts } from "./concept-graph";
import {
 formatIlAnswer,
 calculateHealthFactor,
 formatHealthAnswer,
 formatAprApyAnswer,
} from "./defi-math";
import { formatBlendHealthReport } from "./blend-health";
import { networkSystemBlurb } from "./network-mode";

export type LlmHistoryTurn = { role: "user" | "assistant"; content: string };

export type LlmCopilotOptions = {
 /** Prior session turns (excluding the current user message). */
 history?: LlmHistoryTurn[];
};

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
 name: "get_wallet_balances",
 description:
 "Wallet token balances on Stellar testnet (classic Horizon + StelDex). USDC and cUSDC are the same Circle asset - usable on Blend's live pool, StelDex, and Perps. pUSDC is different (StelDex only). Pass asset for one token; omit asset to list all.",
 parameters: {
 type: "object",
 properties: {
 asset: {
 type: "string",
 description:
 "Single asset code e.g. XLM, USDC, pUSDC, EURC. Prefer USDC over cUSDC. Omit when user asks for all assets/balances.",
 },
 hoursAgo: {
 type: "number",
 description: "If user asks balance N hours ago (XLM only), pass N.",
 },
 },
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "get_portfolio",
 description:
 "ONLY when user explicitly asks for full portfolio, all positions, LP, farms, lending, or rebalance context - NOT for a single asset wallet balance",
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
 "Suggested moves: stake idle LP, supply idle USDC, deploy idle XLM, claim rewards - with chat commands",
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
 name: "list_prediction_markets",
 description:
 "List Orbit Predict markets (sports / crypto / all). Use before proposing a predict_bet. If multiple markets match the user's teams, list them and ask which timeframe - never invent market IDs.",
 parameters: {
 type: "object",
 properties: {
 category: {
 type: "string",
 enum: ["sports", "crypto", "all"],
 description: "Filter category; default all",
 },
 },
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "propose_action",
 description:
 "Propose one on-chain action card. Call multiple times in one turn for multi-action prompts (e.g. swap to A, B, C each = one propose_action per destination). For predict_bet, marketHint must be an exact slug from list_prediction_markets. Prefer exact amounts and asset codes. For add_liquidity: sendAmount/sendAsset is the user-stated Token A; destAsset is Token B. If the user only gave one amount, set amountB to AUTO (Orbit sizes the other side from the live pool ratio — do NOT copy the same number onto both assets).",
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
 "blend_claim",
 "blend_usdc_swap",
 "predict_bet",
 "predict_claim",
 "perp_open",
 "perp_close",
 "nft_mint",
 "nft_list",
 "nft_buy",
 "nft_transfer",
 "nft_cancel",
 "nft_create_collection",
 "token_deploy",
 "token_mint",
 "orbit_supply_deposit",
 "orbit_supply_withdraw",
 "orbit_supply_claim",
 ],
 },
 sendAmount: { type: "string", description: "Amount of Token A (or the send/swap input amount). For one-sided LP, this is the amount the user named." },
 sendAsset: { type: "string", description: "Asset code for Token A (e.g. XLM, pUSDC, USDC). Must match the asset the user amount applies to." },
 destAsset: { type: "string", description: "Asset code for Token B or swap output (e.g. pUSDC, XLM)" },
 destination: { type: "string" },
 amountB: { type: "string", description: "Amount of Token B for add_liquidity. Use AUTO when the user only specified one side (Orbit calculates from pool ratio). Never set amountB equal to sendAmount just because only one amount was given." },
 pair: { type: "string", description: "Pool pair string e.g. XLM/pUSDC" },
 liquidity: { type: "string" },
 marketHint: { type: "string", description: "Prediction market slug or perp symbol (btc, eth, xlm)" },
 outcome: { type: "string", description: "yes or no for prediction bet/claim" },
 positionId: { type: "string", description: "Perp position id or NFT token id" },
 leverage: { type: "number", description: "Perp leverage multiplier" },
 side: { type: "string", description: "long or short for perps" },
 },
 required: ["type"],
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "search_knowledge",
 description:
 "Search Orbit's DeFi / blockchain / CeFi knowledge base. Use for explain/teach questions: what is DeFi, staking vs LP, impermanent loss, bridges, CEX, oracles, Stellar concepts, risk, etc. Always cite the returned Sources in your reply.",
 parameters: {
 type: "object",
 properties: {
 query: {
 type: "string",
 description: "Search query - the concept or question to look up",
 },
 },
 required: ["query"],
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "explain_concept",
 description:
 "Look up a structured concept from Orbit's concept graph (staking, LP, farming, lending, CeFi, bridges, IL, etc.). Prefer for X vs Y and precise definitions. Pass conceptA alone, or conceptA+conceptB to compare.",
 parameters: {
 type: "object",
 properties: {
 conceptA: { type: "string" },
 conceptB: { type: "string", description: "Optional second concept for comparison" },
 },
 required: ["conceptA"],
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "calculate_il",
 description:
 "Calculate impermanent loss for a 50/50 constant-product AMM given a price ratio (new/old). Example: doubles → priceRatio 2; halves → 0.5; +50% → 1.5.",
 parameters: {
 type: "object",
 properties: {
 priceRatio: {
 type: "number",
 description: "P1/P0 relative price of one asset vs the other",
 },
 },
 required: ["priceRatio"],
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "calculate_health_factor",
 description:
 "Educational health factor / LTV from collateral USD, debt USD, and optional liquidation threshold (default 0.75). For live Blend wallet positions use get_blend_health.",
 parameters: {
 type: "object",
 properties: {
 collateralUsd: { type: "number" },
 debtUsd: { type: "number" },
 threshold: { type: "number", description: "Liquidation threshold 0-1, default 0.75" },
 },
 required: ["collateralUsd", "debtUsd"],
 additionalProperties: false,
 },
 },
 },
 {
 type: "function",
 function: {
 name: "get_blend_health",
 description:
 "Estimate educational health factor from the connected wallet's live Blend supply/borrow positions",
 parameters: { type: "object", properties: {}, additionalProperties: false },
 },
 },
 {
 type: "function",
 function: {
 name: "convert_apr_apy",
 description: "Convert an APR percent to approximate APY with daily compounding",
 parameters: {
 type: "object",
 properties: {
 aprPercent: { type: "number", description: "APR as percent, e.g. 10 for 10%" },
 },
 required: ["aprPercent"],
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
 "get_wallet_balances",
 "get_portfolio",
 "get_earning_report",
 "get_rebalance_plan",
 "get_activity",
 "fund_wallet",
 "get_blend_health",
 ].includes(name);
 if (needsWallet && !publicKey) {
 return "Wallet not connected. Ask the user to connect Freighter or their Orbit embedded wallet.";
 }
 if (name === "get_steldex" && args.positions && !publicKey) {
 return "Wallet not connected. Ask the user to connect Freighter or their Orbit embedded wallet.";
 }
 if (name === "get_soroswap" && args.positions && !publicKey) {
 return "Wallet not connected. Ask the user to connect Freighter or their Orbit embedded wallet.";
 }

 switch (name) {
 case "get_wallet_balances": {
 const asset =
 typeof args.asset === "string" && args.asset.trim()
 ? args.asset.trim()
 : undefined;
 const hoursAgo =
 typeof args.hoursAgo === "number" && args.hoursAgo > 0
 ? args.hoursAgo
 : undefined;
 const data = await fetchWalletBalances(publicKey!, { asset, hoursAgo });
 return JSON.stringify(data);
 }
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
 case "list_prediction_markets": {
 const { formatPredictionMarkets } = await import("./predict");
 const cat =
 args.category === "sports" || args.category === "crypto" || args.category === "all"
 ? args.category
 : "all";
 return formatPredictionMarkets({ category: cat });
 }
 case "propose_action":
 return JSON.stringify({ action: args });
 case "search_knowledge": {
 const q =
 typeof args.query === "string" && args.query.trim()
 ? args.query.trim()
 : "";
 if (!q) return "Provide a non-empty query.";
 const concept = tryConceptAnswer(q);
 if (concept) return concept;
 const hits = searchKnowledge(q, { topK: 4, minScore: 1.0 });
 return formatKnowledgeForTool(hits);
 }
 case "explain_concept": {
 const a = typeof args.conceptA === "string" ? args.conceptA : "";
 const b = typeof args.conceptB === "string" ? args.conceptB : "";
 if (!a.trim()) return "Provide conceptA.";
 const left = lookupConcept(a);
 if (!left) return `No concept match for "${a}". Try staking, LP, farming, lending, DeFi, CEX, bridge, IL…`;
 if (b.trim()) {
 const right = lookupConcept(b);
 if (!right) return formatConcept(left);
 return compareConcepts(left, right);
 }
 return formatConcept(left);
 }
 case "calculate_il": {
 const ratio = typeof args.priceRatio === "number" ? args.priceRatio : NaN;
 const ans = formatIlAnswer(ratio);
 if (!ans) return "priceRatio must be a positive number (e.g. 2 for double, 0.5 for half).";
 return ans;
 }
 case "calculate_health_factor": {
 const h = calculateHealthFactor({
 collateralUsd: Number(args.collateralUsd),
 debtUsd: Number(args.debtUsd),
 threshold:
 typeof args.threshold === "number" ? args.threshold : undefined,
 });
 if (!h) return "Provide valid collateralUsd and debtUsd (>= 0).";
 return formatHealthAnswer(h);
 }
 case "get_blend_health":
 return formatBlendHealthReport(publicKey!);
 case "convert_apr_apy": {
 const apr =
 typeof args.aprPercent === "number" ? args.aprPercent : NaN;
 if (!Number.isFinite(apr)) return "Provide aprPercent as a number.";
 return formatAprApyAnswer(apr);
 }
 default:
 return `Unknown tool ${name}`;
 }
}

function actionSummary(action: Record<string, unknown>): string {
 const type = String(action.type ?? "action");
 const amount = action.sendAmount ? `${action.sendAmount} ` : "";
 const asset = action.sendAsset ?? "";
 const isLp =
  type === "steldex_add_liquidity" || type === "soroswap_add_liquidity";
 const dest = action.destAsset
  ? isLp
   ? action.amountB
    ? ` + ${action.amountB} ${action.destAsset}`
    : ` + ${action.destAsset}`
   : ` → ${action.destAsset}`
  : "";
 const to = action.destination
 ? ` to ${String(action.destination).slice(0, 6)}…`
 : "";
 return `I've prepared **${type.replace(/_/g, " ")}** ${amount}${asset}${dest}${to}. Review the card below and sign with your connected wallet.`;
}

export async function runLlmCopilot(
 userMessage: string,
 publicKey: string | null,
 opts: LlmCopilotOptions = {}
): Promise<{
 text: string;
 action: Record<string, unknown> | null;
 actions?: Record<string, unknown>[];
} | null> {
 const cfg = llmConfig();
 if (!cfg) return null;

 const coachBrief = publicKey
 ? await formatCoachBriefForLlm(publicKey).catch(() => null)
 : null;
 const betaNftBrief = publicKey
 ? await import("./product-store")
 .then((m) => m.formatBetaNftStatusForLlm(publicKey))
 .catch(() => null)
 : null;

 const systemParts = [
 "You are Orbit Copilot - a DeFi assistant on Stellar Testnet.",
 networkSystemBlurb(),
 "",
 "CRITICAL DeFi CONCEPTS - never confuse these three:",
 "1. STAKING (single asset): deposit one token to earn rewards. Example: stake BLND on Blend. No LP token needed.",
 "2. LIQUIDITY PROVISION: deposit TWO assets into a pool to earn trading fees (you get LP tokens back). Action type: steldex_add_liquidity. Users almost never know both amounts — Orbit auto-sizes from the live pool ratio. Rules: (a) amount + one asset, no pair (e.g. \"add 100 USDC to liquidity\") → ask ONLY which pair asset (XLM / pUSDC / etc). NEVER ask for a second amount. (b) amount + both assets (e.g. \"add 100 USDC and XLM\", \"supply 100 USDC + XLM\", \"100 USDC with XLM\") → propose_action with sendAmount/sendAsset = the stated amount+asset, destAsset = the other asset, amountB=AUTO. NEVER copy the same number onto both sides. (c) both amounts given → pass both as max caps (Orbit autocorrects to ratio).",
 "3. YIELD FARMING: take the LP tokens you received from liquidity provision and stake them in a farm to earn STELLAR rewards. This requires holding LP tokens first. Action type: steldex_stake.",
 "These are SEPARATE steps. A user cannot farm without first providing liquidity. If they ask to farm but have no LP, tell them to add liquidity first.",
 "",
 "RESPONSE RULES:",
 "Be concise. Answer what was asked, but proactively flag relevant context (idle capital, market moves on swaps).",
 "Use prior conversation turns for pronouns and follow-ups (e.g. \"that one\", \"do it\", \"the same asset\").",
 "Single asset balance → get_wallet_balances with that asset → one line reply.",
 "All balances → get_wallet_balances with NO asset → short bullet list.",
 "Full portfolio / LP / farms / lending / what's earning / rebalance → get_portfolio, get_earning_report, or get_rebalance_plan.",
 "Never call get_portfolio for a single-asset balance question.",
  "For on-chain actions (swap/LP/farm/lend/borrow/send/predict/perp/nft/orbit-supply) → call propose_action with amounts and asset codes. For LP, amountB may be AUTO.",
 "If the user wants a transaction but omitted the amount (e.g. \"swap XLM to USDC\", \"faucet USDC\", \"supply USDC on blend\"), ask how much to use — do NOT lecture about Friendbot. Friendbot already funds XLM on wallet create. For \"faucet USDC\" ask how many XLM to swap to USDC. Exception: for add_liquidity with a numeric amount but missing pair, ask only for the pair asset — never a second amount.",
 "Never propose_action without a numeric sendAmount (LP amountB=AUTO is allowed).",
 "When routing a swap, do NOT narrate venue fallbacks (\"Soroswap down, using classic DEX\") unless the user named that venue. Quiet default: \"Prepared swap: X → Y. Sign with your connected wallet.\"",
 "Explain / teach questions (what is DeFi, IL, CeFi vs DeFi, bridges, oracles, staking vs LP, Stellar concepts) → call search_knowledge or explain_concept first, then answer from the hits and cite Sources.",
 "Impermanent loss numbers → calculate_il. Health/LTV numbers → calculate_health_factor. Live Blend risk → get_blend_health. APR to APY → convert_apr_apy.",
 "Prediction: predict_bet / predict_claim with marketHint = exact slug. Call list_prediction_markets first for sports; if ambiguous (two Chelsea-Arsenal fixtures), ask which timeframe - never invent slugs. NFTs (SEP-50): nft_create_collection is multi-turn (name/supply → description/rarity → media URL or upload → action card). Also nft_mint / nft_list / nft_buy / nft_transfer / nft_cancel. Tokens: token_deploy / token_mint (classic asset + SAC).",
 "Orbit Supply yield: orbit_supply_deposit (USDC/pUSDC/EURC), orbit_supply_claim for \"claim my yield\". Rate 10 XLM per 1M staked per 24h. Not the same as Blend.",
 "Blend: blend_supply/withdraw/borrow/repay on the live testnet pool (Circle USDC + XLM + CETES + TESOURO). Wallet USDC IS valid for Blend - do not ask users to convert. Claim with blend_claim.",
 "Multi-action: for \"swap 200 XLM to pUSDC, cUSDC, EURC each\", call propose_action three times (200 XLM each destination).",
 "Beta tester NFT is ONE per wallet. Obey BETA NFT STATUS below - never keep saying claim/mint if already claimed.",
 "Perps: open/close only - SL/TP in the UI are not enforced on-chain yet. Prefer prediction markets for demos.",
 "Asset codes: XLM; USDC (Circle) = cUSDC - works for Blend, StelDex, Perps, Orbit Supply; pUSDC is StelDex-only (different).",
 "If user mentions idle funds or asks what to do → give a concrete recommendation based on current yields (and coach context below when present).",
 "Never invent transaction hashes. Never ask for private keys. Never invent protocol APYs - use tools.",
 publicKey
 ? `User wallet: ${publicKey}`
 : "User has not connected a wallet yet - remind them to connect Freighter or Orbit embedded wallet if they ask about balances or transactions.",
 ];

 if (betaNftBrief) {
 systemParts.push("", "BETA NFT STATUS (live):", betaNftBrief);
 }

 if (coachBrief) {
 systemParts.push(
 "",
 "PORTFOLIO COACH (live - prefer this when advising what to do next):",
 coachBrief
 );
 }

 const system = systemParts.join("\n");

 const history = (opts.history ?? [])
 .filter((t) => t.content?.trim())
 .slice(-8)
 .map((t) => ({
 role: t.role,
 content: t.content,
 }));

 const messages: any[] = [
 { role: "system", content: system },
 ...history,
 { role: "user", content: userMessage },
 ];

 let action: Record<string, unknown> | null = null;
 const actions: Record<string, unknown>[] = [];
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
 if (actions.length > 1) {
 const enrichedList = [];
 for (const a of actions.slice(0, 5)) {
 const enriched = await enrichChatAction(a, { publicKey });
 if (enriched) enrichedList.push(enriched);
 }
 return {
 text:
 text ||
 `Prepared ${enrichedList.length} actions. Sign one step at a time.`,
 action: enrichedList[0] ?? null,
 actions: enrichedList,
 };
 }
 if (action) {
 const enriched = await enrichChatAction(action, { publicKey });
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
 if (actions.length < 5) actions.push({ ...args });
 messages.push({
 role: "tool",
 tool_call_id: call.id,
 content:
 actions.length > 1
 ? `Action ${actions.length} accepted. User will sign one step at a time.`
 : "Action accepted. Tell the user to review and sign the card in the UI.",
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

 // If we only proposed action(s), return cards (skip extra LLM round for multi)
 if (
 (action || actions.length) &&
 toolCalls.every((c: any) => c.function?.name === "propose_action")
 ) {
 if (actions.length > 1) {
 const enrichedList = [];
 for (const a of actions.slice(0, 5)) {
 const enriched = await enrichChatAction(a, { publicKey });
 if (enriched) enrichedList.push(enriched);
 }
 return {
 text: `Prepared ${enrichedList.length} actions. Sign one step at a time.`,
 action: enrichedList[0] ?? null,
 actions: enrichedList,
 };
 }
 const enriched = await enrichChatAction(action!, { publicKey });
 return {
 text: actionSummary(enriched ?? action!),
 action: enriched ?? action,
 };
 }
 }

 if (actions.length > 1) {
 const enrichedList = [];
 for (const a of actions.slice(0, 5)) {
 const enriched = await enrichChatAction(a, { publicKey });
 if (enriched) enrichedList.push(enriched);
 }
 return {
 text: `Prepared ${enrichedList.length} actions. Sign one step at a time.`,
 action: enrichedList[0] ?? null,
 actions: enrichedList,
 };
 }
 if (action) {
 const enriched = await enrichChatAction(action, { publicKey });
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
