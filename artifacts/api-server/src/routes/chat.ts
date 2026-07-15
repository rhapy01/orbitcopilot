import { Router, type IRouter } from "express";
import {
 GetChatMessagesResponse,
 SendChatMessageBody,
 SendChatMessageResponse,
 DeleteChatMessageParams,
 ClearChatHistoryResponse,
} from "@workspace/api-zod";
import {
 clearChatMessages,
 createChatSession,
 deleteChatMessage,
 getChatSession,
 insertChatMessage,
 listChatMessages,
 listPriorChatTurns,
 listRecentSessions,
} from "../lib/chat-store";
import {
 STELDEX_FULL_RANGE,
 findRowForPair,
 formatSteldexHoldings,
 getSteldexFarmPools,
 getSteldexFarmPositions,
 getSteldexOrders,
 getSteldexSwapQuote,
 getSteldexTokenBalanceHuman,
 normalizeSteldexSymbol,
 resolveSteldexPool,
 resolveSteldexToken,
 steldexDecimals,
 toSteldexUnits,
 fromSteldexUnits,
 matchSteldexAddLiquidityAmounts,
} from "../lib/steldex";
import { wrapActionWithTrustlineIfNeeded } from "../lib/stellar";
import {
 CAPABILITIES_TEXT,
 formatEcosystemOverview,
 formatMarketOverview,
 formatPortfolioSummary,
 formatRecentActivity,
 formatSteldexPools,
 formatYieldOpportunities,
} from "../lib/chat-tools";
import { formatEarningReport, formatRebalancePlan } from "../lib/portfolio-intel";
import { runLlmCopilot, llmConfigured } from "../lib/llm";
import { answerWalletQueryFromMessage } from "../lib/wallet-data";
import { normalizeUserMessageText } from "../lib/fuzzy-normalize";
import { tryExplainAnswer, tryTeachAnswer } from "../lib/knowledge-rag";
import { formatBlendHealthReport } from "../lib/blend-health";
import {
 isMainnetExecutionAsk,
 mainnetGuardrailText,
} from "../lib/network-mode";
import { formatAquariusPools, formatAquariusQuote } from "../lib/aquarius";
import { fundWithFriendbot } from "../lib/friendbot";
import { formatReflectorPrices } from "../lib/reflector";
import { formatProtocolRegistry } from "../lib/protocols";
import {
 clearPendingPredictBet,
 formatAmbiguousMarkets,
 formatPredictionMarkets,
 formatPredictionPositions,
 getPendingPredictBet,
 parsePredictBetIntent,
 pickPendingMarket,
 preparePredictionBet,
 preparePredictionClaim,
 resolvePredictionMarkets,
 setPendingPredictBet,
} from "../lib/predict";
import { parseMultiSwapEach } from "../lib/multi-action";
import {
 formatPerpMarkets,
 formatPerpPositions,
 preparePerpClose,
 preparePerpOpen,
} from "../lib/perps";
import {
 formatNftCatalog,
 getNftHoldings,
 prepareNftBuy,
 prepareNftList,
 prepareNftMint,
 prepareNftTransfer,
 type NftGalleryPayload,
} from "../lib/nft";
import {
 BlendRequestType,
 formatBlendMarkets,
 preflightBlendWalletSpend,
 resolveBlendReserve,
} from "../lib/blend";
import {
 faucetSoroswapToken,
 formatSoroswapPositions,
 formatSoroswapStatus,
 getSoroswapPositions,
 isSoroswapPair,
 resolveSoroswapToken,
 soroswapConfigured,
 soroswapTestnetReady,
 trySoroswapQuote,
 matchSoroswapAddLiquidityAmounts,
} from "../lib/soroswap";
import { enrichChatActionWithTrustline } from "../lib/enrich-action";
import { timed } from "../lib/metrics";
import {
 FAUCET_RE,
 NFT_BUY_RE,
 NFT_CLAIM_BETA_RE,
 NFT_LIST_RE,
 NFT_MINT_RE,
 NFT_TRANSFER_RE,
 ORBIT_SUPPLY_CLAIM_RE,
 ORBIT_SUPPLY_DEPOSIT_RE,
 ORBIT_SUPPLY_WITHDRAW_RE,
 PERP_CLOSE_RE,
 PREDICT_CLAIM_RE,
} from "../lib/chat-intents";
import {
 formatOrbitSupplyStatus,
 prepareOrbitSupplyClaim,
 prepareOrbitSupplyDeposit,
 prepareOrbitSupplyWithdraw,
} from "../lib/orbit-supply";
import { BETA_NFT_NAME, BETA_NFT_URI, BETA_NFT_MAX_SUPPLY } from "../lib/beta-nft";
import { getBetaNftClaimedCount, resolveBetaNftStatus } from "../lib/product-store";

const router: IRouter = Router();

const AI_RESPONSES = {
 default: CAPABILITIES_TEXT,
 send:
 "To send funds on testnet, tell me the amount, asset, and recipient. Example: \"Send 50 XLM to GABCDE…\" - I'll prepare the transaction for your connected wallet.",
 swap:
 "Swaps on Stellar Testnet:\n• StelDex - \"Swap 10 XLM to pUSDC\"\n• Soroswap (Phoenix/Aquarius) - \"Swap 10 XLM to USDC\"\n• Classic DEX fallback for XLM/USDC if aggregator is down\nUse Testnet (Freighter or Orbit wallet).",
 trustline:
 "To hold tokens like USDC, your wallet needs a one-time enable step (a trustline). Orbit detects this and asks you to sign once - then your swap continues. It locks ~0.5 XLM as a reserve; it doesn't send money.",
 connectWallet:
 "Connect Freighter or your Orbit embedded wallet using the button in the header so I can read balances and prepare transactions.",
 steldexHelp:
 "Unicorn StelDex (Testnet) - three different actions:\n\n1. Liquidity provision (requires 2 assets):\n \"add 10 XLM and 10 pUSDC to liquidity pool on StelDex\"\n\n2. Yield farming (stake the LP tokens you got from step 1):\n \"stake my XLM/pUSDC LP for 52 weeks\"\n\n3. Single-asset staking (where supported):\n Stake a single token to earn rewards.\n\nOther actions:\n \"remove liquidity XLM/pUSDC\"\n \"claim rewards from XLM/pUSDC\"\n \"unstake XLM/pUSDC\"\n \"swap 10 XLM to pUSDC\"\n \"what do I have on StelDex?\"",
 steldexPoolNotFound:
 "I couldn't find that pool on StelDex. Ask for a pair like XLM/pUSDC, XLM/cUSDC, EURC/XLM, or STELLAR/XLM.",
 noPosition:
 "I don't see that position on StelDex for your wallet. Check with \"what do I have on StelDex?\" or add liquidity first.",
};

const SEND_INTENT_RE =
 /\b(?:send|transfer|pay)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+to\s+(G[A-Z2-7]{55})\b/i;
const SWAP_INTENT_RE =
 /\b(?:swap|exchange|convert)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;
const STELDEX_STAKE_RE =
 /\bstake\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b(?:.*?(\d+)\s*weeks?)?/i;
const STELDEX_UNSTAKE_RE = /\bunstake\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_CLAIM_RE = /\bclaim\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_ADD_LIQUIDITY_RE =
 /\badd\s+liquidity\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+and\s+([\d.]+)\s*([a-zA-Z]{2,10})/i;
// Handles "add 2xlm and 2pusdc to liquidity" / "add 2 xlm and 2 pusdc to liquidity pool"
const STELDEX_ADD_LIQUIDITY_ALT_RE =
 /\badd\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+and\s+([\d.]+)\s*([a-zA-Z]{2,10})\b(?:.*\bliquidit)/i;
const STELDEX_REMOVE_LIQUIDITY_RE =
 /\bremove\s+liquidity\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_LIMIT_ORDER_RE =
 /\b(?:limit\s+order|place\s+limit)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\s+(?:at|@)\s+([\d.]+)/i;
const STELDEX_CANCEL_ORDER_RE = /\bcancel\s+order\s+#?(\d+)\b/i;
// Catches "stake my LP", "stake my positions", "stake cUSDC" without explicit pair
const STELDEX_STAKE_SINGLE_RE =
 /\bstake\b(?:\s+(?:my|all))?\s*(?:(?:my|the|all)\s+)?(?:([a-zA-Z]{2,10})\s+)?(?:lp|liquidity|position)/i;
const YIELD_ASSET_RE = /\b(?:yield|earn|apy|opportunities?)\s+(?:for\s+|on\s+)?([a-zA-Z]{2,12})\b/i;
const PRICE_ASSET_RE =
 /\b(?:price|worth|value)\s+(?:of\s+)?([a-zA-Z]{2,12})\b|\bhow\s+much\s+is\s+([a-zA-Z]{2,12})\b/i;
const AQUARIUS_QUOTE_RE =
 /\baquarius\s+(?:quote|price|route)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;
const AQUARIUS_SWAP_RE =
 /\baquarius\s+swap\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;
const FUNDBOT_RE = /\b(?:fund|friendbot|airdrop)\b(?:\s+my\s+wallet)?\b/i;
const PERP_OPEN_RE =
 /\bopen\s+(?:a\s+)?([\d.]+)\s*(?:\$|usdc\s+)?(?:usdc\s+)?(long|short)\s+on\s+(bitcoin|btc|ethereum|eth|xlm|stellar)\s+at\s+(\d+)\s*x\b/i;
const PERP_OPEN_ALT_RE =
 /\b(long|short)\s+([\d.]+)\s*usdc\s+(?:of\s+)?(bitcoin|btc|ethereum|eth|xlm|stellar)\s+(?:at\s+)?(\d+)\s*x\b/i;
const PERP_SL_RE = /\bstop\s*loss\s*(?:at\s*)?([\d.]+)/i;
const PERP_TP_RE = /\b(?:take\s*profit|tp)\s*(?:at\s*)?([\d.]+)/i;

function isConnectWalletIntent(content: string): boolean {
 const lower = content.toLowerCase();
 return (
 /\bconnect\b(?:\s+my)?\s+wallet\b/.test(lower) ||
 /\bconnect\b.*\bfreighter\b/.test(lower) ||
 /\blink\b(?:\s+my)?\s+wallet\b/.test(lower)
 );
}

const SUPPORTED_ASSETS = ["XLM", "USDC"];

type ChatReply = {
 text: string;
 action: ChatAction | null;
 actions?: ChatAction[];
 gallery?: NftGalleryPayload | null;
 pendingPredict?: {
 amountXlm: string;
 outcome: "yes" | "no";
 marketIds: number[];
 };
};

