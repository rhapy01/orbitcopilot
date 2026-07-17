/**
 * NFT media packs — ordered unique assets for sequential open mint.
 * Client unzips ZIP → uploads chunks → finalize → mint next uses total_supply()+1.
 */

import { randomBytes } from "crypto";
import { mediaPublicUrl, storeNftMedia } from "./nft-media";
import {
  metadataPublicUrl,
  storeNftMetadata,
  parseTraits,
} from "./nft-metadata";

export const NFT_PACK_MAX_ITEMS = 2000;
export const NFT_PACK_CHUNK_MAX = 15;

let ensured = false;

async function ensurePackTables(): Promise<void> {
  if (ensured) return;
  const { pool } = await import("@workspace/db");
  await pool.query(`
CREATE TABLE IF NOT EXISTS "nft_media_packs" (
  "id" text PRIMARY KEY NOT NULL,
  "creator" text NOT NULL,
  "name" text,
  "collection_contract" text,
  "expected_count" integer NOT NULL DEFAULT 0,
  "item_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'uploading',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "nft_media_packs_creator_idx" ON "nft_media_packs" ("creator");
CREATE INDEX IF NOT EXISTS "nft_media_packs_collection_idx" ON "nft_media_packs" ("collection_contract");
CREATE TABLE IF NOT EXISTS "nft_media_pack_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "pack_id" text NOT NULL REFERENCES "nft_media_packs"("id") ON DELETE CASCADE,
  "token_index" integer NOT NULL,
  "media_id" text NOT NULL,
  "metadata_id" text NOT NULL,
  "file_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("pack_id", "token_index")
);
CREATE INDEX IF NOT EXISTS "nft_media_pack_items_pack_idx" ON "nft_media_pack_items" ("pack_id");
`);
  ensured = true;
}

export type MediaPackItemInput = {
  /** 1-based token index (matches on-chain token_id). */
  tokenIndex: number;
  dataUrl: string;
  fileName?: string;
  name?: string;
  description?: string;
  traits?: string;
};

export async function createMediaPack(input: {
  walletAddress: string;
  name?: string;
  expectedCount?: number;
  collectionContract?: string;
}): Promise<{
  packId: string;
  expectedCount: number;
  status: string;
}> {
  await ensurePackTables();
  const expected = Math.max(
    0,
    Math.min(NFT_PACK_MAX_ITEMS, Math.floor(input.expectedCount ?? 0))
  );
  const packId = randomBytes(16).toString("hex");
  const { db, nftMediaPacksTable } = await import("@workspace/db");
  await db.insert(nftMediaPacksTable).values({
    id: packId,
    creator: input.walletAddress,
    name: input.name?.trim().slice(0, 128) || null,
    collectionContract: input.collectionContract?.trim() || null,
    expectedCount: expected,
    itemCount: 0,
    status: "uploading",
  });
  return { packId, expectedCount: expected, status: "uploading" };
}

