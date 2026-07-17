import { useState, useEffect, useRef } from "react";
import {
 ArrowRight,
 CheckCircle2,
 ExternalLink,
 ImagePlus,
 Loader2,
 Sprout,
 Wallet,
 XCircle,
} from "lucide-react";
import { useBuildTransaction, useSubmitTransaction } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/use-wallet";
import {
 STELDEX_FULL_RANGE,
 STELDEX_NETWORK_PASSPHRASE,
 buildAndSubmitSteldex,
 formatReceiveEstimate,
 fromSteldexUnits,
 isTxTooLateError,
 steldexDecimals,
 steldexExplorerTxUrl,
 toSteldexUnits,
 type SteldexWriteEndpoint,
} from "@/lib/steldex-submit";
import { track } from "@/lib/analytics";
import { actionConfidence, outcomeSummary } from "@/lib/action-confidence";
import {
  teachLessonForAction,
  type TeachLesson,
} from "@/lib/learn-more";
import { resolveActionContract } from "@/lib/contract";
import { STELLAR_NETWORK_PASSPHRASE } from "@/lib/soroban";

function isBetaNftMintAction(action: ChatAction): boolean {
 if (action.type !== "nft_mint") return false;
 const name = (action.sendAsset ?? "").toLowerCase();
 const uri = (action.marketHint ?? "").toLowerCase();
 return (
 name.includes("beta tester") ||
 name.includes("orbit beta") ||
 name.includes("orbit co-pilot beta") ||
 uri.includes("orbit-beta-tester")
 );
}

/** Persist one-per-wallet claim so UI/AI stop offering mint again. */
async function confirmBetaNftClaim(
 walletAddress: string,
 txHash: string
): Promise<void> {
 const res = await fetch("/api/nft/claim-beta/confirm", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ walletAddress, txHash }),
 });
 if (!res.ok) {
 const data = await res.json().catch(() => ({}));
 throw new Error(
 typeof data?.error === "string" ? data.error : "Failed to record beta NFT claim"
 );
 }
}

export interface ChatAction {
 type:
 | "send"
 | "swap"
 | "soroswap_swap"
 | "soroswap_add_liquidity"
 | "soroswap_remove_liquidity"
 | "steldex_swap"
 | "steldex_stake"
 | "steldex_claim"
 | "steldex_unstake"
 | "steldex_add_liquidity"
 | "steldex_remove_liquidity"
 | "steldex_limit_order"
 | "steldex_cancel_order"
 | "blend_supply"
 | "blend_withdraw"
 | "blend_borrow"
 | "blend_repay"
 | "blend_claim"
 | "blend_usdc_swap"
 | "predict_bet"
 | "predict_claim"
 | "perp_open"
 | "perp_close"
 | "nft_mint"
 | "nft_list"
 | "nft_buy"
 | "nft_transfer"
 | "nft_cancel"
 | "nft_create_collection"
 | "nft_media_pack"
 | "token_deploy"
 | "token_mint"
 | "orbit_supply_deposit"
 | "orbit_supply_withdraw"
 | "orbit_supply_claim"
    | "defindex_deposit"
    | "defindex_withdraw"
    | "meridian_deposit"
    | "meridian_withdraw"
    | "aquarius_swap"
 | "connect_wallet"
 | "add_trustline";
 requestType?: number;
 sendAmount?: string;
 sendAsset?: string;
 destination?: string;
 destAsset?: string;
 poolContract?: string;
 pair?: string;
 amountB?: string;
 token0Contract?: string;
 token1Contract?: string;
 fromTokenContract?: string;
 toTokenContract?: string;
 tickLower?: number;
 tickUpper?: number;
 liquidity?: string;
 lockWeeks?: number;
 limitPrice?: string;
 orderType?: string;
 orderId?: string;
 amount0Min?: string;
 amount1Min?: string;
 /** Human-readable estimated receive (from quote). */
 estimatedDestAmount?: string;
 positionId?: number;
 marketHint?: string;
 outcome?: string;
 side?: string;
 leverage?: number;
 marginUsdc?: string;
 stopLoss?: number;
 takeProfit?: number;
 entryPrice?: number;
 liquidationPrice?: number;
 notionalUsdc?: number;
 tokenId?: number;
 metadataUri?: string;
 tokenName?: string;
 description?: string;
 imageUrl?: string;
 website?: string;
 /** Local file as base64 data URL (preferred over imageUrl when set). */
 imageDataUrl?: string;
 animationDataUrl?: string;
 bannerImageDataUrl?: string;
 maxSupply?: number;
 royaltyBps?: number;
 /** User explicitly set max supply (including 0 = unlimited). */
 supplySpecified?: boolean;
 mediaPackId?: string;
 collectionContract?: string;
 /** When true, mint next asset from media pack. */
 useMediaPack?: boolean;
 priceXlm?: string;
 markPriceStale?: boolean;
 xdr?: string;
 networkPassphrase?: string;
 /** For add_trustline: the swap action to auto-execute after trustline is added */
 pendingAction?: ChatAction;
}

const MEDIA_MAX_BYTES = 8 * 1024 * 1024;

function needsMediaAttach(action: ChatAction): boolean {
 if (action.type === "nft_mint" && isBetaNftMintAction(action)) return false;
 if (action.type === "nft_mint" && (action.useMediaPack || action.mediaPackId)) {
 return false;
 }
 return (
 action.type === "nft_mint" ||
 action.type === "nft_create_collection" ||
 action.type === "nft_media_pack" ||
 action.type === "token_deploy"
 );
}

function fileToDataUrl(file: File): Promise<string> {
 return new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = () => {
 if (typeof reader.result === "string") resolve(reader.result);
 else reject(new Error("Could not read file"));
 };
 reader.onerror = () => reject(new Error("Could not read file"));
 reader.readAsDataURL(file);
 });
}

function mediaPreviewUrl(action: ChatAction): string | null {
 return action.imageDataUrl || action.imageUrl || null;
}

function collectionSetupReady(action: ChatAction): boolean {
 if (action.type !== "nft_create_collection") return true;
 const hasDesc = Boolean(action.description?.trim());
 const hasArt = Boolean(
 action.imageDataUrl || action.imageUrl?.trim() || action.mediaPackId
 );
 const hasSupply = Boolean(action.supplySpecified || action.mediaPackId);
 return hasDesc && hasArt && hasSupply;
}

function collectionSetupMissing(action: ChatAction): string[] {
 if (action.type !== "nft_create_collection") return [];
 const missing: string[] = [];
 if (!action.description?.trim()) missing.push("description");
 if (
 !action.imageDataUrl &&
 !action.imageUrl?.trim() &&
 !action.mediaPackId
 ) {
 missing.push("artwork or media pack ZIP");
 }
 if (!action.supplySpecified && !action.mediaPackId) missing.push("max supply");
 return missing;
}

type Status = "idle" | "building" | "signing" | "submitting" | "success" | "error";

/** Translate raw Soroban/wallet/network error messages into plain English. */
function sanitizeError(raw: string): string {
 if (!raw) return "Something went wrong. Try again.";
 const r = raw.toLowerCase();
 if (r.includes("user declined") || r.includes("user rejected") || r.includes("cancelled"))
 return "You declined the transaction.";
 if (isTxTooLateError(raw))
 return "That transaction expired while waiting to be signed. Tap refresh to build a fresh one.";
 if (r.includes("device share"))
 return "This device isn't unlocked for signing. Restore your Orbit wallet first.";
 if (r.includes("insufficient balance") || r.includes("underfunded"))
 return "Insufficient balance on this connected wallet - check the header address, keep ~2.5 XLM for fees, and note StelDex uses pUSDC (not classic USDC).";
 if (r.includes("sequence") || r.includes("out of date") || r.includes("stale sequence"))
 return "Network wasn’t ready yet after enabling the asset. Tap the button again - it usually works on retry.";
 if (r.includes("fee") && r.includes("low"))
 return "Transaction fee too low. Try again - the network may be busy.";
 if (r.includes("timeout") || r.includes("confirmation timeout"))
 return "Transaction timed out waiting for confirmation. It may still go through - check the explorer.";
 if (r.includes("feebumpinnerfailed") || r.includes("inner failed"))
 return "The transaction was rejected on-chain. Check your balances and try again.";
 if (r.includes("no xdr") || r.includes("missing") || r.includes("no transaction"))
 return "Could not build the transaction. The protocol may be temporarily unavailable.";
 if (r.includes("network") || r.includes("reach") || r.includes("fetch"))
 return "Network error - couldn't reach the blockchain. Check your connection and try again.";
 if (r.includes("slippage") || r.includes("price impact"))
 return "Price moved too much during the transaction. Try again or increase slippage tolerance.";
 if (r.includes("op_no_trust") || r.includes("no_trust") || /\btrustline\b/.test(r))
 return "Your wallet needs this asset enabled first (classic trustline). Orbit can set that up in one sign.";
 if (r.includes("not authorized") || r.includes("auth"))
 return "Token authorization failed - for Blend, make sure you hold that protocol’s testnet asset (Blend USDC is not the same as classic Circle USDC).";
 if (r.includes("blend simulation failed"))
 return raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
 if (r.includes("submit failed") && r.includes("aaa"))
 return "Network wasn’t ready yet after a prior step. Tap again to retry the swap.";
 // If none matched, return the raw message but cap its length
 return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
}

