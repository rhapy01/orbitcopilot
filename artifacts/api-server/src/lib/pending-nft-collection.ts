/**
 * Multi-turn NFT collection create wizard.
 * Flow: basics (name/supply) → description/traits → media → action card.
 */

import { getNftWizardDraft, setNftWizardDraft } from "./chat-store";

export type NftCollectionWizardStep =
  | "awaiting_basics"
  | "awaiting_details"
  | "awaiting_media";

export type PendingNftCollectionDraft = {
  name: string;
  symbol: string;
  maxSupply: number;
  supplySpecified: boolean;
  royaltyBps: number;
  description?: string;
  traits?: string;
  website?: string;
  imageUrl?: string;
  /** Prefer attach-on-card when user said they'll upload. */
  preferUpload?: boolean;
  publicMintPriceXlm?: string;
  allowlistMintPriceXlm?: string;
  maxMintPerWallet?: number;
  allowlistActive?: boolean;
  publicMintActive?: boolean;
  step: NftCollectionWizardStep;
  createdAt: number;
};

const NFT_DEFAULT_ROYALTY_BPS = 250;
const drafts = new Map<string, PendingNftCollectionDraft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

export function nftCollectionDraftKey(
  publicKey: string | null,
  sessionId?: number
): string {
  if (sessionId != null && Number.isFinite(sessionId)) return `session:${sessionId}`;
  if (publicKey) return `wallet:${publicKey}`;
  return "anon";
}

function sessionIdFromDraftKey(key: string): number | null {
  const m = key.match(/^session:(\d+)$/);
  if (!m?.[1]) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isExpired(d: PendingNftCollectionDraft): boolean {
  return Date.now() - d.createdAt > DRAFT_TTL_MS;
}

function coerceDraft(raw: Record<string, unknown>): PendingNftCollectionDraft | null {
  const step = raw.step;
  if (
    step !== "awaiting_basics" &&
    step !== "awaiting_details" &&
    step !== "awaiting_media"
  ) {
    return null;
  }
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now();
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    symbol: typeof raw.symbol === "string" ? raw.symbol : "",
    maxSupply:
      typeof raw.maxSupply === "number" && Number.isFinite(raw.maxSupply)
        ? raw.maxSupply
        : 0,
    supplySpecified: Boolean(raw.supplySpecified),
    royaltyBps:
      typeof raw.royaltyBps === "number" && Number.isFinite(raw.royaltyBps)
        ? raw.royaltyBps
        : NFT_DEFAULT_ROYALTY_BPS,
    description: typeof raw.description === "string" ? raw.description : undefined,
    traits: typeof raw.traits === "string" ? raw.traits : undefined,
    website: typeof raw.website === "string" ? raw.website : undefined,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : undefined,
    preferUpload: Boolean(raw.preferUpload),
    publicMintPriceXlm:
      typeof raw.publicMintPriceXlm === "string" ? raw.publicMintPriceXlm : undefined,
    allowlistMintPriceXlm:
      typeof raw.allowlistMintPriceXlm === "string" ? raw.allowlistMintPriceXlm : undefined,
    maxMintPerWallet:
      typeof raw.maxMintPerWallet === "number" && Number.isFinite(raw.maxMintPerWallet)
        ? raw.maxMintPerWallet
        : undefined,
    allowlistActive: Boolean(raw.allowlistActive),
    publicMintActive:
      raw.publicMintActive != null ? Boolean(raw.publicMintActive) : undefined,
    step,
    createdAt,
  };
}

export function setNftCollectionDraft(
  key: string,
  value: Omit<PendingNftCollectionDraft, "createdAt">
): void {
  drafts.set(key, { ...value, createdAt: Date.now() });
}

export function clearNftCollectionDraft(key: string): void {
  drafts.delete(key);
}

export function getNftCollectionDraft(
  key: string
): PendingNftCollectionDraft | null {
  const d = drafts.get(key);
  if (!d) return null;
  if (isExpired(d)) {
    drafts.delete(key);
    return null;
  }
  return d;
}

export async function loadNftCollectionDraft(
  key: string
): Promise<PendingNftCollectionDraft | null> {
  const cached = getNftCollectionDraft(key);
  if (cached) return cached;

  const sessionId = sessionIdFromDraftKey(key);
  if (!sessionId) return null;

  try {
    const raw = await getNftWizardDraft(sessionId);
    if (!raw) return null;
    const draft = coerceDraft(raw);
    if (!draft || isExpired(draft)) {
      await setNftWizardDraft(sessionId, null);
      return null;
    }
    drafts.set(key, draft);
    return draft;
  } catch {
    return null;
  }
}

