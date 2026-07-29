/**
 * Orbit NFT — SEP-50 collections + XLM marketplace (Soroban).
 *
 * Deploy contracts/orbit-nft (+ optional orbit-nft-factory) and set env IDs.
 * Metadata JSON follows SEP-50 / OpenSea schema via nft-metadata.ts.
 */

import {
 buildContractInvoke,
 NATIVE_XLM_SAC,
 nftFactoryConfigured,
 requireNftContract,
 requireNftFactoryContract,
} from "./onchain";
import { SOROBAN_RPC } from "./stellar";
import {
 parseTraits,
 storeNftMetadata,
 type Sep50Metadata,
} from "./nft-metadata";
import { storeNftMedia } from "./nft-media";

/** 0.5% Orbit platform fee on secondary NFT sales. */
export const NFT_PLATFORM_FEE_BPS = 50;
/** 2.5% default creator royalty (max 10% = 1000 bps). */
export const NFT_DEFAULT_ROYALTY_BPS = 250;
export const NFT_MAX_ROYALTY_BPS = 1000;

function clampRoyaltyBps(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return NFT_DEFAULT_ROYALTY_BPS;
  return Math.max(0, Math.min(NFT_MAX_ROYALTY_BPS, Math.floor(raw)));
}

/** Parse "royalty 5%" / "royalty 2.5" from chat into basis points. */
export function parseRoyaltyBpsFromText(content: string): number | undefined {
  const m = content.match(/\broyalty\s+(\d+(?:\.\d+)?)\s*%?/i);
  if (!m?.[1]) return undefined;
  const pct = parseFloat(m[1]);
  if (!Number.isFinite(pct)) return undefined;
  // Values > 10 without % are treated as bps if > 10 and <= 1000, else as percent.
  if (pct > 10 && pct <= NFT_MAX_ROYALTY_BPS && !/%/.test(m[0])) {
    return clampRoyaltyBps(pct);
  }
  return clampRoyaltyBps(Math.round(pct * 100));
}

/** Fields parsed from a create-collection chat prompt. */
export type CollectionPromptFields = {
  name: string;
  symbol: string;
  maxSupply: number;
  royaltyBps: number;
  description?: string;
  image?: string;
  website?: string;
  /** True when chat included an explicit max/supply number. */
  supplySpecified: boolean;
  /** True when the user named the collection (not a bare "create collection" ask). */
  nameSpecified: boolean;
  publicMintPriceXlm?: string;
  allowlistMintPriceXlm?: string;
  maxMintPerWallet?: number;
};

export function parseCollectionPromptFields(
  content: string,
  match: RegExpMatchArray
): CollectionPromptFields {
  let name = (match[1]?.trim() || "").replace(/,\s*$/, "").trim();
  let nameSpecified = Boolean(name);
  if (!name) {
    // Fallback: words after "collection" until a keyword / comma clause
    const after = content.match(
      /\bcollection\b\s+(?:called|named\s+)?["']?(.+?)(?=\s*(?:,|\s)+(?:symbol|max|total|supply|ts|royalty|description|image|website|banner)\b|\s*$)/i
    );
    const afterName = after?.[1]?.trim().replace(/,\s*$/, "");
    if (afterName) {
      name = afterName;
      nameSpecified = true;
    }
  }
  name = name
    .replace(
      /\s+(?:symbol|max(?:\s+supply)?|total\s+supply|supply|ts|royalty|description|image|website|banner)\b.*$/i,
      ""
    )
    .replace(/,\s*$/, "")
    .trim()
    .slice(0, 64);

  const symbolFromMatch = match[2]?.trim();
  const symbol =
    (symbolFromMatch || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "ORB")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12) || "ORB";

  const supplyMatch = content.match(
    /\b(?:total\s+supply|max(?:\s+supply)?|supply|ts)\s*(?:is|=|:)?\s*(\d+)\b/i
  );
  const unlimited = /\b(?:unlimited|no\s+max(?:\s+supply)?)\b/i.test(content);
  const maxFromRe = match[3] ? parseInt(match[3], 10) : NaN;
  const maxFromText = supplyMatch?.[1] ? parseInt(supplyMatch[1], 10) : NaN;
  const supplySpecified =
    unlimited || Number.isFinite(maxFromText) || Number.isFinite(maxFromRe);
  const maxSupply = unlimited
    ? 0
    : Number.isFinite(maxFromText)
      ? maxFromText
      : Number.isFinite(maxFromRe)
        ? maxFromRe
        : 0;

  const description =
    content.match(/\bdescription\s+["']([^"']+)["']/i)?.[1]?.trim() ||
    content.match(
      /\bdescription\s+(.+?)(?=\s+(?:symbol|max|supply|royalty|image|website|banner)\b|$)/i
    )?.[1]?.trim();
  const image = content.match(/\bimage\s+(https?:\/\/\S+)/i)?.[1]?.trim();
  const website = content.match(/\bwebsite\s+(https?:\/\/\S+)/i)?.[1]?.trim();
  const royaltyBps = parseRoyaltyBpsFromText(content) ?? NFT_DEFAULT_ROYALTY_BPS;
  const publicMintPriceXlm = parseMintPriceXlmFromText(content);
  const allowlistMintPriceXlm = parseAllowlistMintPriceXlmFromText(content);
  const maxMintPerWallet = parseMaxMintPerWalletFromText(content);

  return {
    name,
    symbol,
    maxSupply: Math.max(0, maxSupply),
    royaltyBps,
    description: description || undefined,
    image,
    website,
    supplySpecified,
    nameSpecified: nameSpecified && name.length >= 2,
    publicMintPriceXlm,
    allowlistMintPriceXlm,
    maxMintPerWallet,
  };
}

