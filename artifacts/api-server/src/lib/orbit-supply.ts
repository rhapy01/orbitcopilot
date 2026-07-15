/**
 * Orbit Supply - fixed-rate XLM yield on USDC / pUSDC / EURC (Soroban).
 *
 * Rate: 10 XLM per 1,000,000 human units staked, per 24h, proportional to stake.
 * Deploy contracts/orbit-supply and set ORBIT_SUPPLY_CONTRACT_ID=C…
 */

import {
 buildContractInvoke,
 TESTNET_USDC_SAC,
 requireOrbitSupplyContract,
 getSorobanTokenBalance,
} from "./onchain";
import {
 normalizeSteldexSymbol,
 resolveSteldexToken,
 steldexDecimals,
 toSteldexUnits,
 fromSteldexUnits,
} from "./steldex";

const PERIOD_SECS = 86_400;
const REWARD_XLM_PER_MILLION = 10;

export type OrbitSupplyAsset = "USDC" | "pUSDC" | "EURC";

const ASSET_DECIMALS: Record<OrbitSupplyAsset, number> = {
 USDC: 7,
 pUSDC: 6,
 EURC: 7,
};

export function normalizeOrbitSupplyAsset(raw: string): OrbitSupplyAsset | null {
 const n = normalizeSteldexSymbol(raw);
 if (n === "cUSDC" || n === "USDC" || raw.toUpperCase() === "USDC") return "USDC";
 if (n === "pUSDC") return "pUSDC";
 if (n === "EURC") return "EURC";
 const u = raw.trim().toUpperCase();
 if (u === "USDC" || u === "CUSDC") return "USDC";
 if (u === "PUSDC") return "pUSDC";
 if (u === "EURC") return "EURC";
 return null;
}

export async function resolveOrbitSupplyToken(
 asset: OrbitSupplyAsset
): Promise<{ contract: string; decimals: number; symbol: OrbitSupplyAsset }> {
 if (asset === "USDC") {
 return { contract: TESTNET_USDC_SAC, decimals: ASSET_DECIMALS.USDC, symbol: "USDC" };
 }
 const contract = await resolveSteldexToken(asset);
 if (!contract) {
 throw new Error(`Could not resolve ${asset} token contract on testnet`);
 }
 return {
 contract,
 decimals: steldexDecimals(asset) || ASSET_DECIMALS[asset],
 symbol: asset,
 };
}

function toRawAmount(human: string, decimals: number): string {
 return toSteldexUnits(human, decimals);
}

function fromRaw(raw: bigint | string, decimals: number): number {
 return Number(fromSteldexUnits(String(raw), decimals));
}

/** Daily XLM for a human stake amount (proportional: 10 XLM / 1M). */
export function dailyYieldXlm(humanStake: number): number {
 if (!Number.isFinite(humanStake) || humanStake <= 0) return 0;
 return (humanStake / 1_000_000) * REWARD_XLM_PER_MILLION;
}

export async function prepareOrbitSupplyDeposit(input: {
 walletAddress: string;
 asset: string;
 amount: string;
}) {
 const contractId = requireOrbitSupplyContract();
 const symbol = normalizeOrbitSupplyAsset(input.asset);
 if (!symbol) {
 throw new Error("Orbit Supply accepts USDC, pUSDC, or EURC only.");
 }
 const token = await resolveOrbitSupplyToken(symbol);
 const need = parseFloat(input.amount);
 if (!Number.isFinite(need) || need <= 0) {
 throw new Error("Amount must be positive");
 }

 // Balance preflight
 let available = 0;
 if (symbol === "USDC") {
 const { getAccountBalances } = await import("./stellar");
 const bals = await getAccountBalances(input.walletAddress);
 available = bals.find((b) => b.assetCode === "USDC")?.balance ?? 0;
 // Also try SAC balance
 try {
 const raw = await getSorobanTokenBalance(input.walletAddress, token.contract);
 available = Math.max(available, fromRaw(raw, token.decimals));
 } catch {
 /* keep classic */
 }
 } else {
 const { getSteldexTokenBalanceHuman } = await import("./steldex");
 available = await getSteldexTokenBalanceHuman(input.walletAddress, symbol);
 }
 if (need > available + 1e-9) {
 throw new Error(
 `Not enough ${symbol} to supply on Orbit Supply: need ${need}, have ~${available.toFixed(6)}. (This is Circle/StelDex ${symbol} - not Blend USDC.)`
 );
 }

 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 const amountRaw = toRawAmount(input.amount, token.decimals);
 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "supply",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 Address.fromString(token.contract).toScVal(),
 nativeToScVal(BigInt(amountRaw), { type: "i128" }),
 ],
 });

  const daily = dailyYieldXlm(need);
  const { orbitSupplyLearnMoreBlurb } = await import("./learn-more");
  return {
    type: "orbit_supply_deposit" as const,
    sendAmount: input.amount,
    sendAsset: symbol,
    tokenContract: token.contract,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: [
      `Orbit Supply: deposit ${input.amount} ${symbol}. Earn ~${daily.toFixed(6)} XLM / 24h (10 XLM per 1M). Claim after 24h with "claim my yield".`,
      orbitSupplyLearnMoreBlurb(contractId),
    ].join("\n"),
  };
}

