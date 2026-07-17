/**
 * SEP-50 / OpenSea-compatible metadata hosting for chat-driven NFT mints.
 * Stores JSON off-chain; token_uri on-chain points here.
 */

import { randomBytes } from "crypto";

export type Sep50Metadata = {
  name: string;
  description?: string;
  image?: string;
  animation_url?: string;
  external_url?: string;
  banner_image?: string;
  featured_image?: string;
  attributes?: Array<{
    trait_type?: string;
    value?: string | number;
    display_type?: string;
    max_value?: number;
  }>;
};

function publicBaseUrl(): string {
  const fromEnv =
    process.env.ORBIT_PUBLIC_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (fromEnv) {
    return fromEnv.startsWith("http") ? fromEnv.replace(/\/$/, "") : `https://${fromEnv}`;
  }
  return "https://orbitpilot.vercel.app";
}

export function metadataPublicUrl(id: string): string {
  return `${publicBaseUrl()}/api/nft/meta/${id}`;
}

export async function storeNftMetadata(input: {
  walletPublicKey?: string;
  collectionContract?: string;
  metadata: Sep50Metadata;
}): Promise<{ id: string; uri: string }> {
  const id = randomBytes(16).toString("hex");
  const payload = {
    name: input.metadata.name.slice(0, 128),
    description: input.metadata.description?.slice(0, 2000) ?? "",
    image: input.metadata.image ?? "",
    animation_url: input.metadata.animation_url ?? "",
    external_url: input.metadata.external_url ?? publicBaseUrl(),
    banner_image: input.metadata.banner_image ?? "",
    featured_image: input.metadata.featured_image ?? "",
    attributes: input.metadata.attributes ?? [],
  };

  try {
    const { db, nftMetadataTable } = await import("@workspace/db");
    await db.insert(nftMetadataTable).values({
      id,
      walletPublicKey: input.walletPublicKey ?? null,
      collectionContract: input.collectionContract ?? null,
      payload,
    });
  } catch (err) {
    // Fallback: process memory (dev / DB unavailable). Not durable on serverless.
    const g = globalThis as unknown as { __orbitNftMeta?: Map<string, Sep50Metadata> };
    if (!g.__orbitNftMeta) g.__orbitNftMeta = new Map();
    g.__orbitNftMeta.set(id, payload);
    console.warn("[nft-metadata] DB insert failed; using memory store", err);
  }

  return { id, uri: metadataPublicUrl(id) };
}

export async function getNftMetadata(id: string): Promise<Sep50Metadata | null> {
  try {
    const { db, nftMetadataTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(nftMetadataTable)
      .where(eq(nftMetadataTable.id, id))
      .limit(1);
    if (rows[0]?.payload && typeof rows[0].payload === "object") {
      return rows[0].payload as Sep50Metadata;
    }
  } catch {
    /* fall through */
  }
  const g = globalThis as unknown as { __orbitNftMeta?: Map<string, Sep50Metadata> };
  return g.__orbitNftMeta?.get(id) ?? null;
}

/** Parse trait strings like "Background=Nebula,Rarity=Legendary". */
export function parseTraits(
  raw?: string
): Sep50Metadata["attributes"] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return { trait_type: "Trait", value: part };
      return {
        trait_type: part.slice(0, eq).trim() || "Trait",
        value: part.slice(eq + 1).trim(),
      };
    });
}