/** True when a create prompt already has everything needed for the action card. */
export function collectionPromptComplete(fields: CollectionPromptFields): boolean {
  return Boolean(
    fields.supplySpecified &&
      fields.description?.trim() &&
      fields.image?.trim()
  );
}

export function collectionDraftMissing(fields: {
  description?: string;
  image?: string;
  imageDataUrl?: string;
  supplySpecified?: boolean;
}): string[] {
  const missing: string[] = [];
  if (!fields.description?.trim()) missing.push("description");
  if (!fields.image?.trim() && !fields.imageDataUrl) missing.push("artwork (image)");
  if (!fields.supplySpecified) missing.push("max supply (0 = unlimited)");
  return missing;
}

export function formatCreateCollectionDraftMessage(fields: CollectionPromptFields): string {
  const missing = collectionDraftMissing({
    description: fields.description,
    image: fields.image,
    supplySpecified: fields.supplySpecified,
  });
  const lines = [
    `Set up SEP-50 collection "${fields.name}" (${fields.symbol}).`,
    `Creator royalty ${(fields.royaltyBps / 100).toFixed(2)}% · Orbit platform fee ${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}%.`,
    fields.supplySpecified
      ? `Max supply: ${fields.maxSupply === 0 ? "unlimited" : fields.maxSupply}.`
      : null,
    "",
  ].filter((l) => l !== null) as string[];

  if (missing.length) {
    lines.push("Complete these on the card before signing:");
    for (const m of missing) lines.push(`• ${m}`);
    lines.push("");
    lines.push(
      'Full example: create NFT collection Foxes symbol FOX max 1000 royalty 5% description "Stellar fox PFP collection" image https://example.com/fox.png'
    );
  } else {
    lines.push("Details look complete — review the card and sign to deploy.");
  }
  return lines.join("\n");
}

function toStroops(human: string): string {
 const [w, f = ""] = human.trim().split(".");
 const frac = (f + "0000000").slice(0, 7);
 return BigInt((w || "0") + frac).toString();
}

