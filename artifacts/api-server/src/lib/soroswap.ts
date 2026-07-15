import { logger } from "./logger";

/**
 * Soroswap API client - aligned with https://api.soroswap.finance/docs
 * Network: testnet only for Orbit.
 */
const SOROSWAP_API = "https://api.soroswap.finance";
const NETWORK = "testnet";

/** Docs sample tokens (GET /api/tokens may return a newer list). */
const FALLBACK_TOKENS: Record<string, { contract: string; decimals: number }> = {
 XLM: {
 contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
 decimals: 7,
 },
 USDC: {
 contract: "CBBHRKEP5M3NUDRISGLJKGHDHX3DA2CN2AZBQY6WLVUJ7VNLGSKBDUCM",
 decimals: 7,
 },
 AQUA: {
 contract: "CCXQWO33QBEUDVTWDDOYLD2SYEJSWUM6DIJUX6NDAOSXNCGK3PSIWQJG",
 decimals: 7,
 },
};

type TokenInfo = { contract: string; decimals: number };

let _tokenCache: Record<string, TokenInfo> | null = null;
let _tokenCacheTime = 0;
let _protocolsCache: string[] | null = null;
let _protocolsCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function apiKey(): string | null {
 return process.env.SOROSWAP_API_KEY?.trim() || null;
}

export function soroswapConfigured(): boolean {
 return Boolean(apiKey());
}

async function soroswapFetch(path: string, init?: RequestInit): Promise<Response> {
 const key = apiKey();
 const headers: Record<string, string> = {
 "Content-Type": "application/json",
 ...(init?.headers as Record<string, string> | undefined),
 };
 // Health is public; everything else needs Bearer auth per docs.
 if (key && !path.startsWith("/health")) {
 headers.Authorization = `Bearer ${key}`;
 }
 return fetch(`${SOROSWAP_API}${path}`, { ...init, headers });
}

async function soroswapGet(path: string): Promise<any> {
 const res = await soroswapFetch(path);
 if (!res.ok) {
 let message = `Soroswap GET ${path} failed (${res.status})`;
 try {
 const data: any = await res.json();
 message = data.detail || data.message || data.error || message;
 } catch {
 // ignore
 }
 throw new Error(typeof message === "string" ? message : "Soroswap request failed");
 }
 return res.json();
}

async function soroswapPost(path: string, body: Record<string, unknown>): Promise<any> {
 if (!apiKey()) {
 throw new Error("Soroswap is not configured. Set SOROSWAP_API_KEY in .env.");
 }
 const urlPath = path.includes("?") ? path : `${path}?network=${NETWORK}`;
 let res: Response;
 try {
 res = await soroswapFetch(urlPath, { method: "POST", body: JSON.stringify(body) });
 } catch (err) {
 logger.error({ err, path }, "Soroswap request failed");
 throw new Error("Could not reach Soroswap API");
 }

 if (!res.ok) {
 let message = `Soroswap error (${res.status})`;
 try {
 const data: any = await res.json();
 message =
 data.detail ||
 data.title ||
 (Array.isArray(data.message) ? data.message.join(", ") : data.message) ||
 data.error ||
 message;
 } catch {
 // ignore
 }
 logger.warn({ path, status: res.status, message }, "Soroswap API error");
 throw new Error(typeof message === "string" ? message : "Soroswap request failed");
 }

 return res.json();
}

/** GET /health - indexer status and protocols per network. */
export async function getSoroswapHealth(): Promise<{
 reachable: boolean;
 testnetProtocols: string[];
 mainnetProtocols: string[];
}> {
 try {
 const data = await soroswapGet("/health");
 const indexer = data?.status?.indexer ?? {};
 return {
 reachable: Boolean(data?.status?.reachable ?? data?.reachable),
 testnetProtocols: Array.isArray(indexer.testnet) ? indexer.testnet : [],
 mainnetProtocols: Array.isArray(indexer.mainnet) ? indexer.mainnet : [],
 };
 } catch (err) {
 logger.warn({ err }, "Soroswap health check failed");
 return { reachable: false, testnetProtocols: [], mainnetProtocols: [] };
 }
}

