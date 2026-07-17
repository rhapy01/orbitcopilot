/**
 * Pending action clarify — when a user asks to swap/send/supply without an amount,
 * or add liquidity with only one asset amount, we ask for the missing piece and
 * complete on the next turn.
 */

export type PendingActionKind =
  | "swap"
  | "send"
  | "supply"
  | "deposit"
  | "withdraw"
  | "borrow"
  | "repay"
  | "add_liquidity";

export type PendingActionClarify = {
  kind: PendingActionKind;
  fromAsset?: string;
  toAsset?: string;
  asset?: string;
  destination?: string;
  protocol?: string;
  /** Known deposit amount when clarifying the LP pair asset */
  amount?: string;
  /** Optional prompt context for the follow-up message */
  promptHint?: string;
  createdAt: number;
};

const pending = new Map<string, PendingActionClarify>();
const PENDING_TTL_MS = 15 * 60 * 1000;

export function pendingActionKey(publicKey: string | null, sessionId?: number): string {
  if (sessionId != null && Number.isFinite(sessionId)) return `session:${sessionId}`;
  if (publicKey) return `wallet:${publicKey}`;
  return "anon";
}

export function setPendingAction(
  key: string,
  value: Omit<PendingActionClarify, "createdAt">
): void {
  pending.set(key, { ...value, createdAt: Date.now() });
}

export function clearPendingAction(key: string): void {
  pending.delete(key);
}

export function getPendingAction(key: string): PendingActionClarify | null {
  const p = pending.get(key);
  if (!p) return null;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(key);
    return null;
  }
  return p;
}

/** Extract a positive amount from a short follow-up like "50", "50 XLM", "swap 100". */
export function parseFollowUpAmount(content: string): {
  amount: string;
  assetHint?: string;
} | null {
  const t = content.trim();
  // "50", "50.5", "50 XLM", "100 usdc"
  let m = t.match(/^([\d]+(?:\.[\d]+)?)\s*([a-zA-Z]{2,12})?$/i);
  if (m) {
    return { amount: m[1], assetHint: m[2]?.toUpperCase() };
  }
  // "swap 50", "use 100", "send 25"
  m = t.match(
    /\b(?:swap|use|send|supply|deposit|withdraw|borrow|repay|convert|exchange)?\s*([\d]+(?:\.[\d]+)?)\s*([a-zA-Z]{2,12})?\b/i
  );
  if (m) {
    return { amount: m[1], assetHint: m[2]?.toUpperCase() };
  }
  return null;
}

/** Extract a lone asset code from a short follow-up like "xlm", "with pUSDC". */
export function parseFollowUpAsset(content: string, knownAsset?: string): string | null {
  const t = content.trim();
  let m = t.match(/^([a-zA-Z]{2,12})$/i);
  if (m) return m[1]!.toUpperCase();
  m = t.match(/^(?:with|and|use|pair(?:ed)?\s+with|plus)\s+([a-zA-Z]{2,12})\s*$/i);
  if (m) return m[1]!.toUpperCase();
  // "XLM/USDC" or "USDC-XLM" → the side that isn't the known anchor asset
  m = t.match(/^([a-zA-Z]{2,12})\s*[\/\-]\s*([a-zA-Z]{2,12})$/i);
  if (m) {
    const a = m[1]!.toUpperCase();
    const b = m[2]!.toUpperCase();
    const known = knownAsset?.toUpperCase();
    if (known && a === known) return b;
    if (known && b === known) return a;
    return b; // default: treat second as the pair asset
  }
  return null;
}

/** Build a synthetic full intent string from pending + amount so existing parsers can run. */
export function synthesizeIntentFromPending(
  pendingAction: PendingActionClarify,
  amount: string,
  assetHint?: string
): string | null {
  const amt = amount.trim();
  if (!amt || !Number.isFinite(Number(amt)) || Number(amt) <= 0) return null;

  switch (pendingAction.kind) {
    case "swap": {
      const from = pendingAction.fromAsset || "XLM";
      const to = pendingAction.toAsset || "USDC";
      // If user said "50 USDC" as follow-up but we're swapping XLM→USDC, still use XLM as input
      return `swap ${amt} ${from} to ${to}`;
    }
    case "send": {
      const asset = pendingAction.asset || assetHint || "XLM";
      if (!pendingAction.destination) return null;
      return `send ${amt} ${asset} to ${pendingAction.destination}`;
    }
    case "supply": {
      const asset = pendingAction.asset || assetHint || "USDC";
      const proto = pendingAction.protocol || "blend";
      return `supply ${amt} ${asset} on ${proto}`;
    }
    case "deposit": {
      const asset = pendingAction.asset || assetHint || "XLM";
      const proto = pendingAction.protocol || "defindex";
      return `deposit ${amt} ${asset} into ${proto}`;
    }
    case "withdraw": {
      const asset = pendingAction.asset || assetHint || "XLM";
      const proto = pendingAction.protocol || "defindex";
      return `withdraw ${amt} ${asset} from ${proto}`;
    }
    case "borrow": {
      const asset = pendingAction.asset || assetHint || "USDC";
      return `borrow ${amt} ${asset} on blend`;
    }
    case "repay": {
      const asset = pendingAction.asset || assetHint || "USDC";
      return `repay ${amt} ${asset} on blend`;
    }
    case "add_liquidity":
      // Amount follow-up for LP is unusual; prefer asset follow-up via synthesizeLpIntentFromPending
      return null;
    default:
      return null;
  }
}