function fromStroops(stroops: bigint | number | string): string {
 const n = BigInt(stroops);
 const whole = n / 10_000_000n;
 const frac = n % 10_000_000n;
 if (frac === 0n) return whole.toString();
 return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

/** Parse "mint price 5 XLM" / "public mint 10" from chat. */
export function parseMintPriceXlmFromText(content: string): string | undefined {
 const m = content.match(
   /\b(?:public\s+)?(?:mint(?:ing)?\s+)?price\s*(?:is|=|:)?\s*([\d.]+)\s*(?:xlm)?\b/i
 ) ?? content.match(/\bmint\s+(?:for\s+)?([\d.]+)\s*xlm\b/i);
 if (!m?.[1]) return undefined;
 const n = parseFloat(m[1]);
 return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
}

export function parseAllowlistMintPriceXlmFromText(content: string): string | undefined {
 const m = content.match(
   /\b(?:allowlist|presale|private)\s+(?:mint(?:ing)?\s+)?price\s*(?:is|=|:)?\s*([\d.]+)\s*(?:xlm)?\b/i
 );
 if (!m?.[1]) return undefined;
 const n = parseFloat(m[1]);
 return Number.isFinite(n) && n >= 0 ? String(n) : undefined;
}

export function parseMaxMintPerWalletFromText(content: string): number | undefined {
 const m = content.match(
   /\b(?:max\s+)?(?:mint(?:s)?\s+per\s+wallet|per\s+wallet)\s*(?:is|=|:)?\s*(\d+)\b/i
 );
 if (!m?.[1]) return undefined;
 const n = parseInt(m[1], 10);
 return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export type CollectionMintConfigView = {
  publicMintPriceXlm: string;
  allowlistMintPriceXlm: string;
  maxMintPerWallet: number;
  allowlistActive: boolean;
  publicMintActive: boolean;
  openMint: boolean;
  floorPriceXlm: string | null;
};

export async function getCollectionMintInfo(
  collectionContract: string,
  walletAddress?: string
): Promise<CollectionMintConfigView> {
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const cfg = await simulateContractCall(collectionContract, "mint_config", []);
  const floor = await simulateContractCall(collectionContract, "floor_price", []);
  let mintPriceFor = 0n;
  if (walletAddress) {
    const p = await simulateContractCall(collectionContract, "mint_price_for", [
      Address.fromString(walletAddress).toScVal(),
    ]);
    mintPriceFor = BigInt(String(p ?? 0));
  }
  const publicPrice = BigInt(String(cfg?.public_mint_price ?? cfg?.publicMintPrice ?? 0));
  const allowPrice = BigInt(String(cfg?.allowlist_mint_price ?? cfg?.allowlistMintPrice ?? 0));
  return {
    publicMintPriceXlm: fromStroops(publicPrice),
    allowlistMintPriceXlm: fromStroops(allowPrice),
    maxMintPerWallet: Number(cfg?.max_mint_per_wallet ?? cfg?.maxMintPerWallet ?? 0),
    allowlistActive: Boolean(cfg?.allowlist_active ?? cfg?.allowlistActive),
    publicMintActive: Boolean(cfg?.public_mint_active ?? cfg?.publicMintActive),
    openMint: Boolean(cfg?.open_mint ?? cfg?.openMint),
    floorPriceXlm: floor && BigInt(String(floor)) > 0n ? fromStroops(floor) : null,
    ...(walletAddress
      ? { walletMintPriceXlm: fromStroops(mintPriceFor) }
      : {}),
  } as CollectionMintConfigView & { walletMintPriceXlm?: string };
}

async function simulateContractCall(
  contractId: string,
  method: string,
  args: any[]
): Promise<any> {
  const { Contract, TransactionBuilder, Networks, BASE_FEE, scValToNative } =
    await import("@stellar/stellar-sdk");
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const { getDemoKeypair } = await import("./stellar");
  const rpc = new Server(SOROBAN_RPC);
  const demo = await getDemoKeypair();
  const account = await rpc.getAccount(demo.publicKey());
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  if (!retval) return null;
  return scValToNative(retval);
}

function resolveCollectionId(collectionContract?: string): string {
 const id = collectionContract?.trim();
 if (id?.startsWith("C")) return id;
 return requireNftContract();
}

/** Creator's latest factory collection, or default / hinted contract. */
export async function resolveCreatorCollection(
  wallet: string,
  hint?: string
): Promise<string> {
  if (hint?.trim().startsWith("C")) return hint.trim();
  if (nftFactoryConfigured()) {
    try {
      const factory = requireNftFactoryContract();
      const { Address } = await import("@stellar/stellar-sdk");
      const list = await simulateContractCall(factory, "collections_of", [
        Address.fromString(wallet).toScVal(),
      ]);
      if (Array.isArray(list) && list.length > 0) {
        return String(list[list.length - 1]);
      }
    } catch {
      /* fall through */
    }
  }
  return resolveCollectionId();
}

/** Build salt bytes for factory deploy from creator + name + symbol. */
async function collectionSalt(
 creator: string,
 name: string,
 symbol: string
): Promise<Buffer> {
 const { createHash } = await import("crypto");
 return createHash("sha256")
 .update(`${creator}:${name}:${symbol}:${Date.now()}`)
 .digest();
}

export function collectionMintFieldsFromPrompt(fields: {
  publicMintPriceXlm?: string;
  allowlistMintPriceXlm?: string;
  maxMintPerWallet?: number;
}) {
  const presaleOnly = Boolean(fields.allowlistMintPriceXlm && !fields.publicMintPriceXlm);
  const publicPrice = fields.publicMintPriceXlm ?? "0";
  const allowPrice = fields.allowlistMintPriceXlm ?? publicPrice;
  return {
    publicMintPriceXlm: publicPrice,
    allowlistMintPriceXlm: allowPrice,
    maxMintPerWallet: fields.maxMintPerWallet ?? 0,
    allowlistActive: presaleOnly,
    publicMintActive: !presaleOnly,
  };
}

export async function prepareCreateCollection(input: {
 walletAddress: string;
 name: string;
 symbol: string;
 baseUri?: string;
 description?: string;
 image?: string;
 imageDataUrl?: string;
 bannerImage?: string;
 bannerImageDataUrl?: string;
 externalUrl?: string;
 maxSupply?: number;
 openMint?: boolean;
 /** Public mint price in XLM (0 = free). */
 publicMintPriceXlm?: string;
 /** Allowlist / presale mint price in XLM. */
 allowlistMintPriceXlm?: string;
 maxMintPerWallet?: number;
 /** Start with allowlist stage active (public stage off). */
 allowlistActive?: boolean;
 /** Start with public mint stage active. Default true when openMint. */
 publicMintActive?: boolean;
 /** Creator royalty in basis points (100 = 1%). Default 250 = 2.5%. */
 royaltyBps?: number;
 /** Optional media pack — max supply defaults to pack size when set. */
 mediaPackId?: string;
}) {
 const factoryId = requireNftFactoryContract();
 const { Address, nativeToScVal, xdr } = await import("@stellar/stellar-sdk");
 const name = input.name.trim().slice(0, 64);
 const symbol = input.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
 if (!name || symbol.length < 1) {
 throw new Error('Need collection name and symbol, e.g. "create NFT collection Orbit Foxes symbol FOX"');
 }

 let packItemCount = 0;
 if (input.mediaPackId?.trim()) {
 const { getMediaPack } = await import("./nft-media-pack");
 const pack = await getMediaPack(input.mediaPackId.trim());
 if (!pack) throw new Error("Media pack not found");
 if (pack.creator !== input.walletAddress) {
 throw new Error("Media pack belongs to a different wallet");
 }
 if (pack.status !== "ready") {
 throw new Error("Finalize the media pack before creating the collection");
 }
 packItemCount = pack.itemCount;
 }

 let image = input.image?.trim();
 if (input.imageDataUrl) {
 const uploaded = await storeNftMedia({
 walletPublicKey: input.walletAddress,
 dataUrl: input.imageDataUrl,
 });
 image = uploaded.url;
 }
 let bannerImage = input.bannerImage?.trim();
 if (input.bannerImageDataUrl) {
 const uploaded = await storeNftMedia({
 walletPublicKey: input.walletAddress,
 dataUrl: input.bannerImageDataUrl,
 });
 bannerImage = uploaded.url;
 }
 const royaltyBps = clampRoyaltyBps(input.royaltyBps);
 const collectionMetadata = await storeNftMetadata({
 walletPublicKey: input.walletAddress,
 metadata: {
 name,
 description:
 input.description?.trim() ||
 `${name} — a SEP-50 NFT collection launched with Orbit Copilot.`,
 image,
 banner_image: bannerImage,
 featured_image: image,
 external_url: input.externalUrl?.trim(),
 attributes: [
 { trait_type: "Symbol", value: symbol },
 { trait_type: "Standard", value: "SEP-50" },
 { trait_type: "Creator royalty", value: `${(royaltyBps / 100).toFixed(2)}%` },
 { trait_type: "Platform fee", value: `${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}%` },
 ...(packItemCount
 ? [{ trait_type: "Media pack", value: `${packItemCount} unique assets` }]
 : []),
 ],
 },
 });
 const baseUri = (input.baseUri ?? collectionMetadata.uri).slice(0, 200);
 const maxSupply = Math.max(
 0,
 Math.floor(
 packItemCount > 0
 ? input.maxSupply && input.maxSupply > 0
 ? Math.min(input.maxSupply, packItemCount)
 : packItemCount
 : (input.maxSupply ?? 0)
 )
 );
 const openMint = input.openMint !== false;
 const publicMintPriceXlm = input.publicMintPriceXlm?.trim() || "0";
 const allowlistMintPriceXlm = input.allowlistMintPriceXlm?.trim() || publicMintPriceXlm;
 const maxMintPerWallet = Math.max(0, Math.floor(input.maxMintPerWallet ?? 0));
 const allowlistActive = input.allowlistActive === true;
 const publicMintActive =
   input.publicMintActive !== undefined ? input.publicMintActive : openMint && !allowlistActive;
 const publicMintStroops = BigInt(toStroops(publicMintPriceXlm));
 const allowlistMintStroops = BigInt(toStroops(allowlistMintPriceXlm));
 const salt = await collectionSalt(input.walletAddress, name, symbol);
 const saltScVal = xdr.ScVal.scvBytes(salt);
 const mintConfigScVal = xdr.ScVal.scvMap([
  new xdr.ScMapEntry({
   key: xdr.ScVal.scvSymbol("public_mint_price"),
   val: nativeToScVal(publicMintStroops, { type: "i128" }),
  }),
  new xdr.ScMapEntry({
   key: xdr.ScVal.scvSymbol("allowlist_mint_price"),
   val: nativeToScVal(allowlistMintStroops, { type: "i128" }),
  }),
  new xdr.ScMapEntry({
   key: xdr.ScVal.scvSymbol("max_mint_per_wallet"),
   val: nativeToScVal(maxMintPerWallet, { type: "u32" }),
  }),
  new xdr.ScMapEntry({
   key: xdr.ScVal.scvSymbol("allowlist_active"),
   val: xdr.ScVal.scvBool(allowlistActive),
  }),
  new xdr.ScMapEntry({
   key: xdr.ScVal.scvSymbol("public_mint_active"),
   val: xdr.ScVal.scvBool(publicMintActive),
  }),
 ]);

 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId: factoryId,
 method: "create_collection",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 saltScVal,
 nativeToScVal(name, { type: "string" }),
 nativeToScVal(symbol, { type: "string" }),
 nativeToScVal(baseUri, { type: "string" }),
 nativeToScVal(maxSupply, { type: "u32" }),
 xdr.ScVal.scvBool(openMint),
 nativeToScVal(royaltyBps, { type: "u32" }),
 mintConfigScVal,
 ],
 });

 return {
 type: "nft_create_collection" as const,
 name,
 symbol,
 maxSupply,
 openMint,
 royaltyBps,
 platformFeeBps: NFT_PLATFORM_FEE_BPS,
 publicMintPriceXlm,
 allowlistMintPriceXlm,
 maxMintPerWallet,
 allowlistActive,
 publicMintActive,
 mediaPackId: input.mediaPackId?.trim() || undefined,
 factoryId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: [
  `Create SEP-50 NFT collection "${name}" (${symbol})${maxSupply ? ` max ${maxSupply}` : ""}${packItemCount ? ` with ${packItemCount}-asset media pack` : ""}.`,
  allowlistActive
    ? `Allowlist mint: ${allowlistMintPriceXlm} XLM${maxMintPerWallet ? ` · max ${maxMintPerWallet}/wallet` : ""}.`
    : publicMintActive
      ? `Public mint: ${publicMintPriceXlm === "0" ? "free" : `${publicMintPriceXlm} XLM`}${maxMintPerWallet ? ` · max ${maxMintPerWallet}/wallet` : ""}.`
      : "Minting: admin-only until you open a stage.",
  `Secondary sales: ${(royaltyBps / 100).toFixed(2)}% creator royalty + ${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}% Orbit fee.`,
  "Sign to deploy.",
 ].join(" "),
 };
}

