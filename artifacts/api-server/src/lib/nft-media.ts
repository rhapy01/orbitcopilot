import { createHash, randomBytes } from "crypto";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
]);

function publicBaseUrl(): string {
  const configured =
    process.env.ORBIT_PUBLIC_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!configured) return "https://orbitpilot.vercel.app";
  return configured.startsWith("http")
    ? configured.replace(/\/$/, "")
    : `https://${configured}`;
}

export function mediaPublicUrl(id: string): string {
  return `${publicBaseUrl()}/api/nft/media/${id}`;
}

export function decodeMediaDataUrl(dataUrl: string): {
  mimeType: string;
  data: Buffer;
} {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    dataUrl.trim()
  );
  if (!match) {
    throw new Error("Media must be a base64 data URL");
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.has(mimeType)) {
    throw new Error(`Unsupported media type: ${mimeType}`);
  }
  const data = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!data.length) throw new Error("Media file is empty");
  if (data.length > MAX_MEDIA_BYTES) {
    throw new Error("Media file exceeds the 8 MB limit");
  }
  return { mimeType, data };
}

export async function storeNftMedia(input: {
  walletPublicKey?: string;
  dataUrl: string;
}): Promise<{ id: string; url: string; mimeType: string; byteSize: number }> {
  const { mimeType, data } = decodeMediaDataUrl(input.dataUrl);
  const id = randomBytes(16).toString("hex");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const { db, nftMediaTable } = await import("@workspace/db");

  await db.insert(nftMediaTable).values({
    id,
    walletPublicKey: input.walletPublicKey ?? null,
    mimeType,
    byteSize: data.length,
    sha256,
    data,
  });

  return {
    id,
    url: mediaPublicUrl(id),
    mimeType,
    byteSize: data.length,
  };
}

export async function getNftMedia(id: string): Promise<{
  mimeType: string;
  data: Buffer;
  sha256: string;
} | null> {
  const { db, nftMediaTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      mimeType: nftMediaTable.mimeType,
      data: nftMediaTable.data,
      sha256: nftMediaTable.sha256,
    })
    .from(nftMediaTable)
    .where(eq(nftMediaTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}
