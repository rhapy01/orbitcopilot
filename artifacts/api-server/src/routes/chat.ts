import { Router, type IRouter } from "express";
import { db, chatMessagesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  GetChatMessagesResponse,
  SendChatMessageBody,
  SendChatMessageResponse,
  DeleteChatMessageParams,
  ClearChatHistoryResponse,
} from "@workspace/api-zod";
import { getSteldexPools } from "../lib/steldex";

const router: IRouter = Router();

const AI_RESPONSES: Record<string, string> = {
  default:
    "I'm Orbit Copilot, your AI financial assistant on the Stellar network. I can help you send payments, swap assets, discover yield opportunities, and manage your portfolio. What would you like to do today?",
  send:
    "To send funds, I'll need the recipient's Stellar address and the amount. For example, you can say 'Send 50 USDC to GABCDE...' and I'll prepare the transaction for your review before signing.",
  swap:
    "I can help you swap assets on the Stellar DEX. Stellar's built-in order book offers fast, low-cost swaps. Which assets would you like to exchange? For example: 'Swap 100 XLM to USDC'.",
  yield:
    "Great question! I'm scanning the Stellar DeFi ecosystem for the best yield opportunities. Currently, lending USDC on Blend Protocol offers around 8.2% APY with low risk, while providing XLM/USDC liquidity on StellarX can earn up to 14.5% APY. Want me to walk you through any of these?",
  trustline:
    "A trustline is a Stellar concept that allows your wallet to hold a specific asset issued by another account. Without a trustline, your wallet can't receive or hold that asset. Each trustline requires a small XLM reserve (0.5 XLM). I can help you create a trustline for any asset you need.",
  portfolio:
    "Your portfolio is looking healthy! You're up 3.2% in the last 24 hours. Your largest holding is USDC at 45% of your portfolio, followed by XLM at 30%. Want me to suggest some rebalancing strategies or yield opportunities for your idle USDC?",
  risk:
    "Risk assessment is important in DeFi. I evaluate opportunities based on protocol security audits, TVL stability, smart contract risk, and historical volatility. Low-risk options include established lending protocols. Higher APY usually means higher risk. I always explain the risks before recommending anything.",
  steldexHelp:
    "I can route liquidity, farming, and limit-order requests through StelDex, a Soroban DEX on Stellar Testnet. Try: \"add liquidity 10 XLM and 10 pUSDC to XLM/pUSDC\", \"stake my XLM/pUSDC LP\", \"claim rewards from XLM/pUSDC\", or \"unstake XLM/pUSDC\".",
  steldexPoolNotFound:
    "I couldn't find that pool on StelDex. Ask me for a pair like XLM/pUSDC, XLM/cUSDC, EURC/XLM, or STELLAR/XLM.",
};

const SEND_INTENT_RE =
  /\b(?:send|transfer|pay)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+to\s+(G[A-Z2-7]{55})\b/i;
const SWAP_INTENT_RE =
  /\b(?:swap|exchange|convert)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;
const STELDEX_STAKE_RE = /\bstake\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_UNSTAKE_RE = /\bunstake\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_CLAIM_RE = /\bclaim\b(?:.*?)\b([a-zA-Z]{2,10})\s*\/\s*([a-zA-Z]{2,10})\b/i;
const STELDEX_ADD_LIQUIDITY_RE =
  /\badd\s+liquidity\s+([\d.]+)\s*([a-zA-Z]{2,10})\s+and\s+([\d.]+)\s*([a-zA-Z]{2,10})/i;

const SUPPORTED_ASSETS = ["XLM", "USDC", "AQUA", "yXLM", "EURC"];
const STELDEX_ONLY_ASSETS = ["PUSDC", "CUSDC", "STELLAR"];

interface ChatAction {
  type: "send" | "swap" | "steldex_swap" | "steldex_stake" | "steldex_claim" | "steldex_unstake" | "steldex_add_liquidity";
  sendAmount?: string;
  sendAsset?: string;
  destination?: string;
  destAsset?: string;
  poolContract?: string;
  pair?: string;
  amountB?: string;
}

