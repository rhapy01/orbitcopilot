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
  deleteChatMessage,
  insertChatMessage,
  listChatMessages,
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
  normalizeSteldexSymbol,
  resolveSteldexPool,
  resolveSteldexToken,
  steldexDecimals,
  toSteldexUnits,
} from "../lib/steldex";
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
import { formatAquariusPools, formatAquariusQuote } from "../lib/aquarius";
import { fundWithFriendbot } from "../lib/friendbot";
import { formatReflectorPrices } from "../lib/reflector";
import { formatProtocolRegistry } from "../lib/protocols";
import {
  formatPredictionMarkets,
  formatPredictionPositions,
  preparePredictionBet,
} from "../lib/predict";
import {
  formatPerpMarkets,
  formatPerpPositions,
  preparePerpClose,
  preparePerpOpen,
} from "../lib/perps";
import {
  BlendRequestType,
  formatBlendMarkets,
  resolveBlendReserve,
} from "../lib/blend";
import {
  faucetSoroswapToken,
  formatSoroswapPositions,
  formatSoroswapStatus,
  isSoroswapPair,
  resolveSoroswapToken,
  soroswapConfigured,
  soroswapTestnetReady,
  trySoroswapQuote,
} from "../lib/soroswap";
import { runLlmCopilot } from "../lib/llm";
import { enrichChatAction } from "../lib/enrich-action";
import { timed } from "../lib/metrics";

const router: IRouter = Router();