/**
 * Protocols available for quotes on testnet.
 * Prefer GET /protocols; fall back to /health indexer list.
 * Docs: testnet historically exposes soroswap + aqua (not phoenix).
 */
export async function getSoroswapProtocols(): Promise<string[]> {
 const now = Date.now();
 if (_protocolsCache && now - _protocolsCacheTime < CACHE_TTL_MS) {
 return _protocolsCache;
 }

 if (apiKey()) {
 try {
 const data = await soroswapGet(`/protocols?network=${NETWORK}`);
 const list = Array.isArray(data) ? data.map(String) : [];
 if (list.length) {
 _protocolsCache = list;
 _protocolsCacheTime = now;
 return list;
 }
 } catch {
 // fall through to health
 }
 }

 const health = await getSoroswapHealth();
 _protocolsCache = health.testnetProtocols;
 _protocolsCacheTime = now;
 return _protocolsCache;
}

/** True when the testnet aggregator indexer has at least one protocol. */
export async function soroswapTestnetReady(): Promise<boolean> {
 if (!soroswapConfigured()) return false;
 const protocols = await getSoroswapProtocols();
 return protocols.length > 0;
}

/** Live testnet token map from GET /api/tokens. */
export async function getSoroswapTokens(): Promise<Record<string, TokenInfo>> {
 const now = Date.now();
 if (_tokenCache && now - _tokenCacheTime < CACHE_TTL_MS) return _tokenCache;

 try {
 const data = await soroswapGet("/api/tokens");
 const networks = Array.isArray(data) ? data : [];
 const testnet = networks.find((n: any) => n.network === "testnet");
 const assets = testnet?.assets ?? [];
 const map: Record<string, TokenInfo> = {};
 for (const a of assets) {
 const code = String(a.code ?? "").toUpperCase();
 if (!code || !a.contract) continue;
 map[code] = {
 contract: String(a.contract),
 decimals: typeof a.decimals === "number" ? a.decimals : 7,
 };
 }
 if (Object.keys(map).length) {
 _tokenCache = map;
 _tokenCacheTime = now;
 return map;
 }
 } catch (err) {
 logger.warn({ err }, "Failed to load Soroswap token list; using docs fallback");
 }

 _tokenCache = { ...FALLBACK_TOKENS };
 _tokenCacheTime = now;
 return _tokenCache;
}

export async function resolveSoroswapToken(symbol: string): Promise<TokenInfo | null> {
 const tokens = await getSoroswapTokens();
 return tokens[symbol.trim().toUpperCase()] ?? null;
}

export async function isSoroswapPair(from: string, to: string): Promise<boolean> {
 const tokens = await getSoroswapTokens();
 return Boolean(tokens[from.toUpperCase()] && tokens[to.toUpperCase()]);
}

export function toSoroswapUnits(human: string, decimals: number): string {
 const [wholeRaw, fracRaw = ""] = human.trim().split(".");
 const whole = wholeRaw === "" ? "0" : wholeRaw;
 const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
 return BigInt(whole + frac).toString();
}

export function fromSoroswapUnits(raw: string | number, decimals: number): string {
 const s = String(raw);
 const neg = s.startsWith("-");
 const digits = neg ? s.slice(1) : s;
 const padded = digits.padStart(decimals + 1, "0");
 const whole = padded.slice(0, -decimals) || "0";
 const frac = padded.slice(-decimals).replace(/0+$/, "");
 const human = frac ? `${whole}.${frac}` : whole;
 return neg ? `-${human}` : human;
}