async function findSteldexPool(
  symbolA: string,
  symbolB: string
): Promise<{ poolContract: string; pair: string } | null> {
  const pools = await getSteldexPools();
  const a = symbolA.toUpperCase();
  const b = symbolB.toUpperCase();
  const match = pools.find((p: any) => {
    const s0 = String(p.symbol0 ?? "").toUpperCase();
    const s1 = String(p.symbol1 ?? "").toUpperCase();
    return (s0 === a && s1 === b) || (s0 === b && s1 === a);
  }) as any;
  if (!match) return null;
  return { poolContract: match.address, pair: match.pair };
}

async function parseIntentAction(content: string): Promise<ChatAction | null> {
  const sendMatch = content.match(SEND_INTENT_RE);
  if (sendMatch) {
    const [, amount, asset, destination] = sendMatch;
    return { type: "send", sendAmount: amount, sendAsset: asset.toUpperCase(), destination };
  }

  const addLiqMatch = content.match(STELDEX_ADD_LIQUIDITY_RE);
  if (addLiqMatch) {
    const [, amountA, symbolA, amountB, symbolB] = addLiqMatch;
    const pool = await findSteldexPool(symbolA, symbolB);
    if (!pool) return { type: "steldex_add_liquidity" };
    return {
      type: "steldex_add_liquidity",
      sendAmount: amountA,
      sendAsset: symbolA.toUpperCase(),
      amountB,
      destAsset: symbolB.toUpperCase(),
      poolContract: pool.poolContract,
      pair: pool.pair,
    };
  }

  const stakeMatch = content.match(STELDEX_STAKE_RE);
  if (stakeMatch) {
    const [, symbolA, symbolB] = stakeMatch;
    const pool = await findSteldexPool(symbolA, symbolB);
    if (!pool) return { type: "steldex_stake" };
    return { type: "steldex_stake", poolContract: pool.poolContract, pair: pool.pair };
  }

  const unstakeMatch = content.match(STELDEX_UNSTAKE_RE);
  if (unstakeMatch) {
    const [, symbolA, symbolB] = unstakeMatch;
    const pool = await findSteldexPool(symbolA, symbolB);
    if (!pool) return { type: "steldex_unstake" };
    return { type: "steldex_unstake", poolContract: pool.poolContract, pair: pool.pair };
  }

  const claimMatch = content.match(STELDEX_CLAIM_RE);
  if (claimMatch) {
    const [, symbolA, symbolB] = claimMatch;
    const pool = await findSteldexPool(symbolA, symbolB);
    if (!pool) return { type: "steldex_claim" };
    return { type: "steldex_claim", poolContract: pool.poolContract, pair: pool.pair };
  }

  const swapMatch = content.match(SWAP_INTENT_RE);
  if (swapMatch) {
    const [, amount, fromAsset, toAsset] = swapMatch;
    const from = fromAsset.toUpperCase();
    const to = toAsset.toUpperCase();
    const isSteldex = STELDEX_ONLY_ASSETS.includes(from) || STELDEX_ONLY_ASSETS.includes(to);
    return {
      type: isSteldex ? "steldex_swap" : "swap",
      sendAmount: amount,
      sendAsset: from,
      destAsset: to,
    };
  }

  return null;
}

