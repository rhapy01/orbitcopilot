import { logger } from "./logger";
import { NETWORK_PASSPHRASE, SOROBAN_RPC } from "./stellar";
import { withRetry } from "./retry";
import { resolveAssetCode } from "./fuzzy-normalize";
import { NATIVE_XLM_SAC, TESTNET_USDC_SAC } from "./onchain";

const CONTRACTS_URL =
 "https://cdn.jsdelivr.net/gh/blend-capital/blend-utils@main/testnet.contracts.json";

/**
 * Live Blend UI pool on testnet (dashboard default):
 * https://testnet.blend.capital/dashboard/?poolId=CAPBMXIQ…
 * Reserves: XLM + Circle USDC (CBIELT…) + CETES + TESOURO
 *
 * Older blend-utils "TestnetV2" (CCEB…) used a mock USDC (CAQCFV…) - do not use that for Orbit.
 */
export const BLEND_LIVE_POOL_ID =
 process.env.ORBIT_BLEND_POOL_ID?.trim() ||
 "CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW";

/** Live pool reserve tokens (verified via get_reserve_list). */
export const BLEND_LIVE_RESERVES: Record<
 string,
 { contract: string; decimals: number }
> = {
 XLM: { contract: NATIVE_XLM_SAC, decimals: 7 },
 USDC: { contract: TESTNET_USDC_SAC, decimals: 7 }, // Circle USDC SAC = classic USDC:GBBD…
 CETES: {
 contract: "CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC",
 decimals: 7,
 },
 TESOURO: {
 contract: "CCKA3OUWLZPX3YT335UNHIFMKSYA37M66VKGD5XZOX4BA4IKTYP4WBEE",
 decimals: 7,
 },
};

export interface BlendContracts {
 ids: Record<string, string>;
 hashes: Record<string, string>;
}

/** Blend Pool RequestType enum (v2). */
export const BlendRequestType = {
 Supply: 0,
 Withdraw: 1,
 SupplyCollateral: 2,
 WithdrawCollateral: 3,
 Borrow: 4,
 Repay: 5,
} as const;

let _cache: BlendContracts | null = null;
let _cacheTime = 0;
const TTL = 10 * 60 * 1000;

export async function getBlendContracts(): Promise<BlendContracts> {
 const now = Date.now();
 if (_cache && now - _cacheTime < TTL) return _cache;

 try {
 const res = await withRetry(() => fetch(CONTRACTS_URL), { label: "blend.contracts" });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 _cache = (await res.json()) as BlendContracts;
 _cacheTime = now;
 return _cache;
 } catch (err) {
 logger.error({ err }, "Failed to load Blend testnet contracts");
 throw new Error("Could not load Blend testnet contracts");
 }
}

export function getBlendPoolId(): string {
 return BLEND_LIVE_POOL_ID;
}

export function blendReserveSymbols(): string[] {
 return Object.keys(BLEND_LIVE_RESERVES);
}

export async function formatBlendMarkets(): Promise<string> {
 const pool = getBlendPoolId();
 const lines = blendReserveSymbols().map(
 (s) => `• ${s}: ${BLEND_LIVE_RESERVES[s].contract}`
 );

 return [
 "Blend Protocol (Stellar Testnet) - live UI pool:",
 "",
 `Pool: ${pool}`,
 `Dashboard: https://testnet.blend.capital/dashboard/?poolId=${pool}`,
 "",
 "Reserves (same tokens as Freighter / classic where applicable):",
 ...lines,
 "",
 "USDC here is **Circle USDC** (CBIELT… / GBBD47…) - the same USDC in your wallet.",
 "XLM is the native SAC.",
 "",
 'Actions: "supply 10 USDC on Blend", "borrow 2 XLM on Blend", "repay 1 XLM on Blend", "withdraw 5 USDC on Blend", "claim Blend rewards".',
 "Supply uses collateral mode so you can borrow against deposits.",
 ].join("\n");
}

export async function resolveBlendReserve(symbol: string): Promise<{
 symbol: string;
 tokenContract: string;
 poolContract: string;
 decimals: number;
} | null> {
 const fuzzy = resolveAssetCode(symbol);
 let key = (fuzzy ?? symbol).trim().toUpperCase();
 if (key === "CUSDC" || key === "CIRCLE USDC") key = "USDC";
 const entry = BLEND_LIVE_RESERVES[key];
 if (!entry) return null;
 return {
 symbol: key,
 tokenContract: entry.contract,
 poolContract: getBlendPoolId(),
 decimals: entry.decimals,
 };
}

const DECIMALS: Record<string, number> = {
 XLM: 7,
 USDC: 7,
 CETES: 7,
 TESOURO: 7,
 BLND: 7,
 wETH: 7,
 wBTC: 7,
};

