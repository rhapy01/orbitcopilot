/**
 * Fuzzy spelling / alias normalization for chat intents.
 * Corrects asset codes, protocol names, and common crypto shorthand
 * before deterministic regex routing and LLM calls.
 */

export type FuzzyCorrection = { from: string; to: string };

export type NormalizeResult = {
 text: string;
 corrections: FuzzyCorrection[];
};

type VocabEntry = {
 /** Form written back into the message (regex/LLM friendly). */
 canonical: string;
 aliases: string[];
};

/** Assets and tickers used in Orbit chat actions. */
const ASSET_VOCAB: VocabEntry[] = [
 { canonical: "XLM", aliases: ["xlm", "native", "lumens", "lumen"] },
 { canonical: "USDC", aliases: ["usdc", "cusdc"] },
 { canonical: "pUSDC", aliases: ["pusdc"] },
 { canonical: "EURC", aliases: ["eurc"] },
 { canonical: "BLND", aliases: ["blnd"] },
 { canonical: "AQUA", aliases: ["aqua"] },
 { canonical: "STELLAR", aliases: ["stellar"] },
 { canonical: "wETH", aliases: ["weth"] },
 { canonical: "wBTC", aliases: ["wbtc"] },
 { canonical: "BTC", aliases: ["btc", "bitcoin"] },
 { canonical: "ETH", aliases: ["eth", "ethereum"] },
];

/** Protocol names - written as lowercase so `.includes("blend")` still works. */
const PROTOCOL_VOCAB: VocabEntry[] = [
 { canonical: "blend", aliases: ["blend"] },
 { canonical: "steldex", aliases: ["steldex"] },
 { canonical: "soroswap", aliases: ["soroswap"] },
 { canonical: "aquarius", aliases: ["aquarius"] },
 { canonical: "reflector", aliases: ["reflector"] },
 { canonical: "friendbot", aliases: ["friendbot"] },
 { canonical: "phoenix", aliases: ["phoenix"] },
];

/** Never fuzzy-correct these - verbs, function words, and short finance jargon. */
const STOP_WORDS = new Set([
 "a",
 "an",
 "the",
 "to",
 "for",
 "on",
 "in",
 "at",
 "of",
 "or",
 "and",
 "my",
 "me",
 "is",
 "it",
 "if",
 "as",
 "by",
 "up",
 "no",
 "yes",
 "all",
 "do",
 "be",
 "so",
 "we",
 "us",
 "lp",
 "nft",
 "amm",
 "dex",
 "apy",
 "tvl",
 "long",
 "short",
 "open",
 "close",
 "swap",
 "send",
 "stake",
 "unstake",
 "claim",
 "mint",
 "list",
 "buy",
 "sell",
 "pool",
 "farm",
 "from",
 "into",
 "with",
 "what",
 "how",
 "show",
 "please",
 "could",
 "would",
 "help",
 "lend",
 "deposit",
 "withdraw",
 "borrow",
 "repay",
 "supply",
 "add",
 "remove",
 "quote",
 "price",
 "route",
 "order",
 "cancel",
 "transfer",
 "pay",
 "convert",
 "exchange",
 "invest",
 "bet",
 "predict",
 "fund",
 "faucet",
 "wallet",
 "balance",
 "portfolio",
 "market",
 "markets",
 "yield",
 "earn",
 "rewards",
 "liquidity",
 "position",
 "positions",
 "perp",
 "perps",
 "weeks",
 "week",
 "hours",
 "hour",
 "ago",
]);

/** Damerau-Levenshtein (includes adjacent transposition). */
export function editDistance(a: string, b: string): number {
 const s = a.toLowerCase();
 const t = b.toLowerCase();
 if (s === t) return 0;
 const n = s.length;
 const m = t.length;
 if (!n) return m;
 if (!m) return n;

 const dp: number[][] = Array.from({ length: n + 1 }, () =>
 Array<number>(m + 1).fill(0)
 );
 for (let i = 0; i <= n; i++) dp[i][0] = i;
 for (let j = 0; j <= m; j++) dp[0][j] = j;

 for (let i = 1; i <= n; i++) {
 for (let j = 1; j <= m; j++) {
 const cost = s[i - 1] === t[j - 1] ? 0 : 1;
 dp[i][j] = Math.min(
 dp[i - 1][j] + 1,
 dp[i][j - 1] + 1,
 dp[i - 1][j - 1] + cost
 );
 if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
 dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
 }
 }
 }
 return dp[n][m];
}

function maxDistanceForLength(len: number): number {
 if (len <= 3) return 0;
 if (len <= 5) return 1;
 return 2;
}

type Candidate = { canonical: string; key: string };