export async function saveNftCollectionDraft(
  key: string,
  value: Omit<PendingNftCollectionDraft, "createdAt">
): Promise<void> {
  const draft: PendingNftCollectionDraft = { ...value, createdAt: Date.now() };
  setNftCollectionDraft(key, value);

  const sessionId = sessionIdFromDraftKey(key);
  if (!sessionId) return;

  try {
    await setNftWizardDraft(sessionId, draft as unknown as Record<string, unknown>);
  } catch {
    // In-memory draft still works on a warm instance.
  }
}

export async function removeNftCollectionDraft(key: string): Promise<void> {
  clearNftCollectionDraft(key);
  const sessionId = sessionIdFromDraftKey(key);
  if (!sessionId) return;
  try {
    await setNftWizardDraft(sessionId, null);
  } catch {
    // ignore
  }
}

/** True when the prior assistant turn was the collection basics prompt. */
export function isCollectionBasicsPrompt(text: string): boolean {
  return (
    /let'?s create your nft collection/i.test(text) &&
    /collection name/i.test(text)
  );
}

/** Parse freeform basics replies like "Collection Name: X, supply is 777, symbol CER". */
export function parseCollectionBasicsReply(content: string): {
  name: string;
  symbol: string;
  maxSupply: number;
  supplySpecified: boolean;
  nameSpecified: boolean;
  royaltyBps: number;
  publicMintPriceXlm?: string;
  allowlistMintPriceXlm?: string;
  maxMintPerWallet?: number;
} {
  let name =
    content.match(/\b(?:collection\s+name|name)\s*[:=]\s*([^,\n]+)/i)?.[1]?.trim() ||
    content.match(/^([^,\n]+?)(?:\s*,\s*(?:supply|max|symbol|total))/i)?.[1]?.trim() ||
    "";
  name = name.replace(/^["']|["']$/g, "").trim().slice(0, 64);

  const symbolMatch = content.match(
    /\b(?:symbol|ticker)\s*(?:is|=|:)?\s*([A-Za-z0-9]{1,12})\b/i
  );
  const symbol = (
    symbolMatch?.[1] ||
    name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) ||
    "ORB"
  )
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "ORB";

  const unlimited = /\b(?:unlimited|no\s+max(?:\s+supply)?)\b/i.test(content);
  const supplyMatch = content.match(
    /\b(?:total\s+supply|max(?:\s+supply)?|supply)\s*(?:is|=|:)?\s*(\d+)\b/i
  );
  const supplySpecified = unlimited || Boolean(supplyMatch?.[1]);
  const maxSupply = unlimited
    ? 0
    : supplyMatch?.[1]
      ? Math.max(0, parseInt(supplyMatch[1], 10) || 0)
      : 0;

  const mintPriceMatch = content.match(
    /\b(?:public\s+)?(?:mint(?:ing)?\s+)?price\s*(?:is|=|:)?\s*([\d.]+)\s*(?:xlm)?\b/i
  );
  const allowPriceMatch = content.match(
    /\b(?:allowlist|presale|private)\s+(?:mint(?:ing)?\s+)?price\s*(?:is|=|:)?\s*([\d.]+)\s*(?:xlm)?\b/i
  );
  const maxPerWalletMatch = content.match(
    /\b(?:max\s+)?(?:mint(?:s)?\s+per\s+wallet|per\s+wallet)\s*(?:is|=|:)?\s*(\d+)\b/i
  );
  const publicMintPriceXlm = mintPriceMatch?.[1];
  const allowlistMintPriceXlm = allowPriceMatch?.[1];
  const maxMintPerWallet = maxPerWalletMatch?.[1]
    ? parseInt(maxPerWalletMatch[1], 10)
    : undefined;

  const royaltyMatch = content.match(/\broyalty\s+(\d+(?:\.\d+)?)\s*%?/i);
  let royaltyBps = NFT_DEFAULT_ROYALTY_BPS;
  if (royaltyMatch?.[1]) {
    const pct = parseFloat(royaltyMatch[1]);
    if (Number.isFinite(pct)) {
      royaltyBps =
        pct > 10 && pct <= 1000 && !/%/.test(royaltyMatch[0])
          ? Math.round(pct)
          : Math.round(pct * 100);
      royaltyBps = Math.max(0, Math.min(1000, royaltyBps));
    }
  }

  return {
    name,
    symbol,
    maxSupply,
    supplySpecified,
    nameSpecified: name.length >= 2,
    royaltyBps,
    publicMintPriceXlm,
    allowlistMintPriceXlm,
    maxMintPerWallet,
  };
}

export function isCancelWizard(content: string): boolean {
  return /^(cancel|nevermind|never\s*mind|stop|abort)\s*!?\s*$/i.test(
    content.trim()
  );
}

export function isUploadIntent(content: string): boolean {
  return /\b(upload|attach|file|from\s+(my\s+)?(computer|phone|device)|i'?ll\s+upload|i\s+will\s+upload)\b/i.test(
    content
  );
}

export function extractImageUrl(content: string): string | undefined {
  const m = content.match(/https?:\/\/\S+/i);
  return m?.[0]?.replace(/[),.]+$/, "") || undefined;
}

