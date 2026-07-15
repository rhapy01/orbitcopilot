/**
 * Orbit network mode - execution is testnet-only; mainnet is educate-and-refuse.
 */

export type OrbitExecutionNetwork = "testnet";

/** Execution network. Mainnet signing is not enabled. */
export function getExecutionNetwork(): OrbitExecutionNetwork {
 const raw = (process.env.ORBIT_NETWORK ?? "testnet").trim().toLowerCase();
 if (raw === "mainnet") {
 // Soft flag for future - still refuse execution until explicitly wired.
 return "testnet";
 }
 return "testnet";
}

export function isMainnetMention(content: string): boolean {
 return /\bmainnet\b|\bmain\s*net\b|\breal\s+(?:money|funds|assets|xlm|usdc)\b|\blive\s+network\b|\bproduction\s+(?:stellar|network)\b/i.test(
 content
 );
}

/** True when the user is trying to execute / move value on mainnet. */
export function isMainnetExecutionAsk(content: string): boolean {
 if (!isMainnetMention(content)) return false;
 // Pure education about mainnet is allowed through teach/RAG paths.
 if (
 /\b(?:what(?:'s|\s+is)|whats|explain|define|difference|vs\.?|versus|tell\s+me\s+about)\b/i.test(
 content
 )
 ) {
 return false;
 }
 return /\b(?:swap|send|transfer|pay|stake|supply|borrow|repay|withdraw|mint|list|buy|open|long|short|bridge|deposit|trade|invest|bet)\b/i.test(
 content
 );
}

export function mainnetGuardrailText(): string {
 return [
 "**Mainnet execution is not enabled.**",
 "",
 "Orbit Copilot signs and settles on **Stellar Testnet** only (Friendbot XLM, test assets).",
 "You can still ask Orbit to *explain* mainnet, CeFi, bridges, and risk - then practice the same flows on testnet.",
 "",
 "Examples:",
 '• "What is mainnet vs testnet?"',
 '• "Swap 10 XLM to pUSDC" (testnet)',
 '• "Supply 10 USDC on Blend" (testnet)',
 "",
 "── Sources ──",
 "1. Mainnet vs testnet - Orbit Network Guardrails",
 ].join("\n");
}

export function networkSystemBlurb(): string {
 return `NETWORK: Execution is Stellar Testnet only. If the user asks to swap/send/lend on mainnet or with real funds, refuse the action, explain testnet practice, and offer a testnet equivalent. Never claim a mainnet tx was submitted.`;
}