/** POST /quote - best route across available testnet protocols. */
export async function getSoroswapQuote(input: {
 assetIn: string;
 assetOut: string;
 amount: string;
 slippageBps?: number;
 gaslessTrustline?: boolean;
}) {
 let protocols = await getSoroswapProtocols();
 if (!protocols.length) {
 // Docs default for testnet when indexer is empty: still request known AMMs
 protocols = ["soroswap", "aqua"];
 }

 const body: Record<string, unknown> = {
 assetIn: input.assetIn,
 assetOut: input.assetOut,
 amount: input.amount,
 tradeType: "EXACT_IN",
 protocols,
 // Docs sample uses string; API accepts either
 slippageBps: String(input.slippageBps ?? 50),
 parts: 10,
 maxHops: 3,
 };
 if (input.gaslessTrustline) {
 body.gaslessTrustline = "create";
 }

 return soroswapPost("/quote", body);
}

/** POST /quote/build - unsigned XDR for Freighter. */
export async function buildSoroswapTransaction(quote: unknown, fromAddress: string) {
 return soroswapPost("/quote/build", {
 quote,
 from: fromAddress,
 to: fromAddress,
 });
}

/** POST /send - submit signed XDR via Soroswap (Soroban RPC / Horizon). */
export async function sendSoroswapTransaction(signedXdr: string) {
 return soroswapPost("/send", { xdr: signedXdr });
}

/** POST /api/faucet - mint testnet tokens for a wallet. */
export async function faucetSoroswapToken(address: string, contract: string) {
 const path = `/api/faucet?address=${encodeURIComponent(address)}&contract=${encodeURIComponent(contract)}`;
 return soroswapPost(path, {});
}

/** GET /balances/:address - Soroban token balances on testnet. */
export async function getSoroswapBalances(wallet: string) {
 return soroswapGet(`/balances/${encodeURIComponent(wallet)}?network=${NETWORK}`);
}

/** POST /liquidity/add - unsigned XDR to add LP. */
export async function addSoroswapLiquidity(input: {
 assetA: string;
 assetB: string;
 amountA: string;
 amountB: string;
 to: string;
 slippageBps?: number;
}) {
 return soroswapPost("/liquidity/add", {
 assetA: input.assetA,
 assetB: input.assetB,
 amountA: input.amountA,
 amountB: input.amountB,
 to: input.to,
 slippageBps: String(input.slippageBps ?? 50),
 });
}

/** POST /liquidity/remove - unsigned XDR to remove LP. */
export async function removeSoroswapLiquidity(input: {
 assetA: string;
 assetB: string;
 liquidity: string;
 to: string;
 amountA?: string;
 amountB?: string;
 slippageBps?: number;
}) {
 return soroswapPost("/liquidity/remove", {
 assetA: input.assetA,
 assetB: input.assetB,
 liquidity: input.liquidity,
 to: input.to,
 amountA: input.amountA ?? "0",
 amountB: input.amountB ?? "0",
 slippageBps: String(input.slippageBps ?? 50),
 });
}

/** GET /liquidity/positions/:address */
export async function getSoroswapPositions(wallet: string) {
 return soroswapGet(`/liquidity/positions/${encodeURIComponent(wallet)}?network=${NETWORK}`);
}

export async function prepareSoroswapAddLiquidity(input: {
 walletAddress: string;
 symbolA: string;
 symbolB: string;
 amountA: string;
 amountB: string;
}): Promise<{ xdr: string; networkPassphrase: string; pair: string }> {
 const a = await resolveSoroswapToken(input.symbolA);
 const b = await resolveSoroswapToken(input.symbolB);
 if (!a || !b) throw new Error("Unknown Soroswap tokens for liquidity");

 const built = await addSoroswapLiquidity({
 assetA: a.contract,
 assetB: b.contract,
 amountA: toSoroswapUnits(input.amountA, a.decimals),
 amountB: toSoroswapUnits(input.amountB, b.decimals),
 to: input.walletAddress,
 });
 const xdr = built.xdr ?? built.transaction ?? built.txXdr;
 if (!xdr) throw new Error("Soroswap did not return XDR for add-liquidity");
 return {
 xdr,
 networkPassphrase: "Test SDF Network ; September 2015",
 pair: `${input.symbolA.toUpperCase()}/${input.symbolB.toUpperCase()}`,
 };
}