/** Complete one-sided LP after the user names the second asset (e.g. "xlm"). */
export function synthesizeLpIntentFromPending(
  pendingAction: PendingActionClarify,
  secondAsset: string
): string | null {
  if (pendingAction.kind !== "add_liquidity") return null;
  const amount = pendingAction.amount?.trim();
  const asset = pendingAction.asset;
  const other = secondAsset.trim().toUpperCase();
  if (!amount || !asset || !other) return null;
  if (other === asset.toUpperCase()) return null;
  const proto = pendingAction.protocol || "steldex";
  // AUTO = derive counterpart from live pool ratio; keep user's stated amount
  return `add liquidity ${amount} ${asset} and AUTO ${other} on ${proto}`;
}

export function clarifyPrompt(pendingAction: PendingActionClarify): string {
  switch (pendingAction.kind) {
    case "swap":
      return (
        pendingAction.promptHint ||
        `How many **${pendingAction.fromAsset || "XLM"}** do you want to swap to **${pendingAction.toAsset || "USDC"}**?\n\nReply with an amount, e.g. \`50\` or \`50 ${pendingAction.fromAsset || "XLM"}\`.`
      );
    case "send":
      return `How much **${pendingAction.asset || "XLM"}** should I send to \`${pendingAction.destination?.slice(0, 4)}…${pendingAction.destination?.slice(-4)}\`?\n\nReply with an amount, e.g. \`10\`.`;
    case "supply":
      return `How much **${pendingAction.asset || "USDC"}** do you want to supply${pendingAction.protocol ? ` on ${pendingAction.protocol}` : ""}?\n\nReply with an amount, e.g. \`100\`.`;
    case "deposit":
      return `How much **${pendingAction.asset || "XLM"}** do you want to deposit${pendingAction.protocol ? ` into ${pendingAction.protocol}` : ""}?\n\nReply with an amount, e.g. \`25\`.`;
    case "withdraw":
      return `How much **${pendingAction.asset || "XLM"}** do you want to withdraw${pendingAction.protocol ? ` from ${pendingAction.protocol}` : ""}?\n\nReply with an amount, e.g. \`25\`.`;
    case "borrow":
      return `How much **${pendingAction.asset || "USDC"}** do you want to borrow?\n\nReply with an amount, e.g. \`50\`.`;
    case "repay":
      return `How much **${pendingAction.asset || "USDC"}** do you want to repay?\n\nReply with an amount, e.g. \`50\`.`;
    case "add_liquidity":
      return (
        pendingAction.promptHint ||
        `Which second asset should pair with **${pendingAction.amount || "?"} ${pendingAction.asset || "USDC"}** on the liquidity pool?\n\nReply with an asset code, e.g. \`XLM\` or \`pUSDC\` (I'll calculate the matching amount from the pool ratio).`
      );
    default:
      return "How much would you like to use? Reply with an amount (e.g. `50`).";
  }
}

/** Incomplete swap: "swap XLM to USDC" / "convert xlm into usdc" (no leading amount). */
export const INCOMPLETE_SWAP_PAIR_RE =
  /\b(?:swap|exchange|convert)\s+([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;

/** Incomplete swap: "swap to USDC" / "convert into pUSDC" */
export const INCOMPLETE_SWAP_DEST_RE =
  /\b(?:swap|exchange|convert)\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;

/** Incomplete send: "send USDC to G…" without amount */
export const INCOMPLETE_SEND_RE =
  /\b(?:send|transfer|pay)\s+([a-zA-Z]{2,12})\s+to\s+(G[A-Z2-7]{55})\b/i;

/** Incomplete lend/borrow style without amount */
export const INCOMPLETE_SUPPLY_RE =
  /\b(?:supply|lend)\s+([a-zA-Z]{2,12})\b(?!\s*[/\d])/i;

export const INCOMPLETE_DEPOSIT_RE =
  /\b(?:deposit|stake)\s+([a-zA-Z]{2,12})\b(?:.*\b(?:into|on|to)\s+(defindex|meridian|orbit[\s-]?supply|blend)\b)/i;

export const INCOMPLETE_WITHDRAW_RE =
  /\bwithdraw\s+([a-zA-Z]{2,12})\b(?:.*\b(?:from|on)\s+(defindex|meridian|orbit[\s-]?supply|blend)\b)/i;

export const INCOMPLETE_BORROW_RE =
  /\bborrow\s+([a-zA-Z]{2,12})\b/i;

export const INCOMPLETE_REPAY_RE =
  /\brepay\s+([a-zA-Z]{2,12})\b/i;
