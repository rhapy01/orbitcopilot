import {
 getAccountBalances,
 getAccountEffects,
 netNativeXlmChangeSince,
} from "./stellar";
import { getSteldexWalletBalances, normalizeSteldexSymbol } from "./steldex";
import { resolveAssetCode } from "./fuzzy-normalize";

export type WalletBalanceRow = {
 asset: string;
 balance: number;
};

export type WalletBalancesPayload = {
 network: "testnet";
 wallet: string;
 fetchedAt: string;
 balances: WalletBalanceRow[];
 historical?: {
 asset: string;
 hoursAgo: number;
 estimatedBalance: number;
 currentBalance: number;
 netChange: number;
 effectCount: number;
 };
};

const ASSET_ALIASES: Record<string, string[]> = {
 XLM: ["xlm", "native", "lumens", "lumen"],
 USDC: ["usdc", "cusdc"], // cUSDC is Circle USDC SAC - same asset
 "Blend USDC": ["blend usdc", "blendusdc"],
 EURC: ["eurc"],
 pUSDC: ["pusdc"],
 STELLAR: ["stellar token"],
 BLND: ["blnd"],
 AQUA: ["aqua"],
 BTC: ["btc", "bitcoin"],
 ETH: ["eth", "ethereum"],
};

/** Canonical display key: cUSDC ≡ USDC (same Circle SAC / trustline). pUSDC and Blend USDC stay separate. */
function assetKey(code: string): string {
 const raw = code.trim();
 if (/^blend[\s_-]?usdc$/i.test(raw)) return "Blend USDC";
 const fuzzy = resolveAssetCode(code);
 const n = normalizeSteldexSymbol(fuzzy ?? code);
 if (n === "cUSDC" || code.toUpperCase() === "CUSDC" || fuzzy === "USDC") return "USDC";
 if (n === "pUSDC" || n === "STELLAR" || n === "EURC" || n === "XLM") return n;
 if (fuzzy) return fuzzy;
 return code.toUpperCase();
}

function displayAsset(code: string): string {
 const key = assetKey(code);
 if (key === "USDC") return "USDC (Circle)";
 if (key === "Blend USDC") return "Blend USDC";
 return key;
}

function assetsMatch(a: string, b: string): boolean {
 const ka = assetKey(a);
 const kb = assetKey(b);
 if (ka === kb) return true;
 // Asking for "USDC" should also surface Blend USDC so the agent can distinguish
 if ((ka === "USDC" && kb === "Blend USDC") || (ka === "Blend USDC" && kb === "USDC")) {
 return true;
 }
 return false;
}

export function detectAssetsInText(content: string): string[] {
 const lower = content.toLowerCase();
 const found: string[] = [];
 for (const [code, aliases] of Object.entries(ASSET_ALIASES)) {
 // Prefer explicit pUSDC over generic usdc
 if (code === "USDC" && lower.includes("pusdc") && !lower.includes("cusdc") && !/\busdc\b/.test(lower)) {
 continue;
 }
 if (aliases.some((a) => lower.includes(a))) found.push(code);
 }
 // Fuzzy pass: scan tokens for near-matches not caught by exact aliases
 for (const token of content.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
 const resolved = resolveAssetCode(token);
 if (resolved && !found.includes(resolved)) found.push(resolved);
 }
 return found;
}

export function parseHoursAgo(content: string): number | undefined {
 const lower = content.toLowerCase();
 const hoursMatch = lower.match(/(\d+)\s*hours?\s+ago/);
 if (hoursMatch) return parseInt(hoursMatch[1], 10);
 if (/\b(?:an|one)\s+hour\s+ago\b/.test(lower)) return 1;
 const minsMatch = lower.match(/(\d+)\s*(?:minutes?|mins?)\s+ago/);
 if (minsMatch) return Math.max(1, Math.round(parseInt(minsMatch[1], 10) / 60));
 if (lower.includes("yesterday")) return 24;
 return undefined;
}

