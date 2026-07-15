import { buildPortfolioIntel, type PortfolioIntel } from "./portfolio-intel";
import {
 getLastIntent,
 getLastOutcome,
 type StoredIntent,
 type StoredOutcome,
} from "./product-store";

export type GoldenStep = "connect" | "fund" | "deploy" | "done";

export type CoachMove = {
 title: string;
 reason: string;
 command: string;
 from: string;
 to: string;
 protocol: string;
 riskNotes: string[];
};

export type CoachResponse = {
 wallet: string;
 network: "testnet";
 idleAssets: { asset: string; amount: string; note: string }[];
 idleCount: number;
 earningCount: number;
 headline: string;
 opportunity: string;
 primaryMove: CoachMove | null;
 goldenPath: {
 step: GoldenStep;
 label: string;
 steps: { id: GoldenStep; label: string; done: boolean }[];
 };
 lastIntent: StoredIntent | null;
 lastOutcome: StoredOutcome | null;
};

function risksForCommand(command: string, protocol: string): string[] {
 const notes = [
 "Testnet only - no real mainnet funds",
 `Signs with your connected wallet only`,
 `Settles on ${protocol} - Orbit never holds balances`,
 ];
 const c = command.toLowerCase();
 if (c.includes("liquidity") || c.includes("swap") || c.includes("lp")) {
 notes.push("Price can move (slippage); review amounts before signing");
 notes.push("Network fee: small XLM reserve required");
 }
 if (c.includes("blend") || c.includes("supply") || c.includes("borrow")) {
 notes.push("Lending markets can change rates; capital is in the Blend pool contract");
 }
 if (c.includes("stake") || c.includes("farm")) {
 notes.push("Farm rewards vary; unstaking may have lock rules on the protocol");
 }
 if (c.includes("predict") || c.includes("bet") || c.includes("perp")) {
 notes.push("You can lose the stake/margin - high risk");
 }
 if (c.includes("fund") || c.includes("friendbot")) {
 return [
 "Friendbot sends free Testnet XLM",
 "No signature required for funding",
 "Testnet only",
 ];
 }
 notes.push("Transactions are irreversible once confirmed on-chain");
 return notes;
}

function idleWalletAssets(intel: PortfolioIntel) {
 return intel.positions
 .filter((p) => p.status === "idle" && p.kind === "wallet")
 .map((p) => ({
 asset: p.asset,
 amount: p.amount,
 note: p.note,
 }));
}

function pickPrimaryMove(intel: PortfolioIntel): CoachMove | null {
 const move = intel.moves[0];
 if (!move) return null;

 let protocol = "Stellar";
 const cmd = move.command.toLowerCase();
 if (cmd.includes("blend")) protocol = "Blend";
 else if (cmd.includes("steldex") || cmd.includes("liquidity") || cmd.includes("stake"))
 protocol = "StelDex";
 else if (cmd.includes("soroswap")) protocol = "Soroswap";
 else if (cmd.includes("yield")) protocol = "Orbit";

 return {
 title: `${move.from} → ${move.to}`,
 reason: move.reason,
 command: move.command,
 from: move.from,
 to: move.to,
 protocol,
 riskNotes: risksForCommand(move.command, protocol),
 };
}

function goldenPath(
 hasAccount: boolean,
 idleCount: number,
 earningCount: number,
 xlmIdle: number
): CoachResponse["goldenPath"] {
 let step: GoldenStep = "deploy";
 if (!hasAccount || xlmIdle < 1) step = "fund";
 else if (earningCount > 0 && idleCount === 0) step = "done";
 else if (earningCount > 0) step = "deploy";
 else step = "deploy";

 const steps: CoachResponse["goldenPath"]["steps"] = [
 { id: "connect", label: "Connect wallet", done: true },
 {
 id: "fund",
 label: "Fund Testnet XLM",
 done: hasAccount && xlmIdle >= 1,
 },
 {
 id: "deploy",
 label: "Deploy idle capital",
 done: earningCount > 0,
 },
 {
 id: "done",
 label: "Earning on-chain",
 done: earningCount > 0 && idleCount === 0,
 },
 ];

 const labels: Record<GoldenStep, string> = {
 connect: "Connect Freighter or Orbit wallet",
 fund: "Fund your wallet (Friendbot) - free Testnet XLM",
 deploy: "Put idle capital to work with one recommended move",
 done: "Capital is earning - review or rebalance anytime",
 };

 return { step, label: labels[step], steps };
}

