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
  steldex:
    "For liquidity provision, farming, and limit orders I route you to StelDex, a Soroban-based exchange I've integrated on Stellar Testnet. Head to the StelDex tab to swap, add liquidity, stake LP tokens into farms for STELLAR rewards, claim, unstake, or place limit orders — all signed with Freighter and settled on-chain in real time.",
};

const SEND_INTENT_RE =
  /\b(?:send|transfer|pay)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+to\s+(G[A-Z2-7]{55})\b/i;
const SWAP_INTENT_RE =
  /\b(?:swap|exchange|convert)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;

const SUPPORTED_ASSETS = ["XLM", "USDC", "AQUA", "yXLM", "EURC"];

interface ChatAction {
  type: "send" | "swap";
  sendAmount: string;
  sendAsset: string;
  destination?: string;
  destAsset?: string;
}

function parseIntentAction(content: string): ChatAction | null {
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

function getAiResponse(content: string): { text: string; action: ChatAction | null } {
  const lower = content.toLowerCase();
  const action = parseIntentAction(content);

  if (action?.type === "send") {
    return {
      text: `I've prepared a transaction to send ${action.sendAmount} ${action.sendAsset} to ${action.destination}. Review the details below and sign with Freighter to broadcast it on-chain.`,
      action,
    };
  }

  if (action?.type === "swap") {
    if (!SUPPORTED_ASSETS.includes(action.sendAsset) || !SUPPORTED_ASSETS.includes(action.destAsset!)) {
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
    return { text: AI_RESPONSES.steldex, action: null };
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

  const { text: aiContent, action } = getAiResponse(parsed.data.content);

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
