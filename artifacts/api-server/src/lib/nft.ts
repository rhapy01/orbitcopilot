/**
 * Orbit NFT — mintable collectibles with XLM listings (Soroban).
 *
 * Deploy contracts/orbit-nft and set ORBIT_NFT_CONTRACT_ID=C…
 */

import {
  buildContractInvoke,
  NATIVE_XLM_SAC,
  requireNftContract,
} from "./onchain";
import { SOROBAN_RPC } from "./stellar";

function toStroops(human: string): string {
  const [w, f = ""] = human.trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt((w || "0") + frac).toString();
}

export async function prepareNftMint(input: {
  walletAddress: string;
  name?: string;
  metadataUri?: string;
}) {
  const contractId = requireNftContract();
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  let name = (input.name ?? "Orbit NFT").slice(0, 64);
  let uri = (input.metadataUri ?? `ipfs://orbit/${Date.now()}`).slice(0, 200);

  // Beta tester NFT: one mint per wallet (DB + on-chain), whitelist required.
  const { isBetaNftMetadata, BETA_NFT_NAME, BETA_NFT_URI } = await import("./beta-nft");
  if (isBetaNftMetadata(name, uri)) {
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
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Mint NFT "${name}" to your wallet. Sign to confirm.`,
  };
}

export async function prepareNftList(input: {
  walletAddress: string;
  tokenId: number;
  priceXlm: string;
}) {
  const contractId = requireNftContract();
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
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `List NFT #${input.tokenId} for ${input.priceXlm} XLM. Sign to list.`,
  };
}

export async function prepareNftBuy(input: {
  walletAddress: string;
  tokenId: number;
}) {
  const contractId = requireNftContract();
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
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Buy NFT #${input.tokenId} with XLM. Sign to purchase.`,
  };
}

export async function prepareNftTransfer(input: {
  walletAddress: string;
  tokenId: number;
  to: string;
}) {
  const contractId = requireNftContract();
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
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Transfer NFT #${input.tokenId} to ${input.to.slice(0, 8)}… Sign to send.`,
  };
}

export async function formatNftCatalog(): Promise<string> {
  const id = process.env.ORBIT_NFT_CONTRACT_ID?.trim();
  return [
    "Orbit NFT marketplace (Soroban):",
    "",
    "• Beta reward: submit feedback (heart) → auto-mint \"Orbit Co-Pilot Beta tester\" (max 7777)",
    "• Or chat: \"i have submitted my feedback, mint my beta tester nft\"",
    "• Mint: \"mint an NFT called Stellar Fox\"",
    "• List: \"list NFT #1 for 5 XLM\"",
    "• Buy: \"buy NFT #1\"",
    "• Transfer: \"transfer NFT #1 to G…\"",
    "• Holdings: \"view my NFTs\" / \"my NFTs\"",
    "",
    id?.startsWith("C")
      ? `Contract: ${id}`
      : "Deploy contracts/orbit-nft and set ORBIT_NFT_CONTRACT_ID=C…",
    `Settlement token: native XLM SAC (${NATIVE_XLM_SAC.slice(0, 8)}…)`,
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

  // Relative media from JSON often points at production — also allow local public assets
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
        ? `Here's your Orbit NFT — ${items[0].name}${items[0].name.includes(`#${items[0].tokenId}`) ? "" : ` (#${items[0].tokenId})`}.`
        : `Here's your collection — ${items.length} Orbit NFTs.`;

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