/** Rebuild a fresh unsigned XDR for Orbit-native actions (predict / perps / NFT / Aquarius). */
async function rebuildOrbitNativeXdr(
 action: ChatAction,
 publicKey: string,
 slippageBps: number
): Promise<{ xdr: string; networkPassphrase?: string; estimatedDestAmount?: string }> {
 let endpoint = "";
 let body: Record<string, unknown> = { walletAddress: publicKey };

 switch (action.type) {
 case "predict_bet":
 endpoint = "/api/predict/bet";
 body = {
 ...body,
 marketHint: action.marketHint,
 outcome: action.outcome ?? "yes",
 amountXlm: action.sendAmount,
 };
 break;
 case "predict_claim":
 endpoint = "/api/predict/claim";
 body = {
 ...body,
 marketHint: action.marketHint,
 outcome: action.outcome ?? "yes",
 };
 break;
 case "perp_open":
 endpoint = "/api/perps/open";
 body = {
 ...body,
 marketHint: action.marketHint,
 side: action.side ?? "long",
 marginUsdc: action.marginUsdc ?? action.sendAmount,
 leverage: action.leverage ?? 1,
 stopLoss: action.stopLoss,
 takeProfit: action.takeProfit,
 };
 break;
 case "perp_close":
 endpoint = "/api/perps/close";
 body = {
 ...body,
 positionId: action.positionId,
 marketHint: action.marketHint,
 };
 break;
 case "nft_mint":
 if (isBetaNftMintAction(action)) {
 endpoint = "/api/nft/claim-beta";
 } else {
 endpoint = "/api/nft/mint";
 body = {
 ...body,
 name: action.sendAsset ?? action.marketHint,
 metadataUri: action.metadataUri,
 description: action.description,
 image: action.imageUrl,
 imageDataUrl: action.imageDataUrl,
 animationDataUrl: action.animationDataUrl,
 collectionContract: action.collectionContract,
 mediaPackId: action.mediaPackId,
 useMediaPack: action.useMediaPack === true || Boolean(action.mediaPackId),
 };
 }
 break;
 case "nft_create_collection":
 endpoint = "/api/nft/create-collection";
 body = {
 ...body,
 name: action.marketHint?.replace(/\s*\([^)]*\)\s*$/, "").trim() || "Orbit Collection",
 symbol: action.sendAsset || "ORB",
 description: action.description,
 image: action.imageUrl,
 imageDataUrl: action.imageDataUrl,
 bannerImageDataUrl: action.bannerImageDataUrl,
 externalUrl: action.website,
 maxSupply: action.maxSupply ?? 0,
 openMint: true,
 royaltyBps: action.royaltyBps ?? 250,
 mediaPackId: action.mediaPackId,
 };
 break;
 case "nft_cancel":
 endpoint = "/api/nft/cancel";
 body = { ...body, tokenId: action.tokenId };
 break;
 case "nft_list":
 endpoint = "/api/nft/list";
 body = {
 ...body,
 tokenId: action.tokenId,
 priceXlm: action.priceXlm ?? action.sendAmount,
 };
 break;
 case "nft_buy":
 endpoint = "/api/nft/buy";
 body = { ...body, tokenId: action.tokenId };
 break;
 case "nft_transfer":
 endpoint = "/api/nft/transfer";
 body = {
 ...body,
 tokenId: action.tokenId,
 to: action.destination,
 };
 break;
 case "token_deploy":
 endpoint = "/api/token/deploy";
 body = {
 ...body,
 code: action.sendAsset,
 name: action.tokenName,
 description: action.description,
 image: action.imageUrl,
 imageDataUrl: action.imageDataUrl,
 website: action.website,
 };
 break;
 case "token_mint":
 endpoint = "/api/token/mint";
 body = {
 ...body,
 code: action.sendAsset,
 amount: action.sendAmount,
 };
 break;
 case "orbit_supply_deposit":
 endpoint = "/api/orbit-supply/deposit";
 body = {
 ...body,
 amount: action.sendAmount,
 asset: action.sendAsset,
 };
 break;
 case "orbit_supply_withdraw":
 endpoint = "/api/orbit-supply/withdraw";
 body = {
 ...body,
 amount: action.sendAmount,
 asset: action.sendAsset,
 };
 break;
 case "orbit_supply_claim":
 endpoint = "/api/orbit-supply/claim";
 break;
case "defindex_deposit":
  endpoint = "/api/defindex/deposit";
  body = { ...body, amount: action.sendAmount, asset: action.sendAsset ?? "XLM" };
  break;
case "defindex_withdraw":
  endpoint = "/api/defindex/withdraw";
  body = { ...body, amount: action.sendAmount, asset: action.sendAsset ?? "XLM" };
  break;
case "meridian_deposit":
  endpoint = "/api/meridian/deposit";
  body = { ...body, amount: action.sendAmount };
  break;
case "meridian_withdraw":
  endpoint = "/api/meridian/withdraw";
  body = { ...body, amount: action.sendAmount, shares: action.sendAmount };
  break;
 case "blend_usdc_swap":
 endpoint = "/api/blend/swap-usdc";
 body = {
 ...body,
 amount: action.sendAmount,
 };
 break;
 case "blend_claim":
 endpoint = "/api/blend/build";
 body = {
 ...body,
 action: "claim",
 };
 break;
 case "aquarius_swap":
 endpoint = "/api/aquarius/build";
 body = {
 ...body,
 fromSymbol: action.sendAsset,
 toSymbol: action.destAsset,
 amount: action.sendAmount,
 slippageBps,
 };
 break;
 default:
 throw new Error("Cannot refresh this action type");
 }

 const res = await fetch(endpoint, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(body),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) {
 throw new Error(
 typeof data?.error === "string" ? data.error : `Refresh failed (HTTP ${res.status})`
 );
 }
 if (!data.xdr || typeof data.xdr !== "string") {
 throw new Error("Refresh returned no transaction");
 }
 return {
 xdr: data.xdr,
 networkPassphrase:
 typeof data.networkPassphrase === "string" ? data.networkPassphrase : undefined,
 estimatedDestAmount:
 data.amountOutHuman != null
 ? String(data.amountOutHuman)
 : data.estimatedDestAmount != null
 ? String(data.estimatedDestAmount)
 : undefined,
 };
}

/** Poll Horizon until the classic trustline exists (post changeTrust). */
async function waitForTrustlineReady(
 publicKey: string,
 assetCode: string,
 maxAttempts = 12
): Promise<boolean> {
 const code = assetCode.toUpperCase() === "CUSDC" ? "USDC" : assetCode.toUpperCase();
 for (let i = 0; i < maxAttempts; i++) {
 try {
 const res = await fetch(
 `https://horizon-testnet.stellar.org/accounts/${encodeURIComponent(publicKey)}`
 );
 if (res.ok) {
 const acct = await res.json();
 const balances = Array.isArray(acct?.balances) ? acct.balances : [];
 const found = balances.some(
 (b: any) =>
 (b.asset_type === "native" && code === "XLM") ||
 (typeof b.asset_code === "string" && b.asset_code.toUpperCase() === code)
 );
 if (found) return true;
 }
 } catch {
 // keep polling
 }
 await new Promise((r) => setTimeout(r, 1000));
 }
 return false;
}

function isSteldexAction(type: ChatAction["type"]) {
 return type.startsWith("steldex_");
}

function isSorobanAction(type: ChatAction["type"]) {
 return (
 type.startsWith("steldex_") ||
 type.startsWith("soroswap_") ||
 type.startsWith("blend_")
 );
}

function isOrbitNativeAction(type: ChatAction["type"]) {
 return (
 type === "predict_bet" ||
 type === "predict_claim" ||
 type === "perp_open" ||
 type === "perp_close" ||
 type === "nft_mint" ||
 type === "nft_list" ||
 type === "nft_buy" ||
 type === "nft_transfer" ||
 type === "nft_cancel" ||
 type === "nft_create_collection" ||
 type === "token_deploy" ||
 type === "token_mint" ||
 type === "orbit_supply_deposit" ||
 type === "orbit_supply_withdraw" ||
 type === "orbit_supply_claim" ||
    type === "defindex_deposit" ||
    type === "defindex_withdraw" ||
    type === "meridian_deposit" ||
    type === "meridian_withdraw" ||
    type === "blend_claim" ||
 type === "blend_usdc_swap" ||
 type === "aquarius_swap"
 );
}

