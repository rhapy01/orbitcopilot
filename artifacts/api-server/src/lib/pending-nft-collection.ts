/**
 * Multi-turn NFT collection create wizard.
 * Flow: basics (name/supply) → description/traits → media → action card.
 */

export type NftCollectionWizardStep = "awaiting_details" | "awaiting_media";

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
  step: NftCollectionWizardStep;
  createdAt: number;
};

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
  if (Date.now() - d.createdAt > DRAFT_TTL_MS) {
    drafts.delete(key);
    return null;
  }
  return d;
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
  // Strip structured bits from the prose description when present.
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