function pendingPredictKey(publicKey: string | null, sessionId?: number): string {
 if (sessionId != null && Number.isFinite(sessionId)) return `session:${sessionId}`;
 if (publicKey) return `wallet:${publicKey}`;
 return "anon";
}

async function buildPredictBetReply(
 publicKey: string,
 amountXlm: string,
 outcome: "yes" | "no",
 hint: string,
 opts?: { sessionId?: number; marketId?: number }
): Promise<ChatReply> {
 const key = pendingPredictKey(publicKey, opts?.sessionId);

 if (opts?.marketId == null) {
 const resolved = resolvePredictionMarkets(hint);
 if (resolved.status === "none") {
 return {
 text: `No market matched “${hint}”. Try “list sports markets” or “list prediction markets”.`,
 action: null,
 };
 }
 if (resolved.status === "ambiguous") {
 setPendingPredictBet(key, {
 amountXlm,
 outcome,
 markets: resolved.markets,
 });
 return {
 text: formatAmbiguousMarkets(resolved.markets, hint),
 action: null,
 pendingPredict: {
 amountXlm,
 outcome,
 marketIds: resolved.markets.map((m) => m.id),
 },
 };
 }
 opts = { ...opts, marketId: resolved.market.id };
 }

 try {
 const bet = await preparePredictionBet({
 walletAddress: publicKey,
 marketHint: hint,
 outcome,
 amountXlm,
 marketId: opts?.marketId,
 });
 clearPendingPredictBet(key);
 const tf = bet.market.timeframeLabel ? ` (${bet.market.timeframeLabel})` : "";
 return {
 text: `On-chain prediction: ${amountXlm} XLM on ${bet.outcome.toUpperCase()} for "${bet.market.question}"${tf}. Sign to stake into the Soroban contract.`,
 action: {
 type: "predict_bet",
 positionId: bet.positionId,
 sendAmount: String(bet.amountXlm),
 sendAsset: "XLM",
 marketHint: bet.market.slug,
 outcome: bet.outcome,
 xdr: bet.xdr,
 networkPassphrase: bet.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare bet", action: null };
 }
}

interface ChatAction {
 type:
 | "send"
 | "swap"
 | "soroswap_swap"
 | "soroswap_add_liquidity"
 | "soroswap_remove_liquidity"
 | "steldex_swap"
 | "steldex_stake"
 | "steldex_claim"
 | "steldex_unstake"
 | "steldex_add_liquidity"
 | "steldex_remove_liquidity"
 | "steldex_limit_order"
 | "steldex_cancel_order"
 | "blend_supply"
 | "blend_withdraw"
 | "blend_borrow"
 | "blend_repay"
 | "blend_claim"
 | "blend_usdc_swap"
 | "predict_bet"
 | "predict_claim"
 | "perp_open"
 | "perp_close"
 | "nft_mint"
 | "nft_list"
 | "nft_buy"
 | "nft_transfer"
 | "orbit_supply_deposit"
 | "orbit_supply_withdraw"
 | "orbit_supply_claim"
 | "aquarius_swap"
 | "connect_wallet"
 | "add_trustline";
 requestType?: number;
 positionId?: number;
 marketHint?: string;
 outcome?: string;
 side?: string;
 leverage?: number;
 marginUsdc?: string;
 stopLoss?: number;
 takeProfit?: number;
 entryPrice?: number;
 liquidationPrice?: number;
 notionalUsdc?: number;
 tokenId?: number;
 metadataUri?: string;
 priceXlm?: string;
 markPriceStale?: boolean;
 xdr?: string;
 networkPassphrase?: string;
 pendingAction?: ChatAction;
 sendAmount?: string;
 sendAsset?: string;
 destination?: string;
 destAsset?: string;
 poolContract?: string;
 pair?: string;
 amountB?: string;
 token0Contract?: string;
 token1Contract?: string;
 fromTokenContract?: string;
 toTokenContract?: string;
 tickLower?: number;
 tickUpper?: number;
 liquidity?: string;
 lockWeeks?: number;
 limitPrice?: string;
 orderType?: string;
 orderId?: string;
 estimatedDestAmount?: string;
}

type IntentResult =
 | { kind: "action"; text: string; action: ChatAction }
 | { kind: "text"; text: string }
 | { kind: "none" };

function withFullRange(
 pool: { poolContract: string; pair: string; token0Contract: string; token1Contract: string },
 extra: Partial<ChatAction> = {}
): Partial<ChatAction> {
 return {
 poolContract: pool.poolContract,
 pair: pool.pair,
 token0Contract: pool.token0Contract,
 token1Contract: pool.token1Contract,
 tickLower: STELDEX_FULL_RANGE.tickLower,
 tickUpper: STELDEX_FULL_RANGE.tickUpper,
 ...extra,
 };
}

async function parseSteldexIntents(
 content: string,
 publicKey: string | null
): Promise<IntentResult> {
 const addLiqMatch = content.match(STELDEX_ADD_LIQUIDITY_RE) ?? content.match(STELDEX_ADD_LIQUIDITY_ALT_RE);
 if (addLiqMatch) {
 const [, amountA, symbolA, amountB, symbolB] = addLiqMatch;
 const pool = await resolveSteldexPool(symbolA, symbolB);
 if (pool) {
 const a = normalizeSteldexSymbol(symbolA);
 const b = normalizeSteldexSymbol(symbolB);
 const amount0Raw = a === pool.symbol0 ? amountA! : amountB!;
 const amount1Raw = a === pool.symbol0 ? amountB! : amountA!;

 const matched = await matchSteldexAddLiquidityAmounts({
 symbol0: pool.symbol0,
 symbol1: pool.symbol1,
 token0Contract: pool.token0Contract,
 token1Contract: pool.token1Contract,
 amount0Max: amount0Raw,
 amount1Max: amount1Raw,
 });
 const amount0 = matched?.amount0 ?? amount0Raw;
 const amount1 = matched?.amount1 ?? amount1Raw;
 const ratioNote = matched
 ? matched.adjusted
 ? ` ${matched.note}`
 : ` Pool ratio OK (${pool.symbol0}/${pool.symbol1}).`
 : " (Could not verify pool ratio live - if the tx fails, amounts may be unbalanced.)";

 return {
 kind: "action",
 text: `Ready to add ${amount0} ${pool.symbol0} and ${amount1} ${pool.symbol1} to ${pool.pair} on StelDex (full-range).${ratioNote} Sign one step at a time with your connected wallet.`,
 action: {
 type: "steldex_add_liquidity",
 ...withFullRange(pool),
 sendAmount: amount0,
 amountB: amount1,
 sendAsset: pool.symbol0,
 destAsset: pool.symbol1,
 },
 };
 }

 if (soroswapConfigured() && (await isSoroswapPair(symbolA, symbolB))) {
 const matched = await matchSoroswapAddLiquidityAmounts({
 symbolA: symbolA!,
 symbolB: symbolB!,
 amountAMax: amountA!,
 amountBMax: amountB!,
 });
 const outA = matched?.amount0 ?? amountA!;
 const outB = matched?.amount1 ?? amountB!;
 const ratioNote = matched
 ? matched.adjusted
 ? ` ${matched.note}`
 : " Pool ratio OK."
 : " (Could not verify pool ratio live - if the tx fails, amounts may be unbalanced.)";

 return {
 kind: "action",
 text: `Soroswap add liquidity: ${outA} ${symbolA!.toUpperCase()} + ${outB} ${symbolB!.toUpperCase()}.${ratioNote} Sign with your connected wallet.`,
 action: {
 type: "soroswap_add_liquidity",
 sendAmount: outA,
 amountB: outB,
 sendAsset: symbolA!.toUpperCase(),
 destAsset: symbolB!.toUpperCase(),
 pair: `${symbolA!.toUpperCase()}/${symbolB!.toUpperCase()}`,
 },
 };
 }

 return { kind: "text", text: AI_RESPONSES.steldexPoolNotFound };
 }

 const removeLiqMatch = content.match(STELDEX_REMOVE_LIQUIDITY_RE);
 if (removeLiqMatch) {
 if (!publicKey) return { kind: "text", text: AI_RESPONSES.connectWallet };
 const [, symbolA, symbolB] = removeLiqMatch;
 const farmPools = (await getSteldexFarmPools(publicKey)) as any[];
 const match = findRowForPair(farmPools, symbolA, symbolB);
 if (match?.lpLiquidity && match.lpLiquidity !== "0") {
 return {
 kind: "action",
 text: `I'll remove your LP on ${match.pair} (liquidity ${match.lpLiquidity}). Confirm and sign with your wallet.`,
 action: {
 type: "steldex_remove_liquidity",
 poolContract: match.poolContract,
 pair: match.pair,
 tickLower: match.tickLower ?? STELDEX_FULL_RANGE.tickLower,
 tickUpper: match.tickUpper ?? STELDEX_FULL_RANGE.tickUpper,
 liquidity: match.lpLiquidity,
 },
 };
 }

 // Soroswap fallback
 if (soroswapConfigured()) {
 try {
 const positions = (await getSoroswapPositions(publicKey)) as any[];
 const a = symbolA.toUpperCase();
 const b = symbolB.toUpperCase();
 const pos = positions?.find((p) => {
 const pair = String(p.pair ?? `${p.assetA}/${p.assetB}`).toUpperCase();
 return (
 (pair.includes(a) && pair.includes(b)) ||
 (String(p.assetA).toUpperCase() === a && String(p.assetB).toUpperCase() === b)
 );
 });
 const liq = pos?.userPosition ?? pos?.liquidity;
 if (liq && liq !== "0") {
 return {
 kind: "action",
 text: `Soroswap remove liquidity ${a}/${b}. Sign with your wallet.`,
 action: {
 type: "soroswap_remove_liquidity",
 sendAsset: a,
 destAsset: b,
 pair: `${a}/${b}`,
 liquidity: String(liq),
 },
 };
 }
 } catch {
 /* fall through */
 }
 }

 return { kind: "text", text: AI_RESPONSES.noPosition };
 }

 const stakeMatch = content.match(STELDEX_STAKE_RE);
 if (stakeMatch) {
 if (!publicKey) return { kind: "text", text: AI_RESPONSES.connectWallet };
 const [, symbolA, symbolB, weeksRaw] = stakeMatch;
 const lockWeeks = Math.min(156, Math.max(1, weeksRaw ? parseInt(weeksRaw, 10) : 52));
 const farmPools = (await getSteldexFarmPools(publicKey)) as any[];
 const match = findRowForPair(farmPools, symbolA, symbolB);
 const available = match?.availableToStake ?? match?.lpLiquidity;
 if (!match?.poolContract || !available || available === "0") {
 return {
 kind: "text",
 text: "No LP available to stake for that pair. Add liquidity first, then stake.",
 };
 }
 return {
 kind: "action",
 text: `I'll stake your available ${match.pair} LP for ${lockWeeks} weeks on the StelDex farm. Sign with your connected wallet.`,
 action: {
 type: "steldex_stake",
 poolContract: match.poolContract,
 pair: match.pair,
 tickLower: match.tickLower ?? STELDEX_FULL_RANGE.tickLower,
 tickUpper: match.tickUpper ?? STELDEX_FULL_RANGE.tickUpper,
 lockWeeks,
 },
 };
 }

 // Fallback: "stake my LP" / "stake my positions" / "stake my cUSDC LP" - no pair specified
 const stakeSingleMatch = content.match(STELDEX_STAKE_SINGLE_RE);
 if (stakeSingleMatch) {
 if (!publicKey) return { kind: "text", text: AI_RESPONSES.connectWallet };
 const assetHint = stakeSingleMatch[1] ? normalizeSteldexSymbol(stakeSingleMatch[1]) : null;
 const farmPools = (await getSteldexFarmPools(publicKey)) as any[];
 const stakeable = farmPools.filter(
 (p: any) => p.availableToStake && p.availableToStake !== "0"
 );
 if (stakeable.length === 0) {
 return { kind: "text", text: "No LP available to stake right now. Add liquidity first, then stake." };
 }
 // If asset hint given, filter to pools containing that asset
 const filtered = assetHint
 ? stakeable.filter((p: any) => p.pair?.toUpperCase().includes(assetHint.toUpperCase()))
 : stakeable;
 const match = (filtered[0] ?? stakeable[0]) as any;
 if (stakeable.length > 1 && !filtered[0]) {
 const poolList = stakeable.map((p: any) => p.pair).join(", ");
 return { kind: "text", text: `You have unstaked LP in multiple pools: ${poolList}. Which one do you want to stake? E.g. "stake XLM/pUSDC".` };
 }
 return {
 kind: "action",
 text: `I'll stake your available ${match.pair} LP for 52 weeks on the StelDex farm. Sign with your connected wallet.`,
 action: {
 type: "steldex_stake",
 poolContract: match.poolContract,
 pair: match.pair,
 tickLower: match.tickLower ?? STELDEX_FULL_RANGE.tickLower,
 tickUpper: match.tickUpper ?? STELDEX_FULL_RANGE.tickUpper,
 lockWeeks: 52,
 },
 };
 }

 const unstakeMatch = content.match(STELDEX_UNSTAKE_RE);
 if (unstakeMatch) {
 if (!publicKey) return { kind: "text", text: AI_RESPONSES.connectWallet };
 const [, symbolA, symbolB] = unstakeMatch;
 const positions = (await getSteldexFarmPositions(publicKey)) as any[];
 const match = findRowForPair(positions, symbolA, symbolB);
 if (!match?.poolContract) {
 return { kind: "text", text: AI_RESPONSES.noPosition };
 }
 return {
 kind: "action",
 text: `I'll unstake your ${match.pair} farm position. Sign with your connected wallet.`,
 action: {
 type: "steldex_unstake",
 poolContract: match.poolContract,
 pair: match.pair,
 tickLower: match.tickLower ?? STELDEX_FULL_RANGE.tickLower,
 tickUpper: match.tickUpper ?? STELDEX_FULL_RANGE.tickUpper,
 },
 };
 }

 const claimMatch = content.match(STELDEX_CLAIM_RE);
 if (claimMatch) {
 if (!publicKey) return { kind: "text", text: AI_RESPONSES.connectWallet };
 const [, symbolA, symbolB] = claimMatch;
 const positions = (await getSteldexFarmPositions(publicKey)) as any[];
 const match = findRowForPair(positions, symbolA, symbolB);
 if (!match?.poolContract) {
 return { kind: "text", text: AI_RESPONSES.noPosition };
 }
 return {
 kind: "action",
 text: `I'll claim STELLAR farm rewards from ${match.pair}. Sign with your connected wallet.`,
 action: {
 type: "steldex_claim",
 poolContract: match.poolContract,
 pair: match.pair,
 tickLower: match.tickLower ?? STELDEX_FULL_RANGE.tickLower,
 tickUpper: match.tickUpper ?? STELDEX_FULL_RANGE.tickUpper,
 },
 };
 }

 const limitMatch = content.match(STELDEX_LIMIT_ORDER_RE);
 if (limitMatch) {
 const [, amount, fromAsset, toAsset, price] = limitMatch;
 const from = normalizeSteldexSymbol(fromAsset);
 const to = normalizeSteldexSymbol(toAsset);
 const fromContract = await resolveSteldexToken(from);
 const toContract = await resolveSteldexToken(to);
 if (!fromContract || !toContract) {
 return { kind: "text", text: AI_RESPONSES.steldexPoolNotFound };
 }
 // limitPrice: output token units per 1 input token, using output decimals
 const limitPrice = toSteldexUnits(price, steldexDecimals(to));
 return {
 kind: "action",
 text: `Limit order: sell ${amount} ${from} for ${to} at ${price} ${to} per ${from}. Sign with your connected wallet.`,
 action: {
 type: "steldex_limit_order",
 sendAmount: amount,
 sendAsset: from,
 destAsset: to,
 fromTokenContract: fromContract,
 toTokenContract: toContract,
 limitPrice,
 orderType: "Limit",
 },
 };
 }

 const cancelMatch = content.match(STELDEX_CANCEL_ORDER_RE);
 if (cancelMatch) {
 if (!publicKey) return { kind: "text", text: AI_RESPONSES.connectWallet };
 const orderId = cancelMatch[1];
 const orders = (await getSteldexOrders(publicKey)) as any[];
 const exists = orders.some((o) => String(o.orderId) === orderId);
 if (!exists) {
 return {
 kind: "text",
 text: `I don't see open order #${orderId} on StelDex for your wallet.`,
 };
 }
 return {
 kind: "action",
 text: `I'll cancel StelDex order #${orderId}. Sign with your connected wallet.`,
 action: { type: "steldex_cancel_order", orderId },
 };
 }

 const swapMatch = content.match(SWAP_INTENT_RE);
 if (swapMatch) {
 const [, amount, fromAsset, toAsset] = swapMatch;
 // Classic / Soroswap USDC is not StelDex (StelDex uses pUSDC)
 if (fromAsset.toUpperCase() === "USDC" || toAsset.toUpperCase() === "USDC") {
 return { kind: "none" };
 }

 const from = normalizeSteldexSymbol(fromAsset);
 const to = normalizeSteldexSymbol(toAsset);
 const fromContract = await resolveSteldexToken(from);
 const toContract = await resolveSteldexToken(to);
 if (!fromContract || !toContract) {
 return { kind: "none" };
 }

 let quoteNote = "";
 let estimatedDestAmount: string | undefined;
 try {
 const quote = await getSteldexSwapQuote({
 walletAddress: publicKey ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
 fromTokenContract: fromContract,
 toTokenContract: toContract,
 amountIn: toSteldexUnits(amount, steldexDecimals(from)),
 slippageBps: 50,
 });
 // API returns outputAmount (human) or amountOutRaw (raw integer)
 const raw = (quote as any).amountOutRaw ?? (quote as any).amountOut;
 const human = (quote as any).outputAmount;
 if (human != null && human !== "") {
 estimatedDestAmount = String(human);
 quoteNote = ` Quote out ≈ ${estimatedDestAmount} ${to}.`;
 } else if (raw != null && raw !== "") {
 estimatedDestAmount = fromSteldexUnits(String(raw), steldexDecimals(to));
 quoteNote = ` Quote out ≈ ${estimatedDestAmount} ${to}.`;
 }
 } catch {
 // quote optional
 }

 // Spendable balance preflight against the same Soroban inventory StelDex uses
 if (publicKey) {
 const need = parseFloat(amount);
 if (Number.isFinite(need) && need > 0) {
 let available = 0;
 if (from === "XLM") {
 const { getAccountBalances } = await import("../lib/stellar");
 const classicBals = await getAccountBalances(publicKey).catch(
 (): Awaited<ReturnType<typeof getAccountBalances>> => []
 );
 available = classicBals.find((b) => b.assetCode === "XLM")?.balance ?? 0;
 const spendable = Math.max(0, available - 2.5);
 if (need > spendable) {
 return {
 kind: "text",
 text:
 spendable <= 0
 ? `Not enough XLM in this Orbit wallet (${publicKey.slice(0, 4)}…${publicKey.slice(-4)}). Balance ${available.toFixed(4)} XLM - keep ~2.5 XLM for fees/reserves.`
 : `Not enough spendable XLM: need ${need}, have ~${spendable.toFixed(4)} spendable (${available.toFixed(4)} total, reserving ~2.5 for fees). This is your Orbit/Freighter connected address - tokens in a different wallet won't count.`,
 };
 }
 } else {
 available = await getSteldexTokenBalanceHuman(publicKey, from);
 if (need > available + 1e-9) {
 return {
 kind: "text",
 text: `Not enough ${from} in this connected wallet (${publicKey.slice(0, 4)}…${publicKey.slice(-4)}): need ${need}, have ${available.toFixed(6)}. StelDex uses Soroban balances (e.g. pUSDC ≠ classic USDC).`,
 };
 }
 }
 }
 }

 const swapAction: ChatAction = {
 type: "steldex_swap",
 sendAmount: amount,
 sendAsset: from,
 destAsset: to,
 fromTokenContract: fromContract,
 toTokenContract: toContract,
 estimatedDestAmount,
 };
 const gated = await wrapActionWithTrustlineIfNeeded(publicKey, swapAction);
 return {
 kind: "action",
 text:
 gated.text ??
 `StelDex swap: ${amount} ${from} → ${to}.${quoteNote} Sign each step with your connected wallet.`,
 action: gated.action as ChatAction,
 };
 }

 return { kind: "none" };
}

async function parseClassicAction(content: string): Promise<ChatAction | null> {
 const sendMatch = content.match(SEND_INTENT_RE);
 if (sendMatch) {
 const [, amount, asset, destination] = sendMatch;
 return { type: "send", sendAmount: amount, sendAsset: asset.toUpperCase(), destination };
 }

 const swapMatch = content.match(SWAP_INTENT_RE);
 if (swapMatch) {
 const [, amount, fromAsset, toAsset] = swapMatch;
 return {
 type: "swap",
 sendAmount: amount,
 sendAsset: fromAsset.toUpperCase(),
 destAsset: toAsset.toUpperCase(),
 };
 }

 return null;
}

async function getDeterministicResponse(
 content: string,
 publicKey: string | null,
 options?: { readQueries?: boolean; sessionId?: number }
): Promise<ChatReply> {
 const lower = content.toLowerCase();
 const readQueries = options?.readQueries !== false;
 const sessionId = options?.sessionId;

 // Follow-up after ambiguous predict clarify: "1", "2", "the epl one"
 {
 const key = pendingPredictKey(publicKey, sessionId);
 const pending = getPendingPredictBet(key);
 if (pending && publicKey) {
 const pick = pickPendingMarket(content, pending);
 if (pick) {
 return buildPredictBetReply(
 publicKey,
 pending.amountXlm,
 pending.outcome,
 pick.slug,
 { sessionId, marketId: pick.id }
 );
 }
 // Short numeric / clarify-looking replies that didn't match - re-prompt
 if (/^#?\d+\.?$/.test(content.trim()) || /^(the\s+)?(epl|fa\s*cup|premier)/i.test(content.trim())) {
 return {
 text: formatAmbiguousMarkets(pending.markets),
 action: null,
 };
 }
 }
 }

 // Multi-swap: "swap 200 XLM to pUSDC, cUSDC, EURC each"
 {
 const multi = parseMultiSwapEach(content);
 if (multi) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const actions: ChatAction[] = [];
 const notes: string[] = [];
 for (const to of multi.toAssets) {
 const synthetic = `swap ${multi.amount} ${multi.fromAsset} to ${to}`;
 try {
 const steldex = await parseSteldexIntents(synthetic, publicKey);
 if (steldex.kind === "action") {
 const gated = await wrapActionWithTrustlineIfNeeded(publicKey, steldex.action);
 actions.push(gated.action as ChatAction);
 notes.push(`• ${multi.amount} ${multi.fromAsset} → ${to}`);
 } else if (steldex.kind === "text") {
 notes.push(`• ${to}: ${steldex.text}`);
 } else {
 // Classic / Soroswap fallback for USDC-style
 const classic: ChatAction = {
 type: "swap",
 sendAmount: multi.amount,
 sendAsset: multi.fromAsset.toUpperCase() === "PUSDC" ? "pUSDC" : multi.fromAsset,
 destAsset: to,
 };
 const gated = await wrapActionWithTrustlineIfNeeded(publicKey, classic);
 actions.push(gated.action as ChatAction);
 notes.push(`• ${multi.amount} ${multi.fromAsset} → ${to} (prepared)`);
 }
 } catch (err: any) {
 notes.push(`• ${to}: ${err?.message ?? "failed"}`);
 }
 }
 if (!actions.length) {
 return {
 text: `Could not prepare multi-swap.\n${notes.join("\n")}`,
 action: null,
 };
 }
 return {
 text: `Prepared ${actions.length} swaps (${multi.amount} ${multi.fromAsset} each → ${multi.toAssets.join(", ")}). Sign one step at a time.\n${notes.join("\n")}`,
 action: actions[0] ?? null,
 actions,
 };
 }
 }

 // Trustline-continue: auto-triggered after add_trustline success
 // Message format: "Trustline for X added successfully. Continue with the swap: A X → Y"
 const trustlineContinueMatch = content.match(
 /trustline for ([a-zA-Z]{2,12}) added successfully\. continue with the swap: ([\d.]+) ([a-zA-Z]{2,12}) → ([a-zA-Z]{2,12})/i
 );
 if (trustlineContinueMatch) {
 const [, , amount, fromAsset, toAsset] = trustlineContinueMatch;
 const from = normalizeSteldexSymbol(fromAsset);
 const to = normalizeSteldexSymbol(toAsset);
 const fromContract = await resolveSteldexToken(from);
 const toContract = await resolveSteldexToken(to);
 if (fromContract && toContract) {
 let estimatedDestAmount: string | undefined;
 try {
 const quote = await getSteldexSwapQuote({
 walletAddress: publicKey ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
 fromTokenContract: fromContract,
 toTokenContract: toContract,
 amountIn: toSteldexUnits(amount, steldexDecimals(from)),
 slippageBps: 50,
 });
 const human = (quote as any).outputAmount;
 const raw = (quote as any).amountOutRaw ?? (quote as any).amountOut;
 if (human != null) estimatedDestAmount = String(human);
 else if (raw != null) estimatedDestAmount = fromSteldexUnits(String(raw), steldexDecimals(to));
 } catch { /* quote optional */ }
 return {
 text: `Trustline added. Now swapping ${amount} ${from} → ${to}. Review the card and sign with your connected wallet.`,
 action: {
 type: "steldex_swap",
 sendAmount: amount,
 sendAsset: from,
 destAsset: to,
 fromTokenContract: fromContract,
 toTokenContract: toContract,
 estimatedDestAmount,
 },
 };
 }
 }

 if (isConnectWalletIntent(content)) {
 if (publicKey) {
 const short = `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
 return {
 text: `You're connected as ${short} on Stellar Testnet.`,
 action: null,
 };
 }
 return {
 text: "Opening wallet connect - approve Freighter or use your Orbit embedded wallet.",
 action: { type: "connect_wallet" },
 };
 }

 // StelDex write intents (read positions first where required)
 try {
 const steldex = await parseSteldexIntents(content, publicKey);
 if (steldex.kind === "action") {
 const gated = await wrapActionWithTrustlineIfNeeded(publicKey, steldex.action);
 return {
 text: gated.text ?? steldex.text,
 action: gated.action as ChatAction,
 };
 }
 if (steldex.kind === "text") return { text: steldex.text, action: null };
 } catch (err: any) {
 return {
 text: err?.message ?? "StelDex request failed. Try again in a moment.",
 action: null,
 };
 }

 // Classic Stellar send / SDEX swap
 let action: ChatAction | null = null;
 try {
 action = await parseClassicAction(content);
 } catch {
 action = null;
 }

 if (action?.type === "send") {
 const gated = await wrapActionWithTrustlineIfNeeded(publicKey, action);
 return {
 text:
 gated.text ??
 `I've prepared a transaction to send ${action.sendAmount} ${action.sendAsset} to ${action.destination}. Review below and sign with your connected wallet.`,
 action: gated.action as ChatAction,
 };
 }

 if (action?.type === "swap") {
 const from = action.sendAsset!;
 const to = action.destAsset!;

 if (soroswapConfigured() && (await isSoroswapPair(from, to)) && (await soroswapTestnetReady())) {
 try {
 const preview = await trySoroswapQuote(from, to, action.sendAmount!);
 if (preview) {
 const fromTok = await resolveSoroswapToken(from);
 const toTok = await resolveSoroswapToken(to);
 const route =
 preview.protocols?.length ? ` via ${preview.protocols.join(", ")}` : "";
 const impact = preview.priceImpactPct
 ? ` Impact ~${preview.priceImpactPct}%.`
 : "";
 const swapAction: ChatAction = {
 type: "soroswap_swap",
 sendAmount: action.sendAmount,
 sendAsset: from,
 destAsset: to,
 fromTokenContract: fromTok!.contract,
 toTokenContract: toTok!.contract,
 };
 const gated = await wrapActionWithTrustlineIfNeeded(publicKey, swapAction);
 return {
 text:
 gated.text ??
 `Soroswap route${route}: ${action.sendAmount} ${from} → ~${preview.amountOutHuman} ${to}.${impact} Sign with your connected wallet.`,
 action: gated.action as ChatAction,
 };
 }
 } catch {
 // fall through to classic when aggregator errors
 }
 }

 if (!SUPPORTED_ASSETS.includes(from) || !SUPPORTED_ASSETS.includes(to)) {
 return {
 text: `No live Soroswap path for ${from}/${to} on testnet right now. Classic DEX supports ${SUPPORTED_ASSETS.join(" / ")}; StelDex supports pUSDC, cUSDC, STELLAR, EURC.`,
 action: null,
 };
 }

 return {
 text: `No Soroswap liquidity for ${from}/${to} right now - using classic testnet DEX for ${action.sendAmount} ${from} → ${to}. Sign with your connected wallet.`,
 action: (await wrapActionWithTrustlineIfNeeded(publicKey, action)).action as ChatAction,
 };
 }

 // Prediction markets (Orbit-native)
 if (
 /\b(?:how\s+(?:do\s+i\s+)?resolve|resolve\s+(?:a\s+)?(?:prediction\s+)?market|admin\s+resolve)\b/i.test(
 content
 )
 ) {
 const hint = content.match(
 /\bresolve\s+(?:market\s+)?([a-z0-9\-]+)\s+(yes|no)\b/i
 );
 const slug = hint?.[1] ?? "brazil-wins";
 const outcome = (hint?.[2] ?? "yes").toLowerCase();
 return {
 text: [
 "**Resolve Orbit Predict markets (admin / demo)**",
 "",
 "Claims only work after the market is resolved on-chain by the contract admin.",
 "",
 "Option A - Node script (needs ORBIT_ADMIN_SECRET_KEY in .env):",
 `\`node artifacts/api-server/scripts/resolve-predict.mjs ${slug} ${outcome}\``,
 "",
 "Option B - Stellar CLI (see contracts/README.md):",
 "```",
 `stellar contract invoke --id $ORBIT_PREDICT_CONTRACT_ID --source orbit-admin --network testnet -- \\`,
 ` resolve_market --market_id <id> --outcome ${outcome === "no" ? "No" : "Yes"}`,
 "```",
 "",
 `After resolve, winners: \"claim ${outcome} on ${slug}\"`,
 "",
 "Market IDs: brazil-wins=0, btc-100k=1, xlm-up-week=2, eth-flip=3, chelsea-arsenal-epl=4, chelsea-arsenal-fa-cup=5, liverpool-city-epl=6",
 ].join("\n"),
 action: null,
 };
 }

 // List sports / prediction markets
 if (
 /\blist\s+sports\s+markets?\b/i.test(content) ||
 /\bsports\s+(?:prediction\s+)?markets?\b/i.test(content)
 ) {
 try {
 return { text: await formatPredictionMarkets({ category: "sports" }), action: null };
 } catch (err: any) {
 return { text: err?.message ?? "Sports markets unavailable", action: null };
 }
 }

 if (
 lower.includes("prediction") ||
 lower.includes("predict market") ||
 (lower.includes("markets") && lower.includes("predict")) ||
 /\blist\s+prediction\s+markets?\b/i.test(content)
 ) {
 if (publicKey && (lower.includes("my") || lower.includes("position"))) {
 try {
 return { text: await formatPredictionPositions(publicKey), action: null };
 } catch {
 // fall through
 }
 }
 try {
 const category = /\bcrypto\b/i.test(content) ? "crypto" as const : "all" as const;
 return { text: await formatPredictionMarkets({ category }), action: null };
 } catch (err: any) {
 return { text: err?.message ?? "Prediction markets unavailable (push DB schema?).", action: null };
 }
 }

 // Natural-language + slug predict bets (with disambiguation)
 const predIntent = parsePredictBetIntent(content);
 if (predIntent) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 return buildPredictBetReply(
 publicKey,
 predIntent.amountXlm,
 predIntent.outcome,
 predIntent.hint,
 { sessionId }
 );
 }

 const predClaim = content.match(PREDICT_CLAIM_RE);
 if (predClaim) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const outcomeRaw = (predClaim[1] || predClaim[3] || "yes").toLowerCase();
 const slug = predClaim[2] || predClaim[4] || "";
 if (!slug) {
 return {
 text: 'Specify the market: "claim yes winnings on brazil" or "claim no on election-2024"',
 action: null,
 };
 }
 try {
 const claim = await preparePredictionClaim({
 walletAddress: publicKey,
 marketHint: slug,
 outcome: outcomeRaw === "no" ? "no" : "yes",
 });
 return {
 text: claim.message,
 action: {
 type: "predict_claim",
 positionId: claim.positionId,
 marketHint: claim.market.slug,
 outcome: claim.outcome,
 xdr: claim.xdr,
 networkPassphrase: claim.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare claim", action: null };
 }
 }

 // Beta claim BEFORE holdings - feedback prompt has "my" + "nft" and was hijacked by gallery
 if (NFT_CLAIM_BETA_RE.test(content)) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const status = await resolveBetaNftStatus(publicKey);
 if (!status.eligible) {
 return {
 text: "You're not whitelisted yet. Open the heart icon, submit feedback with this wallet connected, then ask me to mint your beta tester NFT.",
 action: null,
 };
 }
 if (status.claimed) {
 const txNote =
 status.claimTxHash && status.claimTxHash !== "onchain-sync"
 ? ` (tx ${status.claimTxHash.slice(0, 8)}…)`
 : "";
 return {
 text: `You already minted your "${BETA_NFT_NAME}" NFT${txNote}. Ask “view my NFTs” to open your gallery.`,
 action: null,
 };
 }
 const claimedCount = await getBetaNftClaimedCount();
 if (claimedCount >= BETA_NFT_MAX_SUPPLY) {
 return {
 text: `The Orbit Co-Pilot Beta collection is sold out (${BETA_NFT_MAX_SUPPLY}/${BETA_NFT_MAX_SUPPLY}).`,
 action: null,
 };
 }
 const minted = await prepareNftMint({
 walletAddress: publicKey,
 name: BETA_NFT_NAME,
 metadataUri: BETA_NFT_URI,
 });
 return {
 text: `Thanks for testing Orbit - preparing your "${BETA_NFT_NAME}" NFT (${claimedCount + 1}/${BETA_NFT_MAX_SUPPLY}). Review the card and sign to mint.`,
 action: {
 type: "nft_mint",
 sendAsset: BETA_NFT_NAME,
 marketHint: BETA_NFT_URI,
 xdr: minted.xdr,
 networkPassphrase: minted.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare beta NFT claim", action: null };
 }
 }

 // NFT gallery - only when user asks to view holdings (not mint/claim)
 {
 const wantsGallery =
 /\b(?:view|show|see|list)\b[\s\w]{0,24}\b(?:my\s+)?nfts?\b/i.test(content) ||
 /\bmy\s+nfts?\b/i.test(content) ||
 /\b(?:nft|nfts|collectibles?)\b[\s\w]{0,24}\b(?:holdings?|collection)\b/i.test(content) ||
 /\b(?:holdings?|collection)\b[\s\w]{0,24}\b(?:nft|nfts)\b/i.test(content);
 const isMintOrClaim =
 /\bmint\b/i.test(content) || /\bclaim\b/i.test(content);

 if (wantsGallery && !isMintOrClaim) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const { text, gallery } = await getNftHoldings(publicKey);
 return { text, action: null, gallery };
 } catch (err: any) {
 return { text: err?.message ?? "NFT holdings unavailable", action: null };
 }
 }
 }
 if (lower.includes("nft") && (lower.includes("market") || lower.includes("help") || lower === "nfts")) {
 try {
 return { text: await formatNftCatalog(), action: null };
 } catch (err: any) {
 return { text: err?.message ?? "NFT marketplace unavailable", action: null };
 }
 }

 const nftMint = content.match(NFT_MINT_RE);
 if (nftMint) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const minted = await prepareNftMint({
 walletAddress: publicKey,
 name: nftMint[1]?.trim(),
 metadataUri: nftMint[2]?.trim(),
 });
 return {
 text: minted.message,
 action: {
 type: "nft_mint",
 metadataUri: minted.metadataUri,
 marketHint: minted.name,
 xdr: minted.xdr,
 networkPassphrase: minted.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Mint failed", action: null };
 }
 }

 const nftList = content.match(NFT_LIST_RE);
 if (nftList) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const listed = await prepareNftList({
 walletAddress: publicKey,
 tokenId: parseInt(nftList[1], 10),
 priceXlm: nftList[2],
 });
 return {
 text: listed.message,
 action: {
 type: "nft_list",
 tokenId: listed.tokenId,
 priceXlm: listed.priceXlm,
 sendAmount: listed.priceXlm,
 sendAsset: "XLM",
 xdr: listed.xdr,
 networkPassphrase: listed.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "List failed", action: null };
 }
 }

 const nftBuy = content.match(NFT_BUY_RE);
 if (nftBuy) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const bought = await prepareNftBuy({
 walletAddress: publicKey,
 tokenId: parseInt(nftBuy[1], 10),
 });
 return {
 text: bought.message,
 action: {
 type: "nft_buy",
 tokenId: bought.tokenId,
 xdr: bought.xdr,
 networkPassphrase: bought.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Buy failed", action: null };
 }
 }

 const nftTransfer = content.match(NFT_TRANSFER_RE);
 if (nftTransfer) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const transferred = await prepareNftTransfer({
 walletAddress: publicKey,
 tokenId: parseInt(nftTransfer[1], 10),
 to: nftTransfer[2],
 });
 return {
 text: transferred.message,
 action: {
 type: "nft_transfer",
 tokenId: transferred.tokenId,
 destination: transferred.destination,
 xdr: transferred.xdr,
 networkPassphrase: transferred.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Transfer failed", action: null };
 }
 }

 // Perpetuals (Orbit-native)
 if (lower.includes("perp") && (lower.includes("market") || lower.includes("list"))) {
 try {
 return { text: await formatPerpMarkets(), action: null };
 } catch (err: any) {
 return { text: err?.message ?? "Perps unavailable (push DB schema?).", action: null };
 }
 }

 const perpClose = content.match(PERP_CLOSE_RE);
 if (perpClose) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const result = await preparePerpClose({
 walletAddress: publicKey,
 marketHint: perpClose[1],
 });
 return {
 text: result.message,
 action: {
 type: "perp_close",
 positionId: result.positionId,
 marketHint: result.market,
 side: result.side,
 entryPrice: result.entryPrice,
 xdr: result.xdr,
 networkPassphrase: result.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Close failed", action: null };
 }
 }

 let perpMatch = content.match(PERP_OPEN_RE);
 let marginStr: string | undefined;
 let sideStr: string | undefined;
 let marketStr: string | undefined;
 let levStr: string | undefined;
 if (perpMatch) {
 [, marginStr, sideStr, marketStr, levStr] = perpMatch;
 } else {
 perpMatch = content.match(PERP_OPEN_ALT_RE);
 if (perpMatch) {
 [, sideStr, marginStr, marketStr, levStr] = perpMatch;
 }
 }
 if (perpMatch && marginStr && sideStr && marketStr && levStr) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const sl = content.match(PERP_SL_RE)?.[1];
 const tp = content.match(PERP_TP_RE)?.[1];
 try {
 const open = await preparePerpOpen({
 walletAddress: publicKey,
 marketHint: marketStr,
 side: sideStr.toLowerCase() === "short" ? "short" : "long",
 marginUsdc: marginStr,
 leverage: parseInt(levStr, 10),
 stopLoss: sl ? parseFloat(sl) : undefined,
 takeProfit: tp ? parseFloat(tp) : undefined,
 });
 return {
 text: `On-chain perp ${open.side.toUpperCase()} ${open.market} ${open.leverage}x - margin $${open.marginUsdc} USDC into contract, entry ~$${open.entryPrice.toFixed(2)}, liq ~$${open.liquidationPrice.toFixed(2)}${open.stopLoss ? `, SL $${open.stopLoss}` : ""}${open.takeProfit ? `, TP $${open.takeProfit}` : ""}. Sign the contract invoke.`,
 action: {
 type: "perp_open",
 positionId: open.positionId,
 sendAmount: String(open.marginUsdc),
 sendAsset: "USDC",
 side: open.side,
 leverage: open.leverage,
 marginUsdc: String(open.marginUsdc),
 marketHint: open.market,
 stopLoss: open.stopLoss ?? undefined,
 takeProfit: open.takeProfit ?? undefined,
 entryPrice: open.entryPrice,
 liquidationPrice: open.liquidationPrice,
 notionalUsdc: open.notionalUsdc,
 xdr: open.xdr,
 networkPassphrase: open.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Could not open perp", action: null };
 }
 }

 if (lower.includes("perp") || lower.includes("perpetual")) {
 if (publicKey && (lower.includes("my") || lower.includes("position"))) {
 try {
 return { text: await formatPerpPositions(publicKey), action: null };
 } catch {
 // fall through
 }
 }
 try {
 return { text: await formatPerpMarkets(), action: null };
 } catch (err: any) {
 return { text: err?.message ?? "Perps unavailable", action: null };
 }
 }

 // Friendbot - fund testnet XLM
 if (FUNDBOT_RE.test(content) && !lower.includes("faucet")) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const result = await fundWithFriendbot(publicKey);
 return { text: result.message, action: null };
 }

 // Aquarius live find-path quote or executable swap
 const aquaSwapMatch = content.match(AQUARIUS_SWAP_RE);
 if (aquaSwapMatch) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const [, amount, fromAsset, toAsset] = aquaSwapMatch;
 try {
 const { buildAquariusSwap } = await import("../lib/aquarius");
 const built = await buildAquariusSwap({
 walletAddress: publicKey,
 fromSymbol: fromAsset,
 toSymbol: toAsset,
 amount,
 });
 const action: ChatAction = {
 type: "aquarius_swap",
 sendAmount: amount,
 sendAsset: built.tokenIn,
 destAsset: built.tokenOut,
 estimatedDestAmount: built.estimatedDestAmount,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 };
 return {
 text: [
 `Aquarius swap ready: ${amount} ${built.tokenIn} → ~${built.estimatedDestAmount} ${built.tokenOut}`,
 `Pools: ${built.pools.length} hop(s)`,
 "",
 "Review and sign the router invoke below (Testnet only).",
 ].join("\n"),
 action,
 };
 } catch (err: any) {
 return {
 text: err?.message ?? "Aquarius swap build failed.",
 action: null,
 };
 }
 }

 const aquaQuoteMatch = content.match(AQUARIUS_QUOTE_RE);
 if (aquaQuoteMatch) {
 const [, amount, fromAsset, toAsset] = aquaQuoteMatch;
 try {
 return {
 text: await formatAquariusQuote(fromAsset, toAsset, amount),
 action: null,
 };
 } catch (err: any) {
 return {
 text: err?.message ?? "Aquarius quote failed.",
 action: null,
 };
 }
 }

 // Blend writes must run on the action pass (readQueries: false).
 // Also handle Circle→Blend USDC conversion here (no DEX liquidity on testnet).
 {
 const wantsBlendSwap =
 /\b(?:swap|convert|exchange)\b[\s\S]{0,40}\b(?:to\s+)?blend\s*usdc\b/i.test(content) ||
 /\b(?:swap|convert|exchange)\s+([\d.]+)\s*(?:circle\s+)?(?:usdc|cusdc)\s+(?:to|into|for)\s+blend\b/i.test(
 content
 ) ||
 /\bconvert\s+([\d.]+)\s*usdc\s+and\s+supply\b/i.test(content);

 const blendSwapAmount =
 content.match(
 /\b(?:swap|convert|exchange)\s+([\d.]+)\s*(?:circle\s+)?(?:usdc|cusdc)\b/i
 )?.[1] ??
 content.match(/\bconvert\s+([\d.]+)\s*usdc\s+and\s+supply\b/i)?.[1] ??
 null;

 if (wantsBlendSwap || (lower.includes("blend") && blendSwapAmount)) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const amount = blendSwapAmount ?? "100";
 try {
 const { prepareCircleToBlendUsdcSwap } = await import("../lib/blend");
 const swap = await prepareCircleToBlendUsdcSwap({
 walletAddress: publicKey,
 amount,
 });
 const swapAction: ChatAction = {
 type: "blend_usdc_swap",
 sendAmount: swap.sendAmount,
 sendAsset: "USDC",
 destAsset: "Blend USDC",
 xdr: swap.xdr,
 networkPassphrase: swap.networkPassphrase,
 };

 // "convert N USDC and supply on Blend"
 const alsoSupply = /\band\s+supply\b/i.test(content) || /\bsupply\b.*\bblend\b/i.test(content);
 if (alsoSupply) {
 const reserve = await resolveBlendReserve("USDC");
 if (reserve) {
 const supplyAction: ChatAction = {
 type: "blend_supply",
 requestType: BlendRequestType.SupplyCollateral,
 sendAmount: amount,
 sendAsset: "USDC",
 poolContract: reserve.poolContract,
 token0Contract: reserve.tokenContract,
 };
 return {
 text: `${swap.message}\n\nNext: supply ${amount} Blend USDC as collateral on Blend (sign one step at a time).`,
 action: swapAction,
 actions: [swapAction, supplyAction],
 };
 }
 }

 return { text: swap.message, action: swapAction };
 } catch (err: any) {
 return {
 text:
 err?.message ??
 "Could not prepare Circle→Blend USDC swap. Deploy/fund orbit-blend-swap or use https://testnet.blend.capital faucet.",
 action: null,
 };
 }
 }

 if (
 lower.includes("blend") &&
 /\bclaim\b/.test(lower) &&
 (/\brewards?\b|\bemissions?\b|\byield\b|\bblnd\b/.test(lower) ||
 /\bclaim\s+(?:on\s+)?blend\b/.test(lower))
 ) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const { buildBlendClaimTx } = await import("../lib/blend");
 const claim = await buildBlendClaimTx({ walletAddress: publicKey });
      return {
        text: "Claim Blend emissions (BLND) for your supply/borrow positions. Sign to receive rewards.",
        action: {
          type: "blend_claim",
          sendAsset: "BLND",
          xdr: claim.xdr,
          networkPassphrase: claim.networkPassphrase,
          poolContract: claim.poolContract,
        },
      };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare Blend claim", action: null };
 }
 }

 if (lower.includes("blend")) {
 const blendOp = content.match(
 /\b(supply|lend|deposit|withdraw|borrow|repay)\s+([\d.]+)\s*([a-zA-Z]{2,12})\b/i
 );
 if (blendOp) {
 const [, op, amount, asset] = blendOp;
 const reserve = await resolveBlendReserve(asset);
 if (!reserve) {
 return {
 text: "That asset isn't on Blend testnet reserves (XLM, USDC, BLND, wETH, wBTC).",
 action: null,
 };
 }
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const opLower = op.toLowerCase();
 const type =
 opLower === "withdraw"
 ? "blend_withdraw"
 : opLower === "borrow"
 ? "blend_borrow"
 : opLower === "repay"
 ? "blend_repay"
 : "blend_supply";
 // Supply/withdraw as collateral so deposits can back borrows (Blend docs recommendation).
 const requestType =
 type === "blend_withdraw"
 ? BlendRequestType.WithdrawCollateral
 : type === "blend_borrow"
 ? BlendRequestType.Borrow
 : type === "blend_repay"
 ? BlendRequestType.Repay
 : BlendRequestType.SupplyCollateral;

 if (type === "blend_supply" || type === "blend_repay") {
 const check = await preflightBlendWalletSpend({
 walletAddress: publicKey,
 symbol: reserve.symbol,
 amount,
 op: type === "blend_repay" ? "repay" : "supply",
 });
 if (!check.ok) {
 return { text: check.message, action: null };
 }
 }

 const usdcNote =
 reserve.symbol === "USDC"
 ? " Uses **Circle USDC** (same as your wallet) as collateral - you can borrow against it."
 : type === "blend_supply"
 ? " (collateral - enables borrowing)"
 : "";
 const action: ChatAction = {
 type,
 requestType,
 sendAmount: amount,
 sendAsset: reserve.symbol,
 poolContract: reserve.poolContract,
 token0Contract: reserve.tokenContract,
 };
      const gated = await wrapActionWithTrustlineIfNeeded(publicKey, action);
      return {
        text:
          gated.text ??
          `Blend ${type.replace("blend_", "")}: ${amount} ${reserve.symbol} on the live testnet pool.${usdcNote} Review and sign with your connected wallet.`,
        action: gated.action as ChatAction,
      };
 }
 }
 }

 // Orbit Supply - yield vault (USDC / pUSDC / EURC → XLM every 24h)
 {
 if (ORBIT_SUPPLY_CLAIM_RE.test(content)) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const claim = await prepareOrbitSupplyClaim({ walletAddress: publicKey });
 return {
 text: claim.message,
 action: {
 type: "orbit_supply_claim",
 sendAmount: claim.sendAmount,
 sendAsset: "XLM",
 xdr: claim.xdr,
 networkPassphrase: claim.networkPassphrase,
 },
 };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare yield claim", action: null };
 }
 }

 const depositMatch = content.match(ORBIT_SUPPLY_DEPOSIT_RE);
 if (depositMatch) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const [, amount, asset] = depositMatch;
 try {
 const prepared = await prepareOrbitSupplyDeposit({
 walletAddress: publicKey,
 amount,
 asset,
 });
        const gated = await wrapActionWithTrustlineIfNeeded(publicKey, {
          type: "orbit_supply_deposit",
          sendAmount: prepared.sendAmount,
          sendAsset: prepared.sendAsset,
          token0Contract: prepared.tokenContract,
          xdr: prepared.xdr,
          networkPassphrase: prepared.networkPassphrase,
        });
        return {
          text: gated.text ?? prepared.message,
          action: gated.action as ChatAction,
        };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare Orbit Supply deposit", action: null };
 }
 }

 const withdrawMatch = content.match(ORBIT_SUPPLY_WITHDRAW_RE);
 if (withdrawMatch) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const [, amount, asset] = withdrawMatch;
 try {
 const prepared = await prepareOrbitSupplyWithdraw({
 walletAddress: publicKey,
 amount,
 asset,
 });
 return {
 text: prepared.message,
 action: {
 type: "orbit_supply_withdraw",
 sendAmount: prepared.sendAmount,
 sendAsset: prepared.sendAsset,
 token0Contract: prepared.tokenContract,
 xdr: prepared.xdr,
 networkPassphrase: prepared.networkPassphrase,
 },
 };
 } catch (err: any) {
 return { text: err?.message ?? "Could not prepare Orbit Supply withdraw", action: null };
 }
 }
 }

 // Reflector / oracle prices (also covered by market intent)
 if (!readQueries) {
 if (
 lower.includes("help") ||
 lower.includes("what can you") ||
 lower.includes("capabilities") ||
 lower.includes("how do i")
 ) {
 return { text: CAPABILITIES_TEXT, action: null };
 }
 return { text: AI_RESPONSES.default, action: null };
 }

 if (lower.includes("reflector") || lower.includes("oracle")) {
 const asset = content.match(/\b(?:of|for)\s+([a-zA-Z]{2,12})\b/i)?.[1];
 try {
 return {
 text: await formatReflectorPrices(asset ? [asset] : undefined),
 action: null,
 };
 } catch {
 return { text: "Reflector prices unavailable right now.", action: null };
 }
 }

 // Ecosystem discovery
 if (
 lower.includes("ecosystem") ||
 lower.includes("what protocols") ||
 lower.includes("which protocols") ||
 lower.includes("integrations") ||
 lower.includes("protocol registry")
 ) {
 try {
 return { text: await formatEcosystemOverview(), action: null };
 } catch {
 return { text: formatProtocolRegistry(), action: null };
 }
 }

 if (lower.includes("blend")) {
 // Write ops are handled earlier (before the readQueries early-return).
 try {
 return { text: await formatBlendMarkets(), action: null };
 } catch {
 return { text: "Blend testnet contracts unavailable right now.", action: null };
 }
 }

 if (
 lower.includes("orbit-supply") ||
 lower.includes("orbit supply") ||
 (lower.includes("my yield") && !lower.includes("claim")) ||
 (lower.includes("yield") && lower.includes("orbit"))
 ) {
 try {
 return { text: await formatOrbitSupplyStatus(publicKey), action: null };
 } catch (err: any) {
 return { text: err?.message ?? "Orbit Supply unavailable.", action: null };
 }
 }

 if (lower.includes("aquarius") || lower.includes("aqua pool")) {
 try {
 return { text: await formatAquariusPools(), action: null };
 } catch {
 return { text: "Aquarius testnet API unavailable right now.", action: null };
 }
 }

 // Soroswap faucet (docs: POST /api/faucet)
 const faucetMatch = content.match(FAUCET_RE);
 if (faucetMatch) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 if (!soroswapConfigured()) {
 return { text: "Soroswap faucet needs SOROSWAP_API_KEY in .env.", action: null };
 }
 const symbol = (faucetMatch[1] || faucetMatch[2] || "").toUpperCase();
 if (!symbol) {
 return { text: "Specify a token to mint, e.g. \"faucet USDC\".", action: null };
 }
 try {
 const token = await resolveSoroswapToken(symbol);
 if (!token) {
 return {
 text: `Unknown Soroswap testnet token "${symbol}". Try USDC, AQUA, or XLM.`,
 action: null,
 };
 }
 await faucetSoroswapToken(publicKey, token.contract);
 const tip =
 symbol === "USDC"
 ? " This is Circle testnet USDC - usable for Blend supply, Orbit Perps, and StelDex (as cUSDC)."
 : "";
 return {
 text: `Minted testnet ${symbol} to your wallet via the Soroswap faucet (${token.contract.slice(0, 8)}…). Check balances in a moment.${tip}`,
 action: null,
 };
 } catch (err: any) {
 return {
 text: `Faucet failed: ${err?.message ?? "unknown error"}. You can also mint at https://testnet.soroswap.finance while on Testnet.`,
 action: null,
 };
 }
 }

 if (lower.includes("soroswap") || lower.includes("phoenix") || lower.includes("aggregator")) {
 if (publicKey && (lower.includes("position") || lower.includes("lp") || lower.includes("have"))) {
 try {
 return { text: await formatSoroswapPositions(publicKey), action: null };
 } catch {
 // fall through
 }
 }
 try {
 return { text: await formatSoroswapStatus(), action: null };
 } catch {
 return { text: AI_RESPONSES.swap, action: null };
 }
 }

 // StelDex reads
 if (
 lower.includes("steldex") &&
 (lower.includes("have") ||
 lower.includes("position") ||
 lower.includes("holding") ||
 lower.includes("balance") ||
 lower.includes("what do i"))
 ) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 return { text: await formatSteldexHoldings(publicKey), action: null };
 } catch {
 return { text: "I couldn't load your StelDex positions right now.", action: null };
 }
 }

 // Earning vs idle - explicit phrasing only (full dump avoided for balance questions)
 if (
 lower.includes("what's earning") ||
 lower.includes("what is earning") ||
 lower.includes("whats earning") ||
 lower.includes("not earning") ||
 lower.includes("what's idle") ||
 lower.includes("what is idle") ||
 lower.includes("idle capital") ||
 (lower.includes("earning") && (lower.includes("idle") || lower.includes("vs")))
 ) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 return { text: await formatEarningReport(publicKey), action: null };
 } catch {
 return { text: "Couldn't build earning report. Fund the wallet and try again.", action: null };
 }
 }

 // Rebalance plan
 if (
 lower.includes("rebalance") ||
 lower.includes("where should i put") ||
 lower.includes("where should i deploy") ||
 lower.includes("move liquidity") ||
 lower.includes("what should i do with") ||
 (lower.includes("move") && (lower.includes("lp") || lower.includes("position")))
 ) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 return { text: await formatRebalancePlan(publicKey), action: null };
 } catch {
 return { text: "Couldn't build a rebalance plan right now.", action: null };
 }
 }

 if (
 lower.includes("portfolio") ||
 lower.includes("all positions") ||
 lower.includes("everything i have") ||
 lower.includes("full portfolio") ||
 (lower.includes("my positions") && !lower.includes("steldex")) ||
 (lower.includes("positions") &&
 (lower.includes("all") ||
 lower.includes("every") ||
 lower.includes("portfolio")))
 ) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 return { text: await formatPortfolioSummary(publicKey), action: null };
 } catch {
 return {
 text: "I couldn't load your portfolio from Stellar testnet. Check your wallet is on Testnet and the account is funded (Friendbot).",
 action: null,
 };
 }
 }

 if (
 lower.includes("activity") ||
 lower.includes("history") ||
 lower.includes("transactions") ||
 lower.includes("recent ops")
 ) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 return { text: await formatRecentActivity(publicKey), action: null };
 } catch {
 return { text: "I couldn't load recent activity from Stellar right now.", action: null };
 }
 }

 if (lower.includes("yield") || lower.includes("earn") || lower.includes("apy") || lower.includes("interest")) {
 const assetMatch = content.match(YIELD_ASSET_RE);
 try {
 return { text: await formatYieldOpportunities(assetMatch?.[1]), action: null };
 } catch {
 return { text: "I couldn't load yield opportunities right now.", action: null };
 }
 }

 if (
 lower.includes("market") ||
 lower.includes("price") ||
 lower.includes("how much is") ||
 lower.includes("trading at")
 ) {
 const priceMatch = content.match(PRICE_ASSET_RE);
 try {
 return {
 text: await formatMarketOverview(priceMatch?.[1] ?? priceMatch?.[2]),
 action: null,
 };
 } catch {
 return { text: "I couldn't load market data right now.", action: null };
 }
 }

 if (
 lower.includes("steldex") ||
 lower.includes("pools") ||
 (lower.includes("liquidity") && !lower.includes("add liquidity") && !lower.includes("remove"))
 ) {
 try {
 return { text: await formatSteldexPools(), action: null };
 } catch {
 return { text: AI_RESPONSES.steldexHelp, action: null };
 }
 }

 if (lower.includes("send") || lower.includes("transfer") || lower.includes("payment")) {
 return { text: AI_RESPONSES.send, action: null };
 }
 if (lower.includes("swap") || lower.includes("exchange") || lower.includes("convert")) {
 return { text: AI_RESPONSES.swap, action: null };
 }
 if (
 lower.includes("stake") ||
 lower.includes("farm") ||
 lower.includes("unstake") ||
 lower.includes("claim") ||
 lower.includes("add liquidity") ||
 lower.includes("remove liquidity") ||
 lower.includes("limit order")
 ) {
 return { text: AI_RESPONSES.steldexHelp, action: null };
 }
 if (lower.includes("trustline") || lower.includes("trust line")) {
 return { text: AI_RESPONSES.trustline, action: null };
 }
 if (
 lower.includes("help") ||
 lower.includes("what can you") ||
 lower.includes("capabilities") ||
 lower.includes("how do i")
 ) {
 return { text: CAPABILITIES_TEXT, action: null };
 }

 return { text: AI_RESPONSES.default, action: null };
}