/** Structured wallet balances for LLM tools (Horizon classic + StelDex + Blend USDC). */
export async function fetchWalletBalances(
 publicKey: string,
 opts?: { asset?: string; hoursAgo?: number }
): Promise<WalletBalancesPayload> {
 const [rows, steldex, blendUsdc] = await Promise.all([
 getAccountBalances(publicKey),
 getSteldexWalletBalances(publicKey).catch(() => []),
 import("./blend")
 .then((m) => m.getBlendReserveBalanceHuman(publicKey, "USDC"))
 .catch(() => null),
 ]);

 const byAsset = new Map<string, WalletBalanceRow>();
 for (const r of rows) {
 const key = assetKey(r.assetCode);
 byAsset.set(key, {
 asset: displayAsset(r.assetCode),
 balance: r.balance,
 });
 }
 for (const s of steldex) {
 const key = assetKey(s.asset);
 const existing = byAsset.get(key);
 // Same key (e.g. cUSDC→USDC): keep max so we don't double-list
 if (!existing || s.balance > existing.balance) {
 byAsset.set(key, { asset: displayAsset(s.asset), balance: s.balance });
 }
 }
 if (blendUsdc != null) {
 byAsset.set("Blend USDC", { asset: "Blend USDC", balance: blendUsdc });
 }

 const balances: WalletBalanceRow[] = [...byAsset.values()];

 const payload: WalletBalancesPayload = {
 network: "testnet",
 wallet: publicKey,
 fetchedAt: new Date().toISOString(),
 balances: opts?.asset
 ? balances.filter((b) => assetsMatch(b.asset, opts.asset!))
 : balances,
 };

 const hoursAgo = opts?.hoursAgo;
 const asset = opts?.asset ? assetKey(opts.asset) : "XLM";
 if (hoursAgo != null && hoursAgo > 0 && asset === "XLM") {
 const current = balances.find((b) => assetKey(b.asset) === "XLM")?.balance ?? 0;
 const since = new Date(Date.now() - hoursAgo * 3_600_000);
 const effects = await getAccountEffects(publicKey);
 const { net, count } = netNativeXlmChangeSince(effects, since);
 payload.historical = {
 asset: "XLM",
 hoursAgo,
 estimatedBalance: current - net,
 currentBalance: current,
 netChange: net,
 effectCount: count,
 };
 }

 return payload;
}

function wantsAllWalletAssets(content: string, assets: string[]): boolean {
 const lower = content.toLowerCase();
 if (/\b(?:my\s+)?asset balances?\b/.test(lower)) return true;
 if (/\b(all|every)\s+(?:my\s+)?(?:assets?|balances?|tokens?|holdings?)\b/.test(lower)) {
 return true;
 }
 if (
 /\b(?:what are my|show my|list my)\s+(?:assets?|balances?|tokens?|holdings?)\b/.test(
 lower
 )
 ) {
 return true;
 }
 if (
 /\b(?:assets?|balances?|holdings?)\b/.test(lower) &&
 assets.length === 0 &&
 !/\b(portfolio|position|lp|farm|earning|rebalance)\b/.test(lower)
 ) {
 return true;
 }
 return false;
}

/** No-LLM fallback: short answer only, no portfolio essay. */
export async function answerWalletQueryFromMessage(
 publicKey: string,
 content: string
): Promise<string | null> {
 const lower = content.toLowerCase();
 if (
 !/\b(balance|balances|how much|assets?|holdings?)\b/.test(lower)
 ) {
 return null;
 }
 if (
 /\b(portfolio|rebalance|earning|idle|lp|farm|steldex|blend|predict|perp)\b/.test(
 lower
 )
 ) {
 return null;
 }

 const assets = detectAssetsInText(content);
 const allAssets = wantsAllWalletAssets(content, assets);
 const hoursAgo = parseHoursAgo(content);

 if (allAssets) {
 const data = await fetchWalletBalances(publicKey);
 if (!data.balances.length) return "No wallet balances found on testnet.";
 return data.balances
 .map((b) => `${b.asset}: ${b.balance.toFixed(4)}`)
 .join("\n");
 }

 const asset = assets[0] ?? "XLM";
 // Classic Circle USDC = StelDex cUSDC; pUSDC is a different StelDex token
 if (asset === "USDC") {
 const data = await fetchWalletBalances(publicKey, { asset: "USDC" });
 const pusdc = await fetchWalletBalances(publicKey, { asset: "pUSDC" });
 const usdcBal = data.balances[0]?.balance ?? 0;
 const pusdcBal = pusdc.balances[0]?.balance ?? 0;
 if (usdcBal <= 0 && pusdcBal > 0) {
 return `0 USDC. You do have ${pusdcBal.toFixed(4)} pUSDC on StelDex (different token) - ask for “pUSDC balance” or swap using pUSDC.`;
 }
 return `${usdcBal.toFixed(4)} USDC`;
 }

 const data = await fetchWalletBalances(publicKey, { asset, hoursAgo });
 const row = data.balances[0];
 const current = row?.balance ?? 0;

 if (data.historical) {
 const h = data.historical;
 const est = h.estimatedBalance.toFixed(4);
 const now = h.currentBalance.toFixed(4);
 if (hoursAgo) {
 return `XLM now: ${now}\nXLM ~${hoursAgo}h ago: ~${est}`;
 }
 }

 return `${current.toFixed(4)} ${asset}`;
}