/** Idle capital coach - hero product surface for connected wallets. */
export async function buildCoach(publicKey: string): Promise<CoachResponse> {
 const intel = await buildPortfolioIntel(publicKey);
 const idleAssets = idleWalletAssets(intel);
 const idleCount = intel.summary.idle;
 const earningCount = intel.summary.earning;
 const xlmIdle = parseFloat(
 idleAssets.find((a) => a.asset === "XLM")?.amount ?? "0"
 );
 const hasAccount = intel.positions.length > 0 || xlmIdle > 0;

 // Account missing entirely (friendbot never run)
 const noFunds = !hasAccount || (xlmIdle < 1 && idleAssets.length === 0);

 let primaryMove = pickPrimaryMove(intel);
 if (noFunds) {
 primaryMove = {
 title: "Fund wallet → start",
 reason: "No Testnet balance yet. Friendbot gives free XLM so you can act on-chain.",
 command: "Fund my wallet",
 from: "Empty wallet",
 to: "Funded Testnet wallet",
 protocol: "Friendbot",
 riskNotes: risksForCommand("fund my wallet", "Friendbot"),
 };
 }

 const idleSummary = idleAssets
 .map((a) => `${a.amount} ${a.asset}`)
 .join(", ");

 let headline: string;
 let opportunity: string;
 const borrowingCount = intel.summary.borrowing;

 if (noFunds) {
 headline = "Your wallet isn’t funded yet";
 opportunity =
 "One tap funds Testnet XLM via Friendbot - then Orbit can put idle capital to work.";
 } else if (borrowingCount > 0) {
 headline =
 idleCount > 0
 ? "You have borrows - watch liquidation risk"
 : "Open Blend debt - check health";
 opportunity =
 `${borrowingCount} borrowing position(s). Ask “blend health” for an educational health-factor estimate, or repay on Blend to reduce risk.` +
 (idleSummary ? ` Still idle: ${idleSummary}.` : "");
 } else if (earningCount === 0 && idleCount > 0) {
 headline = "You have idle capital";
 opportunity = idleSummary
 ? `${idleSummary} is sitting in your wallet - not earning.`
 : "Balances are idle - deploy a portion to start earning.";
 } else if (earningCount > 0 && idleCount > 0) {
 headline = "Part of your capital is still idle";
 opportunity = idleSummary
 ? `Earning positions: ${earningCount}. Still idle: ${idleSummary}.`
 : `${idleCount} idle position(s) could be deployed.`;
 } else if (earningCount > 0) {
 headline = "Your capital is earning on-chain";
 opportunity = `${earningCount} earning position(s). Ask Orbit to rebalance or claim rewards.`;
 } else {
 headline = "No positions detected";
 opportunity = "Fund the wallet or ask “What’s in my portfolio?”";
 }

 // Prefer repay guidance when borrowed and no better idle deploy
 if (borrowingCount > 0 && !noFunds) {
 const borrowPos = intel.positions.find((p) => p.status === "borrowing");
 if (borrowPos?.suggestion) {
 primaryMove = {
 title: `${borrowPos.asset} debt → reduce risk`,
 reason: "Open borrow increases liquidation risk - review health or repay.",
 command: borrowPos.suggestion.startsWith("repay")
 ? borrowPos.suggestion
 : "blend health",
 from: "Borrowing",
 to: "Safer health factor",
 protocol: borrowPos.protocol,
 riskNotes: risksForCommand("repay on Blend", "Blend"),
 };
 } else if (!primaryMove || idleCount === 0) {
 primaryMove = {
 title: "Check Blend health",
 reason: "You have borrow exposure - estimate health before adding risk.",
 command: "blend health",
 from: "Borrowing",
 to: "Risk check",
 protocol: "Blend",
 riskNotes: risksForCommand("borrow on Blend", "Blend"),
 };
 }
 }

 const [lastIntent, lastOutcome] = await Promise.all([
 getLastIntent(publicKey),
 getLastOutcome(publicKey),
 ]);

 return {
 wallet: publicKey,
 network: "testnet",
 idleAssets,
 idleCount,
 earningCount,
 headline,
 opportunity,
 primaryMove,
 goldenPath: goldenPath(!noFunds, idleCount, earningCount, xlmIdle),
 lastIntent,
 lastOutcome,
 };
}

/**
 * Compact coach snapshot for the LLM system prompt.
 * Failures return null so chat never blocks on portfolio intel.
 */
export async function formatCoachBriefForLlm(
 publicKey: string
): Promise<string | null> {
 try {
 const coach = await buildCoach(publicKey);
 const lines = [
 `Coach headline: ${coach.headline}`,
 `Opportunity: ${coach.opportunity}`,
 `Idle positions: ${coach.idleCount}; earning: ${coach.earningCount}`,
 `Golden path step: ${coach.goldenPath.step} - ${coach.goldenPath.label}`,
 ];
 if (coach.idleAssets.length) {
 lines.push(
 `Idle assets: ${coach.idleAssets.map((a) => `${a.amount} ${a.asset}`).join(", ")}`
 );
 }
 if (coach.primaryMove) {
 lines.push(
 `Primary move: ${coach.primaryMove.title} (${coach.primaryMove.protocol}). Reason: ${coach.primaryMove.reason}. Suggested chat command: "${coach.primaryMove.command}"`
 );
 }
 return lines.join("\n");
 } catch {
 return null;
 }
}