function buildCandidates(entries: VocabEntry[]): Candidate[] {
 const out: Candidate[] = [];
 for (const e of entries) {
 out.push({ canonical: e.canonical, key: e.canonical.toLowerCase() });
 for (const a of e.aliases) {
 out.push({ canonical: e.canonical, key: a.toLowerCase() });
 }
 }
 return out;
}

const ASSET_CANDIDATES = buildCandidates(ASSET_VOCAB);
const PROTOCOL_CANDIDATES = buildCandidates(PROTOCOL_VOCAB);
const ALL_CANDIDATES = [...ASSET_CANDIDATES, ...PROTOCOL_CANDIDATES];

/** Exact alias / canonical lookup (case-insensitive). */
export function resolveExactToken(raw: string): string | null {
 const key = raw.trim().toLowerCase();
 if (!key) return null;
 for (const c of ALL_CANDIDATES) {
 if (c.key === key) return c.canonical;
 }
 return null;
}

/**
 * Resolve a single token to a canonical asset/protocol form.
 * Returns null when no confident match.
 */
export function resolveFuzzyToken(raw: string): string | null {
 const key = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
 if (!key || STOP_WORDS.has(key)) return null;

 const exact = resolveExactToken(key);
 if (exact) return exact;

 const maxDist = maxDistanceForLength(key.length);
 if (maxDist === 0) return null;

 let best: { canonical: string; dist: number } | null = null;
 let tie = false;

 for (const c of ALL_CANDIDATES) {
 // Skip wildly different lengths
 if (Math.abs(c.key.length - key.length) > maxDist) continue;
 const dist = editDistance(key, c.key);
 if (dist > maxDist) continue;
 if (!best || dist < best.dist) {
 best = { canonical: c.canonical, dist };
 tie = false;
 } else if (best && dist === best.dist && c.canonical !== best.canonical) {
 tie = true;
 }
 }

 if (!best || tie) return null;
 return best.canonical;
}

/** Resolve asset codes only (for balance / StelDex / Blend helpers). */
export function resolveAssetCode(raw: string): string | null {
 const key = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
 if (!key || STOP_WORDS.has(key)) return null;

 for (const c of ASSET_CANDIDATES) {
 if (c.key === key) return c.canonical;
 }

 const maxDist = maxDistanceForLength(key.length);
 if (maxDist === 0) return null;

 let best: { canonical: string; dist: number } | null = null;
 let tie = false;
 for (const c of ASSET_CANDIDATES) {
 if (Math.abs(c.key.length - key.length) > maxDist) continue;
 const dist = editDistance(key, c.key);
 if (dist > maxDist) continue;
 if (!best || dist < best.dist) {
 best = { canonical: c.canonical, dist };
 tie = false;
 } else if (best && dist === best.dist && c.canonical !== best.canonical) {
 tie = true;
 }
 }
 if (!best || tie) return null;
 return best.canonical;
}

/**
 * Normalize a user chat message: fix typos in assets/protocols,
 * and split glued amounts like "10pudsc" → "10pUSDC".
 */
export function normalizeUserMessage(content: string): NormalizeResult {
 const corrections: FuzzyCorrection[] = [];

 // Multi-word aliases first (longest wins)
 let text = content.replace(/\bstellar\s+token\b/gi, () => {
 corrections.push({ from: "stellar token", to: "STELLAR" });
 return "STELLAR";
 });

 text = text.replace(
 /([a-zA-Z0-9]+)/g,
 (raw) => {
 // Stellar public key
 if (/^G[A-Z2-7]{55}$/i.test(raw)) return raw;

 // Glued amount + asset: 10pudsc, 2xlmm
 const glued = raw.match(/^([\d.]+)([A-Za-z][A-Za-z0-9]*)$/);
 if (glued) {
 const [, amount, assetPart] = glued;
 const resolved = resolveFuzzyToken(assetPart);
 if (resolved && resolved.toLowerCase() !== assetPart.toLowerCase()) {
 corrections.push({ from: assetPart, to: resolved });
 return `${amount}${resolved}`;
 }
 if (resolved) return `${amount}${resolved}`;
 return raw;
 }

 // Pure number
 if (/^[\d.]+$/.test(raw)) return raw;

 const lower = raw.toLowerCase();
 if (STOP_WORDS.has(lower)) return raw;

 const resolved = resolveFuzzyToken(raw);
 if (!resolved) return raw;

 // Already canonical (case-insensitive)
 if (resolved.toLowerCase() === lower) {
 // Prefer canonical casing for assets (XLM, pUSDC, …)
 if (resolved !== raw && /^[A-Za-z]/.test(resolved) && resolved !== lower) {
 corrections.push({ from: raw, to: resolved });
 return resolved;
 }
 return raw;
 }

 corrections.push({ from: raw, to: resolved });
 return resolved;
 }
 );

 return { text, corrections };
}

export function normalizeUserMessageText(content: string): string {
 return normalizeUserMessage(content).text;
}
