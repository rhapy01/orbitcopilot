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
import {
  clarifyPrompt,
  clearPendingAction,
  getPendingAction,
  INCOMPLETE_BORROW_RE,
  INCOMPLETE_DEPOSIT_RE,
  INCOMPLETE_REPAY_RE,
  INCOMPLETE_SEND_RE,
  INCOMPLETE_SUPPLY_RE,
  INCOMPLETE_SWAP_DEST_RE,
  INCOMPLETE_SWAP_PAIR_RE,
  INCOMPLETE_WITHDRAW_RE,
  parseFollowUpAmount,
  parseFollowUpAsset,
  pendingActionKey,
  setPendingAction,
  synthesizeIntentFromPending,
  synthesizeLpIntentFromPending,
} from "../lib/pending-action";
import {
  askForCollectionDetails,
  askForCollectionMedia,
  clearNftCollectionDraft,
  extractImageUrl,
  getNftCollectionDraft,
  isCancelWizard,
  isUploadIntent,
  nftCollectionDraftKey,
  parseDetailsReply,
  setNftCollectionDraft,
} from "../lib/pending-nft-collection";
import { isLpAutoAmount } from "../lib/defi-math";
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
 collectionPromptComplete,
 parseCollectionPromptFields,
 prepareNftBuy,
 prepareNftCancelListing,
 prepareNftList,
 prepareNftMint,
 prepareNftTransfer,
 type NftGalleryPayload,
} from "../lib/nft";
import {
 formatTokenLaunchHelp,
 prepareTokenLaunch,
 prepareTokenMint,
} from "../lib/token-launch";
import {
 BlendRequestType,
 formatBlendMarkets,
 preflightBlendWalletSpend,
 resolveBlendReserve,
} from "../lib/blend";
import {
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
 NFT_CANCEL_RE,
 NFT_CLAIM_BETA_RE,
 NFT_CREATE_COLLECTION_RE,
 NFT_LIST_RE,
 NFT_MINT_RE,
 NFT_TRANSFER_RE,
 ORBIT_SUPPLY_CLAIM_RE,
 ORBIT_SUPPLY_DEPOSIT_RE,
 ORBIT_SUPPLY_WITHDRAW_RE,
 PERP_CLOSE_RE,
 PREDICT_CLAIM_RE,
 TOKEN_LAUNCH_RE,
 TOKEN_MINT_SUPPLY_RE,
} from "../lib/chat-intents";
import {
 formatOrbitSupplyStatus,
 prepareOrbitSupplyClaim,
 prepareOrbitSupplyDeposit,
 prepareOrbitSupplyWithdraw,
} from "../lib/orbit-supply";
import { BETA_NFT_NAME, BETA_NFT_URI, BETA_NFT_MAX_SUPPLY } from "../lib/beta-nft";
import { getBetaNftClaimedCount, resolveBetaNftStatus } from "../lib/product-store";
import {
  defindexConfigured,
  formatDefindexStatus,
  prepareDefindexDeposit,
  prepareDefindexWithdraw,
} from "../lib/defindex";
import {
  formatMeridianStatus,
  prepareMeridianDeposit,
  prepareMeridianWithdraw,
} from "../lib/meridian";

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
 "Unicorn StelDex (Testnet) - three different actions:\n\n1. Liquidity provision (one amount + pair — Orbit auto-sizes the other side):\n \"add 100 USDC to liquidity\" → pick pair (XLM or pUSDC)\n \"add 100 USDC and XLM to liquidity on StelDex\"\n\n2. Yield farming (stake the LP tokens you got from step 1):\n \"stake my XLM/pUSDC LP for 52 weeks\"\n\n3. Single-asset staking (where supported):\n Stake a single token to earn rewards.\n\nOther actions:\n \"remove liquidity XLM/pUSDC\"\n \"claim rewards from XLM/pUSDC\"\n \"unstake XLM/pUSDC\"\n \"swap 10 XLM to pUSDC\"\n \"what do I have on StelDex?\"",
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
const LP_VERB = String.raw`(?:add|provide|supply)`;
const LP_PAIR_SEP = String.raw`(?:and|with|\/|\+)`;
const STELDEX_ADD_LIQUIDITY_RE = new RegExp(
 String.raw`\b${LP_VERB}\s+liquidity\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+${LP_PAIR_SEP}\s+([\d.]+|AUTO|\*|max)\s*([a-zA-Z]{2,10})`,
 "i"
);
// Handles "add 2xlm and 2pusdc to liquidity" / "supply 100 usdc + 50 xlm as liquidity"
const STELDEX_ADD_LIQUIDITY_ALT_RE = new RegExp(
 String.raw`\b${LP_VERB}\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+${LP_PAIR_SEP}\s+([\d.]+|AUTO|\*|max)\s*([a-zA-Z]{2,10})\b(?:.*\bliquidit)`,
 "i"
);
// One-sided: amount + asset + pair asset (no second amount) — e.g. "supply 100 USDC + XLM as liquidity"
const STELDEX_ADD_LIQUIDITY_ONE_SIDED_RE = new RegExp(
 String.raw`\b${LP_VERB}\s+liquidity\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+${LP_PAIR_SEP}\s+([a-zA-Z]{2,10})\b` +
 String.raw`|\b${LP_VERB}\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+${LP_PAIR_SEP}\s+([a-zA-Z]{2,10})\b(?:.*\bliquidit)`,
 "i"
);
// Single amount only — ask for pair asset (never a second amount)
const STELDEX_ADD_LIQUIDITY_SINGLE_RE = new RegExp(
 String.raw`\b${LP_VERB}(?:\s+liquidity)?\s+([\d.]+)\s*([a-zA-Z]{2,10})\b(?!\s*${LP_PAIR_SEP}\s+[a-zA-Z])(?:.*\bliquidit)`,
 "i"
);
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

