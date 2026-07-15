/**
 * Structured DeFi concept graph - entities, relations, and Orbit action hints.
 * Complements RAG chunks for precise "X vs Y" and "what is X" answers.
 */

export type ConceptId =
 | "staking"
 | "liquidity_provision"
 | "yield_farming"
 | "lending"
 | "borrowing"
 | "spot_swap"
 | "perps"
 | "prediction"
 | "cex"
 | "defi"
 | "bridge"
 | "oracle"
 | "nft"
 | "trustline"
 | "impermanent_loss"
 | "liquidation"
 | "stablecoin"
 | "custody";

export type ConceptNode = {
 id: ConceptId;
 name: string;
 aliases: string[];
 summary: string;
 /** Concepts this is often confused with. */
 differsFrom: ConceptId[];
 /** Must usually happen before this (e.g. LP before farming). */
 prerequisites: ConceptId[];
 /** Related topics for further reading. */
 related: ConceptId[];
 /** Pasteable Orbit chat examples (testnet). */
 orbitHints: string[];
 riskNotes: string[];
};

export const CONCEPT_GRAPH: ConceptNode[] = [
 {
 id: "staking",
 name: "Single-asset staking",
 aliases: ["stake", "staking", "single asset stake"],
 summary:
 "Deposit one token to earn rewards. No second asset and no LP token required. Different from providing liquidity or farming LP.",
 differsFrom: ["liquidity_provision", "yield_farming", "lending"],
 prerequisites: [],
 related: ["yield_farming", "lending"],
 orbitHints: [
 "Single-asset stake ≠ LP farm. For StelDex rewards you usually LP first, then stake LP.",
 ],
 riskNotes: ["Reward rates vary", "Lockups may apply on some protocols"],
 },
 {
 id: "liquidity_provision",
 name: "Liquidity provision (LP)",
 aliases: ["lp", "liquidity", "provide liquidity", "add liquidity", "amm lp", "liquidity provision"],
 summary:
 "Deposit TWO assets into an AMM pool to earn trading fees. You receive LP tokens representing your share. This is not staking a single asset.",
 differsFrom: ["staking", "yield_farming", "spot_swap"],
 prerequisites: [],
 related: ["impermanent_loss", "yield_farming", "spot_swap"],
 orbitHints: [
 '"add 10 XLM and 10 pUSDC to liquidity on StelDex"',
 '"remove liquidity XLM/pUSDC"',
 ],
 riskNotes: ["Impermanent loss if prices diverge", "Pool smart-contract risk"],
 },
 {
 id: "yield_farming",
 name: "Yield farming",
 aliases: ["farm", "farming", "yield farm", "farm rewards", "yield farming"],
 summary:
 "Stake LP tokens in a farm to earn extra reward tokens. Usually requires providing liquidity first, then staking the LP.",
 differsFrom: ["staking", "liquidity_provision", "lending"],
 prerequisites: ["liquidity_provision"],
 related: ["staking", "impermanent_loss"],
 orbitHints: [
 '"add liquidity…" then "stake XLM/pUSDC for 52 weeks"',
 '"claim rewards from XLM/pUSDC"',
 ],
 riskNotes: ["Still exposed to IL while LP is in the pool", "Reward emissions can drop"],
 },
 {
 id: "lending",
 name: "Lending / supplying",
 aliases: ["lend", "lending", "supply", "supplying", "deposit lend"],
 summary:
 "Supply assets to a lending pool to earn interest paid by borrowers. Capital sits in the protocol; rates move with utilization.",
 differsFrom: ["staking", "borrowing", "liquidity_provision"],
 prerequisites: [],
 related: ["borrowing", "liquidation"],
 orbitHints: ['"supply 10 USDC on Blend"', '"withdraw 5 USDC on Blend"'],
 riskNotes: ["Smart-contract risk", "Rates are variable"],
 },
 {
 id: "borrowing",
 name: "Borrowing",
 aliases: ["borrow", "borrowing", "loan", "debt"],
 summary:
 "Borrow against collateral. If collateral value falls or debt rises, you can be liquidated. Higher risk than supplying alone.",
 differsFrom: ["lending", "perps"],
 prerequisites: ["lending"],
 related: ["liquidation", "perps"],
 orbitHints: ['"borrow 2 XLM on Blend"', '"repay 1 XLM on Blend"'],
 riskNotes: ["Liquidation risk", "Interest accrues on debt"],
 },
 {
 id: "spot_swap",
 name: "Spot swap",
 aliases: ["swap", "exchange", "convert", "trade spot", "spot"],
 summary:
 "Exchange one asset for another at the current market/AMM price. You hold the asset after the trade - no leverage.",
 differsFrom: ["perps", "liquidity_provision"],
 prerequisites: [],
 related: ["cex"],
 orbitHints: ['"swap 10 XLM to pUSDC"', '"aquarius quote 10 XLM to USDC"'],
 riskNotes: ["Slippage on thin pools", "Wrong asset code / trustline issues"],
 },
 {
 id: "perps",
 name: "Perpetual futures",
 aliases: ["perp", "perps", "perpetual", "futures", "leverage"],
 summary:
 "Leveraged long/short positions that track price without expiry. You can lose margin quickly via liquidation.",
 differsFrom: ["spot_swap", "prediction", "borrowing"],
 prerequisites: [],
 related: ["liquidation", "oracle"],
 orbitHints: ['"open a 200 USDC long on BTC at 5x"', '"close my btc perp" (SL/TP not enforced on-chain yet)'],
 riskNotes: ["High risk of total margin loss", "Funding rates", "Oracle dependency"],
 },
 {
 id: "prediction",
 name: "Prediction markets",
 aliases: ["prediction", "predict", "bet", "yes no market"],
 summary:
 "Stake on yes/no outcomes. After resolution, winning shares can be claimed. You can lose the full stake.",
 differsFrom: ["perps", "spot_swap"],
 prerequisites: [],
 related: ["oracle"],
 orbitHints: [
 '"list sports markets"',
 '"buy yes for Chelsea over Arsenal with 30 XLM"',
 '"bet 2 XLM yes on chelsea-arsenal-epl"',
 '"claim yes on chelsea-arsenal-epl" (after resolve)',
 ],
 riskNotes: ["Binary loss of stake", "Resolution / liquidity risk"],
 },
 {
 id: "cex",
 name: "Centralized exchange (CEX)",
 aliases: ["cex", "centralized exchange", "binance", "coinbase", "kraken", "cefi exchange"],
 summary:
 "Company-run order book with custodial balances and usually KYC. Convenient fiat on-ramps; you trust the exchange.",
 differsFrom: ["defi"],
 prerequisites: [],
 related: ["custody", "defi"],
 orbitHints: [
 "Withdraw to your Stellar wallet on the correct network, then use Orbit for on-chain DeFi",
 ],
 riskNotes: ["Custody / insolvency risk", "Withdraw freezes", "Wrong-network withdrawals"],
 },
 {
 id: "defi",
 name: "Decentralized finance (DeFi)",
 aliases: ["defi", "decentralized finance", "onchain finance", "on-chain finance"],
 summary:
 "Financial apps as smart contracts: swaps, lending, farms. Self-custody via your wallet; composable but code/oracle risk.",
 differsFrom: ["cex"],
 prerequisites: [],
 related: ["spot_swap", "lending", "liquidity_provision", "custody"],
 orbitHints: ["Ask Orbit to swap, LP, supply on Blend, or open a perp on Stellar Testnet"],
 riskNotes: ["Smart-contract bugs", "Oracle failures", "UX mistakes (wrong asset)"],
 },
 {
 id: "bridge",
 name: "Cross-chain bridge",
 aliases: ["bridge", "bridging", "cross chain", "cross-chain", "wormhole"],
 summary:
 "Moves value between blockchains (lock/mint or liquidity networks). Powerful but historically a major hack target.",
 differsFrom: ["spot_swap"],
 prerequisites: [],
 related: ["stablecoin", "custody"],
 orbitHints: [
 "Orbit does not execute bridges - education only; execution stays on Stellar testnet",
 ],
 riskNotes: ["Bridge hacks", "Wrapped asset peg risk", "Long finality delays"],
 },
 {
 id: "oracle",
 name: "Price oracle",
 aliases: ["oracle", "price feed", "price oracle", "reflector"],
 summary:
 "On-chain price feeds used by lending, perps, and liquidations. Stale or manipulated feeds cause bad liquidations/trades.",
 differsFrom: [],
 prerequisites: [],
 related: ["lending", "perps", "liquidation"],
 orbitHints: ['"price of XLM"', "Reflector-backed market snapshots in chat"],
 riskNotes: ["Stale prices", "Feed downtime", "Manipulation on thin markets"],
 },
 {
 id: "nft",
 name: "NFT",
 aliases: ["nft", "nfts", "non fungible", "collectible"],
 summary:
 "Unique on-chain tokens (art, membership, receipts). Prices are illiquid; metadata quality varies.",
 differsFrom: ["spot_swap"],
 prerequisites: [],
 related: ["custody"],
 orbitHints: [
 '"mint an NFT called …"',
 '"list NFT #1 for 5 XLM"',
 '"view my NFTs"',
 '"claim my beta NFT" (once - only if eligible and not already claimed)',
 ],
 riskNotes: ["Illiquidity", "Metadata mutability"],
 },
 {
 id: "trustline",
 name: "Stellar trustline",
 aliases: ["trustline", "trust line", "asset trust"],
 summary:
 "On Stellar Classic, a trustline authorizes holding a non-XLM asset from an issuer. It locks a small XLM reserve.",
 differsFrom: [],
 prerequisites: [],
 related: ["spot_swap", "stablecoin"],
 orbitHints: ["Orbit may prompt add-trustline before a swap destination settles"],
 riskNotes: ["Reserve XLM locked", "Wrong issuer = wrong asset"],
 },
 {
 id: "impermanent_loss",
 name: "Impermanent loss",
 aliases: ["impermanent loss", "il", "impermanent"],
 summary:
 "Opportunity cost of LP vs holding the two assets when relative prices move. Fees can offset IL but do not remove it.",
 differsFrom: [],
 prerequisites: ["liquidity_provision"],
 related: ["liquidity_provision", "yield_farming"],
 orbitHints: ['Ask "calculate IL if price doubles" or "IL if token drops 50%"'],
 riskNotes: ["Realized when you withdraw after a move", "Volatile pairs → larger IL"],
 },
 {
 id: "liquidation",
 name: "Liquidation",
 aliases: ["liquidation", "liquidated", "health factor", "ltv"],
 summary:
 "Forced close when collateral no longer safely covers debt (lending) or margin (perps). Liquidators repay debt and seize collateral.",
 differsFrom: [],
 prerequisites: [],
 related: ["borrowing", "perps", "oracle"],
 orbitHints: ['Ask "explain health factor" or "health if collateral 100 debt 40"'],
 riskNotes: ["Can crystallize large losses instantly", "Oracle moves matter"],
 },
 {
 id: "stablecoin",
 name: "Stablecoin",
 aliases: ["stablecoin", "usdc", "usdt", "dai", "eurc", "peg"],
 summary:
 "Token designed to track fiat (usually USD). Mechanisms: fiat reserves, crypto collateral, or algorithms. Pegs can break.",
 differsFrom: [],
 prerequisites: [],
 related: ["cex", "bridge", "lending"],
 orbitHints: [
 "On Orbit: USDC ≈ cUSDC (Circle path); pUSDC is a different StelDex test asset",
 ],
 riskNotes: ["Depeg risk", "Issuer / reserve transparency"],
 },
 {
 id: "custody",
 name: "Custody models",
 aliases: ["custody", "custodial", "non custodial", "self custody", "non-custodial"],
 summary:
 "Custodial = a company holds keys (CEX). Non-custodial = you sign with your wallet (DeFi). Orbit never holds your balances.",
 differsFrom: [],
 prerequisites: [],
 related: ["cex", "defi"],
 orbitHints: ["Connect Freighter or Orbit embedded wallet - you sign every tx"],
 riskNotes: ["Seed phrase loss = fund loss", "Phishing sites steal keys"],
 },
];

