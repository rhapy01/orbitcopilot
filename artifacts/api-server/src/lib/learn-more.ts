/**
 * Server-side teach blurbs are intentionally unused for prep messages.
 * Teach links render on the frontend AFTER a successful on-chain tx
 * (see artifacts/orbit-copilot/src/lib/learn-more.ts).
 *
 * Kept as thin helpers if chat ever needs a follow-up assistant message.
 */

export function blendLearnMoreBlurb(): string {
  return [
    "Your Blend action is on-chain. Learn more:",
    "- Docs: https://docs.blend.capital/tech-docs/integrations/integrate-pool",
    "- Dashboard: https://testnet.blend.capital/dashboard/?poolId=CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW",
    "- Overview: https://docs.blend.capital",
  ].join("\n");
}

export function orbitSupplyLearnMoreBlurb(contractId?: string): string {
  const lines = [
    "Your Orbit Supply action is on-chain. Learn more:",
    "- Fixed yield: 10 XLM per 1,000,000 USDC/pUSDC/EURC / 24h",
    "- Claim after a day: \"claim my yield\"",
    "- Soroban docs: https://developers.stellar.org/docs/build/smart-contracts",
  ];
  if (contractId) {
    lines.push(`- Contract (reward treasury): ${contractId}`);
  }
  return lines.join("\n");
}