export function toBlendUnits(human: string, symbol: string): string {
 const decimals = DECIMALS[symbol.toUpperCase()] ?? 7;
 const [wholeRaw, fracRaw = ""] = human.trim().split(".");
 const whole = wholeRaw === "" ? "0" : wholeRaw;
 const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
 return BigInt(whole + frac).toString();
}

/** Free wallet balance of a live-pool reserve (Circle USDC = classic + SAC). */
export async function getBlendReserveBalanceHuman(
 walletAddress: string,
 symbol: string
): Promise<number | null> {
 const reserve = await resolveBlendReserve(symbol);
 if (!reserve) return null;
 try {
 let best = 0;
 if (reserve.symbol === "USDC") {
 try {
 const { getAccountBalances } = await import("./stellar");
 const classic = await getAccountBalances(walletAddress);
 best = Math.max(best, classic.find((b) => b.assetCode === "USDC")?.balance ?? 0);
 } catch {
 /* ignore */
 }
 }
 if (reserve.symbol === "XLM") {
 try {
 const { getAccountBalances } = await import("./stellar");
 const classic = await getAccountBalances(walletAddress);
 best = Math.max(best, classic.find((b) => b.assetCode === "XLM")?.balance ?? 0);
 } catch {
 /* ignore */
 }
 }
 const { getSorobanTokenBalance } = await import("./onchain");
 const raw = await getSorobanTokenBalance(walletAddress, reserve.tokenContract);
 const decimals = reserve.decimals ?? DECIMALS[reserve.symbol] ?? 7;
 best = Math.max(best, Number(raw) / 10 ** decimals);
 return best;
 } catch (err) {
 logger.warn({ err, symbol, walletAddress }, "Blend reserve balance read failed");
 return null;
 }
}

/**
 * Preflight for supply/repay against the live Blend UI pool.
 * USDC = Circle USDC (same as wallet USDC).
 */
export async function preflightBlendWalletSpend(opts: {
 walletAddress: string;
 symbol: string;
 amount: string;
 op: "supply" | "repay";
}): Promise<
 | { ok: true }
 | {
 ok: false;
 message: string;
 circleUsdc?: number;
 blendUsdc?: number;
 canConvert?: boolean;
 }
> {
 const need = parseFloat(opts.amount);
 if (!Number.isFinite(need) || need <= 0) {
 return { ok: false, message: `Invalid ${opts.op} amount "${opts.amount}".` };
 }

 const reserve = await resolveBlendReserve(opts.symbol);
 if (!reserve) {
 return {
 ok: false,
 message: `That asset isn't on the live Blend pool reserves (${blendReserveSymbols().join(", ")}).`,
 };
 }

 const bal = (await getBlendReserveBalanceHuman(opts.walletAddress, reserve.symbol)) ?? 0;
 if (need <= bal + 1e-9) return { ok: true };

 const short = `${opts.walletAddress.slice(0, 4)}…${opts.walletAddress.slice(-4)}`;
 const verb = opts.op === "repay" ? "repay" : "supply";

 if (reserve.symbol === "USDC") {
 return {
 ok: false,
 circleUsdc: bal,
 message: [
 `Can't ${verb} ${need} USDC on Blend from ${short}: need ${need}, have ~${bal.toFixed(4)} Circle USDC.`,
 "",
 "This Blend pool uses the same Circle USDC as your wallet (CBIELT… / GBBD47…). Get more via \"faucet USDC\" or a swap.",
 ].join("\n"),
 };
 }

 if (reserve.symbol === "XLM") {
 const spendable = Math.max(0, bal - 2.5);
 return {
 ok: false,
 message: `Can't ${verb} ${need} XLM on Blend from ${short}: need ${need}, have ~${spendable.toFixed(4)} spendable XLM (~${bal.toFixed(4)} total, keep ~2.5 for fees).`,
 };
 }

 return {
 ok: false,
 message: `Can't ${verb} ${need} ${reserve.symbol} on Blend from ${short}: need ${need}, have ~${bal.toFixed(6)}.`,
 };
}

