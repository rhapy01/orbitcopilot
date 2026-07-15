/**
 * Detailed post-success explanations (narrative, not link dumps).
 * Shown as a follow-up assistant message after the tx lands on-chain.
 */

export type TeachProtocol = "blend" | "orbit_supply" | null;

export type TeachLesson = {
  title: string;
  /** Markdown body - full explanation for the chat bubble */
  markdown: string;
};

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

export function teachLessonForAction(type: string): TeachLesson | null {
  const protocol = teachProtocolForAction(type);
  if (!protocol) return null;
  return protocol === "blend"
    ? blendTeachAfterSuccess(type)
    : orbitSupplyTeachAfterSuccess(type);
}

export function blendTeachAfterSuccess(actionType: string): TeachLesson {
  const whatYouDid =
    actionType === "blend_claim"
      ? "You just claimed Blend emissions (BLND rewards) tied to your supply and/or borrow activity in the pool."
      : actionType === "blend_withdraw"
        ? "You just withdrew collateral from Blend, which reduces how much you can borrow and may free assets back to your wallet."
        : actionType === "blend_borrow"
          ? "You just borrowed against your Blend collateral. That debt accrues interest until you repay."
          : actionType === "blend_repay"
            ? "You just repaid Blend debt, which improves your health and frees borrowing capacity."
            : "You just supplied assets into Blend as collateral. Those tokens now sit in the pool earning interest and can back a borrow.";

  return {
    title: "Understanding Blend",
    markdown: [
      "**Understanding Blend**",
      "",
      whatYouDid,
      "",
      "Blend is a **lending and borrowing protocol** on Stellar (Soroban). Think of it as a shared pool of assets: lenders/suppliers deposit tokens, borrowers take loans against collateral they posted, and interest rates balance supply and demand automatically.",
      "",
      "**How supplying works.** When you supply (what Orbit usually does in collateral mode), your assets go into the pool. Borrowers can use liquidity from that pool. In return you earn a supply rate that rises when the pool is heavily used and falls when lots of capital sits idle. Your deposit also counts as collateral, so you can borrow other assets without selling what you hold.",
      "",
      "**How borrowing works.** Borrowing lets you pull liquidity while keeping your collateral. You must stay over-collateralized: the value of what you posted has to stay comfortably above what you owe. Blend (like other money markets) watches a health / LTV-style measure. If prices move against you or interest piles up and you drift too close to the limit, liquidators can repay part of your debt and seize collateral - that is the main risk of leverage.",
      "",
      "**Rates and utilization.** Utilization is \"how much of the pool is borrowed.\" High utilization pushes borrow APR up (to discourage more borrowing and attract more supply) and usually improves supply APY. Low utilization does the opposite. Rates are market-driven, not fixed promises.",
      "",
      "**On Orbit's testnet path.** The live Blend pool Orbit targets accepts **Circle USDC** and native **XLM** (the same tokens in your Freighter / Orbit wallet), not a fake separate \"Blend-only\" USDC. So a supply of 100 USDC here really is your wallet USDC becoming pool collateral you can later borrow against, withdraw, or leave to earn.",
      "",
      "If you want to go further: ask to **borrow**, **repay**, **withdraw**, check **Blend health**, or **claim** emissions. Keep a buffer if you borrow - testnet is for practice, but the mechanics mirror real lending risk.",
    ].join("\n"),
  };
}

export function orbitSupplyTeachAfterSuccess(actionType: string): TeachLesson {
  if (actionType === "orbit_supply_claim") {
    return {
      title: "Understanding Orbit Supply",
      markdown: [
        "**Understanding Orbit Supply**",
        "",
        "You just claimed accrued **XLM rewards** from the Orbit Supply vault.",
        "",
        "Orbit Supply is **not** a lending market like Blend. It is Orbit's own fixed-yield vault: you deposit supported assets, leave them staked in the contract, and the vault pays a **flat reward schedule** from a treasury funded with XLM.",
        "",
        "**The rate.** For every **1,000,000** units of USDC, pUSDC, or EURC you keep deposited, you earn **10 XLM per full 24-hour period**. Smaller deposits earn proportionally (example: 100,000 USDC → about 1 XLM per day). Rewards only vest in whole day windows - that is why claims are day-gated.",
        "",
        "You can claim again after another day if you stay deposited. Principal stays yours until you withdraw it with a separate withdraw action.",
      ].join("\n"),
    };
  }

  if (actionType === "orbit_supply_withdraw") {
    return {
      title: "Understanding Orbit Supply",
      markdown: [
        "**Understanding Orbit Supply**",
        "",
        "You just withdrew principal from the Orbit Supply vault back to your wallet.",
        "",
        "While those funds were deposited, they were accruing a **fixed XLM yield**: 10 XLM per 1,000,000 deposited assets per 24 hours, paid from Orbit's reward treasury - not from borrowers like on Blend.",
        "",
        "Withdrawing stops that deposit from earning further. You can deposit again anytime (\"supply … on orbit-supply\") and claim any vested yield with \"claim my yield\" after each 24h window.",
      ].join("\n"),
    };
  }

  return {
    title: "Understanding Orbit Supply",
    markdown: [
      "**Understanding Orbit Supply**",
      "",
      "Your deposit is now in the **Orbit Supply** vault on Stellar testnet.",
      "",
      "Orbit Supply is Orbit's **fixed-yield vault**. Unlike Blend (where you earn variable interest because borrowers pay for liquidity), Orbit Supply pays a simple, predictable XLM reward from a treasury we fund on the contract. You are not lending to other users' borrows here - you are staking into Orbit's yield contract.",
      "",
      "**What you earn.** Rate is **10 XLM per 1,000,000** USDC / pUSDC / EURC deposited, per full **24 hours**. Scale linearly with your stake. After each day window, say **\"claim my yield\"** to pull XLM into your wallet. Principal stays deposited until you withdraw it.",
      "",
      "**Why it exists.** It gives a clear, demo-friendly yield loop on testnet so you can practice deposit → wait → claim without learning variable money-market rates first. Blend is still the place for real lending/borrowing dynamics; Orbit Supply is the simple \"park assets, earn fixed XLM\" path.",
      "",
      "Allowed assets today: Circle **USDC**, StelDex **pUSDC**, and **EURC**. Ask \"orbit supply\" anytime for your stakes and pending claim.",
    ].join("\n"),
  };
}