export async function prepareOrbitSupplyWithdraw(input: {
 walletAddress: string;
 asset: string;
 amount: string;
}) {
 const contractId = requireOrbitSupplyContract();
 const symbol = normalizeOrbitSupplyAsset(input.asset);
 if (!symbol) {
 throw new Error("Orbit Supply accepts USDC, pUSDC, or EURC only.");
 }
 const token = await resolveOrbitSupplyToken(symbol);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 const amountRaw = toRawAmount(input.amount, token.decimals);
 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "withdraw",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 Address.fromString(token.contract).toScVal(),
 nativeToScVal(BigInt(amountRaw), { type: "i128" }),
 ],
 });
 return {
 type: "orbit_supply_withdraw" as const,
 sendAmount: input.amount,
 sendAsset: symbol,
 tokenContract: token.contract,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Orbit Supply: withdraw ${input.amount} ${symbol} principal. Sign to confirm.`,
 };
}

export async function prepareOrbitSupplyClaim(input: { walletAddress: string }) {
 const contractId = requireOrbitSupplyContract();
 const status = await getOrbitSupplyStatus(input.walletAddress);
 if (status.pendingXlm <= 0) {
 const waitHrs =
 status.nextClaimAt && status.nextClaimAt > Date.now() / 1000
 ? ((status.nextClaimAt - Date.now() / 1000) / 3600).toFixed(1)
 : null;
 throw new Error(
 waitHrs
 ? `No Orbit Supply yield ready yet. Next claim in ~${waitHrs}h. Rate: 10 XLM / 1M staked / 24h.`
 : `No Orbit Supply yield to claim. Supply USDC, pUSDC, or EURC first, then claim after 24h.`
 );
 }

 const { Address } = await import("@stellar/stellar-sdk");
 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "claim",
 args: [Address.fromString(input.walletAddress).toScVal()],
 });

  const { orbitSupplyLearnMoreBlurb } = await import("./learn-more");
  return {
    type: "orbit_supply_claim" as const,
    sendAmount: status.pendingXlm.toFixed(7),
    sendAsset: "XLM",
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: [
      `Claim ~${status.pendingXlm.toFixed(6)} XLM Orbit Supply yield. Sign to receive rewards.`,
      orbitSupplyLearnMoreBlurb(contractId),
    ].join("\n"),
  };
}

export type OrbitSupplyStatus = {
 contractId: string;
 stakes: { asset: OrbitSupplyAsset; amount: number; dailyXlm: number }[];
 pendingXlm: number;
 lastClaimAt: number;
 nextClaimAt: number | null;
 rewardTreasuryXlm: number | null;
 dailyXlmTotal: number;
};

async function simulateView(
 contractId: string,
 method: string,
 args: import("@stellar/stellar-sdk").xdr.ScVal[]
): Promise<unknown> {
 const {
 Contract,
 TransactionBuilder,
 Networks,
 BASE_FEE,
 scValToNative,
 } = await import("@stellar/stellar-sdk");
 const { Server } = await import("@stellar/stellar-sdk/rpc");
 const { getDemoKeypair } = await import("./stellar");

 const rpc = new Server(
 (await import("./stellar")).SOROBAN_RPC
 );
 const demo = await getDemoKeypair();
 const account = await rpc.getAccount(demo.publicKey());
 const contract = new Contract(contractId);
 const tx = new TransactionBuilder(account, {
 fee: BASE_FEE,
 networkPassphrase: Networks.TESTNET,
 })
 .addOperation(contract.call(method, ...args))
 .setTimeout(60)
 .build();
 const sim = await rpc.simulateTransaction(tx);
 if ((sim as any)?.error) {
 throw new Error(String((sim as any).error));
 }
 const retval = (sim as any)?.result?.retval;
 if (retval == null) return null;
 return scValToNative(retval);
}

export async function getOrbitSupplyStatus(wallet: string): Promise<OrbitSupplyStatus> {
 const contractId = requireOrbitSupplyContract();
 const { Address } = await import("@stellar/stellar-sdk");
 const userSc = Address.fromString(wallet).toScVal();

 const assets: OrbitSupplyAsset[] = ["USDC", "pUSDC", "EURC"];
 const stakes: OrbitSupplyStatus["stakes"] = [];
 let dailyXlmTotal = 0;

 for (const asset of assets) {
 try {
 const token = await resolveOrbitSupplyToken(asset);
 const raw = await simulateView(contractId, "get_stake", [
 userSc,
 Address.fromString(token.contract).toScVal(),
 ]);
 const amount = fromRaw(BigInt(String(raw ?? 0)), token.decimals);
 if (amount > 0) {
 const dailyXlm = dailyYieldXlm(amount);
 dailyXlmTotal += dailyXlm;
 stakes.push({ asset, amount, dailyXlm });
 }
 } catch {
 /* token may not be allowed yet */
 }
 }

 let pendingXlm = 0;
 let lastClaimAt = 0;
 try {
 const pendingRaw = await simulateView(contractId, "pending_reward", [userSc]);
 pendingXlm = fromRaw(BigInt(String(pendingRaw ?? 0)), 7);
 } catch {
 pendingXlm = 0;
 }
 try {
 const last = await simulateView(contractId, "get_last_claim", [userSc]);
 lastClaimAt = Number(last ?? 0);
 } catch {
 lastClaimAt = 0;
 }

 let rewardTreasuryXlm: number | null = null;
 try {
 const bal = await simulateView(contractId, "reward_balance", []);
 rewardTreasuryXlm = fromRaw(BigInt(String(bal ?? 0)), 7);
 } catch {
 rewardTreasuryXlm = null;
 }

 const nextClaimAt =
 lastClaimAt > 0 ? lastClaimAt + PERIOD_SECS : null;

 return {
 contractId,
 stakes,
 pendingXlm,
 lastClaimAt,
 nextClaimAt,
 rewardTreasuryXlm,
 dailyXlmTotal,
 };
}

export async function formatOrbitSupplyStatus(wallet: string | null): Promise<string> {
 try {
 requireOrbitSupplyContract();
 } catch (err: any) {
 return err?.message ?? "Orbit Supply not configured.";
 }
 if (!wallet) {
 return [
 "Orbit Supply - deposit USDC / pUSDC / EURC, earn XLM yield.",
 "Rate: 10 XLM per 1,000,000 supplied, every 24 hours (proportional).",
 'Connect a wallet, then: "supply 100 USDC on orbit-supply", "claim my yield".',
 ].join("\n");
 }
 const s = await getOrbitSupplyStatus(wallet);
 const lines = [
 "Orbit Supply (Testnet)",
 `Contract: ${s.contractId}`,
 `Rate: 10 XLM / 1M staked / 24h`,
 "",
 ];
 if (!s.stakes.length) {
 lines.push("No deposits yet.");
 lines.push('Try: "supply 100 USDC on orbit-supply"');
 } else {
 lines.push("Your deposits:");
 for (const st of s.stakes) {
 lines.push(
 `• ${st.amount.toFixed(4)} ${st.asset} → ~${st.dailyXlm.toFixed(6)} XLM / day`
 );
 }
 lines.push(`Pending claim: ~${s.pendingXlm.toFixed(6)} XLM`);
 if (s.nextClaimAt && s.pendingXlm <= 0) {
 const hrs = Math.max(0, (s.nextClaimAt - Date.now() / 1000) / 3600);
 lines.push(`Next claim window: ~${hrs.toFixed(1)}h`);
 }
 lines.push('Claim: "claim my yield"');
 }
 if (s.rewardTreasuryXlm != null) {
 lines.push(`Reward treasury: ~${s.rewardTreasuryXlm.toFixed(2)} XLM`);
 }
 return lines.join("\n");
}