/** Build unsigned Circle USDC → Blend USDC swap via Orbit bridge. */
export async function prepareCircleToBlendUsdcSwap(input: {
 walletAddress: string;
 amount: string;
}): Promise<{
 type: "blend_usdc_swap";
 sendAmount: string;
 sendAsset: string;
 destAsset: string;
 xdr: string;
 networkPassphrase: string;
 message: string;
}> {
 const { requireOrbitBlendSwapContract, TESTNET_USDC_SAC, buildContractInvoke } = await import(
 "./onchain"
 );
 const contractId = requireOrbitBlendSwapContract();
 const need = parseFloat(input.amount);
 if (!Number.isFinite(need) || need <= 0) {
 throw new Error("Amount must be positive");
 }

 // Ensure user has Circle USDC
 let circle = 0;
 try {
 const { getAccountBalances } = await import("./stellar");
 const bals = await getAccountBalances(input.walletAddress);
 circle = bals.find((b) => b.assetCode === "USDC")?.balance ?? 0;
 } catch {
 /* ignore */
 }
 try {
 const { getSorobanTokenBalance } = await import("./onchain");
 const raw = await getSorobanTokenBalance(input.walletAddress, TESTNET_USDC_SAC);
 circle = Math.max(circle, Number(raw) / 1e7);
 } catch {
 /* ignore */
 }
 if (need > circle + 1e-9) {
 throw new Error(
 `Not enough Circle USDC to convert: need ${need}, have ~${circle.toFixed(4)}. Get Circle USDC via "faucet USDC" first.`
 );
 }

 const amountRaw = toBlendUnits(input.amount, "USDC");
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "swap_to_blend",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 nativeToScVal(BigInt(amountRaw), { type: "i128" }),
 ],
 });

 return {
 type: "blend_usdc_swap",
 sendAmount: input.amount,
 sendAsset: "USDC",
 destAsset: "Blend USDC",
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Convert ${input.amount} Circle USDC → ${input.amount} Blend USDC (1:1 Orbit bridge). Then you can supply/borrow on Blend.`,
 };
}

/**
 * Claim Blend pool emissions (BLND) for all common reserve token IDs.
 * Per Blend docs: dToken id = index*2, bToken id = index*2+1.
 */
export async function buildBlendClaimTx(input: {
 walletAddress: string;
}): Promise<{ xdr: string; networkPassphrase: string; poolContract: string }> {
 const poolContract = getBlendPoolId();
 const reserves = blendReserveSymbols();
 const reserveTokenIds: number[] = [];
 for (let i = 0; i < reserves.length; i++) {
 reserveTokenIds.push(i * 2, i * 2 + 1);
 }

 const {
 Contract,
 TransactionBuilder,
 Networks,
 BASE_FEE,
 Address,
 nativeToScVal,
 xdr,
 } = await import("@stellar/stellar-sdk");
 const { Server, assembleTransaction } = await import("@stellar/stellar-sdk/rpc");

 const rpc = new Server(SOROBAN_RPC);
 const account = await rpc.getAccount(input.walletAddress);
 const contract = new Contract(poolContract);
 const fromSc = Address.fromString(input.walletAddress).toScVal();
 const idsSc = xdr.ScVal.scvVec(
 reserveTokenIds.map((id) => nativeToScVal(id, { type: "u32" }))
 );

 const op = contract.call("claim", fromSc, idsSc, fromSc);
 const tx = new TransactionBuilder(account, {
 fee: BASE_FEE,
 networkPassphrase: Networks.TESTNET,
 })
 .addOperation(op)
 .setTimeout(300)
 .build();

 const simulated = await rpc.simulateTransaction(tx);
 if ((simulated as any)?.error) {
 throw new Error(
 `Blend claim failed: ${(simulated as any).error}. You may have no claimable emissions yet - supply or borrow first and wait for emissions.`
 );
 }
 const assembled = assembleTransaction(tx, simulated).build();
 return {
 xdr: assembled.toXDR(),
 networkPassphrase: NETWORK_PASSPHRASE,
 poolContract,
 };
}

/**
 * Build an unsigned Blend pool.submit transaction for Freighter.
 * Request types: Supply / Withdraw / Borrow / Repay (and collateral variants).
 */
export async function buildBlendSubmitTx(input: {
 walletAddress: string;
 requestType: number;
 symbol: string;
 amount: string;
}): Promise<{ xdr: string; networkPassphrase: string; poolContract: string; tokenContract: string }> {
 const reserve = await resolveBlendReserve(input.symbol);
 if (!reserve) {
 throw new Error(
 `Unknown Blend reserve "${input.symbol}" (${blendReserveSymbols().join(", ")})`
 );
 }

 const amount = toBlendUnits(input.amount, reserve.symbol);
 const {
 Contract,
 TransactionBuilder,
 Networks,
 BASE_FEE,
 Address,
 nativeToScVal,
 xdr,
 } = await import("@stellar/stellar-sdk");
 const { Server } = await import("@stellar/stellar-sdk/rpc");

 const rpc = new Server(SOROBAN_RPC);
 const account = await rpc.getAccount(input.walletAddress);
 const contract = new Contract(reserve.poolContract);

 const walletSc = Address.fromString(input.walletAddress).toScVal();
 const tokenSc = Address.fromString(reserve.tokenContract).toScVal();
 const amountSc = nativeToScVal(BigInt(amount), { type: "i128" });

 // Request struct as ScMap - keys must be sorted for Soroban struct encoding
 const request = xdr.ScVal.scvMap([
 new xdr.ScMapEntry({
 key: xdr.ScVal.scvSymbol("address"),
 val: tokenSc,
 }),
 new xdr.ScMapEntry({
 key: xdr.ScVal.scvSymbol("amount"),
 val: amountSc,
 }),
 new xdr.ScMapEntry({
 key: xdr.ScVal.scvSymbol("request_type"),
 val: xdr.ScVal.scvU32(input.requestType),
 }),
 ]);

 const requests = xdr.ScVal.scvVec([request]);

 // submit(from, spender, to, requests)
 const op = contract.call("submit", walletSc, walletSc, walletSc, requests);

 const tx = new TransactionBuilder(account, {
 fee: BASE_FEE,
 networkPassphrase: Networks.TESTNET,
 })
 .addOperation(op)
 .setTimeout(300)
 .build();

 const simulated = await rpc.simulateTransaction(tx);
 const simErr = (simulated as any)?.error;
 if (simErr) {
 const msg = String(simErr);
 if (/insufficient|balance|underfunded/i.test(msg)) {
 throw new Error(
 `Blend simulation failed: insufficient ${reserve.symbol} for this action. Check your wallet balance (this pool uses Circle USDC + native XLM).`
 );
 }
 throw new Error(`Blend simulation failed: ${msg}`);
 }

 const { assembleTransaction } = await import("@stellar/stellar-sdk/rpc");
 const assembled = assembleTransaction(tx, simulated).build();

 return {
 xdr: assembled.toXDR(),
 networkPassphrase: NETWORK_PASSPHRASE,
 poolContract: reserve.poolContract,
 tokenContract: reserve.tokenContract,
 };
}

/** Best-effort live Blend positions via pool.get_positions. */
export async function listBlendPositions(wallet: string): Promise<
 {
 symbol: string;
 supply: string;
 liability: string;
 poolContract: string;
 }[]
> {
 try {
 const poolId = getBlendPoolId();
 const symbols = blendReserveSymbols();

 const {
 Contract,
 TransactionBuilder,
 Networks,
 BASE_FEE,
 Address,
 scValToNative,
 } = await import("@stellar/stellar-sdk");
 const { Server } = await import("@stellar/stellar-sdk/rpc");
 const { getDemoKeypair } = await import("./stellar");

 const rpc = new Server(SOROBAN_RPC);
 const demo = await getDemoKeypair();
 const account = await rpc.getAccount(demo.publicKey());
 const contract = new Contract(poolId);
 const tx = new TransactionBuilder(account, {
 fee: BASE_FEE,
 networkPassphrase: Networks.TESTNET,
 })
 .addOperation(contract.call("get_positions", Address.fromString(wallet).toScVal()))
 .setTimeout(30)
 .build();

 const sim = await rpc.simulateTransaction(tx);
 const retval = (sim as any)?.result?.retval;
 if (!retval) return [];

 const raw = scValToNative(retval) as any;
 const out: {
 symbol: string;
 supply: string;
 liability: string;
 poolContract: string;
 }[] = [];

 const collateral = raw?.collateral ?? raw?.Collateral ?? {};
 const liabilities = raw?.liabilities ?? raw?.Liabilities ?? {};

 const reserveByContract = new Map<string, string>();
 for (const sym of symbols) {
 reserveByContract.set(BLEND_LIVE_RESERVES[sym].contract, sym);
 }

 const pushFromMap = (map: any, kind: "supply" | "liability") => {
 if (!map || typeof map !== "object") return;
 const entries = map instanceof Map ? [...map.entries()] : Object.entries(map);
 for (const [key, val] of entries) {
 let sym: string;
 // Positions keys are often reserve index (u32), sometimes asset address
 if (typeof key === "number" || /^\d+$/.test(String(key))) {
 const idx = Number(key);
 sym = symbols[idx] ?? `reserve-${idx}`;
 } else {
 const addr = String(key);
 sym = reserveByContract.get(addr) ?? addr.slice(0, 8);
 }
 const amount = Number(val) / 1e7;
 if (!Number.isFinite(amount) || amount === 0) continue;
 const existing = out.find((o) => o.symbol === sym);
 if (existing) {
 if (kind === "supply") existing.supply = String(amount);
 else existing.liability = String(amount);
 } else {
 out.push({
 symbol: sym,
 supply: kind === "supply" ? String(amount) : "0",
 liability: kind === "liability" ? String(amount) : "0",
 poolContract: poolId,
 });
 }
 }
 };

 pushFromMap(collateral, "supply");
 pushFromMap(liabilities, "liability");
 return out;
 } catch (err) {
 logger.warn({ err }, "Blend get_positions failed");
 return [];
 }
}