const AI_RESPONSES = {
  default: CAPABILITIES_TEXT,
  send:
    "To send funds on testnet, tell me the amount, asset, and recipient. Example: \"Send 50 XLM to GABCDE…\" — I'll prepare the transaction for Freighter (Testnet).",
  swap:
    "Swaps on Stellar Testnet:\n• StelDex — \"Swap 10 XLM to pUSDC\"\n• Soroswap (Phoenix/Aquarius) — \"Swap 10 XLM to USDC\"\n• Classic DEX fallback for XLM/USDC if aggregator is down\nSet Freighter to Testnet.",
  trustline:
    "A trustline lets your wallet hold a non-XLM asset on Stellar. Each trustline locks a small XLM reserve (0.5 XLM).",
  connectWallet:
    "Connect Freighter on Testnet using the button in the header so I can read balances and prepare transactions.",
  steldexHelp:
    "Unicorn StelDex (Testnet):\n• \"Swap 10 XLM to pUSDC\"\n• \"add liquidity 10 XLM and 10 pUSDC\"\n• \"remove liquidity XLM/pUSDC\"\n• \"stake XLM/pUSDC for 52 weeks\"\n• \"claim rewards from XLM/pUSDC\"\n• \"unstake XLM/pUSDC\"\n• \"what do I have on StelDex?\"",
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
const STELDEX_REMOVE_LIQUIDITY_RE =
  /\bremove\s+liquidity\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_LIMIT_ORDER_RE =
  /\b(?:limit\s+order|place\s+limit)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\s+(?:at|@)\s+([\d.]+)/i;
const STELDEX_CANCEL_ORDER_RE = /\bcancel\s+order\s+#?(\d+)\b/i;
const YIELD_ASSET_RE = /\b(?:yield|earn|apy|opportunities?)\s+(?:for\s+|on\s+)?([a-zA-Z]{2,12})\b/i;
const PRICE_ASSET_RE =
  /\b(?:price|worth|value)\s+(?:of\s+)?([a-zA-Z]{2,12})\b|\bhow\s+much\s+is\s+([a-zA-Z]{2,12})\b/i;
const FAUCET_RE = /\b(?:faucet|mint|claim\s+test)\s+([a-zA-Z]{2,12})\b/i;
const AQUARIUS_QUOTE_RE =
  /\baquarius\s+(?:quote|price|route)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;
const FUNDBOT_RE = /\b(?:fund|friendbot|airdrop)\b(?:\s+my\s+wallet)?\b/i;
const PREDICT_BET_RE =
  /\b(?:invest|bet|predict)\s+([\d.]+)\s*xlm\s+(?:on\s+)?(.+?)\s+to\s+win\b/i;
const PREDICT_BET_YES_NO_RE =
  /\b(?:bet|invest)\s+([\d.]+)\s*xlm\s+(yes|no)\s+on\s+([a-z0-9\-]+)\b/i;
const PERP_OPEN_RE =
  /\bopen\s+(?:a\s+)?([\d.]+)\s*(?:\$|usdc\s+)?(?:usdc\s+)?(long|short)\s+on\s+(bitcoin|btc|ethereum|eth|xlm|stellar)\s+at\s+(\d+)\s*x\b/i;
const PERP_OPEN_ALT_RE =
  /\b(long|short)\s+([\d.]+)\s*usdc\s+(?:of\s+)?(bitcoin|btc|ethereum|eth|xlm|stellar)\s+(?:at\s+)?(\d+)\s*x\b/i;
const PERP_SL_RE = /\bstop\s*loss\s*(?:at\s*)?([\d.]+)/i;
const PERP_TP_RE = /\b(?:take\s*profit|tp)\s*(?:at\s*)?([\d.]+)/i;
const PERP_CLOSE_RE = /\bclose\s+(?:my\s+)?([a-z0-9]+)\s*perp\b/i;

const SUPPORTED_ASSETS = ["XLM", "USDC"];

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
    | "predict_bet"
    | "perp_open";
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
  xdr?: string;
  networkPassphrase?: string;
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
  const addLiqMatch = content.match(STELDEX_ADD_LIQUIDITY_RE);
  if (addLiqMatch) {
    const [, amountA, symbolA, amountB, symbolB] = addLiqMatch;
    const pool = await resolveSteldexPool(symbolA, symbolB);
    if (pool) {
      const a = normalizeSteldexSymbol(symbolA);
      const b = normalizeSteldexSymbol(symbolB);
      const amount0 = a === pool.symbol0 ? amountA : amountB;
      const amount1 = a === pool.symbol0 ? amountB : amountA;

      return {
        kind: "action",
        text: `Ready to add ${amount0} ${pool.symbol0} and ${amount1} ${pool.symbol1} to ${pool.pair} on StelDex (full-range). Sign each step in Freighter on Testnet.`,
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
      return {
        kind: "action",
        text: `Soroswap add liquidity: ${amountA} ${symbolA.toUpperCase()} + ${amountB} ${symbolB.toUpperCase()}. Sign in Freighter (Testnet).`,
        action: {
          type: "soroswap_add_liquidity",
          sendAmount: amountA,
          amountB,
          sendAsset: symbolA.toUpperCase(),
          destAsset: symbolB.toUpperCase(),
          pair: `${symbolA.toUpperCase()}/${symbolB.toUpperCase()}`,
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
    if (!match?.lpLiquidity || match.lpLiquidity === "0") {
      return { kind: "text", text: AI_RESPONSES.noPosition };
    }
    return {
      kind: "action",
      text: `I'll remove your LP on ${match.pair} (liquidity ${match.lpLiquidity}). Confirm and sign in Freighter (Testnet).`,
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
      text: `I'll stake your available ${match.pair} LP for ${lockWeeks} weeks on the StelDex farm. Sign in Freighter (Testnet).`,
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
      text: `I'll unstake your ${match.pair} farm position. Sign in Freighter (Testnet).`,
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
      text: `I'll claim STELLAR farm rewards from ${match.pair}. Sign in Freighter (Testnet).`,
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
      text: `Limit order: sell ${amount} ${from} for ${to} at ${price} ${to} per ${from}. Sign in Freighter (Testnet).`,
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
      text: `I'll cancel StelDex order #${orderId}. Sign in Freighter (Testnet).`,
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
    try {
      const quote = await getSteldexSwapQuote({
        fromTokenContract: fromContract,
        toTokenContract: toContract,
        amountIn: toSteldexUnits(amount, steldexDecimals(from)),
        slippageBps: 50,
      });
      if (quote.amountOut) {
        quoteNote = ` Quote out ≈ ${quote.amountOut} (raw units).`;
      }
    } catch {
      // quote optional
    }

    return {
      kind: "action",
      text: `StelDex swap: ${amount} ${from} → ${to}.${quoteNote} Sign each step in Freighter on Testnet.`,
      action: {
        type: "steldex_swap",
        sendAmount: amount,
        sendAsset: from,
        destAsset: to,
        fromTokenContract: fromContract,
        toTokenContract: toContract,
      },
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
  publicKey: string | null
): Promise<{ text: string; action: ChatAction | null }> {
  const lower = content.toLowerCase();

  // StelDex write intents (read positions first where required)
  try {
    const steldex = await parseSteldexIntents(content, publicKey);
    if (steldex.kind === "action") return { text: steldex.text, action: steldex.action };
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
    return {
      text: `I've prepared a transaction to send ${action.sendAmount} ${action.sendAsset} to ${action.destination}. Review below and sign with Freighter.`,
      action,
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
          return {
            text: `Soroswap route${route}: ${action.sendAmount} ${from} → ~${preview.amountOutHuman} ${to}.${impact} Sign in Freighter (Testnet).`,
            action: {
              type: "soroswap_swap",
              sendAmount: action.sendAmount,
              sendAsset: from,
              destAsset: to,
              fromTokenContract: fromTok!.contract,
              toTokenContract: toTok!.contract,
            },
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
      text: `No Soroswap liquidity for ${from}/${to} right now — using classic testnet DEX for ${action.sendAmount} ${from} → ${to}. Sign in Freighter (Testnet).`,
      action,
    };
  }

  // Prediction markets (Orbit-native)
  if (
    lower.includes("prediction") ||
    lower.includes("predict market") ||
    (lower.includes("markets") && lower.includes("predict"))
  ) {
    if (publicKey && (lower.includes("my") || lower.includes("position"))) {
      try {
        return { text: await formatPredictionPositions(publicKey), action: null };
      } catch {
        // fall through
      }
    }
    try {
      return { text: await formatPredictionMarkets(), action: null };
    } catch (err: any) {
      return { text: err?.message ?? "Prediction markets unavailable (push DB schema?).", action: null };
    }
  }

  const predYesNo = content.match(PREDICT_BET_YES_NO_RE);
  if (predYesNo) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    const [, amount, outcome, slug] = predYesNo;
    try {
      const bet = await preparePredictionBet({
        walletAddress: publicKey,
        marketHint: slug,
        outcome: outcome.toLowerCase() === "no" ? "no" : "yes",
        amountXlm: amount,
      });
      return {
        text: `On-chain prediction: ${amount} XLM on ${bet.outcome.toUpperCase()} for "${bet.market.question}". Sign to stake into the Soroban contract.`,
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

  const predWin = content.match(PREDICT_BET_RE);
  if (predWin) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    const [, amount, hint] = predWin;
    try {
      const bet = await preparePredictionBet({
        walletAddress: publicKey,
        marketHint: hint.trim(),
        outcome: "yes",
        amountXlm: amount,
      });
      return {
        text: `On-chain prediction: ${amount} XLM on YES for "${bet.market.question}". Sign to stake into the Soroban contract.`,
        action: {
          type: "predict_bet",
          positionId: bet.positionId,
          sendAmount: String(bet.amountXlm),
          sendAsset: "XLM",
          marketHint: bet.market.slug,
          outcome: "yes",
          xdr: bet.xdr,
          networkPassphrase: bet.networkPassphrase,
        } as ChatAction,
      };
    } catch (err: any) {
      return { text: err?.message ?? "Could not prepare bet", action: null };
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
      return { text: result.message, action: null };
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
        text: `On-chain perp ${open.side.toUpperCase()} ${open.market} ${open.leverage}x — margin $${open.marginUsdc} USDC into contract, entry ~$${open.entryPrice.toFixed(2)}, liq ~$${open.liquidationPrice.toFixed(2)}${open.stopLoss ? `, SL $${open.stopLoss}` : ""}${open.takeProfit ? `, TP $${open.takeProfit}` : ""}. Sign the contract invoke.`,
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

  // Friendbot — fund testnet XLM
  if (FUNDBOT_RE.test(content) && !lower.includes("faucet")) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    const result = await fundWithFriendbot(publicKey);
    return { text: result.message, action: null };
  }

  // Aquarius live find-path quote
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

  // Reflector / oracle prices (also covered by market intent)
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
      const opLower = op.toLowerCase();
      const type =
        opLower === "withdraw"
          ? "blend_withdraw"
          : opLower === "borrow"
            ? "blend_borrow"
            : opLower === "repay"
              ? "blend_repay"
              : "blend_supply";
      const requestType =
        type === "blend_withdraw"
          ? BlendRequestType.Withdraw
          : type === "blend_borrow"
            ? BlendRequestType.Borrow
            : type === "blend_repay"
              ? BlendRequestType.Repay
              : BlendRequestType.Supply;
      return {
        text: `Blend ${type.replace("blend_", "")}: ${amount} ${reserve.symbol} on TestnetV2. Review and sign in Freighter (Testnet).`,
        action: {
          type,
          requestType,
          sendAmount: amount,
          sendAsset: reserve.symbol,
          poolContract: reserve.poolContract,
          token0Contract: reserve.tokenContract,
        },
      };
    }
    try {
      return { text: await formatBlendMarkets(), action: null };
    } catch {
      return { text: "Blend testnet contracts unavailable right now.", action: null };
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
    const symbol = faucetMatch[1].toUpperCase();
    try {
      const token = await resolveSoroswapToken(symbol);
      if (!token) {
        return {
          text: `Unknown Soroswap testnet token "${symbol}". Try USDC, AQUA, or XLM.`,
          action: null,
        };
      }
      await faucetSoroswapToken(publicKey, token.contract);
      return {
        text: `Minted testnet ${symbol} to your wallet via the Soroswap faucet (${token.contract.slice(0, 8)}…). Check balances in a moment.`,
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

  // Earning vs idle scoreboard
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
    lower.includes("balance") ||
    lower.includes("holdings") ||
    lower.includes("what do i have") ||
    lower.includes("my wallet") ||
    lower.includes("my positions") ||
    lower.includes("positions")
  ) {
    if (!publicKey) return { text: AI_RESPONSES.connectWallet, action: null };
    try {
      return { text: await formatPortfolioSummary(publicKey), action: null };
    } catch {
      return {
        text: "I couldn't load your portfolio from Stellar testnet. Check Freighter is on Testnet and the account is funded (Friendbot).",
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
  publicKey: string | null
): Promise<{ text: string; action: ChatAction | null }> {
  // 1) Deterministic intents always win for structured actions / known queries
  const deterministic = await getDeterministicResponse(content, publicKey);
  if (deterministic.action || !isGenericReply(deterministic.text)) {
    return deterministic;
  }

  // 2) Free-form → OpenRouter / OpenAI agent (tools + propose_action)
  try {
    const llm = await timed("chat.llm", () => runLlmCopilot(content, publicKey));
    if (llm?.text) {
      let action = (llm.action as ChatAction | null) ?? null;
      if (action) {
        const enriched = await enrichChatAction(action as unknown as Record<string, unknown>);
        if (enriched) action = enriched as ChatAction;
      }
      return { text: llm.text, action };
    }
  } catch {
    // fall through
  }

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

router.get("/chat/messages", async (req, res): Promise<void> => {
  try {
    const wallet =
      typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
    const messages = await listChatMessages(wallet || null);

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
    const parsed = SendChatMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const publicKey = resolvePublicKey(parsed.data.context);

    await insertChatMessage({
      walletPublicKey: publicKey,
      role: "user",
      content: parsed.data.content,
      metadata: publicKey ? { publicKey } : null,
    });

    const { text: aiContent, action } = await timed("chat.respond", () =>
      getAiResponse(parsed.data.content, publicKey)
    );

    const aiMessage = await insertChatMessage({
      walletPublicKey: publicKey,
      role: "assistant",
      content: aiContent,
      metadata: action ? { action } : null,
    });

    res.status(201).json(
      SendChatMessageResponse.parse({
        id: aiMessage.id,
        role: aiMessage.role,
        content: aiMessage.content,
        metadata: aiMessage.metadata,
        createdAt: aiMessage.createdAt.toISOString(),
      })
    );
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
    await clearChatMessages(key);
    res.json(
      ClearChatHistoryResponse.parse({ success: true, message: "Chat cleared" })
    );
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
