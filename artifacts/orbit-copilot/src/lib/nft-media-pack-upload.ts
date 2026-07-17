/**
 * Client-side ZIP → chunked media pack upload for unique NFT drops.
 */

import JSZip from "jszip";

const CHUNK = 8;
const MAX_ITEMS = 2000;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i;

export type PackUploadProgress = {
  phase: "unzip" | "create" | "upload" | "finalize" | "done";
  uploaded: number;
  total: number;
  message: string;
};

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read file"));
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function indexFromName(name: string, fallback: number): number {
  const base = name.split(/[/\\]/).pop() || name;
  const m = base.match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return fallback;
}

export async function uploadNftMediaPack(input: {
  zipFile: File;
  walletAddress: string;
  name?: string;
  expectedCount?: number;
  collectionContract?: string;
  description?: string;
  onProgress?: (p: PackUploadProgress) => void;
}): Promise<{ packId: string; itemCount: number }> {
  const report = (p: PackUploadProgress) => input.onProgress?.(p);
  report({
    phase: "unzip",
    uploaded: 0,
    total: 0,
    message: "Reading ZIP…",
  });

  const zip = await JSZip.loadAsync(input.zipFile);
  const entries = Object.keys(zip.files)
    .filter((k) => !zip.files[k]!.dir && IMAGE_EXT.test(k) && !k.includes("__MACOSX"))
    .sort((a, b) => {
      const ia = indexFromName(a, 0);
      const ib = indexFromName(b, 0);
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });

  if (!entries.length) {
    throw new Error("ZIP has no images (png/jpg/gif/webp/svg/mp4/webm)");
  }
  if (entries.length > MAX_ITEMS) {
    throw new Error(`Too many files (max ${MAX_ITEMS})`);
  }

  const total = entries.length;
  report({
    phase: "create",
    uploaded: 0,
    total,
    message: `Found ${total} assets — creating pack…`,
  });

  const createRes = await fetch("/api/nft/media-pack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: input.walletAddress,
      name: input.name,
      expectedCount: input.expectedCount || total,
      collectionContract: input.collectionContract,
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.packId) {
    throw new Error(
      typeof created?.error === "string" ? created.error : "Could not create media pack"
    );
  }
  const packId = created.packId as string;

  let uploaded = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const items = [];
    for (let j = 0; j < slice.length; j++) {
      const path = slice[j]!;
      const blob = await zip.files[path]!.async("blob");
      if (blob.size > 8 * 1024 * 1024) {
        throw new Error(`${path} exceeds 8 MB`);
      }
      const dataUrl = await fileToDataUrl(blob);
      const tokenIndex = indexFromName(path, i + j + 1);
      items.push({
        tokenIndex,
        dataUrl,
        fileName: path.split(/[/\\]/).pop(),
      });
    }

    report({
      phase: "upload",
      uploaded,
      total,
      message: `Uploading ${uploaded + 1}–${Math.min(uploaded + items.length, total)} of ${total}…`,
    });

    const upRes = await fetch(`/api/nft/media-pack/${packId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: input.walletAddress,
        collectionName: input.name,
        description: input.description,
        items,
      }),
    });
    const upData = await upRes.json().catch(() => ({}));
    if (!upRes.ok) {
      throw new Error(
        typeof upData?.error === "string" ? upData.error : "Pack chunk upload failed"
      );
    }
    uploaded += items.length;
  }

  report({
    phase: "finalize",
    uploaded: total,
    total,
    message: "Finalizing pack…",
  });

  const finRes = await fetch(`/api/nft/media-pack/${packId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: input.walletAddress }),
  });
  const fin = await finRes.json().catch(() => ({}));
  if (!finRes.ok) {
    throw new Error(
      typeof fin?.error === "string" ? fin.error : "Could not finalize media pack"
    );
  }

  report({
    phase: "done",
    uploaded: total,
    total,
    message: `Pack ready — ${fin.itemCount ?? total} unique assets`,
  });

  return { packId, itemCount: Number(fin.itemCount ?? total) };
}
