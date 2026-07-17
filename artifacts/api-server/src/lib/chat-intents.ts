/**
 * Chat intent regexes - shared for routing + smoke tests.
 * Keep in sync with handlers in routes/chat.ts.
 */

export const PERP_CLOSE_RE = /\bclose\s+(?:my\s+)?([a-z0-9]+)\s*perp\b/i;
export const PREDICT_CLAIM_RE =
 /\bclaim\s+(?:my\s+)?(?:(yes|no)\s+)?winnings?(?:\s+on\s+([a-z0-9\-]+))?\b|\bclaim\s+(yes|no)\s+on\s+([a-z0-9\-]+)\b/i;
export const NFT_MINT_RE =
 /\bmint\s+(?:an?\s+)?nft\b(?:\s+(?:called|named|as)\s+["']?([^"'\n]+?)["']?)?(?:\s+(?:uri|url)\s+(\S+))?(?:\s+image\s+(\S+))?(?:\s+traits?\s+(.+))?/i;
export const NFT_LIST_RE =
 /\blist\s+nft\s+#?(\d+)\s+(?:for\s+)?([\d.]+)\s*xlm\b/i;
export const NFT_BUY_RE = /\bbuy\s+nft\s+#?(\d+)\b/i;
export const NFT_TRANSFER_RE =
 /\b(?:transfer|send)\s+nft\s+#?(\d+)\s+to\s+(G[A-Z2-7]{55})\b/i;
export const NFT_CANCEL_RE =
 /\bcancel\s+(?:listing\s+(?:for\s+)?)?nft\s+#?(\d+)\b|\bunlist\s+nft\s+#?(\d+)\b/i;
export const NFT_CREATE_COLLECTION_RE =
 /\bcreate\s+(?:an?\s+)?(?:nft\s+)?collection\b(?:\s+(?:called|named)?\s*["']?([^"'\n]+?)["']?(?=\s*(?:,|\s)+(?:symbol|max|total|supply|ts|royalty|description|image|website|banner)\b|\s*$))?(?:\s+symbol\s+([A-Za-z0-9]{1,12}))?(?:\s+max(?:\s+supply)?\s+(\d+))?/i;
export const NFT_CLAIM_BETA_RE =
 /\bclaim\s+(?:my\s+)?(?:orbit\s+)?beta\s+(?:tester\s+)?nft\b|\bclaim\s+(?:my\s+)?feedback\s+nft\b|\bi\s+have\s+submitted\s+my\s+feedback[,\s]+mint\s+my\s+beta\s+tester\s+nft\b|\bmint\s+my\s+beta\s+tester\s+nft\b/i;
/** Launch fungible token (classic + SAC). Avoid colliding with "mint NFT". */
export const TOKEN_LAUNCH_RE =
 /\b(?:launch|create|issue)\s+token\s+([A-Za-z0-9]{1,12})(?:\s+(?:with\s+)?(?:supply|amount)\s+([\d.]+))?/i;
export const TOKEN_MINT_SUPPLY_RE =
 /\bmint\s+([\d.]+)\s+([A-Za-z0-9]{1,12})\b(?!\s*nft)/i;
export const FAUCET_RE =
 /\b(?:faucet|claim\s+test)\s+([a-zA-Z]{2,12})\b|\bmint\s+(?!an?\s+nft\b)([a-zA-Z]{2,12})\b/i;

/** Orbit Supply yield claim - "claim my yield", "claim orbit supply rewards" */
export const ORBIT_SUPPLY_CLAIM_RE =
 /\bclaim\s+(?:my\s+)?(?:orbit[\s-]?supply\s+)?(?:yield|rewards?)\b|\bclaim\s+(?:from\s+)?orbit[\s-]?supply\b/i;

/** "supply 100 USDC on orbit-supply" / "deposit 50 pUSDC to orbit supply" */
export const ORBIT_SUPPLY_DEPOSIT_RE =
 /\b(?:supply|deposit|stake)\s+([\d.]+)\s*(usdc|pusdc|eurc|cusdc)\b(?:.*?\b(?:on|to|into)\b.*?\borbit[\s-]?supply\b|\s+orbit[\s-]?supply\b)/i;

/** "withdraw 50 USDC from orbit-supply" */
export const ORBIT_SUPPLY_WITHDRAW_RE =
 /\bwithdraw\s+([\d.]+)\s*(usdc|pusdc|eurc|cusdc)\b(?:.*?\b(?:from|on)\b.*?\borbit[\s-]?supply\b|\s+orbit[\s-]?supply\b)/i;

export type IntentKind =
 | "perp_close"
 | "predict_claim"
 | "nft_mint"
 | "nft_list"
 | "nft_buy"
 | "nft_transfer"
 | "nft_cancel"
 | "nft_create_collection"
 | "nft_claim_beta"
 | "token_launch"
 | "token_mint_supply"
 | "faucet"
 | "orbit_supply_claim"
 | "orbit_supply_deposit"
 | "orbit_supply_withdraw"
 | null;

/** Lightweight intent classifier for smoke tests (order matches chat priority for these). */
export function classifyGreenbeltIntent(content: string): IntentKind {
 if (NFT_CLAIM_BETA_RE.test(content)) return "nft_claim_beta";
 if (ORBIT_SUPPLY_CLAIM_RE.test(content)) return "orbit_supply_claim";
 if (ORBIT_SUPPLY_DEPOSIT_RE.test(content)) return "orbit_supply_deposit";
 if (ORBIT_SUPPLY_WITHDRAW_RE.test(content)) return "orbit_supply_withdraw";
 if (NFT_CREATE_COLLECTION_RE.test(content)) return "nft_create_collection";
 if (TOKEN_LAUNCH_RE.test(content)) return "token_launch";
 if (TOKEN_MINT_SUPPLY_RE.test(content)) return "token_mint_supply";
 if (NFT_MINT_RE.test(content)) return "nft_mint";
 if (NFT_CANCEL_RE.test(content)) return "nft_cancel";
 if (NFT_LIST_RE.test(content)) return "nft_list";
 if (NFT_BUY_RE.test(content)) return "nft_buy";
 if (NFT_TRANSFER_RE.test(content)) return "nft_transfer";
 if (PREDICT_CLAIM_RE.test(content)) return "predict_claim";
 if (PERP_CLOSE_RE.test(content)) return "perp_close";
 if (FAUCET_RE.test(content)) return "faucet";
 return null;
}
