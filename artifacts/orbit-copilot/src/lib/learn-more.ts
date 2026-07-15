/**
 * Short post-success overviews (no link dumps).
 * Shown only after the tx lands on-chain.
 */

export type TeachProtocol = "blend" | "orbit_supply" | null;

export function teachProtocolForAction(type: string): TeachProtocol {
  if (
    type === "blend_supply" ||
    type === "blend_withdraw" ||
    type === "blend_borrow" ||
    type === "blend_repay" ||
    type === "blend_claim"
  ) {
    return "blend";
  }
  if (
    type === "orbit_supply_deposit" ||
    type === "orbit_supply_withdraw" ||
    type === "orbit_supply_claim"
  ) {
    return "orbit_supply";
  }
  return null;
}

export function blendTeachAfterSuccess(actionType: string): {
  title: string;
  body: string;
} {
  const verb =
    actionType === "blend_claim"
      ? "claim"
      : actionType === "blend_withdraw"
        ? "withdraw"
        : actionType === "blend_borrow"
          ? "borrow"
          : actionType === "blend_repay"
            ? "repay"
            : "supply";

  return {
    title: `Blend ${verb} landed`,
    body:
      "Blend is Stellar's main lending market: you supply assets to earn interest, and you can borrow against that collateral. Rates move with utilization (more borrowing raises rates). Keep a healthy buffer if you borrow - if collateral value drops relative to debt, you can be liquidated. What you just did uses Circle USDC / XLM on the live testnet pool, same tokens as your wallet.",
  };
}

export function orbitSupplyTeachAfterSuccess(actionType: string): {
  title: string;
  body: string;
} {
  if (actionType === "orbit_supply_claim") {
    return {
      title: "Orbit Supply claim landed",
      body:
        "Orbit Supply is Orbit's simple yield vault: deposit USDC, pUSDC, or EURC and earn a fixed 10 XLM per 1,000,000 supplied every 24 hours. Claims unlock once a day - say \"claim my yield\" again tomorrow if you stay deposited.",
    };
  }
  if (actionType === "orbit_supply_withdraw") {
    return {
      title: "Orbit Supply withdraw landed",
      body:
        "You pulled principal out of Orbit Supply. While funds were deposited you earned a flat 10 XLM per 1M / day. Deposit again anytime with \"supply … on orbit-supply\".",
    };
  }
  return {
    title: "Orbit Supply deposit landed",
    body:
      "Orbit Supply is Orbit's fixed-yield vault (not a lending market). You earn 10 XLM per 1,000,000 USDC/pUSDC/EURC every 24h from the reward treasury. After a day, say \"claim my yield\" to collect XLM. Withdraw principal anytime.",
  };
}