function isGenericReply(text: string): boolean {
 return text === AI_RESPONSES.default || text === CAPABILITIES_TEXT;
}

async function getAiResponse(
 content: string,
 publicKey: string | null,
 opts?: { sessionId?: number }
): Promise<ChatReply> {
 // Spelling / alias normalization before all routing (pudsc → pUSDC, blennd → blend)
 const normalized = normalizeUserMessageText(content);

 // 0) Mainnet execution asks → educate and refuse (testnet-only engine)
 if (isMainnetExecutionAsk(normalized)) {
 return { text: mainnetGuardrailText(), action: null };
 }

 // 1) Transaction / action intents (deterministic, always)
 const actionPass = await getDeterministicResponse(normalized, publicKey, {
 readQueries: false,
 sessionId: opts?.sessionId,
 });
 if (actionPass.action || actionPass.actions?.length || actionPass.gallery) {
 return actionPass;
 }
 // Clarification / list text from deterministic path (e.g. ambiguous markets)
 if (
 actionPass.text &&
 actionPass.text !== AI_RESPONSES.default &&
 !isGenericReply(actionPass.text)
 ) {
 // Allow deterministic text-only replies for predict clarify / list / errors
 const looksLikeActionText =
 /several markets match|orbit predict|no market matched|prepared \d+ swaps|on-chain prediction/i.test(
 actionPass.text
 ) || actionPass.pendingPredict;
 if (looksLikeActionText) return actionPass;
 }

 // 1.25) Live Blend health for connected wallets
 if (
 publicKey &&
 /\b(?:blend\s+health|health\s+(?:on\s+)?blend|my\s+(?:blend\s+)?health(?:\s+factor)?)\b/i.test(
 normalized
 )
 ) {
 try {
 const report = await formatBlendHealthReport(publicKey);
 return { text: report, action: null };
 } catch {
 // fall through
 }
 }

 // 1.5) Teach path: IL/health math → concept graph → RAG (cited)
 const taught = tryTeachAnswer(normalized);
 if (taught) {
 return { text: taught, action: null };
 }

 // 2) LLM picks tools and answers only what was asked (with multi-turn + coach + RAG tool)
 if (llmConfigured()) {
 try {
 const history =
 opts?.sessionId != null
 ? await listPriorChatTurns(opts.sessionId, 8).catch(() => [])
 : [];
 const llm = await timed("chat.llm", () =>
 runLlmCopilot(normalized, publicKey, { history })
 );
 if (llm && (llm.text || llm.action || llm.actions?.length)) {
 let action = (llm.action as ChatAction | null) ?? null;
 let actions = (llm.actions as ChatAction[] | undefined) ?? undefined;
 let text = llm.text || "";
 if (actions?.length) {
 const gatedList: ChatAction[] = [];
 for (const a of actions) {
 const { action: gated, trustlineText, blockText } = await enrichChatActionWithTrustline(
 a as unknown as Record<string, unknown>,
 { publicKey }
 );
 if (blockText) {
 return { text: blockText, action: null };
 }
 if (gated) gatedList.push(gated as ChatAction);
 if (trustlineText && !text) text = trustlineText;
 }
 actions = gatedList;
 action = gatedList[0] ?? null;
 } else if (action) {
 const { action: gated, trustlineText, blockText } = await enrichChatActionWithTrustline(
 action as unknown as Record<string, unknown>,
 { publicKey }
 );
 if (blockText) {
 return { text: blockText, action: null };
 }
 if (gated) action = gated as ChatAction;
 if (trustlineText) text = trustlineText;
 }
 return { text, action, actions };
 }
 } catch {
 // fall through
 }
 }

 // 3) No LLM - minimal wallet balance answers (no portfolio essay)
 if (publicKey) {
 try {
 const wallet = await answerWalletQueryFromMessage(publicKey, normalized);
 if (wallet) return { text: wallet, action: null };
 } catch {
 // fall through
 }
 }

 // 4) Deterministic read fallbacks (protocol lists, explicit earning/rebalance, etc.)
 const deterministic = await getDeterministicResponse(normalized, publicKey, {
 readQueries: true,
 sessionId: opts?.sessionId,
 });
 if (deterministic.action || deterministic.actions?.length || !isGenericReply(deterministic.text)) {
 return deterministic;
 }

 // 5) Weaker explain fallback before dumping capabilities
 const explained = tryExplainAnswer(normalized);
 if (explained) return { text: explained, action: null };

 return deterministic;
}