export async function prepareNftMint(input: {
 walletAddress: string;
 name?: string;
 metadataUri?: string;
 description?: string;
 image?: string;
 imageDataUrl?: string;
 animationUrl?: string;
 animationDataUrl?: string;
 traits?: string;
 collectionContract?: string;
 /** When set (or collection has a bound pack), mint next unique pack asset. */
 mediaPackId?: string;
 useMediaPack?: boolean;
}) {
 const contractId = resolveCollectionId(input.collectionContract);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 let name = (input.name ?? "Orbit NFT").slice(0, 64);
 let uri = (input.metadataUri ?? "").slice(0, 200);
 let packInfo: {
 packId: string;
 tokenIndex: number;
 itemCount: number;
 imageUrl?: string;
 } | null = null;

 // Beta tester NFT: one mint per wallet (DB + on-chain), whitelist required.
 const { isBetaNftMetadata, BETA_NFT_NAME, BETA_NFT_URI } = await import("./beta-nft");
 if (isBetaNftMetadata(name, uri) || (!input.metadataUri && /beta\s*tester/i.test(name))) {
 const { resolveBetaNftStatus } = await import("./product-store");
 const status = await resolveBetaNftStatus(input.walletAddress);
 if (!status.eligible) {
 throw new Error(
 "Not whitelisted yet. Submit feedback (heart icon) with this wallet connected to unlock the Orbit Beta Tester NFT."
 );
 }
 if (status.claimed) {
 throw new Error(
 `Beta NFT already minted for this wallet${
 status.claimTxHash && status.claimTxHash !== "onchain-sync"
 ? ` (tx ${status.claimTxHash.slice(0, 8)}…)`
 : ""
 }. Ask “view my NFTs” to open your gallery.`
 );
 }
 name = BETA_NFT_NAME.slice(0, 64);
 uri = BETA_NFT_URI.slice(0, 200);
 }

 // Sequential media-pack mint: next unique asset by on-chain total_supply.
 if (!uri && (input.mediaPackId || input.useMediaPack)) {
 const { resolveNextPackMint } = await import("./nft-media-pack");
 const next = await resolveNextPackMint({
 collectionContract: contractId,
 mediaPackId: input.mediaPackId,
 walletAddress: input.walletAddress,
 });
 if (next) {
 name = next.name.slice(0, 64);
 uri = next.metadataUri.slice(0, 200);
 packInfo = {
 packId: next.packId,
 tokenIndex: next.tokenIndex,
 itemCount: next.itemCount,
 imageUrl: next.imageUrl,
 };
 } else if (input.useMediaPack || input.mediaPackId) {
 throw new Error(
 "No ready media pack found. Upload a ZIP pack and finalize it first."
 );
 }
 }

 // Auto-build SEP-50 / OpenSea metadata when chat doesn't pass a URI,
 // OR when the user attached new media after a stale empty-image metadataUri.
 const hasFreshMedia = Boolean(
  input.imageDataUrl ||
  input.animationDataUrl ||
  input.image?.trim() ||
  input.animationUrl?.trim()
 );
 let resolvedImageUrl: string | undefined = packInfo?.imageUrl;
 let resolvedAnimationUrl: string | undefined;
 if (!uri || hasFreshMedia) {
 let image = input.image?.trim() || undefined;
 if (input.imageDataUrl) {
 const uploaded = await storeNftMedia({
 walletPublicKey: input.walletAddress,
 dataUrl: input.imageDataUrl,
 });
 image = uploaded.url;
 }
 let animationUrl = input.animationUrl?.trim() || undefined;
 if (input.animationDataUrl) {
 const uploaded = await storeNftMedia({
 walletPublicKey: input.walletAddress,
 dataUrl: input.animationDataUrl,
 });
 animationUrl = uploaded.url;
 }
 // Rebuild whenever fresh media is present — never keep a prior empty-image URI.
 if (hasFreshMedia || !uri) {
 const meta: Sep50Metadata = {
 name,
 description:
 input.description?.trim() ||
 `${name} — minted via Orbit Copilot chat on Stellar Testnet (SEP-50).`,
 image: image || undefined,
 animation_url: animationUrl || undefined,
 attributes: [
 ...(parseTraits(input.traits) ?? []),
 { trait_type: "Platform", value: "Orbit Copilot" },
 { trait_type: "Standard", value: "SEP-50" },
 ],
 };
 const stored = await storeNftMetadata({
 walletPublicKey: input.walletAddress,
 collectionContract: contractId,
 metadata: meta,
 });
 uri = stored.uri.slice(0, 200);
 resolvedImageUrl = meta.image || resolvedImageUrl;
 resolvedAnimationUrl = meta.animation_url;
 }
 }

 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "mint",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 nativeToScVal(name, { type: "string" }),
 nativeToScVal(uri, { type: "string" }),
 ],
 });

 let mintPriceLine = "";
 try {
 const info = await getCollectionMintInfo(contractId, input.walletAddress);
 const price =
   (info as CollectionMintConfigView & { walletMintPriceXlm?: string }).walletMintPriceXlm ??
   (info.publicMintActive ? info.publicMintPriceXlm : info.allowlistMintPriceXlm);
 if (price && price !== "0") {
 mintPriceLine = ` Mint cost: **${price} XLM** (+ ${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}% Orbit fee on primary).`;
 } else if (!info.publicMintActive && !info.allowlistActive) {
 throw new Error(
 "Public mint is not open for this collection. The creator must enable allowlist or public mint stage."
 );
 } else if (info.allowlistActive && !info.publicMintActive) {
 throw new Error(
 "Allowlist mint is active — your wallet must be on the collection allowlist."
 );
 }
 if (info.floorPriceXlm) {
 mintPriceLine += ` Secondary floor: ${info.floorPriceXlm} XLM.`;
 }
 } catch (err: any) {
 if (err?.message?.includes("not open") || err?.message?.includes("allowlist")) {
 throw err;
 }
 }

 return {
 type: "nft_mint" as const,
 name,
 metadataUri: uri,
 collectionContract: contractId,
 mediaPackId: packInfo?.packId,
 tokenId: packInfo?.tokenIndex,
 imageUrl: resolvedImageUrl,
 animationUrl: resolvedAnimationUrl,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: packInfo
 ? `Mint ${name} (${packInfo.tokenIndex}/${packInfo.itemCount} from media pack).${mintPriceLine} Sign to confirm.`
 : `Mint NFT "${name}" (SEP-50 metadata ready).${mintPriceLine} Sign to confirm.`,
 };
}