export async function getMediaPack(packId: string) {
  await ensurePackTables();
  const { db, nftMediaPacksTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(nftMediaPacksTable)
    .where(eq(nftMediaPacksTable.id, packId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findPackForCollection(collectionContract: string) {
  await ensurePackTables();
  const { db, nftMediaPacksTable } = await import("@workspace/db");
  const { eq, and, desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(nftMediaPacksTable)
    .where(
      and(
        eq(nftMediaPacksTable.collectionContract, collectionContract),
        eq(nftMediaPacksTable.status, "ready")
      )
    )
    .orderBy(desc(nftMediaPacksTable.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLatestReadyPackForCreator(creator: string) {
  await ensurePackTables();
  const { db, nftMediaPacksTable } = await import("@workspace/db");
  const { eq, and, desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(nftMediaPacksTable)
    .where(
      and(
        eq(nftMediaPacksTable.creator, creator),
        eq(nftMediaPacksTable.status, "ready")
      )
    )
    .orderBy(desc(nftMediaPacksTable.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function addMediaPackItems(input: {
  packId: string;
  walletAddress: string;
  collectionName?: string;
  description?: string;
  items: MediaPackItemInput[];
}): Promise<{ added: number; itemCount: number }> {
  await ensurePackTables();
  const pack = await getMediaPack(input.packId);
  if (!pack) throw new Error("Media pack not found");
  if (pack.creator !== input.walletAddress) {
    throw new Error("Only the pack creator can upload items");
  }
  if (pack.status === "ready") {
    throw new Error(
      "Pack is already finalized — create a new pack to replace assets"
    );
  }
  if (!input.items.length) throw new Error("No items in chunk");
  if (input.items.length > NFT_PACK_CHUNK_MAX) {
    throw new Error(`Max ${NFT_PACK_CHUNK_MAX} items per upload chunk`);
  }

  const { db, nftMediaPackItemsTable, nftMediaPacksTable } = await import(
    "@workspace/db"
  );
  const { eq, sql } = await import("drizzle-orm");
  const baseName = input.collectionName?.trim() || pack.name || "Orbit NFT";
  let added = 0;

  for (const item of input.items) {
    const tokenIndex = Math.floor(item.tokenIndex);
    if (
      !Number.isFinite(tokenIndex) ||
      tokenIndex < 1 ||
      tokenIndex > NFT_PACK_MAX_ITEMS
    ) {
      throw new Error(`Invalid token index ${item.tokenIndex}`);
    }
    const media = await storeNftMedia({
      walletPublicKey: input.walletAddress,
      dataUrl: item.dataUrl,
    });
    const tokenName = (
      item.name?.trim() || `${baseName} #${tokenIndex}`
    ).slice(0, 128);
    const meta = await storeNftMetadata({
      walletPublicKey: input.walletAddress,
      collectionContract: pack.collectionContract ?? undefined,
      metadata: {
        name: tokenName,
        description:
          item.description?.trim() ||
          input.description?.trim() ||
          `${baseName} #${tokenIndex} — Orbit Copilot media pack.`,
        image: media.url,
        attributes: [
          { trait_type: "Token", value: tokenIndex },
          { trait_type: "Pack", value: input.packId.slice(0, 8) },
          ...(parseTraits(item.traits) ?? []),
        ],
      },
    });

    await db
      .insert(nftMediaPackItemsTable)
      .values({
        packId: input.packId,
        tokenIndex,
        mediaId: media.id,
        metadataId: meta.id,
        fileName: item.fileName?.slice(0, 200) || null,
      })
      .onConflictDoUpdate({
        target: [
          nftMediaPackItemsTable.packId,
          nftMediaPackItemsTable.tokenIndex,
        ],
        set: {
          mediaId: media.id,
          metadataId: meta.id,
          fileName: item.fileName?.slice(0, 200) || null,
        },
      });
    added += 1;
  }

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(nftMediaPackItemsTable)
    .where(eq(nftMediaPackItemsTable.packId, input.packId));
  const itemCount = Number(countRows[0]?.n ?? 0);

  await db
    .update(nftMediaPacksTable)
    .set({ itemCount, updatedAt: new Date(), status: "uploading" })
    .where(eq(nftMediaPacksTable.id, input.packId));

  return { added, itemCount };
}

export async function finalizeMediaPack(input: {
  packId: string;
  walletAddress: string;
}): Promise<{ packId: string; itemCount: number; status: string }> {
  await ensurePackTables();
  const pack = await getMediaPack(input.packId);
  if (!pack) throw new Error("Media pack not found");
  if (pack.creator !== input.walletAddress) {
    throw new Error("Only the pack creator can finalize");
  }
  if (pack.itemCount < 1) {
    throw new Error("Upload at least one asset before finalizing");
  }
  if (pack.expectedCount > 0 && pack.itemCount < pack.expectedCount) {
    throw new Error(
      `Pack incomplete: ${pack.itemCount}/${pack.expectedCount} assets uploaded`
    );
  }

  const { db, nftMediaPacksTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(nftMediaPacksTable)
    .set({
      status: "ready",
      expectedCount: pack.expectedCount || pack.itemCount,
      updatedAt: new Date(),
    })
    .where(eq(nftMediaPacksTable.id, input.packId));

  return {
    packId: input.packId,
    itemCount: pack.itemCount,
    status: "ready",
  };
}

export async function bindMediaPackToCollection(input: {
  packId: string;
  walletAddress: string;
  collectionContract: string;
}): Promise<void> {
  await ensurePackTables();
  const pack = await getMediaPack(input.packId);
  if (!pack) throw new Error("Media pack not found");
  if (pack.creator !== input.walletAddress) {
    throw new Error("Only the pack creator can bind the collection");
  }
  const contract = input.collectionContract.trim();
  if (!contract.startsWith("C")) {
    throw new Error("collectionContract must be a C… Soroban address");
  }
  const { db, nftMediaPacksTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(nftMediaPacksTable)
    .set({ collectionContract: contract, updatedAt: new Date() })
    .where(eq(nftMediaPacksTable.id, input.packId));
}

export async function getPackItem(packId: string, tokenIndex: number) {
  await ensurePackTables();
  const { db, nftMediaPackItemsTable } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(nftMediaPackItemsTable)
    .where(
      and(
        eq(nftMediaPackItemsTable.packId, packId),
        eq(nftMediaPackItemsTable.tokenIndex, tokenIndex)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve metadata URI for the next mint (token_id = totalSupply + 1). */
export async function resolveNextPackMint(input: {
  collectionContract?: string;
  mediaPackId?: string;
  walletAddress?: string;
}): Promise<{
  packId: string;
  tokenIndex: number;
  name: string;
  metadataUri: string;
  imageUrl: string;
  itemCount: number;
} | null> {
  await ensurePackTables();
  let pack = input.mediaPackId ? await getMediaPack(input.mediaPackId) : null;
  if (!pack && input.collectionContract) {
    pack = await findPackForCollection(input.collectionContract);
  }
  if (!pack && input.walletAddress) {
    pack = await findLatestReadyPackForCreator(input.walletAddress);
  }
  if (!pack || pack.status !== "ready") return null;

  const contractId =
    input.collectionContract?.trim() || pack.collectionContract || undefined;
  if (!contractId?.startsWith("C")) {
    throw new Error(
      "Bind this media pack to a collection contract first (after deploy), then mint."
    );
  }

  const { SOROBAN_RPC } = await import("./stellar");
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
    .addOperation(contract.call("total_supply"))
    .setTimeout(30)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = (sim as any)?.result?.retval;
  const minted = retval != null ? Number(scValToNative(retval)) : 0;
  const tokenIndex = (Number.isFinite(minted) ? minted : 0) + 1;

  if (tokenIndex > pack.itemCount) {
    throw new Error(`Media pack sold out (${pack.itemCount}/${pack.itemCount}).`);
  }

  const item = await getPackItem(pack.id, tokenIndex);
  if (!item) {
    throw new Error(
      `Missing pack asset for token #${tokenIndex}. Re-upload that index.`
    );
  }

  const metadataUri = metadataPublicUrl(item.metadataId);
  const imageUrl = mediaPublicUrl(item.mediaId);
  const name = `${pack.name || "Orbit NFT"} #${tokenIndex}`;

  if (!pack.collectionContract && input.walletAddress) {
    await bindMediaPackToCollection({
      packId: pack.id,
      walletAddress: input.walletAddress,
      collectionContract: contractId,
    });
  }

  return {
    packId: pack.id,
    tokenIndex,
    name,
    metadataUri,
    imageUrl,
    itemCount: pack.itemCount,
  };
}

/** Sort filenames into 1-based token indices (1.png, 001.jpg, or alpha order). */
export function indexFromFileName(
  fileName: string,
  fallbackIndex: number
): number {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const m = base.match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return fallbackIndex;
}