export async function prepareSoroswapRemoveLiquidity(input: {
 walletAddress: string;
 symbolA: string;
 symbolB: string;
 liquidity: string;
}): Promise<{ xdr: string; networkPassphrase: string; pair: string }> {
 const a = await resolveSoroswapToken(input.symbolA);
 const b = await resolveSoroswapToken(input.symbolB);
 if (!a || !b) throw new Error("Unknown Soroswap tokens for liquidity");

 const built = await removeSoroswapLiquidity({
 assetA: a.contract,
 assetB: b.contract,
 liquidity: input.liquidity,
 to: input.walletAddress,
 });
 const xdr = built.xdr ?? built.transaction ?? built.txXdr;
 if (!xdr) throw new Error("Soroswap did not return XDR for remove-liquidity");
 return {
 xdr,
 networkPassphrase: "Test SDF Network ; September 2015",
 pair: `${input.symbolA.toUpperCase()}/${input.symbolB.toUpperCase()}`,
 };
}

export async function formatSoroswapPositions(wallet: string): Promise<string> {
 const positions = await getSoroswapPositions(wallet);
 const list = Array.isArray(positions) ? positions : [];
 if (!list.length) return "No Soroswap LP positions for this wallet on testnet.";
 const lines = list.map((p: any) => {
 const a = p.poolInfo?.tokenA?.symbol ?? "?";
 const b = p.poolInfo?.tokenB?.symbol ?? "?";
 return `• ${a}/${b}: shares ${p.userPosition ?? p.userShares ?? "?"}`;
 });
 return ["Soroswap LP positions:", "", ...lines].join("\n");
}

/** Returns a quote preview if a route exists; null if indexer/path unavailable. */
export async function trySoroswapQuote(
 fromSymbol: string,
 toSymbol: string,
 amount: string
): Promise<{ amountOutHuman: string; protocols: string[] | null; priceImpactPct: string | null } | null> {
 if (!(await soroswapTestnetReady())) {
 // Indexer reports no testnet protocols - quoting will fail
 const health = await getSoroswapHealth();
 if (!health.testnetProtocols.length) return null;
 }

 const from = await resolveSoroswapToken(fromSymbol);
 const to = await resolveSoroswapToken(toSymbol);
 if (!from || !to) return null;

 try {
 const quote = await getSoroswapQuote({
 assetIn: from.contract,
 assetOut: to.contract,
 amount: toSoroswapUnits(amount, from.decimals),
 slippageBps: 50,
 });
 const amountOutRaw = quote?.amountOut ?? quote?.otherAmountThreshold ?? null;
 const routeProtocols =
 quote?.routePlan?.map((r: any) => r?.swapInfo?.protocol).filter(Boolean) ??
 quote?.rawTrade?.distribution?.map((d: any) => d.protocol_id).filter(Boolean) ??
 null;

 return {
 amountOutHuman:
 amountOutRaw != null ? fromSoroswapUnits(amountOutRaw, to.decimals) : "?",
 protocols: routeProtocols,
 priceImpactPct: quote?.priceImpactPct != null ? String(quote.priceImpactPct) : null,
 };
 } catch (err: any) {
 const msg = String(err?.message ?? "");
 if (/no path|path not found|quote failed/i.test(msg)) return null;
 throw err;
 }
}

/**
 * Autocorrect Soroswap add-liquidity amounts to the live pool/route ratio.
 * Both user amounts are max caps.
 */
export async function matchSoroswapAddLiquidityAmounts(input: {
 symbolA: string;
 symbolB: string;
 amountAMax: string;
 amountBMax: string;
}): Promise<import("./defi-math").MatchedLpAmounts | null> {
 const { matchLpAmountsFromRatio } = await import("./defi-math");
 const a = await resolveSoroswapToken(input.symbolA);
 const b = await resolveSoroswapToken(input.symbolB);
 if (!a || !b) return null;

 try {
 const preview = await trySoroswapQuote(input.symbolA, input.symbolB, "1");
 const out = preview?.amountOutHuman != null ? parseFloat(preview.amountOutHuman) : NaN;
 if (!Number.isFinite(out) || out <= 0) return null;

 return matchLpAmountsFromRatio({
 symbol0: input.symbolA.toUpperCase(),
 symbol1: input.symbolB.toUpperCase(),
 amount0Max: input.amountAMax,
 amount1Max: input.amountBMax,
 token1PerToken0: out,
 decimals0: a.decimals,
 decimals1: b.decimals,
 });
 } catch (err) {
 logger.warn({ err }, "Soroswap LP ratio match failed");
 return null;
 }
}