function actionTitle(action: ChatAction): string {
 // Keeps UI titles aligned with Rust methods via contract.ts registry.
 resolveActionContract(action.type);
 switch (action.type) {
 case "send":
 return "Send Payment";
 case "swap":
 return "Swap (Classic DEX)";
 case "soroswap_swap":
 return "Soroswap Swap";
 case "aquarius_swap":
 return "Aquarius Swap";
 case "soroswap_add_liquidity":
 return "Soroswap Add LP";
 case "soroswap_remove_liquidity":
 return "Soroswap Remove LP";
 case "blend_supply":
 return "Blend Supply (Collateral)";
 case "blend_withdraw":
 return "Blend Withdraw";
 case "blend_borrow":
 return "Blend Borrow";
 case "blend_repay":
 return "Blend Repay";
 case "blend_claim":
 return "Claim Blend Rewards";
 case "blend_usdc_swap":
 return "Circle → Blend USDC";
 case "predict_bet":
 return "Prediction Bet";
 case "predict_claim":
 return "Claim Prediction";
 case "perp_open":
 return "Open Perpetual";
 case "perp_close":
 return "Close Perpetual";
 case "nft_mint":
 return "Mint NFT (SEP-50)";
 case "nft_create_collection":
 return "Create NFT Collection";
 case "nft_media_pack":
 return "Upload Media Pack";
 case "nft_cancel":
 return "Cancel NFT Listing";
 case "nft_list":
 return "List NFT";
 case "nft_buy":
 return "Buy NFT";
 case "nft_transfer":
 return "Transfer NFT";
 case "token_deploy":
 return "Deploy Token (SAC)";
 case "token_mint":
 return "Mint Token Supply";
 case "orbit_supply_deposit":
 return "Orbit Supply Deposit";
 case "orbit_supply_withdraw":
 return "Orbit Supply Withdraw";
 case "orbit_supply_claim":
 return "Claim Orbit Yield";
    case "defindex_deposit":
      return "DeFindex Deposit";
    case "defindex_withdraw":
      return "DeFindex Withdraw";
    case "meridian_deposit":
      return "Meridian Deposit";
    case "meridian_withdraw":
      return "Meridian Withdraw";
    case "steldex_swap":
 return "StelDex Swap";
 case "steldex_add_liquidity":
 return "Add Liquidity";
 case "steldex_remove_liquidity":
 return "Remove Liquidity";
 case "steldex_stake":
 return "Stake LP";
 case "steldex_claim":
 return "Claim Rewards";
 case "steldex_unstake":
 return "Unstake LP";
 case "steldex_limit_order":
 return "Limit Order";
 case "steldex_cancel_order":
 return "Cancel Order";
 case "connect_wallet":
 return "Connect Wallet";
 case "add_trustline":
 return `Add ${action.sendAsset ?? "Asset"} Trustline`;
 default:
 return "On-chain Action";
 }
}

function steldexEndpoint(type: ChatAction["type"]): SteldexWriteEndpoint {
 switch (type) {
 case "steldex_swap":
 return "swap";
 case "steldex_add_liquidity":
 return "add-liquidity";
 case "steldex_remove_liquidity":
 return "remove-liquidity";
 case "steldex_stake":
 return "stake";
 case "steldex_claim":
 return "claim";
 case "steldex_unstake":
 return "unstake";
 case "steldex_limit_order":
 return "limit-order";
 case "steldex_cancel_order":
 return "cancel-order";
 default:
 throw new Error("Not a StelDex action");
 }
}

function buildSteldexBody(action: ChatAction, slippageBps = 50): Record<string, unknown> {
 const tickLower = action.tickLower ?? STELDEX_FULL_RANGE.tickLower;
 const tickUpper = action.tickUpper ?? STELDEX_FULL_RANGE.tickUpper;

 switch (action.type) {
 case "steldex_swap": {
 const from = action.fromTokenContract ?? action.token0Contract;
 const to = action.toTokenContract ?? action.token1Contract;
 if (!from || !to || !action.sendAmount || !action.sendAsset) {
 throw new Error("Missing swap details");
 }
 return {
 fromTokenContract: from,
 toTokenContract: to,
 amountIn: toSteldexUnits(action.sendAmount, steldexDecimals(action.sendAsset)),
 slippageBps,
 };
 }
 case "steldex_add_liquidity": {
 if (
 !action.poolContract ||
 !action.token0Contract ||
 !action.token1Contract ||
 !action.sendAmount ||
 !action.amountB ||
 !action.sendAsset ||
 !action.destAsset
 ) {
 throw new Error("Missing liquidity details");
 }
 return {
 poolContract: action.poolContract,
 token0Contract: action.token0Contract,
 token1Contract: action.token1Contract,
 tickLower,
 tickUpper,
 amount0Desired: toSteldexUnits(action.sendAmount, steldexDecimals(action.sendAsset)),
 amount1Desired: toSteldexUnits(action.amountB, steldexDecimals(action.destAsset)),
 };
 }
 case "steldex_remove_liquidity": {
 if (!action.poolContract || !action.liquidity) {
 throw new Error("Missing remove-liquidity details");
 }
 return {
 poolContract: action.poolContract,
 tickLower,
 tickUpper,
 liquidity: action.liquidity,
 amount0Min: action.amount0Min ?? "0",
 amount1Min: action.amount1Min ?? "0",
 };
 }
 case "steldex_stake": {
 if (!action.poolContract) throw new Error("Missing pool");
 return {
 poolContract: action.poolContract,
 tickLower,
 tickUpper,
 stakeMax: true,
 lockWeeks: action.lockWeeks ?? 52,
 autoCompound: false,
 };
 }
 case "steldex_claim": {
 if (!action.poolContract) throw new Error("Missing pool");
 return { poolContract: action.poolContract, tickLower, tickUpper };
 }
 case "steldex_unstake": {
 if (!action.poolContract) throw new Error("Missing pool");
 return {
 poolContract: action.poolContract,
 tickLower,
 tickUpper,
 unstakeMax: true,
 };
 }
 case "steldex_limit_order": {
 const from = action.fromTokenContract ?? action.token0Contract;
 const to = action.toTokenContract ?? action.token1Contract;
 if (!from || !to || !action.sendAmount || !action.sendAsset || !action.limitPrice) {
 throw new Error("Missing limit-order details");
 }
 return {
 fromContract: from,
 toContract: to,
 amount: toSteldexUnits(action.sendAmount, steldexDecimals(action.sendAsset)),
 limitPrice: action.limitPrice,
 orderType: action.orderType ?? "Limit",
 expiryHours: 72,
 };
 }
 case "steldex_cancel_order": {
 if (!action.orderId) throw new Error("Missing order id");
 return { orderId: action.orderId };
 }
 default:
 throw new Error("Unsupported StelDex action");
 }
}

function stepChipLabel(action: ChatAction): string {
 if (action.destAsset) return action.destAsset;
 if (action.marketHint) return action.marketHint;
 if (action.sendAsset) return action.sendAsset;
 return actionTitle(action);
}

function isSwapFamily(type: ChatAction["type"]): boolean {
 return (
 type === "swap" ||
 type === "steldex_swap" ||
 type === "soroswap_swap" ||
 type === "aquarius_swap"
 );
}

