/**
 * Post-success education links (shown only after the tx lands on-chain).
 * Keep plain ASCII hyphens only (no em dashes).
 */

const BLEND_POOL =
  "CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW";

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
  headline: string;
  links: { label: string; href: string }[];
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
    headline: `Your Blend ${verb} is on-chain. Here is how the protocol works:`,
    links: [
      {
        label: "Docs (how pools work)",
        href: "https://docs.blend.capital/tech-docs/integrations/integrate-pool",
      },
      {
        label: "Live dashboard",
        href: `https://testnet.blend.capital/dashboard/?poolId=${BLEND_POOL}`,
      },
      {
        label: "Protocol overview",
        href: "https://docs.blend.capital",
      },
    ],
  };
}

export function orbitSupplyTeachAfterSuccess(actionType: string): {
  headline: string;
  links: { label: string; href: string }[];
} {
  const headline =
    actionType === "orbit_supply_claim"
      ? "Your Orbit Supply yield claim is on-chain. Keep earning:"
      : actionType === "orbit_supply_withdraw"
        ? "Your Orbit Supply withdraw is on-chain. About the vault:"
        : "Your Orbit Supply deposit is on-chain. Earn 10 XLM per 1M supplied every 24h - say \"claim my yield\" after a day.";
  return {
    headline,
    links: [
      {
        label: "How Soroban contracts work",
        href: "https://developers.stellar.org/docs/build/smart-contracts",
      },
      {
        label: "View reward treasury on explorer",
        href: "https://stellar.expert/explorer/testnet/contract/CAK6JTURV46VP2HSVFZORYJHBC4CYP4BDVJLQJK4AXSN6X75SIZRB6QV",
      },
    ],
  };
}