async function getAiResponse(content: string): Promise<{ text: string; action: ChatAction | null }> {
  const lower = content.toLowerCase();
  let action: ChatAction | null;
  try {
    action = await parseIntentAction(content);
  } catch {
    action = null;
  }

  if (action?.type === "send") {
    return {
      text: `I've prepared a transaction to send ${action.sendAmount} ${action.sendAsset} to ${action.destination}. Review the details below and sign with Freighter to broadcast it on-chain.`,
      action,
    };
  }

  if (action?.type === "swap") {
    if (!SUPPORTED_ASSETS.includes(action.sendAsset!) || !SUPPORTED_ASSETS.includes(action.destAsset!)) {
      return {
        text: `I can swap between these assets right now: ${SUPPORTED_ASSETS.join(", ")}. Try something like "Swap 50 XLM to USDC".`,
        action: null,
      };
    }
    return {
      text: `I found a route on the Stellar DEX to swap ${action.sendAmount} ${action.sendAsset} for ${action.destAsset}. Review the quote below and sign with Freighter to execute the swap.`,
      action,
    };
  }

  if (action?.type === "steldex_swap") {
    return {
      text: `${action.sendAsset} and ${action.destAsset} trade on StelDex, a Soroban DEX on Stellar Testnet. I found a route to swap ${action.sendAmount} ${action.sendAsset} for ${action.destAsset} there — review below and sign with Freighter (make sure it's set to Testnet).`,
      action,
    };
  }

  if (action?.type === "steldex_add_liquidity") {
    if (!action.poolContract) {
      return { text: AI_RESPONSES.steldexPoolNotFound, action: null };
    }
    return {
      text: `Ready to add ${action.sendAmount} ${action.sendAsset} and ${action.amountB} ${action.destAsset} to the ${action.pair} pool on StelDex. Review and sign with Freighter (Testnet) to submit on-chain.`,
      action,
    };
  }

  if (action?.type === "steldex_stake") {
    if (!action.poolContract) {
      return { text: AI_RESPONSES.steldexPoolNotFound, action: null };
    }
    return {
      text: `I'll stake your available ${action.pair} LP tokens into the StelDex farm for STELLAR rewards. Sign with Freighter (Testnet) to confirm on-chain.`,
      action,
    };
  }

  if (action?.type === "steldex_claim") {
    if (!action.poolContract) {
      return { text: AI_RESPONSES.steldexPoolNotFound, action: null };
    }
    return {
      text: `I'll claim your pending STELLAR farm rewards from the ${action.pair} pool on StelDex. Sign with Freighter (Testnet) to confirm on-chain.`,
      action,
    };
  }

  if (action?.type === "steldex_unstake") {
    if (!action.poolContract) {
      return { text: AI_RESPONSES.steldexPoolNotFound, action: null };
    }
    return {
      text: `I'll unstake your ${action.pair} LP tokens from the StelDex farm. Sign with Freighter (Testnet) to confirm on-chain.`,
      action,
    };
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
    lower.includes("liquidity pool") ||
    lower.includes("limit order") ||
    lower.includes("steldex")
  ) {
    return { text: AI_RESPONSES.steldexHelp, action: null };
  }
  if (lower.includes("yield") || lower.includes("earn") || lower.includes("apy") || lower.includes("interest")) {
    return { text: AI_RESPONSES.yield, action: null };
  }
  if (lower.includes("trustline") || lower.includes("trust line")) {
    return { text: AI_RESPONSES.trustline, action: null };
  }
  if (lower.includes("portfolio") || lower.includes("balance") || lower.includes("holdings")) {
    return { text: AI_RESPONSES.portfolio, action: null };
  }
  if (lower.includes("risk") || lower.includes("safe") || lower.includes("danger")) {
    return { text: AI_RESPONSES.risk, action: null };
  }
  return { text: AI_RESPONSES.default, action: null };
}

router.get("/chat/messages", async (req, res): Promise<void> => {
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(chatMessagesTable.createdAt);
  res.json(GetChatMessagesResponse.parse(messages.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }))));
});

router.post("/chat/messages", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.insert(chatMessagesTable).values({
    role: "user",
    content: parsed.data.content,
    metadata: null,
  });

  const { text: aiContent, action } = await getAiResponse(parsed.data.content);

  const [aiMessage] = await db
    .insert(chatMessagesTable)
    .values({
      role: "assistant",
      content: aiContent,
      metadata: action ? { action } : null,
    })
    .returning();

  res.status(201).json(SendChatMessageResponse.parse({
    ...aiMessage,
    createdAt: aiMessage.createdAt.toISOString(),
  }));
});

router.delete("/chat/messages/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteChatMessageParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/chat/clear", async (_req, res): Promise<void> => {
  await db.delete(chatMessagesTable);
  res.json(ClearChatHistoryResponse.parse({ success: true, message: "Chat cleared" }));
});

export default router;