/** Pull rarity / traits lines from a freeform description reply. */
export function parseDetailsReply(content: string): {
  description: string;
  traits?: string;
  website?: string;
  royaltyBps?: number;
} {
  const royaltyMatch = content.match(/\broyalty\s+(\d+(?:\.\d+)?)\s*%?/i);
  let royaltyBps: number | undefined;
  if (royaltyMatch?.[1]) {
    const pct = parseFloat(royaltyMatch[1]);
    if (Number.isFinite(pct)) {
      royaltyBps =
        pct > 10 && pct <= 1000 && !/%/.test(royaltyMatch[0])
          ? Math.round(pct)
          : Math.round(pct * 100);
      royaltyBps = Math.max(0, Math.min(1000, royaltyBps));
    }
  }

  const website = content.match(/\bwebsite\s+(https?:\/\/\S+)/i)?.[1]?.replace(
    /[),.]+$/,
    ""
  );

  const traitsMatch =
    content.match(/\b(?:traits?|rarity)\s*[:=]\s*(.+)$/im) ||
    content.match(/\b(?:traits?|rarity)\s+(.+)/i);

  let description = content.trim();
  description = description
    .replace(/\broyalty\s+\d+(?:\.\d+)?\s*%?/gi, "")
    .replace(/\bwebsite\s+https?:\/\/\S+/gi, "")
    .replace(/\b(?:traits?|rarity)\s*[:=]?\s*.+$/gim, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!description) description = content.trim();

  return {
    description: description.slice(0, 500),
    traits: traitsMatch?.[1]?.trim().slice(0, 300),
    website,
    royaltyBps,
  };
}

export function askForCollectionBasics(): string {
  return [
    "Let's create your NFT collection on Stellar.",
    "",
    "First, send the **collection name**, **max supply**, and optional **mint price**.",
    "For example:",
    "",
    "> Space Explorers — supply 1000 — mint price 5 XLM",
    "> My Art Drop, unlimited, public mint 10 XLM, max 2 per wallet",
    "> Presale: allowlist price 3 XLM (open allowlist mint after deploy)",
    "",
    "Say **cancel** to stop.",
  ].join("\n");
}

export function askForCollectionDetails(draft: PendingNftCollectionDraft): string {
  const supplyLine = draft.supplySpecified
    ? `Max supply: **${draft.maxSupply === 0 ? "unlimited" : draft.maxSupply}**.`
    : "Max supply isn’t set yet — include it (e.g. `supply 1000` or `unlimited`).";
  return [
    `Got it — **${draft.name}** (${draft.symbol}).`,
    supplyLine,
    `Creator royalty default: **${(draft.royaltyBps / 100).toFixed(2)}%** (you can change it).`,
    "",
    "Next: send the **collection description**.",
    "You can also include rarity notes, trait themes, website, and royalty — for example:",
    "",
    `> Clan-themed PFPs on Stellar. Rarity: Common/Rare/Legendary. Royalty 5%`,
    "",
    "Say **cancel** to stop.",
  ].join("\n");
}

export function askForCollectionMedia(draft: PendingNftCollectionDraft): string {
  return [
    `Saved details for **${draft.name}**.`,
    draft.description ? `Description: ${draft.description.slice(0, 160)}${draft.description.length > 160 ? "…" : ""}` : null,
    "",
    "Next: add **collection artwork**.",
    "• Paste an image URL, or",
    "• Say **upload** and I’ll open the create card so you can attach a file.",
    "",
    "Say **cancel** to stop.",
  ]
    .filter(Boolean)
    .join("\n");
}