const BY_ID = new Map(CONCEPT_GRAPH.map((c) => [c.id, c]));

function norm(s: string): string {
 return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Resolve a free-text hint to a concept node. */
export function lookupConcept(hint: string): ConceptNode | null {
 const q = norm(hint);
 if (!q) return null;

 for (const c of CONCEPT_GRAPH) {
 if (norm(c.name) === q || c.id.replace(/_/g, " ") === q) return c;
 if (c.aliases.some((a) => norm(a) === q)) return c;
 }

 // Substring / contains (longest alias wins)
 let best: { c: ConceptNode; len: number } | null = null;
 for (const c of CONCEPT_GRAPH) {
 for (const a of [c.name, ...c.aliases, c.id.replace(/_/g, " ")]) {
 const na = norm(a);
 if (na.length < 3) continue;
 if (q.includes(na) || na.includes(q)) {
 if (!best || na.length > best.len) best = { c, len: na.length };
 }
 }
 }
 return best?.c ?? null;
}

export function formatConcept(c: ConceptNode): string {
 const byId = (id: ConceptId) => BY_ID.get(id)?.name ?? id;
 const lines = [
 `**${c.name}**`,
 "",
 c.summary,
 "",
 ];
 if (c.prerequisites.length) {
 lines.push(`Prerequisites: ${c.prerequisites.map(byId).join(", ")}`);
 }
 if (c.differsFrom.length) {
 lines.push(`Often confused with: ${c.differsFrom.map(byId).join(", ")}`);
 }
 if (c.related.length) {
 lines.push(`Related: ${c.related.map(byId).join(", ")}`);
 }
 if (c.riskNotes.length) {
 lines.push("", "Risks:", ...c.riskNotes.map((r) => `• ${r}`));
 }
 if (c.orbitHints.length) {
 lines.push("", "Try on Orbit (Testnet):", ...c.orbitHints.map((h) => `• ${h}`));
 }
 lines.push("", "── Sources ──", `1. ${c.name} - Orbit Concept Graph`);
 return lines.join("\n");
}

export function compareConcepts(a: ConceptNode, b: ConceptNode): string {
 const lines = [
 `**${a.name} vs ${b.name}**`,
 "",
 `${a.name}: ${a.summary}`,
 "",
 `${b.name}: ${b.summary}`,
 "",
 "Key difference:",
 ];

 if (a.id === "staking" && b.id === "liquidity_provision") {
 lines.push("• Staking = one asset. LP = two assets into a pool (fees + IL risk).");
 } else if (
 (a.id === "staking" && b.id === "yield_farming") ||
 (b.id === "staking" && a.id === "yield_farming")
 ) {
 lines.push("• Farming usually stakes LP tokens after providing liquidity - not the same as single-asset stake.");
 } else if (
 (a.id === "liquidity_provision" && b.id === "yield_farming") ||
 (b.id === "liquidity_provision" && a.id === "yield_farming")
 ) {
 lines.push("• LP earns swap fees; farming stakes those LP tokens for extra rewards. Order: LP → then farm.");
 } else if (
 (a.id === "defi" && b.id === "cex") ||
 (b.id === "defi" && a.id === "cex")
 ) {
 lines.push("• CEX = custodial company order book. DeFi = self-custody smart contracts.");
 } else if (
 (a.id === "lending" && b.id === "borrowing") ||
 (b.id === "lending" && a.id === "borrowing")
 ) {
 lines.push("• Supplying earns interest; borrowing creates debt and liquidation risk.");
 } else if (
 (a.id === "spot_swap" && b.id === "perps") ||
 (b.id === "spot_swap" && a.id === "perps")
 ) {
 lines.push("• Spot buys the asset; perps are leveraged bets that can be liquidated.");
 } else {
 lines.push(`• ${a.name} and ${b.name} solve different jobs - do not use them interchangeably.`);
 }

 const hints = [...a.orbitHints.slice(0, 1), ...b.orbitHints.slice(0, 1)];
 if (hints.length) {
 lines.push("", "Try on Orbit (Testnet):", ...hints.map((h) => `• ${h}`));
 }
 lines.push(
 "",
 "── Sources ──",
 `1. ${a.name} - Orbit Concept Graph`,
 `2. ${b.name} - Orbit Concept Graph`
 );
 return lines.join("\n");
}

const COMPARE_RE =
 /\b(?:difference\s+between|differ(?:ence)?\s+between|compare)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+?)(?:\?|$)/i;