export function TransactionActionCard({
 action: initialAction,
 queue,
 beforeIdle,
 onOutcome,
 onContinue,
}: {
 action: ChatAction;
 /** When length > 1, one progressive card advances through each action after success. */
 queue?: ChatAction[];
 beforeIdle?: string | null;
  onOutcome?: (info: {
    hash: string | null;
    summary: string;
    teach?: TeachLesson | null;
  }) => void;
 /** Called with a follow-up prompt when a chained action should continue */
 onContinue?: (prompt: string) => void;
}) {
 const { isConnected, publicKey, openConnectModal, connecting, signTransaction, type: walletType } = useWallet();
 const buildMutation = useBuildTransaction();
 const submitMutation = useSubmitTransaction();

 // Capture queue once per mount (chat uses a stable key per message)
 const [steps] = useState<ChatAction[] | null>(() =>
 queue && queue.length > 1 ? queue : null
 );
 const [stepIndex, setStepIndex] = useState(0);
 const [stepHashes, setStepHashes] = useState<(string | null)[]>([]);
 const [planComplete, setPlanComplete] = useState(false);

 // After enabling an asset, morph into the pending swap/send without a new chat turn
 const [action, setAction] = useState<ChatAction>(() =>
 steps ? steps[0]! : initialAction
 );
 useEffect(() => {
 if (steps) return; // queue progress owns action state
 setAction(initialAction);
 }, [initialAction, steps]);

 const isSwap =
 action.type === "steldex_swap" ||
 action.type === "soroswap_swap" ||
 action.type === "soroswap_add_liquidity" ||
 action.type === "soroswap_remove_liquidity";
 const [slippageBps, setSlippageBps] = useState(50); // default 0.5%
 const SLIPPAGE_OPTIONS = [{ label: "0.5%", bps: 50 }, { label: "1%", bps: 100 }, { label: "2%", bps: 200 }];

 const [status, setStatus] = useState<Status>("idle");
 const [progress, setProgress] = useState<string | null>(null);
 const [stepInfo, setStepInfo] = useState<{ current: number; total: number } | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [hash, setHash] = useState<string | null>(null);
 const [estimatedDest, setEstimatedDest] = useState<string | null>(
 action.estimatedDestAmount ?? null
 );
 const [quoteLoading, setQuoteLoading] = useState(false);
 const [outcomeLine, setOutcomeLine] = useState<string | null>(null);
 const [mediaBusy, setMediaBusy] = useState(false);
 const [mediaError, setMediaError] = useState<string | null>(null);
 const [packProgress, setPackProgress] = useState<string | null>(null);
 const imageInputRef = useRef<HTMLInputElement>(null);
 const packZipRef = useRef<HTMLInputElement>(null);
 const trackedStatus = useRef<Status>("idle");
 const betaClaimRecorded = useRef(false);
 const confidence = actionConfidence(action);

 const planTitle = steps
 ? steps.every((s) => isSwapFamily(s.type))
 ? `Swap plan · ${steps.length} swaps`
 : `Action plan · ${steps.length} steps`
 : null;

 useEffect(() => {
 setEstimatedDest(action.estimatedDestAmount ?? null);
 }, [action.estimatedDestAmount]);

 useEffect(() => {
 // Reset claim recorder when a new beta mint card is shown
 betaClaimRecorded.current = false;
 }, [action.type, action.sendAsset, action.marketHint, action.xdr]);

 const recordBetaClaimIfNeeded = async (
 txHash: string | null | undefined
 ): Promise<boolean> => {
 if (!publicKey || !txHash || !isBetaNftMintAction(action) || betaClaimRecorded.current) {
 return false;
 }
 betaClaimRecorded.current = true;
 try {
 await confirmBetaNftClaim(publicKey, txHash);
 return true;
 } catch {
 // Allow a retry on next success effect if first attempt failed
 betaClaimRecorded.current = false;
 return false;
 }
 };

 useEffect(() => {
 if (estimatedDest || quoteLoading) return;

 const fetchSteldexQuote = async () => {
 if (action.type !== "steldex_swap") return;
 if (!action.sendAmount || !action.sendAsset || !action.destAsset) return;
 if (!action.fromTokenContract || !action.toTokenContract) return;

 setQuoteLoading(true);
 try {
 const res = await fetch("/api/steldex/swap-quote", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 walletAddress: publicKey ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
 fromTokenContract: action.fromTokenContract,
 toTokenContract: action.toTokenContract,
 amountIn: toSteldexUnits(
 action.sendAmount,
 steldexDecimals(action.sendAsset)
 ),
 slippageBps,
 }),
 });
 const data = await res.json();
 if (!res.ok) return;
 // API returns outputAmount (human-readable) or amountOutRaw (raw integer)
 const human = data.outputAmount;
 const raw = data.amountOutRaw ?? data.amountOut ?? data.minAmountOut ?? data.minAmountOutRaw;
 if (human != null && human !== "") {
 setEstimatedDest(String(human));
 } else if (raw != null && raw !== "") {
 setEstimatedDest(fromSteldexUnits(String(raw), steldexDecimals(action.destAsset)));
 }
 } catch {
 /* quote optional */
 } finally {
 setQuoteLoading(false);
 }
 };

 const fetchClassicQuote = async () => {
 if (action.type !== "swap" || !publicKey) return;
 if (!action.sendAmount || !action.sendAsset || !action.destAsset) return;

 setQuoteLoading(true);
 try {
 const res = await fetch("/api/wallet/build-transaction", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 type: "swap",
 sourcePublicKey: publicKey,
 sendAsset: action.sendAsset,
 sendAmount: action.sendAmount,
 destAsset: action.destAsset,
 }),
 });
 const data = await res.json();
 if (!res.ok) return;
 if (data.estimatedDestAmount) {
 setEstimatedDest(String(data.estimatedDestAmount));
 }
 } catch {
 /* quote optional */
 } finally {
 setQuoteLoading(false);
 }
 };

 if (action.type === "steldex_swap") void fetchSteldexQuote();
 else if (action.type === "swap") void fetchClassicQuote();
 }, [
 action,
 estimatedDest,
 quoteLoading,
 publicKey,
 ]);

 useEffect(() => {
 let cancelled = false;

 const run = async () => {
 let justRecordedBeta = false;
 if (status === "success" && hash && isBetaNftMintAction(action)) {
 justRecordedBeta = await recordBetaClaimIfNeeded(hash);
 if (cancelled) return;
 }

 if (trackedStatus.current === status) {
 // Hash often lands after status=success; refresh caches once claim is recorded.
 if (justRecordedBeta) {
 onOutcome?.({ hash, summary: outcomeSummary(action) });
 }
 return;
 }
 trackedStatus.current = status;
 if (status === "signing") {
 track("tx_sign", {
 walletPublicKey: publicKey,
 metadata: { actionType: action.type },
 });
 } else if (status === "success") {
 if (
 action.type === "token_deploy" &&
 publicKey &&
 hash &&
 action.sendAsset
 ) {
 void fetch("/api/token/confirm", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 walletAddress: publicKey,
 code: action.sendAsset,
 txHash: hash,
 }),
 }).catch(() => {});
 }
 track("tx_submit", {
 walletPublicKey: publicKey,
 metadata: { actionType: action.type, txHash: hash },
 });
 const summary = outcomeSummary(action);
 setOutcomeLine(summary);
 if (publicKey) {
 void fetch("/api/portfolio/outcome", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 publicKey,
 summary,
 txHash: hash,
 beforeIdle: beforeIdle ?? null,
 afterNote: "Portfolio cache refreshed - ask what's earning to verify on-chain.",
 }),
 }).catch(() => {});
 }
      onOutcome?.({
        hash,
        summary,
        teach:
          !steps || stepIndex >= steps.length - 1
            ? teachLessonForAction(action.type)
            : null,
      });

      // Multi-action queue: advance to next step (same card) after a brief success beat
      if (steps && stepIndex < steps.length - 1) {
 const nextIdx = stepIndex + 1;
 const next = steps[nextIdx]!;
 setStepHashes((prev) => [...prev, hash]);
 window.setTimeout(() => {
 if (cancelled) return;
 setStepIndex(nextIdx);
 setAction(next);
 setStatus("idle");
 trackedStatus.current = "idle";
 setHash(null);
 setError(null);
 setProgress(null);
 setStepInfo(null);
 setOutcomeLine(null);
 setEstimatedDest(next.estimatedDestAmount ?? null);
 setQuoteLoading(false);
 }, 700);
 } else if (steps) {
 setStepHashes((prev) => [...prev, hash]);
 setPlanComplete(true);
 }
 } else if (status === "error") {
 track("error", {
 walletPublicKey: publicKey,
 metadata: { source: "tx", actionType: action.type, message: error },
 });
 }
 };

 void run();
 return () => {
 cancelled = true;
 };
 }, [
 status,
 publicKey,
 action.type,
 hash,
 error,
 action,
 beforeIdle,
 onOutcome,
 steps,
 stepIndex,
 ]);

 const handleExecute = async (opts?: { skipTooLateRetry?: boolean }) => {
 if (!publicKey) return;
 if (action.type === "nft_create_collection" && !collectionSetupReady(action)) {
 setError(
 `Add ${collectionSetupMissing(action).join(", ")} before signing.`
 );
 // Stay idle so the setup form remains editable; surface message via status error branch.
 setStatus("error");
 return;
 }
 setError(null);
 setProgress(null);
 setStepInfo(null);
 setStatus("building");
 try {
 // Add trustline - always refresh XDR so Freighter never gets a stale timebound
 if (action.type === "add_trustline") {
 const assetCode = action.sendAsset ?? "USDC";
 setProgress("Refreshing enable-asset transaction…");
 const trustRes = await fetch("/api/wallet/add-trustline", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ walletAddress: publicKey, assetCode }),
 });
 const trustData = await trustRes.json().catch(() => ({}));
 if (!trustRes.ok || !trustData.xdr) {
 throw new Error(
 typeof trustData?.error === "string"
 ? trustData.error
 : "Could not refresh enable-asset transaction"
 );
 }
 const trustXdr = trustData.xdr as string;
 const trustPassphrase =
 (trustData.networkPassphrase as string | undefined) ||
 action.networkPassphrase ||
 STELLAR_NETWORK_PASSPHRASE ||
 STELDEX_NETWORK_PASSPHRASE;
 setAction((prev) => ({
 ...prev,
 xdr: trustXdr,
 networkPassphrase: trustPassphrase,
 sendAsset: trustData.assetCode ?? assetCode,
 }));
 setStatus("signing");
 setProgress("Sign once to enable this asset…");
 const signedXdr = await signTransaction(trustXdr, trustPassphrase);
 setStatus("submitting");
 setProgress("Enabling asset…");
 const res = await fetch("/api/wallet/submit-transaction", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ signedXdr, networkPassphrase: trustPassphrase }),
 });
 const data = await res.json();
 if (!res.ok || !data.success) throw new Error(data.error ?? "Could not enable asset");
 setHash(data.hash ?? null);
 // Stay in "submitting" while we confirm Horizon sees the trustline
 setStatus("submitting");
 if (action.pendingAction) {
 const next = action.pendingAction;
 setProgress("Confirming asset is enabled…");
 await waitForTrustlineReady(publicKey, assetCode);
 // Extra beat so Soroban RPC catches Horizon sequence
 await new Promise((r) => setTimeout(r, 2000));
 setAction(next);
 setStatus("idle");
 setHash(null);
 setError(null);
 setProgress(null);
 setStepInfo(null);
 setEstimatedDest(next.estimatedDestAmount ?? null);
 setOutcomeLine(null);
 } else {
 setStatus("success");
 }
 return;
 }
 // Orbit-native - always rebuild XDR so chat-stale timebounds never cause tx_too_late
 if (isOrbitNativeAction(action.type)) {
 setProgress("Refreshing transaction…");
 const rebuilt = await rebuildOrbitNativeXdr(action, publicKey, slippageBps);
 setAction((prev) => ({
 ...prev,
 xdr: rebuilt.xdr,
 networkPassphrase: rebuilt.networkPassphrase ?? prev.networkPassphrase,
 }));
 if (rebuilt.estimatedDestAmount) {
 setEstimatedDest(rebuilt.estimatedDestAmount);
 }
 setStatus("signing");
 setProgress("Sign with your wallet…");
 const signedXdr = await signTransaction(
 rebuilt.xdr,
 rebuilt.networkPassphrase ||
 action.networkPassphrase ||
 STELLAR_NETWORK_PASSPHRASE ||
 STELDEX_NETWORK_PASSPHRASE
 );
 setStatus("submitting");
 setProgress("Submitting to Soroban…");
 const { submitSignedToSoroban } = await import("@/lib/steldex-submit");
 const txHash = await submitSignedToSoroban(signedXdr);
 await recordBetaClaimIfNeeded(txHash);
 setHash(txHash);
 setStatus("success");
 return;
 }

 if (action.type.startsWith("soroswap_") || action.type.startsWith("blend_")) {
 let endpoint = "";
 let body: Record<string, unknown> = { walletAddress: publicKey };

 if (action.type === "soroswap_swap") {
 if (!action.sendAmount || !action.sendAsset || !action.destAsset) {
 throw new Error("Missing swap details");
 }
 endpoint = "/api/soroswap/swap";
 body = {
 ...body,
 fromSymbol: action.sendAsset,
 toSymbol: action.destAsset,
 amount: action.sendAmount,
 slippageBps,
 };
 } else if (action.type === "soroswap_add_liquidity") {
 endpoint = "/api/soroswap/add-liquidity";
 body = {
 ...body,
 symbolA: action.sendAsset,
 symbolB: action.destAsset,
 amountA: action.sendAmount,
 amountB: action.amountB,
 slippageBps,
 };
 } else if (action.type === "soroswap_remove_liquidity") {
 endpoint = "/api/soroswap/remove-liquidity";
 body = {
 ...body,
 symbolA: action.sendAsset,
 symbolB: action.destAsset,
 liquidity: action.liquidity,
 slippageBps,
 };
 } else {
 // blend_*
 const blendAction = action.type.replace("blend_", "");
 endpoint = "/api/blend/build";
 body = {
 ...body,
 action: blendAction === "supply" ? "supply_collateral" : blendAction === "withdraw" ? "withdraw_collateral" : blendAction,
 symbol: action.sendAsset,
 amount: action.sendAmount,
 requestType: action.requestType,
 };
 }

 setProgress("Preparing transaction…");
 const res = await fetch(endpoint, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(body),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
 if (!data.xdr) throw new Error("No XDR returned");
 if (data.amountOutHuman) setEstimatedDest(data.amountOutHuman);

 setStatus("signing");
 setProgress("Sign with your wallet…");
 const signedXdr = await signTransaction(
 data.xdr,
 data.networkPassphrase || STELDEX_NETWORK_PASSPHRASE
 );

 setStatus("submitting");
 setProgress("Submitting to Soroban…");
 const { submitSignedToSoroban } = await import("@/lib/steldex-submit");
 const txHash = await submitSignedToSoroban(signedXdr);
 setHash(txHash);
 setStatus("success");
 return;
 }

 if (isSteldexAction(action.type)) {
 const body = buildSteldexBody(action, slippageBps);
 const endpoint = steldexEndpoint(action.type);

 const txHash = await buildAndSubmitSteldex(
 endpoint,
 body,
 publicKey,
 async (xdr) => {
 setStatus("signing");
 return signTransaction(xdr, STELDEX_NETWORK_PASSPHRASE);
 },
 (msg, step) => {
 setProgress(msg);
 if (step) setStepInfo(step);
 if (msg.startsWith("Sign")) setStatus("signing");
 else if (msg.startsWith("Submitting")) setStatus("submitting");
 else setStatus("building");
 }
 );

 setHash(txHash);
 setStatus("success");
 return;
 }

 if (!action.sendAmount || !action.sendAsset) {
 throw new Error("Missing transaction details");
 }
 const built = await buildMutation.mutateAsync({
 data: {
 type: action.type as "send" | "swap",
 sourcePublicKey: publicKey,
 sendAsset: action.sendAsset,
 sendAmount: action.sendAmount,
 destination: action.destination ?? null,
 destAsset: action.destAsset ?? null,
 },
 });
 if (built.estimatedDestAmount) setEstimatedDest(built.estimatedDestAmount);

 setStatus("signing");
 const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);

 setStatus("submitting");
 const result = await submitMutation.mutateAsync({
 data: { signedXdr, networkPassphrase: built.networkPassphrase },
 });

 if (!result.success) {
 const failMsg = result.error ?? "Transaction failed";
 if (!opts?.skipTooLateRetry && isTxTooLateError(failMsg)) {
 setProgress("Transaction expired - refreshing…");
 await handleExecute({ skipTooLateRetry: true });
 return;
 }
 setError(sanitizeError(failMsg));
 setStatus("error");
 return;
 }

 setHash(result.hash ?? null);
 setStatus("success");
 } catch (err: any) {
 const rawMsg = err?.message ?? "Something went wrong";
 const lower = String(rawMsg).toLowerCase();

 // Expired time bounds: rebuild fresh XDR and retry once (not a dead end)
 if (!opts?.skipTooLateRetry && isTxTooLateError(rawMsg)) {
 setProgress("Transaction expired - refreshing…");
 setError(null);
 await handleExecute({ skipTooLateRetry: true });
 return;
 }

 const looksLikeTrustline =
 lower.includes("op_no_trust") ||
 lower.includes("no_trust") ||
 /\btrustline\b/.test(lower) ||
 lower.includes("change_trust") ||
 lower.includes("changetrust");

 // Mid-tx recovery: classic trustline only - never for Blend (different USDC token)
 // and never treat Soroban "not authorized" as a missing Horizon trustline (causes loops).
 if (
 looksLikeTrustline &&
 publicKey &&
 action.type !== "add_trustline" &&
 !action.type.startsWith("blend_") &&
 (action.destAsset || action.sendAsset)
 ) {
 try {
 const assetCode = action.destAsset || action.sendAsset!;
 const res = await fetch("/api/wallet/add-trustline", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ walletAddress: publicKey, assetCode }),
 });
 const data = await res.json();
 if (res.ok && data.xdr) {
 setAction({
 type: "add_trustline",
 sendAsset: data.assetCode ?? assetCode,
 xdr: data.xdr,
 networkPassphrase: data.networkPassphrase,
 pendingAction: action,
 });
 setStatus("idle");
 setError(null);
 setProgress(null);
 return;
 }
 } catch {
 // fall through to normal error
 }
 }

 setError(sanitizeError(rawMsg));
 setStatus("error");
 }
 };

 const isBusy = status === "building" || status === "signing" || status === "submitting";

 const handleAttachImage = async (file: File | null) => {
 if (!file) return;
 setMediaError(null);
 if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
 setMediaError("Choose an image or video file.");
 return;
 }
 if (file.size > MEDIA_MAX_BYTES) {
 setMediaError("File too large (max 8 MB).");
 return;
 }
 setMediaBusy(true);
 try {
 const dataUrl = await fileToDataUrl(file);
 setAction((prev) => ({
 ...prev,
 imageDataUrl: dataUrl,
 imageUrl: undefined,
 }));
 } catch {
 setMediaError("Could not read that file.");
 } finally {
 setMediaBusy(false);
 if (imageInputRef.current) imageInputRef.current.value = "";
 }
 };

 const clearAttachedImage = () => {
 setMediaError(null);
 setAction((prev) => ({
 ...prev,
 imageDataUrl: undefined,
 imageUrl: undefined,
 }));
 };

 const handlePackZip = async (file: File | null) => {
 if (!file || !publicKey) return;
 setMediaError(null);
 setPackProgress(null);
 if (!file.name.toLowerCase().endsWith(".zip") && file.type !== "application/zip") {
 setMediaError("Choose a .zip of unique images (1.png, 2.png, …).");
 return;
 }
 setMediaBusy(true);
 try {
 const { uploadNftMediaPack } = await import("@/lib/nft-media-pack-upload");
 const result = await uploadNftMediaPack({
 zipFile: file,
 walletAddress: publicKey,
 name: action.marketHint?.replace(/\s*\([^)]*\)\s*$/, "").trim(),
 expectedCount: action.maxSupply && action.maxSupply > 0 ? action.maxSupply : undefined,
 collectionContract: action.collectionContract,
 description: action.description,
 onProgress: (p) => setPackProgress(p.message),
 });
 setAction((prev) => ({
 ...prev,
 mediaPackId: result.packId,
 maxSupply: result.itemCount,
 supplySpecified: true,
 }));
 setPackProgress(`Pack ready — ${result.itemCount} unique assets`);
 } catch (err: any) {
 setMediaError(err?.message ?? "Media pack upload failed");
 setPackProgress(null);
 } finally {
 setMediaBusy(false);
 if (packZipRef.current) packZipRef.current.value = "";
 }
 };

 if (action.type === "nft_media_pack") {
 return (
 <div className="mt-2 max-w-sm rounded-2xl border bg-card p-4 space-y-3">
 <div className="text-sm font-semibold">{actionTitle(action)}</div>
 <p className="text-[11px] text-muted-foreground">
 Upload a ZIP of unique images named like <code>1.png</code>…<code>N.png</code>.
 Then create your collection (or bind the pack) and say <strong>mint next NFT</strong>.
 </p>
 {action.mediaPackId ? (
 <div className="text-sm text-green-600 flex items-center gap-2">
 <CheckCircle2 className="w-4 h-4 shrink-0" />
 Pack ready ({action.maxSupply ?? "?"} assets)
 </div>
 ) : (
 <>
 <input
 ref={packZipRef}
 type="file"
 accept=".zip,application/zip"
 className="hidden"
 onChange={(e) => void handlePackZip(e.target.files?.[0] ?? null)}
 />
 <Button
 type="button"
 size="sm"
 className="w-full rounded-xl bg-orbit-gradient text-white border-0"
 disabled={isBusy || mediaBusy || !isConnected}
 onClick={() => packZipRef.current?.click()}
 >
 {mediaBusy ? (
 <>
 <Loader2 className="w-4 h-4 mr-1 animate-spin" />
 {packProgress ?? "Uploading…"}
 </>
 ) : !isConnected ? (
 <>
 <Wallet className="w-4 h-4 mr-1" />
 Connect wallet first
 </>
 ) : (
 <>
 <ImagePlus className="w-4 h-4 mr-1" />
 Upload ZIP media pack
 </>
 )}
 </Button>
 </>
 )}
 {packProgress && !action.mediaPackId && (
 <p className="text-[11px] text-muted-foreground">{packProgress}</p>
 )}
 {mediaError && <p className="text-[11px] text-destructive">{mediaError}</p>}
 {action.mediaPackId && (
 <p className="text-[11px] text-muted-foreground">
 Pack ID: {action.mediaPackId.slice(0, 8)}… — say “create NFT collection …” or “mint next NFT”.
 </p>
 )}
 </div>
 );
 }

 if (action.type === "add_trustline") {
 const asset = action.sendAsset ?? "token";
 return (
 <div className="mt-2 max-w-sm rounded-2xl border bg-card p-4 space-y-3">
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-orbit-gradient flex items-center justify-center shrink-0">
 <Wallet className="w-4 h-4 text-white" />
 </div>
 <div>
 <p className="text-sm font-semibold">Enable {asset} on your wallet</p>
 <p className="text-xs text-muted-foreground">One-time setup before your action</p>
 </div>
 </div>
 <div className="text-[11px] text-muted-foreground bg-orbit-gradient-subtle rounded-xl px-3 py-2 ring-1 ring-primary/10">
 Your wallet can&apos;t hold {asset} yet. Sign once to enable it (~0.5 XLM locked as a reserve - nothing is sent). Then your action continues automatically.
 </div>
 {status === "success" ? (
 <div className="space-y-2">
 <div className="flex items-center gap-2 text-sm font-medium text-green-600">
 <CheckCircle2 className="w-4 h-4 shrink-0" />
 {asset} enabled
 </div>
 {action.pendingAction && (
 <p className="text-xs text-muted-foreground">
 Continuing your action…
 </p>
 )}
 </div>
 ) : status === "error" ? (
 <div className="space-y-2">
 <div className="flex items-start gap-2 text-sm text-destructive">
 <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
 <span>{error}</span>
 </div>
 <Button
 size="sm"
 variant="outline"
 className="w-full rounded-xl"
 onClick={() => void handleExecute()}
 >
 {error && isTxTooLateError(error) ? "Refresh & try again" : "Try again"}
 </Button>
 </div>
 ) : (
 <Button
 size="sm"
 className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
 onClick={() => void handleExecute()}
 disabled={isBusy || !isConnected}
 >
 {isBusy ? (
 <><Loader2 className="w-4 h-4 mr-1 animate-spin" />{progress ?? "Enabling…"}</>
 ) : !isConnected ? (
 <><Wallet className="w-4 h-4 mr-1" />Connect wallet first</>
 ) : (
 <>Enable {asset}</>
 )}
 </Button>
 )}
 </div>
 );
 }

 if (action.type === "connect_wallet") {
 return (
 <div className="mt-2 max-w-sm rounded-2xl border bg-card p-4">
 {isConnected && publicKey ? (
 <p className="text-sm text-foreground">
 Connected as{" "}
 <span className="font-medium">
 {publicKey.slice(0, 4)}…{publicKey.slice(-4)}
 </span>{" "}
 on Testnet.
 </p>
 ) : (
 <Button
 size="sm"
 className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
 onClick={openConnectModal}
 disabled={connecting}
 >
 {connecting ? (
 <Loader2 className="w-4 h-4 mr-1 animate-spin" />
 ) : (
 <Wallet className="w-4 h-4 mr-1" />
 )}
 Connect wallet
 </Button>
 )}
 </div>
 );
 }

 return (
 <div className="mt-2 rounded-2xl border bg-card p-4 space-y-3 max-w-sm">
 <div className="flex items-center gap-2">
 <div className="w-8 h-8 rounded-full bg-orbit-gradient flex items-center justify-center shrink-0">
 {action.type === "send" ? (
 <ArrowRight className="w-4 h-4 text-white" />
 ) : isSorobanAction(action.type) ? (
 <Sprout className="w-4 h-4 text-white" />
 ) : (
 <Wallet className="w-4 h-4 text-white" />
 )}
 </div>
 <div className="min-w-0 flex-1">
 <div className="text-sm font-semibold">
 {planTitle ?? actionTitle(action)}
 </div>
 {steps && !planComplete && (
 <p className="text-[11px] text-muted-foreground">
 Step {stepIndex + 1} of {steps.length}
 {action.destAsset ? ` · ${action.sendAsset ?? "?"} → ${action.destAsset}` : ""}
 </p>
 )}
 </div>
 </div>

 {steps && (
 <div className="flex flex-wrap gap-1.5">
 {steps.map((step, i) => {
 const done = planComplete || i < stepIndex || (i === stepIndex && status === "success");
 const current = !planComplete && i === stepIndex && status !== "success";
 return (
 <span
 key={`${step.type}-${step.destAsset ?? step.marketHint ?? i}`}
 className={cn(
 "rounded-full border px-2 py-0.5 text-[11px] font-medium",
 done && "border-green-500/40 text-green-600 dark:text-green-500",
 current && "border-primary bg-primary/10 text-primary",
 !done && !current && "border-border text-muted-foreground"
 )}
 >
 {i + 1} · {stepChipLabel(step)}
 </span>
 );
 })}
 </div>
 )}

 {!planComplete && (
 <div className="text-sm space-y-1.5 text-muted-foreground">
 {action.sendAmount && action.sendAsset && action.type !== "steldex_remove_liquidity" && action.type !== "steldex_stake" && action.type !== "steldex_unstake" && action.type !== "steldex_claim" && (
 <div className="flex justify-between">
 <span>{action.type === "steldex_add_liquidity" ? "Token A" : "Amount"}</span>
 <span className="font-medium text-foreground">
 {action.sendAmount} {action.sendAsset}
 </span>
 </div>
 )}
 {action.type === "steldex_add_liquidity" && action.amountB && action.destAsset && (
 <div className="flex justify-between">
 <span>Token B</span>
 <span className="font-medium text-foreground">
 {action.amountB} {action.destAsset}
 </span>
 </div>
 )}
 {action.type === "steldex_remove_liquidity" && action.liquidity && (
 <div className="flex justify-between">
 <span>LP liquidity</span>
 <span className="font-mono text-xs text-foreground truncate max-w-[160px]">
 {action.liquidity}
 </span>
 </div>
 )}
 {action.type === "steldex_stake" && (
 <div className="flex justify-between">
 <span>Lock</span>
 <span className="font-medium text-foreground">{action.lockWeeks ?? 52} weeks</span>
 </div>
 )}
 {action.type === "send" && action.destination && (
 <div className="flex justify-between gap-2">
 <span>To</span>
 <span
 className="font-mono text-xs text-foreground truncate max-w-[160px]"
 title={action.destination}
 >
 {action.destination.slice(0, 6)}...{action.destination.slice(-6)}
 </span>
 </div>
 )}
 {(action.type === "swap" ||
 action.type === "steldex_swap" ||
 action.type === "soroswap_swap" ||
 action.type === "aquarius_swap") &&
 action.destAsset && (
 <div className="flex justify-between">
 <span>Receive (est.)</span>
 <span className="font-medium text-foreground">
 {quoteLoading
 ? "…"
 : estimatedDest
 ? `~${formatReceiveEstimate(estimatedDest, action.destAsset)}`
 : "-"}{" "}
 {action.destAsset}
 </span>
 </div>
 )}
 {action.pair && (
 <div className="flex justify-between">
 <span>Pool</span>
 <span className="font-medium text-foreground">{action.pair}</span>
 </div>
 )}
 {action.orderId && (
 <div className="flex justify-between">
 <span>Order</span>
 <span className="font-medium text-foreground">#{action.orderId}</span>
 </div>
 )}
 {action.type === "predict_bet" && action.outcome && (
 <div className="flex justify-between">
 <span>Outcome</span>
 <span className="font-medium text-foreground">{action.outcome.toUpperCase()}</span>
 </div>
 )}
 {(action.type === "predict_bet" || action.type === "predict_claim") && action.marketHint && (
 <div className="flex justify-between">
 <span>Market</span>
 <span className="font-medium text-foreground">{action.marketHint}</span>
 </div>
 )}
 {action.type === "predict_claim" && action.outcome && (
 <div className="flex justify-between">
 <span>Claim</span>
 <span className="font-medium text-foreground">{action.outcome.toUpperCase()} winnings</span>
 </div>
 )}
 {action.type === "perp_close" && (
 <>
 <div className="flex justify-between">
 <span>Close</span>
 <span className="font-medium text-foreground">
 #{action.positionId} {action.side?.toUpperCase()} {action.marketHint}
 </span>
 </div>
 {action.entryPrice != null && (
 <div className="flex justify-between">
 <span>Entry</span>
 <span className="font-medium text-foreground">${action.entryPrice.toFixed(2)}</span>
 </div>
 )}
 </>
 )}
 {(action.type === "nft_mint" || action.type === "nft_list" || action.type === "nft_buy" || action.type === "nft_transfer" || action.type === "nft_cancel" || action.type === "nft_create_collection" || action.type === "token_deploy" || action.type === "token_mint") && (
 <>
 {action.tokenId != null && (
 <div className="flex justify-between">
 <span>Token</span>
 <span className="font-medium text-foreground">#{action.tokenId}</span>
 </div>
 )}
 {action.marketHint && action.type === "nft_mint" && (
 <div className="flex justify-between">
 <span>Name</span>
 <span className="font-medium text-foreground">{action.marketHint}</span>
 </div>
 )}
 {action.priceXlm && (
 <div className="flex justify-between">
 <span>Price</span>
 <span className="font-medium text-foreground">{action.priceXlm} XLM</span>
 </div>
 )}
 {(action.type === "nft_buy" || action.type === "nft_list") && (
 <p className="text-[11px] text-muted-foreground leading-snug">
 Secondary sale split: seller + creator royalty (default 2.5%) + 0.5% Orbit fee.
 </p>
 )}
 {action.destination && (
 <div className="flex justify-between">
 <span>To</span>
 <span className="font-medium text-foreground font-mono text-xs">
 {action.destination.slice(0, 4)}…{action.destination.slice(-4)}
 </span>
 </div>
 )}
 </>
 )}
 {needsMediaAttach(action) && !planComplete && status !== "success" && (
 <div className="space-y-2 rounded-xl bg-muted/40 px-3 py-2.5 ring-1 ring-border/60">
 {action.type === "nft_create_collection" && (
 <div className="space-y-2 pb-2 border-b border-border/60">
 <p className="text-[11px] font-medium text-foreground">Collection details</p>
 <textarea
 rows={2}
 placeholder="Description (required)"
 value={action.description ?? ""}
 disabled={isBusy}
 onChange={(e) =>
 setAction((prev) => ({
 ...prev,
 description: e.target.value,
 }))
 }
 className="w-full rounded-xl border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground disabled:opacity-50 resize-none"
 />
 <div className="grid grid-cols-2 gap-1.5">
 <label className="space-y-0.5">
 <span className="text-[10px] text-muted-foreground">Max supply</span>
 <input
 type="number"
 min={0}
 placeholder="0 = unlimited"
 value={action.supplySpecified ? action.maxSupply ?? 0 : ""}
 disabled={isBusy}
 onChange={(e) => {
 const raw = e.target.value;
 if (raw === "") {
 setAction((prev) => ({
 ...prev,
 supplySpecified: false,
 maxSupply: 0,
 }));
 return;
 }
 const n = Math.max(0, Math.floor(Number(raw)) || 0);
 setAction((prev) => ({
 ...prev,
 maxSupply: n,
 supplySpecified: true,
 }));
 }}
 className="w-full rounded-xl border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground disabled:opacity-50"
 />
 </label>
 <label className="space-y-0.5">
 <span className="text-[10px] text-muted-foreground">Royalty %</span>
 <input
 type="number"
 min={0}
 max={10}
 step={0.1}
 value={
 action.royaltyBps != null
 ? Number((action.royaltyBps / 100).toFixed(2))
 : 2.5
 }
 disabled={isBusy}
 onChange={(e) => {
 const pct = Math.max(0, Math.min(10, Number(e.target.value) || 0));
 setAction((prev) => ({
 ...prev,
 royaltyBps: Math.round(pct * 100),
 }));
 }}
 className="w-full rounded-xl border bg-background px-2.5 py-1.5 text-[11px] text-foreground disabled:opacity-50"
 />
 </label>
 </div>
 <input
 type="url"
 placeholder="Website (optional)"
 value={action.website ?? ""}
 disabled={isBusy}
 onChange={(e) =>
 setAction((prev) => ({
 ...prev,
 website: e.target.value.trim() || undefined,
 }))
 }
 className="w-full rounded-xl border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground disabled:opacity-50"
 />
 {!collectionSetupReady(action) && (
 <p className="text-[11px] text-amber-700 dark:text-amber-400">
 Still need: {collectionSetupMissing(action).join(", ")}
 </p>
 )}
 </div>
 )}
 <div className="flex items-center justify-between gap-2">
 <p className="text-[11px] font-medium text-foreground">
 {action.type === "token_deploy"
 ? "Token logo"
 : action.type === "nft_create_collection"
 ? "Collection image"
 : "Artwork"}
 </p>
 {(action.imageDataUrl || action.imageUrl) && (
 <button
 type="button"
 className="text-[11px] text-muted-foreground hover:text-foreground"
 onClick={clearAttachedImage}
 disabled={isBusy || mediaBusy}
 >
 Clear
 </button>
 )}
 </div>
 {mediaPreviewUrl(action) ? (
 <div className="flex items-center gap-2.5">
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img
 src={mediaPreviewUrl(action)!}
 alt="Attached media"
 className="h-12 w-12 rounded-lg object-cover ring-1 ring-border"
 />
 <p className="text-[11px] text-muted-foreground truncate min-w-0">
 {action.imageDataUrl ? "Local file ready" : action.imageUrl}
 </p>
 </div>
 ) : (
 <p className="text-[11px] text-muted-foreground">
 Attach from your computer or paste an image URL.
 </p>
 )}
 <div className="flex flex-col gap-1.5">
 <input
 ref={imageInputRef}
 type="file"
 accept="image/*,video/mp4,video/webm"
 className="hidden"
 onChange={(e) => void handleAttachImage(e.target.files?.[0] ?? null)}
 />
 <Button
 type="button"
 size="sm"
 variant="outline"
 className="w-full rounded-xl"
 disabled={isBusy || mediaBusy}
 onClick={() => imageInputRef.current?.click()}
 >
 {mediaBusy ? (
 <>
 <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
 Reading…
 </>
 ) : (
 <>
 <ImagePlus className="w-3.5 h-3.5 mr-1.5" />
 {action.imageDataUrl ? "Replace file" : "Attach from computer"}
 </>
 )}
 </Button>
 <input
 type="url"
 placeholder="https://… image URL"
 value={action.imageDataUrl ? "" : action.imageUrl ?? ""}
 disabled={isBusy || mediaBusy || Boolean(action.imageDataUrl)}
 onChange={(e) => {
 const v = e.target.value.trim();
 setAction((prev) => ({
 ...prev,
 imageUrl: v || undefined,
 imageDataUrl: undefined,
 }));
 }}
 className="w-full rounded-xl border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground disabled:opacity-50"
 />
 </div>
 {mediaError && (
 <p className="text-[11px] text-destructive">{mediaError}</p>
 )}
 {(action.type === "nft_create_collection" || action.type === "nft_media_pack") && (
 <div className="space-y-1.5 pt-1 border-t border-border/60">
 <p className="text-[11px] font-medium text-foreground">
 Unique drop (ZIP media pack)
 </p>
 <p className="text-[11px] text-muted-foreground">
 Optional: ZIP of <code>1.png</code>…<code>N.png</code> for sequential open mint.
 </p>
 {action.mediaPackId ? (
 <p className="text-[11px] text-green-600">
 Pack linked — {action.maxSupply ?? "?"} assets ({action.mediaPackId.slice(0, 8)}…)
 </p>
 ) : (
 <>
 <input
 ref={packZipRef}
 type="file"
 accept=".zip,application/zip"
 className="hidden"
 onChange={(e) => void handlePackZip(e.target.files?.[0] ?? null)}
 />
 <Button
 type="button"
 size="sm"
 variant="outline"
 className="w-full rounded-xl"
 disabled={isBusy || mediaBusy || !isConnected}
 onClick={() => packZipRef.current?.click()}
 >
 {mediaBusy ? (
 <>
 <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
 {packProgress ?? "Uploading pack…"}
 </>
 ) : (
 <>
 <ImagePlus className="w-3.5 h-3.5 mr-1.5" />
 Upload ZIP media pack
 </>
 )}
 </Button>
 </>
 )}
 {packProgress && (
 <p className="text-[11px] text-muted-foreground">{packProgress}</p>
 )}
 </div>
 )}
 </div>
 )}
 {action.type === "perp_open" && (
 <>
 <div className="flex justify-between">
 <span>Side</span>
 <span className="font-medium text-foreground">
 {action.side?.toUpperCase()} {action.marketHint} {action.leverage}x
 </span>
 </div>
 {action.entryPrice != null && (
 <div className="flex justify-between">
 <span>Entry</span>
 <span className="font-medium text-foreground">${action.entryPrice.toFixed(2)}</span>
 </div>
 )}
 {action.liquidationPrice != null && (
 <div className="flex justify-between">
 <span>Liq</span>
 <span className="font-medium text-foreground">
 ${action.liquidationPrice.toFixed(2)}
 </span>
 </div>
 )}
 {action.stopLoss != null && (
 <div className="flex justify-between">
 <span>SL</span>
 <span className="font-medium text-foreground">${action.stopLoss}</span>
 </div>
 )}
 {action.takeProfit != null && (
 <div className="flex justify-between">
 <span>TP</span>
 <span className="font-medium text-foreground">${action.takeProfit}</span>
 </div>
 )}
 </>
 )}
 <div className="flex justify-between">
 <span>Network</span>
 <span className="text-foreground">Stellar Testnet</span>
 </div>
 <div className="flex justify-between gap-2">
 <span>Protocol</span>
 <span className="font-medium text-foreground text-right">{confidence.protocol}</span>
 </div>
 </div>
 )}

 {isSwap && status === "idle" && (
 <div className="flex items-center justify-between text-[11px]">
 <span className="text-muted-foreground">Slippage tolerance</span>
 <div className="flex gap-1">
 {SLIPPAGE_OPTIONS.map((opt) => (
 <button
 key={opt.bps}
 type="button"
 onClick={() => setSlippageBps(opt.bps)}
 className={cn(
 "rounded-full px-2 py-0.5 font-medium transition-colors",
 slippageBps === opt.bps
 ? "bg-primary text-primary-foreground"
 : "bg-muted text-muted-foreground hover:bg-primary/10"
 )}
 >
 {opt.label}
 </button>
 ))}
 </div>
 </div>
 )}

 {status !== "success" && status !== "error" && (
 <div className="rounded-xl bg-orbit-gradient-subtle px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-primary/10">
 <p className="mb-1.5 font-medium text-foreground">Before you sign</p>
 <p className="mb-1.5 text-foreground/80">{confidence.walletScope}</p>
 <ul className="list-disc space-y-0.5 pl-4">
 {confidence.risks.slice(0, 4).map((r) => (
 <li key={r}>{r}</li>
 ))}
 </ul>
 </div>
 )}

 {status === "success" ? (
 <div className="space-y-2 rounded-xl border border-primary/20 bg-orbit-gradient-subtle p-3">
 <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-500">
 <CheckCircle2 className="w-4 h-4 shrink-0" />
 {planComplete && steps
 ? `Done - ${steps.length} step${steps.length === 1 ? "" : "s"} on-chain`
 : steps && stepIndex < steps.length - 1
 ? `Step ${stepIndex + 1} done`
 : "Done on-chain"}
 </div>
 {outcomeLine && (
 <p className="text-sm text-foreground">{outcomeLine}</p>
 )}
 {beforeIdle && (
 <p className="text-xs text-muted-foreground">
 Before: idle {beforeIdle}. Ask “What&apos;s earning?” to see the updated position book.
 </p>
 )}
 {planComplete && steps ? (
 <ul className="space-y-1">
 {steps.map((step, i) => {
 const h = stepHashes[i] ?? (i === steps.length - 1 ? hash : null);
 return (
 <li key={i} className="flex items-center justify-between gap-2 text-xs">
 <span className="text-muted-foreground">
 {i + 1}. {stepChipLabel(step)}
 </span>
 {h ? (
 <a
 href={`https://stellar.expert/explorer/testnet/tx/${h}`}
 target="_blank"
 rel="noreferrer"
 className="text-primary flex items-center gap-1 hover:underline shrink-0"
 >
 Explorer <ExternalLink className="w-3 h-3" />
 </a>
 ) : (
 <span className="text-muted-foreground">-</span>
 )}
 </li>
 );
 })}
 </ul>
 ) : (
 hash && (
 <a
 href={`https://stellar.expert/explorer/testnet/tx/${hash}`}
 target="_blank"
 rel="noreferrer"
 className="text-xs text-primary flex items-center gap-1 hover:underline"
 >
 View on explorer <ExternalLink className="w-3 h-3" />
 </a>
 )
 )}
 {steps && !planComplete && stepIndex < steps.length - 1 && (
 <p className="text-[11px] text-muted-foreground">
 Preparing next step…
 </p>
 )}
 </div>
 ) : status === "error" ? (
 <div className="space-y-2">
 <div className="flex items-start gap-2 text-sm text-destructive">
 <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
 <span className="break-words">{error}</span>
 </div>
 <Button
 size="sm"
 variant="outline"
 className="w-full rounded-xl"
 onClick={() => void handleExecute()}
 >
 {error && isTxTooLateError(error) ? "Refresh & try again" : "Try again"}
 </Button>
 </div>
 ) : !isConnected ? (
 <Button
 size="sm"
 className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
 onClick={openConnectModal}
 disabled={connecting}
 >
 {connecting ? (
 <Loader2 className="w-4 h-4 mr-1 animate-spin" />
 ) : (
 <Wallet className="w-4 h-4 mr-1" />
 )}
 Connect wallet
 </Button>
 ) : (
 <div className="space-y-2">
 <Button
 size="sm"
 className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
 onClick={() => void handleExecute()}
 disabled={
 isBusy ||
 mediaBusy ||
 (action.type === "nft_create_collection" && !collectionSetupReady(action))
 }
 >
 {isBusy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
 {status === "building"
 ? progress ?? "Preparing…"
 : status === "signing"
 ? `${stepInfo ? `Step ${stepInfo.current}/${stepInfo.total}: ` : ""}${progress ?? (walletType === "internal" ? "Signing…" : "Confirm in Freighter…")}`
 : status === "submitting"
 ? progress ?? "Submitting…"
 : action.type === "nft_create_collection" && !collectionSetupReady(action)
 ? "Complete collection details"
 : walletType === "internal"
 ? "Sign with Orbit wallet"
 : "Sign with Freighter"}
 </Button>
 {isBusy && (
 <p className="text-[11px] text-muted-foreground text-center">
 {stepInfo && stepInfo.total > 1
 ? `Step ${stepInfo.current} of ${stepInfo.total}`
 : progress ?? ""}
 </p>
 )}
 </div>
 )}
 </div>
 );
}