export async function prepareSoroswapSwap(input: {
 walletAddress: string;
 fromSymbol: string;
 toSymbol: string;
 amount: string;
}): Promise<{
 xdr: string;
 networkPassphrase: string;
 amountIn: string;
 amountOutHuman: string | null;
 protocols: string[] | null;
 assetIn: string;
 assetOut: string;
 priceImpactPct: string | null;
}> {
 const from = await resolveSoroswapToken(input.fromSymbol);
 const to = await resolveSoroswapToken(input.toSymbol);
 if (!from || !to) {
 throw new Error(
 `Pair not supported on Soroswap testnet. Tokens: ${Object.keys(await getSoroswapTokens()).join(", ")}`
 );
 }

 const amountIn = toSoroswapUnits(input.amount, from.decimals);
 const quote = await getSoroswapQuote({
 assetIn: from.contract,
 assetOut: to.contract,
 amount: amountIn,
 slippageBps: 50,
 });

 const built = await buildSoroswapTransaction(quote, input.walletAddress);
 const xdr =
 (typeof built.xdr === "string" && built.xdr) ||
 (typeof built.transaction === "string" && built.transaction) ||
 (typeof built.txXdr === "string" && built.txXdr) ||
 (typeof built.unsignedXdr === "string" && built.unsignedXdr) ||
 null;

 if (!xdr) {
 logger.error({ builtKeys: Object.keys(built ?? {}) }, "Soroswap build missing XDR");
 throw new Error("Soroswap did not return an unsigned XDR");
 }

 const amountOutRaw = quote?.amountOut ?? quote?.otherAmountThreshold ?? null;
 const routeProtocols =
 quote?.routePlan?.map((r: any) => r?.swapInfo?.protocol).filter(Boolean) ??
 quote?.rawTrade?.distribution?.map((d: any) => d.protocol_id).filter(Boolean) ??
 null;

 return {
 xdr,
 networkPassphrase: "Test SDF Network ; September 2015",
 amountIn,
 amountOutHuman:
 amountOutRaw != null ? fromSoroswapUnits(amountOutRaw, to.decimals) : null,
 protocols: routeProtocols,
 assetIn: from.contract,
 assetOut: to.contract,
 priceImpactPct: quote?.priceImpactPct != null ? String(quote.priceImpactPct) : null,
 };
}

export async function formatSoroswapStatus(): Promise<string> {
 if (!soroswapConfigured()) {
 return "Soroswap is not configured (set SOROSWAP_API_KEY in .env).";
 }

 const [health, protocols, tokens] = await Promise.all([
 getSoroswapHealth(),
 getSoroswapProtocols(),
 getSoroswapTokens(),
 ]);

 const lines = [
 "Soroswap API (https://api.soroswap.finance/docs) - testnet:",
 `• API reachable: ${health.reachable ? "yes" : "no"}`,
 `• Testnet indexer protocols: ${protocols.length ? protocols.join(", ") : "(none - aggregator quotes unavailable)"}`,
 `• Tokens: ${Object.keys(tokens).join(", ")}`,
 ];

 if (!protocols.length) {
 lines.push(
 "",
 "Soroswap's testnet indexer currently lists no protocols, so aggregator quotes return \"No path found\".",
 "Orbit falls back to the classic testnet DEX for XLM/USDC. StelDex still handles pUSDC pairs.",
 'Mint test tokens: "faucet USDC" (POST /api/faucet).'
 );
 } else {
 lines.push('', 'Try: "Swap 10 XLM to USDC" or "faucet USDC".');
 }

 return lines.join("\n");
}
