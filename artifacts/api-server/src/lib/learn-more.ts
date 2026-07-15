/**
 * Optional follow-up overviews if chat ever needs them.
 * Prep messages must NOT include these - teach happens after success in the UI.
 */

export function blendOverviewBlurb(): string {
  return "Blend is Stellar's lending market: supply to earn interest, borrow against collateral. Rates follow utilization; over-borrowed positions can be liquidated. Orbit uses the live testnet pool with Circle USDC and XLM.";
}

export function orbitSupplyOverviewBlurb(): string {
  return "Orbit Supply is a fixed-yield vault: deposit USDC, pUSDC, or EURC and earn 10 XLM per 1M every 24h. Claim with \"claim my yield\" after a day.";
}
