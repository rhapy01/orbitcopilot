import { Film, ImageIcon, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

function mediaSrc(item: NftGalleryItem): string | null {
  const raw = item.animationUrl || item.imageUrl;
  if (!raw) return null;
  // Prefer local asset when production URL is used for beta mp4
  if (raw.includes("orbitpilot-tester.mp4")) return "/orbitpilot-tester.mp4";
  return raw;
}

function isVideo(item: NftGalleryItem, src: string | null): boolean {
  if (item.mediaType === "video") return true;
  if (!src) return false;
  const u = src.toLowerCase();
  return u.includes(".mp4") || u.includes(".webm") || u.includes(".mov");
}

export function NftGallery({
  gallery,
  onAction,
}: {
  gallery: NftGalleryPayload;
  onAction?: (prompt: string) => void;
}) {
  const items = gallery.items ?? [];
  if (!items.length) {
    return (
      <div className="mt-2 max-w-md rounded-2xl border border-dashed border-primary/20 bg-orbit-gradient-subtle/40 px-4 py-6 text-center">
        <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">No NFTs in this wallet yet</p>
      </div>
    );
  }

  return (
    <div className="mt-3 w-full max-w-lg">
      <div
        className={cn(
          "grid gap-3",
          items.length === 1 ? "grid-cols-1" : "grid-cols-2"
        )}
      >
        {items.map((item) => {
          const src = mediaSrc(item);
          const video = isVideo(item, src);
          return (
            <article
              key={item.tokenId}
              className="overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-primary/10"
            >
              <div className="relative aspect-square bg-muted/40">
                {src && video ? (
                  <video
                    src={src}
                    className="h-full w-full object-cover"
                    autoPlay
                    muted
                    loop
                    playsInline
                    poster={item.imageUrl && !isVideo(item, item.imageUrl) ? item.imageUrl : undefined}
                  />
                ) : src ? (
                  <img
                    src={src}
                    alt={item.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Film className="h-8 w-8 opacity-40" />
                    <span className="text-xs">#{item.tokenId}</span>
                  </div>
                )}
                {item.listedPriceXlm && (
                  <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    <Tag className="h-3 w-3" />
                    {item.listedPriceXlm} XLM
                  </div>
                )}
              </div>
              <div className="space-y-2 p-3">
                <div>
                  <p className="truncate text-sm font-semibold leading-tight">{item.name}</p>
                  <p className="text-[11px] text-muted-foreground">#{item.tokenId}</p>
                </div>
                {item.description && (
                  <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {item.description}
                  </p>
                )}
                {onAction && (
                  <div className="flex gap-1.5 pt-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 rounded-lg text-[11px]"
                      onClick={() =>
                        onAction(`list NFT #${item.tokenId} for 5 XLM`)
                      }
                    >
                      List
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 flex-1 rounded-lg text-[11px]"
                      onClick={() =>
                        onAction(`transfer NFT #${item.tokenId} to `)
                      }
                    >
                      Transfer
                    </Button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
