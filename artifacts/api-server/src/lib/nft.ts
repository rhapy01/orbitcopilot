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

function toStroops(human: string): string {
 const [w, f = ""] = human.trim().split(".");
 const frac = (f + "0000000").slice(0, 7);
 return BigInt((w || "0") + frac).toString();
}

function resolveCollectionId(collectionContract?: string): string {
 const id = collectionContract?.trim();
 if (id?.startsWith("C")) return id;
 return requireNftContract();
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
}) {
 const factoryId = requireNftFactoryContract();
 const { Address, nativeToScVal, xdr } = await import("@stellar/stellar-sdk");
 const name = input.name.trim().slice(0, 64);
 const symbol = input.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
 if (!name || symbol.length < 1) {
 throw new Error('Need collection name and symbol, e.g. "create NFT collection Orbit Foxes symbol FOX"');
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
 ],
 },
 });
 const baseUri = (input.baseUri ?? collectionMetadata.uri).slice(0, 200);
 const maxSupply = Math.max(0, Math.floor(input.maxSupply ?? 0));
 const openMint = input.openMint !== false;
 const salt = await collectionSalt(input.walletAddress, name, symbol);
 const saltScVal = xdr.ScVal.scvBytes(salt);

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
 ],
 });

 return {
 type: "nft_create_collection" as const,
 name,
 symbol,
 maxSupply,
 openMint,
 factoryId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Create SEP-50 NFT collection "${name}" (${symbol})${
 maxSupply ? ` max ${maxSupply}` : ""
 }. Sign to deploy your collection contract.`,
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
}) {
 const contractId = resolveCollectionId(input.collectionContract);
 const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
 let name = (input.name ?? "Orbit NFT").slice(0, 64);
 let uri = (input.metadataUri ?? "").slice(0, 200);

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

 // Auto-build SEP-50 / OpenSea metadata when chat doesn't pass a URI.
 if (!uri) {
 let image = input.image?.trim();
 if (input.imageDataUrl) {
 const uploaded = await storeNftMedia({
 walletPublicKey: input.walletAddress,
 dataUrl: input.imageDataUrl,
 });
 image = uploaded.url;
 }
 let animationUrl = input.animationUrl?.trim();
 if (input.animationDataUrl) {
 const uploaded = await storeNftMedia({
 walletPublicKey: input.walletAddress,
 dataUrl: input.animationDataUrl,
 });
 animationUrl = uploaded.url;
 }
 const meta: Sep50Metadata = {
 name,
 description:
 input.description?.trim() ||
 `${name} — minted via Orbit Copilot chat on Stellar Testnet (SEP-50).`,
 image,
 animation_url: animationUrl,
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

 return {
 type: "nft_mint" as const,
 name,
 metadataUri: uri,
 collectionContract: contractId,
 xdr: built.xdr,
 networkPassphrase: built.networkPassphrase,
 message: `Mint NFT "${name}" (SEP-50 metadata ready). Sign to confirm.`,
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
 message: `List NFT #${input.tokenId} for ${input.priceXlm} XLM. Sign to list.`,
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
 message: `Buy NFT #${input.tokenId} with XLM. Sign to purchase.`,
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

export async function formatNftCatalog(): Promise<string> {
 const id = process.env.ORBIT_NFT_CONTRACT_ID?.trim();
 const factory = process.env.ORBIT_NFT_FACTORY_CONTRACT_ID?.trim();
 return [
 "Orbit NFT launchpad (SEP-50 + OpenSea-style metadata, Soroban testnet):",
 "",
 "• Create collection: \"create NFT collection Orbit Foxes symbol FOX\"",
 "• Mint with metadata: \"mint an NFT called Stellar Fox image https://… traits Background=Nebula\"",
 "• Beta reward: feedback (heart) → \"claim my beta NFT\"",
 "• List / buy / transfer: \"list NFT #1 for 5 XLM\" · \"buy NFT #1\" · \"transfer NFT #1 to G…\"",
 "• Cancel listing: \"cancel listing NFT #1\"",
 "• Holdings: \"view my NFTs\"",
 "",
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
 imageUrl = absUrl(typeof meta.image === "string" ? meta.image : imageUrl);
 animationUrl = absUrl(
 typeof meta.animation_url === "string" ? meta.animation_url : animationUrl
 );
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