export async function prepareNftList(input: {
 walletAddress: string;
 tokenId: number;
 priceXlm: string;
 collectionContract?: string;
}) {
 const contractId = resolveCollectionId(input.collectionContract);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 const price = toStroops(input.priceXlm);

 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "list_for_sale",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 nativeToScVal(input.tokenId, { type: "u32" }),
 nativeToScVal(BigInt(price), { type: "i128" }),
 ],
 });

 return {
 type: "nft_list" as const,
 tokenId: input.tokenId,
 priceXlm: input.priceXlm,
 collectionContract: contractId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `List NFT #${input.tokenId} for ${input.priceXlm} XLM. On sale: ~${((10000 - NFT_DEFAULT_ROYALTY_BPS - NFT_PLATFORM_FEE_BPS) / 100).toFixed(2)}% to you, ${(NFT_DEFAULT_ROYALTY_BPS / 100).toFixed(2)}% creator royalty, ${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}% Orbit (collection may vary). Sign to list.`,
 };
}

export async function prepareNftCancelListing(input: {
 walletAddress: string;
 tokenId: number;
 collectionContract?: string;
}) {
 const contractId = resolveCollectionId(input.collectionContract);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "cancel_listing",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 nativeToScVal(input.tokenId, { type: "u32" }),
 ],
 });
 return {
 type: "nft_cancel" as const,
 tokenId: input.tokenId,
 collectionContract: contractId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Cancel listing for NFT #${input.tokenId}. Sign to confirm.`,
 };
}