// DeFindex public vaults (testnet) — XLM + Blend USDC
// "deposit 10 XLM into defindex" / "deposit 5 USDC into defindex" / "withdraw 2 xlm from defindex"
const DEFINDEX_DEPOSIT_RE =
  /\b(?:deposit|supply|stake)\s+([\d.]+)\s*(xlm|usdc|cetes)\b(?:.*?\b(?:into|to|on|in)\b.*?\bdefindex\b|\s+defindex\b)|\bdefindex\b.*?\b(?:deposit|supply)\s+([\d.]+)\s*(xlm|usdc|cetes)\b/i;
const DEFINDEX_WITHDRAW_RE =
  /\bwithdraw\s+([\d.]+)\s*(xlm|usdc|cetes)\b(?:.*?\b(?:from|on)\b.*?\bdefindex\b|\s+defindex\b)|\bdefindex\b.*?\bwithdraw\s+([\d.]+)\s*(xlm|usdc|cetes)\b/i;
// Meridian USDC vault
const MERIDIAN_DEPOSIT_RE =
  /\b(?:deposit|supply)\s+([\d.]+)\s*usdc\b(?:.*?\b(?:into|to|on|in)\b.*?\bmeridian\b|\s+meridian\b)|\bmeridian\b.*?\b(?:deposit|supply)\s+([\d.]+)\s*usdc\b/i;
