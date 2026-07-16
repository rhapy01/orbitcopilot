/**
 * Orbit protocol registry - source of truth for integrated Stellar Testnet backends.
 * All user actions go through chat; these are backend integrations only.
 */

export type ProtocolId =
 | "horizon"
 | "steldex"
 | "soroswap"
 | "aquarius"
 | "blend"
 | "defindex"
 | "meridian"
 | "reflector"
 | "friendbot"
 | "phoenix"
 | "orbit-predict"
 | "orbit-perps"
 | "orbit-nft"
 | "orbit-supply";

export interface ProtocolInfo {
 id: ProtocolId;
 name: string;
 category: "wallet-infra" | "dex" | "amm" | "lending" | "oracle" | "aggregator" | "faucet" | "nft";
 network: "testnet";
 status: "live" | "partial" | "external-down";
 capabilities: string[];
 docs?: string;
 notes?: string;
}

export const PROTOCOL_REGISTRY: ProtocolInfo[] = [
 {
 id: "horizon",
 name: "Stellar Horizon (Classic)",
 category: "wallet-infra",
 network: "testnet",
 status: "live",
 capabilities: ["balances", "payments", "path-payment-swap", "activity"],
 docs: "https://developers.stellar.org/docs/data/horizon",
 },
 {
 id: "steldex",
 name: "Unicorn StelDex",
 category: "dex",
 network: "testnet",
 status: "live",
 capabilities: ["swap", "add-lp", "remove-lp", "stake", "unstake", "claim", "limit-orders"],
 docs: "https://stellar-swap-dex.vercel.app",
 },
 {
 id: "soroswap",
 name: "Soroswap Aggregator",
 category: "aggregator",
 network: "testnet",
 status: "partial",
 capabilities: ["quote", "swap", "add-lp", "remove-lp", "faucet", "balances", "positions"],
 docs: "https://api.soroswap.finance/docs",
 notes: "Routes Soroswap AMM + Aquarius (+ Phoenix on mainnet). Testnet indexer may be empty.",
 },
 {
 id: "aquarius",
 name: "Aquarius AMM",
 category: "amm",
 network: "testnet",
 status: "live",
 capabilities: ["pools", "find-path-quote", "swap-route"],
 docs: "https://docs.aqua.network/developers/code-examples/prerequisites-and-basics",
 },
 {
 id: "phoenix",
 name: "Phoenix DEX",
 category: "dex",
 network: "testnet",
 status: "partial",
 capabilities: ["swap-via-soroswap"],
 docs: "https://api.soroswap.finance/docs",
 notes: "Reached through Soroswap aggregator when indexer lists phoenix.",
 },
 {
 id: "blend",
 name: "Blend Protocol",
 category: "lending",
 network: "testnet",
 status: "live",
 capabilities: ["markets", "supply", "withdraw", "borrow", "repay", "claim", "usdc-bridge"],
 docs: "https://docs.blend.capital",
 notes:
 "Live UI pool CAPBM… - Circle USDC + XLM + CETES + TESOURO. Supply as collateral; claim BLND emissions.",
 },
 {
 id: "defindex",
 name: "DeFindex",
 category: "lending",
 network: "testnet",
 status: "live",
 capabilities: ["vault-deposit", "vault-withdraw", "apy"],
 docs: "https://docs.defindex.io",
 notes:
 "Public PaltaLabs vaults: XLM + Blend USDC + CETES. Chat: deposit/withdraw via api.defindex.io XDR.",
 },
 {
 id: "meridian",
 name: "Meridian",
 category: "lending",
 network: "testnet",
 status: "live",
 capabilities: ["vault-deposit", "vault-withdraw", "positions"],
 docs: "https://github.com/drydocs/meridian",
 notes:
 "USDC vault CBQYE… routes to Blend via adapter. Uses Blend USDC (CAQCFV…).",
 },
 {
 id: "reflector",
 name: "Reflector Oracle",
 category: "oracle",
 network: "testnet",
 status: "live",
 capabilities: ["prices", "fx"],
 docs: "https://developers.stellar.org/docs/data/oracles/oracle-providers",
 },
 {
 id: "friendbot",
 name: "Friendbot",
 category: "faucet",
 network: "testnet",
 status: "live",
 capabilities: ["fund-xlm"],
 docs: "https://developers.stellar.org/docs/networks/friendbot",
 },
 {
 id: "orbit-predict",
 name: "Orbit Prediction Markets",
 category: "dex",
 network: "testnet",
 status: "live",
 capabilities: ["binary-markets", "bet-yes-no", "claim", "positions"],
 notes: "Soroban contract - XLM SAC stakes held on-chain (contracts/orbit-predict)",
 },
 {
 id: "orbit-perps",
 name: "Orbit Perpetuals",
 category: "dex",
 network: "testnet",
 status: "live",
 capabilities: ["long-short", "leverage", "stop-loss", "take-profit", "close", "positions"],
 notes: "Soroban contract - USDC SAC margin held on-chain (contracts/orbit-perps)",
 },
 {
 id: "orbit-nft",
 name: "Orbit NFT",
 category: "nft",
 network: "testnet",
 status: "live",
 capabilities: ["mint", "list", "buy", "transfer", "holdings"],
 notes: "Soroban contract - XLM fixed-price marketplace (contracts/orbit-nft)",
 },
 {
 id: "orbit-supply",
 name: "Orbit Supply",
 category: "lending",
 network: "testnet",
 status: "live",
 capabilities: ["deposit", "withdraw", "claim-yield", "positions"],
 notes:
 "Soroban yield vault - USDC/pUSDC/EURC deposits earn 10 XLM per 1M per 24h (contracts/orbit-supply)",
 },
];

export function formatProtocolRegistry(): string {
 const lines = PROTOCOL_REGISTRY.map((p) => {
 const caps = p.capabilities.join(", ");
 const note = p.notes ? `\n ${p.notes}` : "";
 return `• ${p.name} [${p.status}] - ${p.category}\n ${caps}${note}`;
 });
 return [
 "Orbit protocol backends (Stellar Testnet only):",
 "",
 ...lines,
 "",
 "Everything is driven from chat. Connect Freighter or your Orbit wallet on Testnet to act.",
 ].join("\n");
}