export async function prepareNftBuy(input: {
 walletAddress: string;
 tokenId: number;
 collectionContract?: string;
}) {
 const contractId = resolveCollectionId(input.collectionContract);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");

 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "buy",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 nativeToScVal(input.tokenId, { type: "u32" }),
 ],
 });

 return {
 type: "nft_buy" as const,
 tokenId: input.tokenId,
 collectionContract: contractId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Buy NFT #${input.tokenId} with XLM. Price covers seller + creator royalty + ${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}% Orbit fee. Sign to purchase.`,
 };
}

export async function prepareNftTransfer(input: {
 walletAddress: string;
 tokenId: number;
 to: string;
 collectionContract?: string;
}) {
 const contractId = resolveCollectionId(input.collectionContract);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");

 const built = await buildContractInvoke({
 sourcePublicKey: input.walletAddress,
 contractId,
 method: "transfer",
 args: [
 Address.fromString(input.walletAddress).toScVal(),
 Address.fromString(input.to).toScVal(),
 nativeToScVal(input.tokenId, { type: "u32" }),
 ],
 });

 return {
 type: "nft_transfer" as const,
 tokenId: input.tokenId,
 destination: input.to,
 collectionContract: contractId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Transfer NFT #${input.tokenId} to ${input.to.slice(0, 8)}… Sign to send.`,
 };
}

export async function prepareSetMintStages(input: {
  walletAddress: string;
  collectionContract: string;
  allowlistActive: boolean;
  publicMintActive: boolean;
}) {
  const contractId = resolveCollectionId(input.collectionContract);
  const { Address, nativeToScVal, xdr } = await import("@stellar/stellar-sdk");
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "set_mint_stages",
    args: [
      Address.fromString(input.walletAddress).toScVal(),
      xdr.ScVal.scvBool(input.allowlistActive),
      xdr.ScVal.scvBool(input.publicMintActive),
    ],
  });
  const stage =
    input.allowlistActive && !input.publicMintActive
      ? "allowlist / presale"
      : input.publicMintActive && !input.allowlistActive
        ? "public"
        : input.allowlistActive && input.publicMintActive
          ? "allowlist + public"
          : "closed (admin-only mint)";
  return {
    type: "nft_set_mint_stages" as const,
    collectionContract: contractId,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Set mint stage to **${stage}**. Sign to update the collection.`,
  };
}

export async function prepareSetMintPrices(input: {
  walletAddress: string;
  collectionContract: string;
  publicMintPriceXlm: string;
  allowlistMintPriceXlm: string;
  maxMintPerWallet?: number;
}) {
  const contractId = resolveCollectionId(input.collectionContract);
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "set_mint_prices",
    args: [
      Address.fromString(input.walletAddress).toScVal(),
      nativeToScVal(BigInt(toStroops(input.publicMintPriceXlm)), { type: "i128" }),
      nativeToScVal(BigInt(toStroops(input.allowlistMintPriceXlm)), { type: "i128" }),
    ],
  });
  const ops: Promise<unknown>[] = [Promise.resolve(built)];
  if (input.maxMintPerWallet != null && input.maxMintPerWallet >= 0) {
    ops.push(
      buildContractInvoke({
        sourcePublicKey: input.walletAddress,
        contractId,
        method: "set_max_mint_per_wallet",
        args: [
          Address.fromString(input.walletAddress).toScVal(),
          nativeToScVal(input.maxMintPerWallet, { type: "u32" }),
        ],
      })
    );
  }
  const [priceBuilt] = await Promise.all(ops);
  return {
    type: "nft_set_mint_prices" as const,
    collectionContract: contractId,
    publicMintPriceXlm: input.publicMintPriceXlm,
    allowlistMintPriceXlm: input.allowlistMintPriceXlm,
    maxMintPerWallet: input.maxMintPerWallet,
    xdr: (priceBuilt as { xdr: string }).xdr,
    networkPassphrase: (priceBuilt as { networkPassphrase: string }).networkPassphrase,
    message: `Set mint prices — public: ${input.publicMintPriceXlm} XLM, allowlist: ${input.allowlistMintPriceXlm} XLM${input.maxMintPerWallet ? `, max ${input.maxMintPerWallet}/wallet` : ""}. Sign to update.`,
  };
}

export async function prepareSetAllowlistEntry(input: {
  walletAddress: string;
  collectionContract: string;
  allowWallet: string;
  maxMints?: number;
  customPriceXlm?: string;
}) {
  const contractId = resolveCollectionId(input.collectionContract);
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const customPrice = input.customPriceXlm
    ? BigInt(toStroops(input.customPriceXlm))
    : 0n;
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "set_allowlist_entry",
    args: [
      Address.fromString(input.walletAddress).toScVal(),
      Address.fromString(input.allowWallet).toScVal(),
      nativeToScVal(Math.max(0, input.maxMints ?? 0), { type: "u32" }),
      nativeToScVal(customPrice, { type: "i128" }),
    ],
  });
  return {
    type: "nft_allowlist" as const,
    collectionContract: contractId,
    allowWallet: input.allowWallet,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Add ${input.allowWallet.slice(0, 8)}… to the collection allowlist${input.customPriceXlm ? ` at ${input.customPriceXlm} XLM` : ""}. Sign to confirm.`,
  };
}