const VS_RE = /^(.+?)\s+vs\.?\s+(.+?)(?:\?|$)/i;

/**
 * Answer concept-graph questions (compare / lookup).
 * Returns null when no confident graph match.
 */
export function tryConceptAnswer(content: string): string | null {
 const t = content.trim();
 if (!t) return null;

 const cmp = t.match(COMPARE_RE) ?? t.match(VS_RE);
 if (cmp) {
 const left = lookupConcept(cmp[1]);
 const right = lookupConcept(cmp[2]);
 if (left && right && left.id !== right.id) return compareConcepts(left, right);
 }

 // "what is X" / "explain X" - only when a concept clearly matches
 const topic = t
 .replace(
 /^(?:what(?:'s|\s+is|\s+are)|whats|explain|define|tell\s+me\s+about|how\s+does|how\s+do)\s+/i,
 ""
 )
 .replace(/\?+$/, "")
 .trim();

 if (topic && topic.length >= 2 && topic.length <= 60) {
 const node = lookupConcept(topic);
 // Require strong match: alias/name contained as whole-ish phrase
 if (node) {
 const nTopic = norm(topic);
 const strong = [node.name, ...node.aliases].some((a) => {
 const na = norm(a);
 return nTopic === na || nTopic.includes(na) || na.includes(nTopic);
 });
 if (strong) return formatConcept(node);
 }
 }

 return null;
}