function resolvePublicKey(context: string | null | undefined): string | null {
 if (!context) return null;
 const key = context.trim();
 return /^G[A-Z2-7]{55}$/.test(key) ? key : null;
}

router.get("/chat/sessions", async (req, res): Promise<void> => {
 try {
 const wallet =
 typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
 const sessions = await listRecentSessions(wallet || null);
 res.json(
 sessions.map((s) => ({
 id: s.id,
 walletPublicKey: s.walletPublicKey,
 title: s.title,
 updatedAt: s.updatedAt.toISOString(),
 createdAt: s.createdAt.toISOString(),
 }))
 );
 } catch (err) {
 console.error("[chat] GET /sessions failed:", err);
 res.status(503).json({
 error:
 err instanceof Error
 ? err.message
 : "Chat sessions unavailable (Postgres)",
 });
 }
});

router.post("/chat/sessions", async (req, res): Promise<void> => {
 try {
 const wallet =
 typeof req.body?.context === "string"
 ? req.body.context.trim()
 : typeof req.query.wallet === "string"
 ? req.query.wallet.trim()
 : "";
 const key =
 wallet && /^G[A-Z2-7]{55}$/.test(wallet) ? wallet : null;
 const session = await createChatSession(key);
 res.status(201).json({
 id: session.id,
 walletPublicKey: session.walletPublicKey,
 title: session.title,
 updatedAt: session.updatedAt.toISOString(),
 createdAt: session.createdAt.toISOString(),
 });
 } catch (err) {
 console.error("[chat] POST /sessions failed:", err);
 res.status(503).json({
 error:
 err instanceof Error
 ? err.message
 : "Chat session unavailable (Postgres)",
 });
 }
});