export async function formatCollectionMintStatus(
  collectionContract: string,
  walletAddress?: string
): Promise<string> {
  try {
    const info = await getCollectionMintInfo(collectionContract, walletAddress);
    const lines = [
      "**Primary mint (drop)**",
      info.allowlistActive
        ? `• Allowlist stage: **on** · ${info.allowlistMintPriceXlm} XLM`
        : "• Allowlist stage: off",
      info.publicMintActive
        ? `• Public stage: **on** · ${info.publicMintPriceXlm === "0" ? "free" : `${info.publicMintPriceXlm} XLM`}`
        : "• Public stage: off",
      info.maxMintPerWallet
        ? `• Max mints per wallet: ${info.maxMintPerWallet}`
        : "• Max mints per wallet: unlimited",
      "",
      "**Secondary marketplace**",
      info.floorPriceXlm
        ? `• Floor price: **${info.floorPriceXlm} XLM** (lowest active listing)`
        : "• Floor price: none listed yet",
      "",
      "Creator commands:",
      '• "set public mint price 5 XLM on my collection"',
      '• "open allowlist mint" / "open public mint"',
      '• "add G… to allowlist for 2 mints at 3 XLM"',
      '• "list NFT #1 for 10 XLM" (secondary sale)',
    ];
    return lines.join("\n");
  } catch (err: any) {
    return err?.message ?? "Could not load mint config.";
  }
}

export async function formatNftCatalog(): Promise<string> {
 const id = process.env.ORBIT_NFT_CONTRACT_ID?.trim();
 const factory = process.env.ORBIT_NFT_FACTORY_CONTRACT_ID?.trim();
 return [
 "Orbit NFT launchpad (SEP-50 + OpenSea-style drops, Soroban testnet):",
 "",
 "**Primary mint (SeaDrop-style)**",
 "• Public mint price + allowlist/presale price at create time",
 "• Stages: allowlist → public (creator toggles on-chain)",
 "• Per-wallet mint limits · paid mints split creator + 0.5% Orbit",
 "",
 "**Create & mint**",
 "• Create collection (guided): \"create NFT collection Cloud Explorers supply 777 mint price 5 XLM\"",
 "• Media pack (unique drop): upload ZIP → \"mint next NFT\"",
 "• Mint: \"mint an NFT\" (shows price if collection has paid mint)",
 "",
 "**Secondary marketplace**",
 "• List / buy / transfer: \"list NFT #1 for 5 XLM\" · \"buy NFT #1\"",
 "• Floor price = lowest active listing (on-chain `floor_price`)",
 "• Cancel listing: \"cancel listing NFT #1\"",
 "",
 "**Creator tools**",
 "• \"open public mint\" / \"open allowlist mint\"",
 "• \"set mint price 10 XLM\" · \"add G… to allowlist\"",
 "• \"mint status for my collection\"",
 "",
 "• Beta reward: feedback → \"claim my beta NFT\"",
 "• Holdings: \"view my NFTs\"",
 `Secondary sales: ${(NFT_DEFAULT_ROYALTY_BPS / 100).toFixed(2)}% creator royalty (0–10%, set at create) + ${(NFT_PLATFORM_FEE_BPS / 100).toFixed(2)}% Orbit platform fee; rest to seller.`,
 "Collection create is multi-turn by default; say cancel anytime during setup.",
 "Standard: SEP-50 (name/symbol/token_uri/approve/transfer) — Freighter-compatible.",
 id?.startsWith("C") ? `Default collection: ${id}` : "Deploy orbit-nft → ORBIT_NFT_CONTRACT_ID",
 factory?.startsWith("C")
 ? `Factory: ${factory}`
 : nftFactoryConfigured()
 ? ""
 : "Factory optional: deploy orbit-nft-factory → ORBIT_NFT_FACTORY_CONTRACT_ID",
 `Settlement: native XLM SAC (${NATIVE_XLM_SAC.slice(0, 8)}…)`,
 ].join("\n");
}

export type NftGalleryItem = {
 tokenId: number;
 name: string;
 metadataUri: string;
 imageUrl: string | null;
 animationUrl: string | null;
 mediaType: "image" | "video" | "unknown";
 description?: string | null;
 listedPriceXlm?: string | null;
};

export type NftGalleryPayload = {
 kind: "nft_holdings";
 items: NftGalleryItem[];
};

function looksLikeVideo(url: string | null | undefined): boolean {
 if (!url) return false;
 const u = url.toLowerCase();
 return (
 u.includes(".mp4") ||
 u.includes(".webm") ||
 u.includes(".mov") ||
 u.includes("animation") ||
 u.endsWith("/orbitpilot-tester.mp4")
 );
}

function absUrl(url: string | null | undefined): string | null {
 if (!url || typeof url !== "string") return null;
 const t = url.trim();
 if (!t) return null;
 if (t.startsWith("ipfs://")) {
 return `https://ipfs.io/ipfs/${t.slice("ipfs://".length)}`;
 }
 if (t.startsWith("/")) {
 // Prefer same-origin relative paths in the app
 return t;
 }
 return t;
}

async function fetchMetadataJson(uri: string): Promise<Record<string, unknown> | null> {
 const url = absUrl(uri);
 if (!url || url.startsWith("ipfs://")) return null;
 if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("/")) {
 return null;
 }
 try {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 8000);
 const res = await fetch(url.startsWith("/") ? `https://orbitpilot.vercel.app${url}` : url, {
 signal: controller.signal,
 });
 clearTimeout(timer);
 if (!res.ok) return null;
 const data = (await res.json()) as Record<string, unknown>;
 return data && typeof data === "object" ? data : null;
 } catch {
 return null;
 }
}

async function simulateU32Call(
 contractId: string,
 method: string,
 args: any[]
): Promise<any> {
 return simulateContractCall(contractId, method, args);
}

