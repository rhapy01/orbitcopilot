/**
 * Post-action education blurbs with docs links (green-belt teach moment).
 * Keep plain ASCII hyphens only (no em dashes).
 */

export function blendLearnMoreBlurb(): string {
  return [
    "",
    "Learn more about Blend:",
    "- Docs (how pools work): https://docs.blend.capital/tech-docs/integrations/integrate-pool",
    "- Live dashboard: https://testnet.blend.capital/dashboard/?poolId=CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW",
    "- Protocol overview: https://docs.blend.capital",
  ].join("\n");
}

export function orbitSupplyLearnMoreBlurb(contractId?: string): string {
  const lines = [
    "",
    "Learn more about Orbit Supply:",
    "- Fixed yield: 10 XLM per 1,000,000 USDC/pUSDC/EURC supplied, claimable every 24h",
    "- Claim anytime after a day: \"claim my yield\"",
    "- Stellar Soroban docs: https://developers.stellar.org/docs/build/smart-contracts",
  ];
  if (contractId) {
    lines.push(`- Contract (reward XLM treasury): ${contractId}`);
    lines.push(
      `- Fund rewards: call deposit_reward, or transfer XLM SAC to ${contractId}`
    );
  }
  return lines.join("\n");
}
