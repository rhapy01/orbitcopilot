import { storeNftMedia } from "./nft-media";

export type TokenMetadataInput = {
  name?: string;
  description?: string;
  image?: string;
  imageDataUrl?: string;
  website?: string;
  conditions?: string;
};

export function tokenHomeDomain(): string {
  const configured =
    process.env.ORBIT_PUBLIC_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    "orbitpilot.vercel.app";
  return configured
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .slice(0, 32);
}

export async function registerTokenMetadata(input: {
  issuer: string;
  code: string;
  contractId: string;
  metadata?: TokenMetadataInput;
}): Promise<void> {
  let imageUrl = input.metadata?.image?.trim() || null;
  if (input.metadata?.imageDataUrl) {
    const uploaded = await storeNftMedia({
      walletPublicKey: input.issuer,
      dataUrl: input.metadata.imageDataUrl,
    });
    imageUrl = uploaded.url;
  }

  const { db, launchedTokensTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const existing = await db
    .select()
    .from(launchedTokensTable)
    .where(
      and(
        eq(launchedTokensTable.issuer, input.issuer),
        eq(launchedTokensTable.code, input.code)
      )
    )
    .limit(1);
  const name =
    input.metadata?.name?.trim().slice(0, 64) ||
    existing[0]?.name ||
    input.code;
  const description =
    input.metadata?.description?.trim().slice(0, 1000) ||
    existing[0]?.description ||
    `${name} is a Stellar asset launched through Orbit Copilot.`;
  const website =
    input.metadata?.website?.trim().slice(0, 250) ||
    existing[0]?.website ||
    `https://${tokenHomeDomain()}`;
  const conditions =
    input.metadata?.conditions?.trim().slice(0, 1000) ||
    existing[0]?.conditions ||
    "Supply is controlled by the issuing Stellar account.";
  imageUrl = imageUrl || existing[0]?.imageUrl || null;

  const values = {
    issuer: input.issuer,
    code: input.code,
    contractId: input.contractId,
    name,
    description,
    imageUrl,
    website,
    conditions,
    decimals: 7,
    updatedAt: new Date(),
  };
  if (existing[0]) {
    await db
      .update(launchedTokensTable)
      .set(values)
      .where(eq(launchedTokensTable.id, existing[0].id));
  } else {
    await db.insert(launchedTokensTable).values(values);
  }
}

export async function listTokenMetadata() {
  const { db, launchedTokensTable } = await import("@workspace/db");
  const { isNotNull } = await import("drizzle-orm");
  return db
    .select()
    .from(launchedTokensTable)
    .where(isNotNull(launchedTokensTable.confirmedAt))
    .orderBy(launchedTokensTable.createdAt);
}

export async function confirmTokenMetadata(input: {
  issuer: string;
  code: string;
  txHash: string;
}): Promise<void> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const { TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
  const { SOROBAN_RPC } = await import("./stellar");
  const rpc = new Server(SOROBAN_RPC);
  const result = (await rpc.getTransaction(input.txHash)) as any;
  if (result.status !== "SUCCESS") {
    throw new Error("Token deployment transaction is not successful");
  }
  const envelopeXdr =
    result.envelopeXdr?.toXDR?.("base64") ??
    result.envelopeXdr ??
    result.envelope_xdr;
  if (!envelopeXdr || typeof envelopeXdr !== "string") {
    throw new Error("Could not verify deployment transaction source");
  }
  const tx = TransactionBuilder.fromXDR(envelopeXdr, Networks.TESTNET);
  const source =
    "source" in tx ? tx.source : tx.innerTransaction.source;
  if (source !== input.issuer) {
    throw new Error("Deployment transaction was not signed by this issuer");
  }

  const { db, launchedTokensTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  await db
    .update(launchedTokensTable)
    .set({ deployTxHash: input.txHash, confirmedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(launchedTokensTable.issuer, input.issuer),
        eq(launchedTokensTable.code, input.code)
      )
    );
}

function tomlString(value: string | null | undefined): string {
  return JSON.stringify(value ?? "");
}

export async function buildStellarToml(): Promise<string> {
  const tokens = await listTokenMetadata();
  const origin = `https://${tokenHomeDomain()}`;
  const lines = [
    "VERSION=\"2.0.0\"",
    `NETWORK_PASSPHRASE=${tomlString("Test SDF Network ; September 2015")}`,
    "",
    "[DOCUMENTATION]",
    `ORG_NAME=${tomlString("Orbit Copilot")}`,
    `ORG_URL=${tomlString(origin)}`,
    `ORG_DESCRIPTION=${tomlString(
      "Chat-based Stellar DeFi, NFT, and token launch infrastructure."
    )}`,
  ];

  for (const token of tokens) {
    lines.push(
      "",
      "[[CURRENCIES]]",
      `code=${tomlString(token.code)}`,
      `issuer=${tomlString(token.issuer)}`,
      `display_decimals=${token.decimals}`,
      `name=${tomlString(token.name)}`,
      `desc=${tomlString(token.description)}`,
      `image=${tomlString(token.imageUrl)}`,
      `conditions=${tomlString(token.conditions)}`,
      `contract=${tomlString(token.contractId)}`,
      "is_asset_anchored=false"
    );
  }
  return `${lines.join("\n")}\n`;
}