router.get("/chat/messages", async (req, res): Promise<void> => {
 try {
 const rawSession =
 typeof req.query.sessionId === "string"
 ? req.query.sessionId
 : typeof req.query.session === "string"
 ? req.query.session
 : "";
 const sessionId = parseInt(rawSession, 10);
 if (!Number.isFinite(sessionId) || sessionId <= 0) {
 res.json(GetChatMessagesResponse.parse([]));
 return;
 }

 const session = await getChatSession(sessionId);
 if (!session) {
 res.status(404).json({ error: "Chat session not found" });
 return;
 }

 const wallet =
 typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
 const key =
 wallet && /^G[A-Z2-7]{55}$/.test(wallet) ? wallet : null;

 // Allow access if: session is anonymous (no wallet), wallet matches, or requester is anonymous
 if (session.walletPublicKey !== null && key !== null && session.walletPublicKey !== key) {
 res.status(403).json({ error: "Session does not belong to this wallet" });
 return;
 }

 const messages = await listChatMessages(sessionId);

 res.json(
 GetChatMessagesResponse.parse(
 messages.map((m) => ({
 id: m.id,
 role: m.role,
 content: m.content,
 metadata: m.metadata,
 createdAt: m.createdAt.toISOString(),
 }))
 )
 );
 } catch (err) {
 console.error("[chat] GET /messages failed:", err);
 res.status(503).json({
 error:
 err instanceof Error
 ? err.message
 : "Chat history unavailable (Postgres)",
 });
 }
});

