/**
 * Chat intent regexes — shared for routing + smoke tests.
 * Keep in sync with handlers in routes/chat.ts.
 */

export const PERP_CLOSE_RE = /\bclose\s+(?:my\s+)?([a-z0-9]+)\s*perp\b/i;
export const PREDICT_CLAIM_RE =
  /\bclaim\s+(?:my\s+)?(?:(yes|no)\s+)?winnings?(?:\s+on\s+([a-z0-9\-]+))?\b|\bclaim\s+(yes|no)\s+on\s+([a-z0-9\-]+)\b/i;
export const NFT_MINT_RE =
  /\bmint\s+(?:an?\s+)?nft\b(?:\s+(?:called|named|as)\s+["']?([^"'\n]+)["']?)?(?:\s+(?:uri|url)\s+(\S+))?/i;
export const NFT_LIST_RE =
  /\blist\s+nft\s+#?(\d+)\s+(?:for\s+)?([\d.]+)\s*xlm\b/i;
export const NFT_BUY_RE = /\bbuy\s+nft\s+#?(\d+)\b/i;
export const NFT_TRANSFER_RE =
  /\b(?:transfer|send)\s+nft\s+#?(\d+)\s+to\s+(G[A-Z2-7]{55})\b/i;
export const NFT_CLAIM_BETA_RE =
  /\bclaim\s+(?:my\s+)?(?:orbit\s+)?beta\s+(?:tester\s+)?nft\b|\bclaim\s+(?:my\s+)?feedback\s+nft\b|\bi\s+have\s+submitted\s+my\s+feedback[,\s]+mint\s+my\s+beta\s+tester\s+nft\b|\bmint\s+my\s+beta\s+tester\s+nft\b/i;
export const FAUCET_RE =
  /\b(?:faucet|claim\s+test)\s+([a-zA-Z]{2,12})\b|\bmint\s+(?!an?\s+nft\b)([a-zA-Z]{2,12})\b/i;

export type IntentKind =
  | "perp_close"
  | "predict_claim"
  | "nft_mint"
  | "nft_list"
  | "nft_buy"
  | "nft_transfer"
  | "nft_claim_beta"
  | "faucet"
  | null;

/** Lightweight intent classifier for smoke tests (order matches chat priority for these). */
export function classifyGreenbeltIntent(content: string): IntentKind {
  if (NFT_CLAIM_BETA_RE.test(content)) return "nft_claim_beta";
  if (NFT_MINT_RE.test(content)) return "nft_mint";
  if (NFT_LIST_RE.test(content)) return "nft_list";
  if (NFT_BUY_RE.test(content)) return "nft_buy";
  if (NFT_TRANSFER_RE.test(content)) return "nft_transfer";
  if (PREDICT_CLAIM_RE.test(content)) return "predict_claim";
  if (PERP_CLOSE_RE.test(content)) return "perp_close";
  if (FAUCET_RE.test(content)) return "faucet";
  return null;
}