const MERIDIAN_WITHDRAW_RE =
  /\bwithdraw\s+([\d.]+)\s*(?:usdc|musdc|shares?)?\b(?:.*?\b(?:from|on)\b.*?\bmeridian\b|\s+meridian\b)|\bmeridian\b.*?\bwithdraw\s+([\d.]+)/i;

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
 | "nft_cancel"
 | "nft_create_collection"
 | "token_deploy"
 | "token_mint"
 | "orbit_supply_deposit"
 | "orbit_supply_withdraw"
    | "orbit_supply_claim"
    | "defindex_deposit"
    | "defindex_withdraw"
    | "meridian_deposit"
    | "meridian_withdraw"
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
 tokenName?: string;
 description?: string;
 imageUrl?: string;
 website?: string;
 maxSupply?: number;
 royaltyBps?: number;
 /** User explicitly set max supply (including 0 = unlimited). */
 supplySpecified?: boolean;
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
 publicKey: string | null,
 opts?: { sessionId?: number }
): Promise<IntentResult> {
 const addLiqMatch = content.match(STELDEX_ADD_LIQUIDITY_RE) ?? content.match(STELDEX_ADD_LIQUIDITY_ALT_RE);
 const addLiqOneSided = !addLiqMatch ? content.match(STELDEX_ADD_LIQUIDITY_ONE_SIDED_RE) : null;
 const addLiqSingle = !addLiqMatch && !addLiqOneSided ? content.match(STELDEX_ADD_LIQUIDITY_SINGLE_RE) : null;

 if (addLiqSingle) {
  const [, amountA, symbolA] = addLiqSingle;
  const key = pendingActionKey(publicKey, opts?.sessionId);
  setPendingAction(key, {
   kind: "add_liquidity",
   amount: amountA!,
   asset: symbolA!.toUpperCase(),
   protocol: /\bsoroswap\b/i.test(content) ? "soroswap" : "steldex",
   promptHint: `You want to add **${amountA} ${symbolA!.toUpperCase()}** to a liquidity pool.\n\nWhich second asset should pair with it?\n\nReply with an asset code, e.g. \`XLM\` or \`pUSDC\` — I'll keep **${amountA} ${symbolA!.toUpperCase()}** fixed and calculate the matching amount from the live pool ratio.`,
  });
  return { kind: "text", text: clarifyPrompt(getPendingAction(key)!) };
 }

 if (addLiqMatch || addLiqOneSided) {
 const amountA = addLiqMatch
  ? addLiqMatch[1]!
  : (addLiqOneSided![1] || addLiqOneSided![4])!;
 const symbolA = addLiqMatch
  ? addLiqMatch[2]!
  : (addLiqOneSided![2] || addLiqOneSided![5])!;
 const amountB = addLiqMatch ? addLiqMatch[3]! : "AUTO";
 const symbolB = addLiqMatch
  ? addLiqMatch[4]!
  : (addLiqOneSided![3] || addLiqOneSided![6])!;
 const oneSided = isLpAutoAmount(amountB);
 const pool = await resolveSteldexPool(symbolA, symbolB);
 if (pool) {
 const a = normalizeSteldexSymbol(symbolA);
 const amount0Raw = a === pool.symbol0 ? amountA : oneSided ? "AUTO" : amountB;
 const amount1Raw = a === pool.symbol0 ? (oneSided ? "AUTO" : amountB) : amountA;
 const anchorSide: 0 | 1 | undefined = oneSided
  ? a === pool.symbol0
   ? 0
   : 1
  : undefined;

 const matched = await matchSteldexAddLiquidityAmounts({
 symbol0: pool.symbol0,
 symbol1: pool.symbol1,
 token0Contract: pool.token0Contract,
 token1Contract: pool.token1Contract,
 amount0Max: amount0Raw,
 amount1Max: amount1Raw,
 anchorSide,
 });
 const final0 = matched?.amount0 ?? (amount0Raw === "AUTO" ? null : amount0Raw);
 const final1 = matched?.amount1 ?? (amount1Raw === "AUTO" ? null : amount1Raw);
 if (!final0 || !final1) {
  return {
   kind: "text",
   text: `Could not quote the ${pool.pair} pool ratio to size your LP. Try again in a moment, or give both amounts explicitly (e.g. \"add liquidity 100 ${symbolA} and 10 ${symbolB}\").`,
  };
 }
 const ratioNote = matched
 ? matched.adjusted
 ? ` ${matched.note}`
 : ` Pool ratio OK (${pool.symbol0}/${pool.symbol1}).`
 : " (Could not verify pool ratio live - if the tx fails, amounts may be unbalanced.)";

 return {
 kind: "action",
 text: `Ready to add ${final0} ${pool.symbol0} and ${final1} ${pool.symbol1} to ${pool.pair} on StelDex (full-range).${ratioNote} Sign one step at a time with your connected wallet.`,
 action: {
 type: "steldex_add_liquidity",
 ...withFullRange(pool),
 sendAmount: final0,
 amountB: final1,
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
 amountBMax: oneSided ? "AUTO" : amountB!,
 anchorSide: oneSided ? 0 : undefined,
 });
 const outA = matched?.amount0 ?? amountA!;
 const outB = matched?.amount1;
 if (oneSided && !outB) {
  return {
   kind: "text",
   text: `Could not quote Soroswap ${symbolA}/${symbolB} to size your LP. Try giving both amounts explicitly.`,
  };
 }
 const ratioNote = matched
 ? matched.adjusted
 ? ` ${matched.note}`
 : " Pool ratio OK."
 : " (Could not verify pool ratio live - if the tx fails, amounts may be unbalanced.)";

 return {
 kind: "action",
 text: `Soroswap add liquidity: ${outA} ${symbolA!.toUpperCase()} + ${outB ?? amountB} ${symbolB!.toUpperCase()}.${ratioNote} Sign with your connected wallet.`,
 action: {
 type: "soroswap_add_liquidity",
 sendAmount: outA,
 amountB: outB ?? amountB!,
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
 if (/^(the\s+)?(epl|fa\s*cup|premier)/i.test(content.trim())) {
 return {
 text: formatAmbiguousMarkets(pending.markets),
 action: null,
 };
 }
 const numOnly = content.trim().match(/^#?(\d+)\.?$/);
 if (numOnly) {
 const n = Number(numOnly[1]);
 if (n >= 1 && n <= pending.markets.length) {
 return {
 text: formatAmbiguousMarkets(pending.markets),
 action: null,
 };
 }
 // Larger numbers (e.g. "50") may be an amount for a pending swap — fall through
 }
 }
 }

 // Follow-up after amount / LP-pair clarify: "50", "50 XLM", "xlm"
 {
 const key = pendingActionKey(publicKey, sessionId);
 const pendingAct = getPendingAction(key);
 if (pendingAct) {
 if (/^(cancel|nevermind|never\s*mind|stop|no)\s*!?\s*$/i.test(content.trim())) {
 clearPendingAction(key);
 return { text: "Cancelled — tell me what you’d like to do next.", action: null };
 }
 if (pendingAct.kind === "add_liquidity") {
  const assetReply = parseFollowUpAsset(content, pendingAct.asset);
  if (assetReply) {
   const synthetic = synthesizeLpIntentFromPending(pendingAct, assetReply);
   if (synthetic) {
    clearPendingAction(key);
    return getDeterministicResponse(synthetic, publicKey, options);
   }
  }
  // "50 XLM" as second side with explicit amount → two-sided LP
  const amtReply = parseFollowUpAmount(content);
  if (amtReply?.assetHint && pendingAct.amount && pendingAct.asset) {
   clearPendingAction(key);
   const synthetic = `add liquidity ${pendingAct.amount} ${pendingAct.asset} and ${amtReply.amount} ${amtReply.assetHint} on ${pendingAct.protocol || "steldex"}`;
   return getDeterministicResponse(synthetic, publicKey, options);
  }
  if (content.trim().split(/\s+/).length <= 6) {
   return {
    text: `${clarifyPrompt(pendingAct)}\n\n(Reply with an asset like **XLM**, or say **cancel**.)`,
    action: null,
   };
  }
  clearPendingAction(key);
 } else {
 const parsed = parseFollowUpAmount(content);
 if (parsed) {
 const synthetic = synthesizeIntentFromPending(
 pendingAct,
 parsed.amount,
 parsed.assetHint
 );
 if (synthetic) {
 clearPendingAction(key);
 return getDeterministicResponse(synthetic, publicKey, options);
 }
 }
 // Short replies that aren't amounts → re-ask; long new intents clear pending
 if (content.trim().split(/\s+/).length <= 6) {
 return {
 text: `${clarifyPrompt(pendingAct)}\n\n(I still need a number to continue — or say **cancel**.)`,
 action: null,
 };
 }
 clearPendingAction(key);
 }
 }
 }

 // Multi-turn NFT collection create wizard
 {
 const draftKey = nftCollectionDraftKey(publicKey, sessionId);
 const draft = getNftCollectionDraft(draftKey);
 if (draft) {
 if (isCancelWizard(content)) {
 clearNftCollectionDraft(draftKey);
 return { text: "Cancelled collection setup — say when you want to start again.", action: null };
 }
 // Starting a new collection replaces the draft (handled below via regex)
 if (!NFT_CREATE_COLLECTION_RE.test(content)) {
 if (draft.step === "awaiting_details") {
 const details = parseDetailsReply(content);
 const supplyInReply = content.match(
 /\b(?:total\s+supply|max(?:\s+supply)?|supply|ts)\s*(?:is|=|:)?\s*(\d+)\b/i
 );
 const unlimited = /\b(?:unlimited|no\s+max)\b/i.test(content);
 let supplySpecified = draft.supplySpecified;
 let maxSupply = draft.maxSupply;
 if (unlimited) {
 supplySpecified = true;
 maxSupply = 0;
 } else if (supplyInReply?.[1]) {
 supplySpecified = true;
 maxSupply = Math.max(0, parseInt(supplyInReply[1], 10) || 0);
 }
 if (!details.description || details.description.length < 8) {
 return {
 text: `${askForCollectionDetails(draft)}\n\n(Need a bit more detail — at least a short description.)`,
 action: null,
 };
 }
 const next = {
 ...draft,
 description: details.description,
 traits: details.traits ?? draft.traits,
 website: details.website ?? draft.website,
 royaltyBps: details.royaltyBps ?? draft.royaltyBps,
 supplySpecified,
 maxSupply,
 step: "awaiting_media" as const,
 };
 setNftCollectionDraft(draftKey, next);
 return { text: askForCollectionMedia(next), action: null };
 }

 if (draft.step === "awaiting_media") {
 const imageUrl = extractImageUrl(content);
 const preferUpload = isUploadIntent(content);
 if (!imageUrl && !preferUpload) {
 return {
 text: `${askForCollectionMedia(draft)}\n\n(Paste a URL or say **upload**.)`,
 action: null,
 };
 }
 clearNftCollectionDraft(draftKey);
 const traitsNote = draft.traits
 ? `\nTraits / rarity: ${draft.traits}`
 : "";
 return {
 text: [
 `All set — **${draft.name}** (${draft.symbol}) is ready to deploy.`,
 draft.description ? `Description: ${draft.description}` : null,
 `Max supply: ${draft.supplySpecified ? (draft.maxSupply === 0 ? "unlimited" : draft.maxSupply) : "not set (use the card)"}.`,
 `Royalty: ${(draft.royaltyBps / 100).toFixed(2)}% · Orbit fee: 0.5%.`,
 preferUpload
 ? "Attach your artwork on the card, review, then sign."
 : "Review the card and sign to create the collection.",
 ].filter(Boolean).join("\n"),
 action: {
 type: "nft_create_collection",
 marketHint: `${draft.name} (${draft.symbol})`,
 sendAsset: draft.symbol,
 description: draft.description
 ? `${draft.description}${traitsNote}`
 : undefined,
 imageUrl: imageUrl || undefined,
 website: draft.website,
 maxSupply: draft.maxSupply,
 royaltyBps: draft.royaltyBps,
 supplySpecified: draft.supplySpecified,
 } as ChatAction,
 };
 }
 }
 }
 }

 // Incomplete tx intents (no amount) → ask for the figure before LLM can digress
 {
 const key = pendingActionKey(publicKey, sessionId);
 const hasLeadingAmount =
 /\b(?:swap|exchange|convert|send|transfer|pay|supply|lend|deposit|withdraw|borrow|repay)\s+[\d.]+/i.test(
 content
 );

 if (!hasLeadingAmount && !SWAP_INTENT_RE.test(content) && !SEND_INTENT_RE.test(content)) {
 const swapPair = content.match(INCOMPLETE_SWAP_PAIR_RE);
 if (swapPair) {
 setPendingAction(key, {
 kind: "swap",
 fromAsset: swapPair[1]!.toUpperCase(),
 toAsset: swapPair[2]!.toUpperCase(),
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const swapDest = content.match(INCOMPLETE_SWAP_DEST_RE);
 if (swapDest) {
 setPendingAction(key, {
 kind: "swap",
 fromAsset: "XLM",
 toAsset: swapDest[1]!.toUpperCase(),
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const sendInc = content.match(INCOMPLETE_SEND_RE);
 if (sendInc) {
 setPendingAction(key, {
 kind: "send",
 asset: sendInc[1]!.toUpperCase(),
 destination: sendInc[2]!,
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const depInc = content.match(INCOMPLETE_DEPOSIT_RE);
 if (depInc) {
 setPendingAction(key, {
 kind: "deposit",
 asset: depInc[1]!.toUpperCase(),
 protocol: (depInc[2] || "defindex").replace(/\s+/g, "-").toLowerCase(),
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const wdInc = content.match(INCOMPLETE_WITHDRAW_RE);
 if (wdInc) {
 setPendingAction(key, {
 kind: "withdraw",
 asset: wdInc[1]!.toUpperCase(),
 protocol: (wdInc[2] || "defindex").replace(/\s+/g, "-").toLowerCase(),
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const supplyInc = content.match(INCOMPLETE_SUPPLY_RE);
 if (supplyInc && /\bblend\b/i.test(content)) {
 setPendingAction(key, {
 kind: "supply",
 asset: supplyInc[1]!.toUpperCase(),
 protocol: "blend",
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const borrowInc = content.match(INCOMPLETE_BORROW_RE);
 if (borrowInc && !/\bborrow\s+[\d.]/i.test(content)) {
 setPendingAction(key, {
 kind: "borrow",
 asset: borrowInc[1]!.toUpperCase(),
 protocol: "blend",
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
 }

 const repayInc = content.match(INCOMPLETE_REPAY_RE);
 if (repayInc && !/\brepay\s+[\d.]/i.test(content)) {
 setPendingAction(key, {
 kind: "repay",
 asset: repayInc[1]!.toUpperCase(),
 protocol: "blend",
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
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
 const steldex = await parseSteldexIntents(synthetic, publicKey, { sessionId });
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
 const steldex = await parseSteldexIntents(content, publicKey, { sessionId });
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
 const namedSoroswap = /\bsoroswap\b/i.test(content);
 const namedVenue = /\b(?:soroswap|steldex|aquarius|phoenix|classic\s+dex|sdex)\b/i.test(
 content
 );

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
 const quiet =
 `Prepared swap: ${action.sendAmount} ${from} → ~${preview.amountOutHuman} ${to}. Sign with your connected wallet.`;
 const named =
 `Soroswap route${route}: ${action.sendAmount} ${from} → ~${preview.amountOutHuman} ${to}.${impact} Sign with your connected wallet.`;
 return {
 text: gated.text ?? (namedSoroswap || namedVenue ? named : quiet),
 action: gated.action as ChatAction,
 };
 }
 } catch {
 // fall through to classic when aggregator errors
 }
 }

 if (!SUPPORTED_ASSETS.includes(from) || !SUPPORTED_ASSETS.includes(to)) {
 if (namedSoroswap) {
 return {
 text: `No live Soroswap path for ${from}/${to} on testnet right now. Classic DEX supports ${SUPPORTED_ASSETS.join(" / ")}; StelDex supports pUSDC, cUSDC, STELLAR, EURC.`,
 action: null,
 };
 }
 return {
 text: `I can't route ${from} → ${to} on testnet right now. Try XLM/USDC, or a StelDex pair like pUSDC / cUSDC / EURC.`,
 action: null,
 };
 }

 const gatedClassic = await wrapActionWithTrustlineIfNeeded(publicKey, action);
 if (namedSoroswap) {
 return {
 text:
 gatedClassic.text ??
 `No Soroswap liquidity for ${from}/${to} right now - using classic testnet DEX for ${action.sendAmount} ${from} → ${to}. Sign with your connected wallet.`,
 action: gatedClassic.action as ChatAction,
 };
 }
 return {
 text:
 gatedClassic.text ??
 `Prepared swap: ${action.sendAmount} ${from} → ${to}. Sign with your connected wallet.`,
 action: gatedClassic.action as ChatAction,
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

 if (/\b(?:token\s+launch|launchpad\s+token|how\s+to\s+launch\s+token)\b/i.test(content)) {
 return { text: formatTokenLaunchHelp(), action: null };
 }

 const createCollection = content.match(NFT_CREATE_COLLECTION_RE);
 if (createCollection) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const fields = parseCollectionPromptFields(content, createCollection);
 const draftKey = nftCollectionDraftKey(publicKey, sessionId);

 // Full one-shot prompt → action card immediately
 if (collectionPromptComplete(fields)) {
 clearNftCollectionDraft(draftKey);
 return {
 text: [
 `Ready to create **${fields.name}** (${fields.symbol}).`,
 `Max supply: ${fields.maxSupply === 0 ? "unlimited" : fields.maxSupply}.`,
 `Royalty: ${(fields.royaltyBps / 100).toFixed(2)}% · Orbit fee: 0.5%.`,
 "Review the card and sign to deploy.",
 ].join("\n"),
 action: {
 type: "nft_create_collection",
 marketHint: `${fields.name} (${fields.symbol})`,
 sendAsset: fields.symbol,
 description: fields.description,
 imageUrl: fields.image,
 website: fields.website,
 maxSupply: fields.maxSupply,
 royaltyBps: fields.royaltyBps,
 supplySpecified: true,
 } as ChatAction,
 };
 }

 // Guided multi-turn: name/supply first → ask description → ask media → card
 const hasDetails = Boolean(fields.description?.trim());
 const hasMedia = Boolean(fields.image?.trim());
 if (hasDetails && !hasMedia) {
 setNftCollectionDraft(draftKey, {
 name: fields.name,
 symbol: fields.symbol,
 maxSupply: fields.maxSupply,
 supplySpecified: fields.supplySpecified,
 royaltyBps: fields.royaltyBps,
 description: fields.description,
 website: fields.website,
 step: "awaiting_media",
 });
 return {
 text: askForCollectionMedia({
 name: fields.name,
 symbol: fields.symbol,
 maxSupply: fields.maxSupply,
 supplySpecified: fields.supplySpecified,
 royaltyBps: fields.royaltyBps,
 description: fields.description,
 website: fields.website,
 step: "awaiting_media",
 createdAt: Date.now(),
 }),
 action: null,
 };
 }

 setNftCollectionDraft(draftKey, {
 name: fields.name,
 symbol: fields.symbol,
 maxSupply: fields.maxSupply,
 supplySpecified: fields.supplySpecified,
 royaltyBps: fields.royaltyBps,
 description: fields.description,
 website: fields.website,
 imageUrl: fields.image,
 step: "awaiting_details",
 });
 return {
 text: askForCollectionDetails({
 name: fields.name,
 symbol: fields.symbol,
 maxSupply: fields.maxSupply,
 supplySpecified: fields.supplySpecified,
 royaltyBps: fields.royaltyBps,
 description: fields.description,
 website: fields.website,
 imageUrl: fields.image,
 step: "awaiting_details",
 createdAt: Date.now(),
 }),
 action: null,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Create collection failed", action: null };
 }
 }

 const tokenLaunch = content.match(TOKEN_LAUNCH_RE);
 if (tokenLaunch) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const supply = content.match(/\b(?:supply|amount)\s+([\d.]+)/i)?.[1];
 const tokenName = content.match(
 /\b(?:named|name)\s+["']([^"']+)["']/i
 )?.[1];
 const description = content.match(
 /\bdescription\s+["']([^"']+)["']/i
 )?.[1];
 const image = content.match(/\bimage\s+(https?:\/\/\S+)/i)?.[1];
 const website = content.match(/\bwebsite\s+(https?:\/\/\S+)/i)?.[1];
 const launched = await prepareTokenLaunch({
 walletAddress: publicKey,
 code: tokenLaunch[1],
 amount: supply ?? tokenLaunch[2],
 metadata: {
 name: tokenName,
 description,
 image,
 website,
 },
 });
 if (!launched.xdr) {
 return { text: launched.message, action: null };
 }
 return {
 text: launched.message,
 action: {
 type: launched.type,
 sendAsset: launched.code,
 sendAmount: "amount" in launched ? launched.amount : undefined,
 tokenName,
 description,
 imageUrl: image,
 website,
 marketHint: launched.contractId,
 xdr: launched.xdr,
 networkPassphrase: launched.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Token launch failed", action: null };
 }
 }

 const tokenMintSupply = content.match(TOKEN_MINT_SUPPLY_RE);
 if (tokenMintSupply) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const minted = await prepareTokenMint({
 walletAddress: publicKey,
 amount: tokenMintSupply[1],
 code: tokenMintSupply[2],
 });
 return {
 text: minted.message,
 action: {
 type: "token_mint",
 sendAsset: minted.code,
 sendAmount: minted.amount,
 marketHint: minted.contractId,
 xdr: minted.xdr,
 networkPassphrase: minted.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Token mint failed", action: null };
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
 image: nftMint[3]?.trim(),
 traits: nftMint[4]?.trim(),
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

 const nftCancel = content.match(NFT_CANCEL_RE);
 if (nftCancel) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 try {
 const tokenId = parseInt(nftCancel[1] || nftCancel[2], 10);
 const cancelled = await prepareNftCancelListing({
 walletAddress: publicKey,
 tokenId,
 });
 return {
 text: cancelled.message,
 action: {
 type: "nft_cancel",
 tokenId: cancelled.tokenId,
 xdr: cancelled.xdr,
 networkPassphrase: cancelled.networkPassphrase,
 } as ChatAction,
 };
 } catch (err: any) {
 return { text: err?.message ?? "Cancel listing failed", action: null };
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

// DeFindex — deposit / withdraw into the public testnet XLM vault
{
  if (/\bdefindex\b/i.test(content) && !DEFINDEX_DEPOSIT_RE.test(content) && !DEFINDEX_WITHDRAW_RE.test(content)) {
    try {
      return { text: await formatDefindexStatus(), action: null };
    } catch (err: any) {
      return { text: err?.message ?? "DeFindex unavailable", action: null };
    }
  }

  const defiDeposit = content.match(DEFINDEX_DEPOSIT_RE);
  if (defiDeposit) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    if (!defindexConfigured()) {
      return { text: "DeFindex is not configured yet. Set DEFINDEX_API_KEY in .env.", action: null };
    }
    const amount = String(defiDeposit[1] || defiDeposit[3] || "10");
    const asset = String(defiDeposit[2] || defiDeposit[4] || "XLM");
    try {
      const prepared = await prepareDefindexDeposit({
        walletAddress: publicKey,
        amount,
        asset,
      });
      return {
        text: prepared.message,
        action: {
          type: "defindex_deposit",
          sendAmount: prepared.sendAmount,
          sendAsset: prepared.sendAsset,
          poolContract: prepared.vaultAddress,
          xdr: prepared.xdr,
          networkPassphrase: prepared.networkPassphrase,
        } as ChatAction,
      };
    } catch (err: any) {
      return { text: err?.message ?? "Could not prepare DeFindex deposit", action: null };
    }
  }

  const defiWithdraw = content.match(DEFINDEX_WITHDRAW_RE);
  if (defiWithdraw) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    if (!defindexConfigured()) {
      return { text: "DeFindex is not configured yet. Set DEFINDEX_API_KEY in .env.", action: null };
    }
    const amount = String(defiWithdraw[1] || defiWithdraw[3] || "1");
    const asset = String(defiWithdraw[2] || defiWithdraw[4] || "XLM");
    try {
      const prepared = await prepareDefindexWithdraw({
        walletAddress: publicKey,
        amount,
        asset,
      });
      return {
        text: prepared.message,
        action: {
          type: "defindex_withdraw",
          sendAmount: prepared.sendAmount,
          sendAsset: prepared.sendAsset,
          poolContract: prepared.vaultAddress,
          xdr: prepared.xdr,
          networkPassphrase: prepared.networkPassphrase,
        } as ChatAction,
      };
    } catch (err: any) {
      return { text: err?.message ?? "Could not prepare DeFindex withdraw", action: null };
    }
  }
}

// Meridian USDC vault (Blend adapter)
{
  if (/\bmeridian\b/i.test(content) && !MERIDIAN_DEPOSIT_RE.test(content) && !MERIDIAN_WITHDRAW_RE.test(content)) {
    try {
      return { text: await formatMeridianStatus(publicKey), action: null };
    } catch (err: any) {
      return { text: err?.message ?? "Meridian unavailable", action: null };
    }
  }

  const merDeposit = content.match(MERIDIAN_DEPOSIT_RE);
  if (merDeposit) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    const amount = String(merDeposit[1] || merDeposit[2] || "10");
    try {
      const prepared = await prepareMeridianDeposit({ walletAddress: publicKey, amount });
      return {
        text: prepared.message,
        action: {
          type: "meridian_deposit",
          sendAmount: prepared.sendAmount,
          sendAsset: prepared.sendAsset,
          poolContract: prepared.vaultAddress,
          xdr: prepared.xdr,
          networkPassphrase: prepared.networkPassphrase,
        } as ChatAction,
      };
    } catch (err: any) {
      return { text: err?.message ?? "Could not prepare Meridian deposit", action: null };
    }
  }

  const merWithdraw = content.match(MERIDIAN_WITHDRAW_RE);
  if (merWithdraw) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    const shares = String(merWithdraw[1] || merWithdraw[2] || "1");
    try {
      const prepared = await prepareMeridianWithdraw({ walletAddress: publicKey, shares });
      return {
        text: prepared.message,
        action: {
          type: "meridian_withdraw",
          sendAmount: prepared.sendAmount,
          sendAsset: prepared.sendAsset,
          poolContract: prepared.vaultAddress,
          xdr: prepared.xdr,
          networkPassphrase: prepared.networkPassphrase,
        } as ChatAction,
      };
    } catch (err: any) {
      return { text: err?.message ?? "Could not prepare Meridian withdraw", action: null };
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

 // Faucet / get test tokens — XLM via Friendbot; other assets via swap (wallets already get XLM)
 const faucetMatch = content.match(FAUCET_RE);
 if (faucetMatch) {
 if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
 const symbol = (faucetMatch[1] || faucetMatch[2] || "").toUpperCase();
 if (!symbol) {
 return { text: "Specify a token, e.g. \"faucet USDC\" or \"faucet XLM\".", action: null };
 }

 if (symbol === "XLM") {
 const result = await fundWithFriendbot(publicKey);
 return {
 text: result.success
 ? `${result.message} You can swap some of that XLM for USDC next — say \"swap 50 XLM to USDC\".`
 : result.message,
 action: null,
 };
 }

 // Non-XLM: ask how much XLM to swap (Friendbot already runs on wallet create)
 const key = pendingActionKey(publicKey, sessionId);
 const dest = symbol === "CUSDC" ? "USDC" : symbol;
 setPendingAction(key, {
 kind: "swap",
 fromAsset: "XLM",
 toAsset: dest,
 promptHint: `Wallets are already funded with testnet **XLM** via Friendbot when you connect — no need to fund again.\n\nTo get **${dest}**, I’ll prepare an **XLM → ${dest}** swap.\n\nHow many **XLM** do you want to swap to **${dest}**?\n\nReply with an amount, e.g. \`50\` or \`50 XLM\` (or say **cancel**).`,
 });
 return { text: clarifyPrompt(getPendingAction(key)!), action: null };
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
 // Clarification / list text from deterministic path (e.g. ambiguous markets, LP pair ask)
 if (
 actionPass.text &&
 actionPass.text !== AI_RESPONSES.default &&
 !isGenericReply(actionPass.text)
 ) {
 // Allow deterministic text-only replies for predict clarify / LP pair / list / errors
 const looksLikeActionText =
 /several markets match|orbit predict|no market matched|prepared \d+ swaps|on-chain prediction|how many|reply with an amount|still need a number|i’ll prepare an|i'll prepare an|wallets are already funded|second asset|pair with|reply with an asset|liquidity pool|matching amount from the (?:live )?pool|got it —|collection description|add \*\*collection artwork\*\*|paste an image url|say \*\*upload\*\*|cancelled collection setup|all set —/i.test(
 actionPass.text
 ) || actionPass.pendingPredict;
 // LP pair clarify / NFT collection wizard — never let the LLM override
 const pendingLp = getPendingAction(pendingActionKey(publicKey, opts?.sessionId));
 const pendingNft = getNftCollectionDraft(
 nftCollectionDraftKey(publicKey, opts?.sessionId)
 );
 if (
 looksLikeActionText ||
 pendingLp?.kind === "add_liquidity" ||
 pendingNft
 ) {
 return actionPass;
 }
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