router.post("/chat/messages", async (req, res): Promise<void> => {
 try {
 const bodyParsed = SendChatMessageBody.safeParse(req.body);
 if (!bodyParsed.success) {
 res.status(400).json({ error: bodyParsed.error.message });
 return;
 }

 const publicKey = resolvePublicKey(bodyParsed.data.context);
 const rawSessionId = (req.body as { sessionId?: unknown }).sessionId;
 let sessionId =
 typeof rawSessionId === "number"
 ? rawSessionId
 : typeof rawSessionId === "string"
 ? parseInt(rawSessionId, 10)
 : NaN;

 if (!Number.isFinite(sessionId) || sessionId <= 0) {
 const session = await createChatSession(publicKey);
 sessionId = session.id;
 } else {
 const session = await getChatSession(sessionId);
 if (!session) {
 res.status(404).json({ error: "Chat session not found" });
 return;
 }
 // Allow access if session is anonymous, wallet matches, or requester is anonymous
 if (session.walletPublicKey !== null && publicKey !== null && session.walletPublicKey !== publicKey) {
 res.status(403).json({ error: "Session does not belong to this wallet" });
 return;
 }
 }

 await insertChatMessage({
 walletPublicKey: publicKey,
 sessionId,
 role: "user",
 content: bodyParsed.data.content,
 metadata: publicKey ? { publicKey } : null,
 });

 // Check if client wants SSE streaming
 const wantsStream = req.headers.accept === "text/event-stream";

 if (wantsStream) {
 res.setHeader("Content-Type", "text/event-stream");
 res.setHeader("Cache-Control", "no-cache");
 res.setHeader("Connection", "keep-alive");
 res.setHeader("X-Accel-Buffering", "no");
 res.flushHeaders();

 const sendEvent = (data: Record<string, unknown>) => {
 res.write(`data: ${JSON.stringify(data)}\n\n`);
 };

 sendEvent({ type: "session", sessionId });

 try {
 const { text: aiContent, action, actions, gallery } = await timed("chat.respond", () =>
 getAiResponse(bodyParsed.data.content, publicKey, { sessionId })
 );

 // Stream text in ~40-char chunks for a typing effect
 const chunkSize = 40;
 for (let i = 0; i < aiContent.length; i += chunkSize) {
 sendEvent({ type: "delta", text: aiContent.slice(i, i + chunkSize) });
 // Small yield to allow flush
 await new Promise((r) => setTimeout(r, 8));
 }

 const meta: Record<string, unknown> = {};
 if (action) meta.action = action;
 if (actions?.length) {
 meta.actions = actions;
 if (!meta.action) meta.action = actions[0];
 }
 if (gallery) meta.gallery = gallery;

 const aiMessage = await insertChatMessage({
 walletPublicKey: publicKey,
 sessionId,
 role: "assistant",
 content: aiContent,
 metadata: Object.keys(meta).length ? meta : null,
 });

 sendEvent({
 type: "done",
 id: aiMessage.id,
 role: aiMessage.role,
 content: aiMessage.content,
 metadata: aiMessage.metadata,
 createdAt: aiMessage.createdAt.toISOString(),
 sessionId,
 });
 } catch (err) {
 sendEvent({ type: "error", error: err instanceof Error ? err.message : "Chat failed" });
 }

 res.end();
 return;
 }

 // Non-streaming fallback (existing behaviour)
 const { text: aiContent, action, actions, gallery } = await timed("chat.respond", () =>
 getAiResponse(bodyParsed.data.content, publicKey, { sessionId })
 );

 const meta: Record<string, unknown> = {};
 if (action) meta.action = action;
 if (actions?.length) {
 meta.actions = actions;
 if (!meta.action) meta.action = actions[0];
 }
 if (gallery) meta.gallery = gallery;

 const aiMessage = await insertChatMessage({
 walletPublicKey: publicKey,
 sessionId,
 role: "assistant",
 content: aiContent,
 metadata: Object.keys(meta).length ? meta : null,
 });

 res.status(201).json({
 ...SendChatMessageResponse.parse({
 id: aiMessage.id,
 role: aiMessage.role,
 content: aiMessage.content,
 metadata: aiMessage.metadata,
 createdAt: aiMessage.createdAt.toISOString(),
 }),
 sessionId,
 });
 } catch (err) {
 console.error("[chat] POST /messages failed:", err);
 res.status(503).json({
 error: err instanceof Error ? err.message : "Chat failed (Postgres)",
 });
 }
});

router.delete("/chat/messages/:id", async (req, res): Promise<void> => {
 try {
 const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const params = DeleteChatMessageParams.safeParse({ id: parseInt(raw, 10) });
 if (!params.success) {
 res.status(400).json({ error: params.error.message });
 return;
 }

 await deleteChatMessage(params.data.id);
 res.sendStatus(204);
 } catch (err) {
 console.error("[chat] DELETE /messages failed:", err);
 res.status(503).json({
 error:
 err instanceof Error
 ? err.message
 : "Delete failed (Postgres)",
 });
 }
});

router.post("/chat/clear", async (req, res): Promise<void> => {
 try {
 const wallet =
 typeof req.body?.context === "string"
 ? req.body.context.trim()
 : typeof req.query.wallet === "string"
 ? req.query.wallet.trim()
 : "";

 const key =
 wallet && /^G[A-Z2-7]{55}$/.test(wallet) ? wallet : null;
 const session = await clearChatMessages(key);
 res.json({
 success: true,
 message: "New chat started",
 sessionId: session.id,
 });
 } catch (err) {
 console.error("[chat] POST /clear failed:", err);
 res.status(503).json({
 error:
 err instanceof Error
 ? err.message
 : "Clear failed (Postgres)",
 });
 }
});

export default router;
