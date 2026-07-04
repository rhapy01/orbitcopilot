import type { ChatAction } from "@/components/transaction-action-card";

/** Plain-language confidence notes shown before Freighter sign. */
export function actionConfidence(action: ChatAction): {
  protocol: string;
  walletScope: string;
  risks: string[];
} {
  const type = action.type;
  let protocol = "Stellar";
  if (type.startsWith("steldex_")) protocol = "Unicorn StelDex";
  else if (type.startsWith("soroswap_")) protocol = "Soroswap";
  else if (type.startsWith("blend_")) protocol = "Blend";
  else if (type.startsWith("predict_")) protocol = "Orbit Predict (Soroban)";
  else if (type.startsWith("perp_")) protocol = "Orbit Perps (Soroban)";
  else if (type === "swap" || type === "send") protocol = "Stellar Classic (Horizon)";

  const risks: string[] = [
    "Testnet only — not mainnet funds",
    "Only your connected Freighter wallet can sign",
    "Orbit never custody balances — settlement is on-chain",
  ];

  if (type === "send") {
    risks.push("Payment is irreversible once confirmed");
    risks.push("Double-check the destination address");
  }
  if (
    type === "swap" ||
    type === "steldex_swap" ||
    type === "soroswap_swap"
  ) {
    risks.push("Receive amount is an estimate — slippage can apply");
    risks.push("Keep a small XLM reserve for network fees");
  }
  if (type.includes("liquidity") || type.includes("stake")) {
    risks.push("LP/farm positions can lose value if prices move (impermanent loss)");
    risks.push("Protocol rules (locks, fees) apply on StelDex/Soroswap");
  }
  if (type.startsWith("blend_")) {
    risks.push("Supply/borrow rates change with utilization");
    risks.push("Funds move into the Blend pool contract");
  }
  if (type.startsWith("predict_") || type.startsWith("perp_")) {
    risks.push("You can lose stake or margin — high risk");
  }

  const assetBits = [action.sendAsset, action.destAsset, action.pair]
    .filter(Boolean)
    .join(" / ");

  return {
    protocol,
    walletScope: assetBits
      ? `Affects: ${assetBits} on this wallet only`
      : "Affects this Freighter wallet only",
    risks,
  };
}

export function outcomeSummary(action: ChatAction): string {
  const title =
    action.type === "send"
      ? `Sent ${action.sendAmount ?? ""} ${action.sendAsset ?? ""}`
      : action.type.includes("swap")
        ? `Swapped ${action.sendAmount ?? ""} ${action.sendAsset ?? ""} → ${action.destAsset ?? ""}`
        : action.type.includes("liquidity")
          ? `Liquidity action on ${action.pair ?? action.sendAsset ?? "pool"}`
          : action.type.includes("stake")
            ? `Staked on ${action.pair ?? "farm"}`
            : action.type.startsWith("blend_")
              ? `Blend ${action.type.replace("blend_", "")} ${action.sendAmount ?? ""} ${action.sendAsset ?? ""}`
              : action.type.startsWith("predict_")
                ? `Prediction market action`
                : action.type.startsWith("perp_")
                  ? `Perps action`
                  : `On-chain action (${action.type})`;
  return `${title.trim()} — confirmed on Stellar Testnet`;
}