async function enrichNftItem(
 contractId: string,
 tokenId: number
): Promise<NftGalleryItem> {
 const { nativeToScVal } = await import("@stellar/stellar-sdk");
 const { isBetaNftMetadata, BETA_NFT_MEDIA_URL, BETA_NFT_NAME, BETA_NFT_URI } =
 await import("./beta-nft");

 let metadataUri = "";
 try {
 const uri = await simulateU32Call(contractId, "token_uri", [
 nativeToScVal(tokenId, { type: "u32" }),
 ]);
 metadataUri = typeof uri === "string" ? uri : String(uri ?? "");
 } catch {
 metadataUri = "";
 }

 let listedPriceXlm: string | null = null;
 try {
 const listing = await simulateU32Call(contractId, "get_listing", [
 nativeToScVal(tokenId, { type: "u32" }),
 ]);
 if (listing && typeof listing === "object" && (listing as any).price != null) {
 const stroops = BigInt(String((listing as any).price));
 listedPriceXlm = (Number(stroops) / 1e7).toString();
 }
 } catch {
 /* optional */
 }

 let name = `NFT #${tokenId}`;
 let description: string | null = null;
 let imageUrl: string | null = null;
 let animationUrl: string | null = null;

 if (isBetaNftMetadata(null, metadataUri) || metadataUri.includes("orbit-beta-tester")) {
 name = BETA_NFT_NAME;
 metadataUri = metadataUri || BETA_NFT_URI;
 animationUrl = BETA_NFT_MEDIA_URL;
 imageUrl = BETA_NFT_MEDIA_URL;
 }

 if (metadataUri.startsWith("http") || metadataUri.startsWith("/")) {
 const meta = await fetchMetadataJson(metadataUri);
 if (meta) {
 if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
 if (typeof meta.description === "string") description = meta.description;
 const img =
 typeof meta.image === "string" && meta.image.trim() ? meta.image.trim() : null;
 const anim =
 typeof meta.animation_url === "string" && meta.animation_url.trim()
  ? meta.animation_url.trim()
  : null;
 imageUrl = absUrl(img) ?? imageUrl;
 animationUrl = absUrl(anim) ?? animationUrl;
 }
 // DB fallback when remote fetch fails or image field is empty
 if (!imageUrl && !animationUrl) {
  const idMatch = metadataUri.match(/\/api\/nft\/meta\/([a-f0-9]{16,64})/i);
  if (idMatch?.[1]) {
   try {
    const { getNftMetadata } = await import("./nft-metadata");
    const local = await getNftMetadata(idMatch[1]);
    if (local?.image?.trim()) imageUrl = absUrl(local.image);
    if (local?.animation_url?.trim()) animationUrl = absUrl(local.animation_url);
    if (typeof local?.name === "string" && local.name.trim()) name = local.name.trim();
    if (typeof local?.description === "string") description = local.description;
   } catch {
    /* optional */
   }
  }
 }
 }

 // Relative media from JSON often points at production - also allow local public assets
 if (animationUrl?.includes("orbitpilot-tester.mp4") || imageUrl?.includes("orbitpilot-tester.mp4")) {
 animationUrl = animationUrl ?? "/orbitpilot-tester.mp4";
 imageUrl = imageUrl ?? "/orbitpilot-tester.mp4";
 }

 const primary = animationUrl || imageUrl;
 const mediaType: NftGalleryItem["mediaType"] = looksLikeVideo(primary)
 ? "video"
 : primary
 ? "image"
 : "unknown";

 return {
 tokenId,
 name,
 metadataUri,
 imageUrl,
 animationUrl,
 mediaType,
 description,
 listedPriceXlm,
 };
}

/** Structured holdings for gallery UI + short chat text. */
export async function getNftHoldings(wallet: string): Promise<{
 text: string;
 gallery: NftGalleryPayload;
}> {
 try {
 const contractId = requireNftContract();
 const { Address } = await import("@stellar/stellar-sdk");
 const idsRaw = await simulateU32Call(contractId, "tokens_of", [
 Address.fromString(wallet).toScVal(),
 ]);
 const ids = (Array.isArray(idsRaw) ? idsRaw : [])
 .map((n) => Number(n))
 .filter((n) => Number.isFinite(n) && n > 0);

 if (!ids.length) {
 return {
 text: "You don't hold any Orbit NFTs yet. Submit feedback (heart) to unlock the beta tester NFT, or say \"mint an NFT called Orbit One\".",
 gallery: { kind: "nft_holdings", items: [] },
 };
 }

 const items = await Promise.all(ids.map((id) => enrichNftItem(contractId, id)));
 const text =
 items.length === 1
 ? `Here's your Orbit NFT - ${items[0].name}${items[0].name.includes(`#${items[0].tokenId}`) ? "" : ` (#${items[0].tokenId})`}.`
 : `Here's your collection - ${items.length} Orbit NFTs.`;

 return {
 text,
 gallery: { kind: "nft_holdings", items },
 };
 } catch (err: any) {
 return {
 text: err?.message ?? "Could not load NFT holdings.",
 gallery: { kind: "nft_holdings", items: [] },
 };
 }
}

export async function formatNftHoldings(wallet: string): Promise<string> {
 const { text, gallery } = await getNftHoldings(wallet);
 if (!gallery.items.length) return text;
 return [
 text,
 ...gallery.items.map((i) => `• #${i.tokenId} ${i.name}`),
 "",
 'List one: "list NFT #1 for 5 XLM" · Transfer: "transfer NFT #1 to G…"',
 ].join("\n");
}

/** True if wallet holds the Orbit beta tester NFT (on-chain). */
export async function walletOwnsBetaNft(
 wallet: string
): Promise<{ owned: boolean; tokenId: number | null }> {
 const { isBetaNftMetadata } = await import("./beta-nft");
 const { gallery } = await getNftHoldings(wallet);
 for (const item of gallery.items) {
 if (isBetaNftMetadata(item.name, item.metadataUri)) {
 return { owned: true, tokenId: item.tokenId };
 }
 }
 return { owned: false, tokenId: null };
}
