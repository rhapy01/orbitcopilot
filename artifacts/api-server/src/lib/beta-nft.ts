/**
 * Orbit Co-Pilot Beta tester NFT — earned by submitting product feedback.
 * One claim per wallet; mint XDR is only issued to whitelisted wallets.
 * Media: /orbitpilot-tester.mp4 · Metadata: /nft/orbit-beta-tester.json
 */

export const BETA_NFT_NAME = "Orbit Co-Pilot Beta tester";
export const BETA_NFT_DESCRIPTION =
  "Appreciating the users who took time to test Orbit Copilot. Limited beta collection — total supply 7777.";
export const BETA_NFT_MAX_SUPPLY = 7777;

/** Public metadata JSON (includes animation_url → mp4). */
export const BETA_NFT_URI =
  process.env.BETA_NFT_METADATA_URL?.trim() ||
  "https://orbitpilot.vercel.app/nft/orbit-beta-tester.json";

export const BETA_NFT_MEDIA_URL =
  process.env.BETA_NFT_MEDIA_URL?.trim() ||
  "https://orbitpilot.vercel.app/orbitpilot-tester.mp4";

/** Chat prompt auto-sent after successful feedback + whitelist. */
export const BETA_NFT_CLAIM_PROMPT =
  "i have submitted my feedback, mint my beta tester nft";

export function isBetaNftMetadata(name?: string | null, uri?: string | null): boolean {
  if (uri && (uri === BETA_NFT_URI || uri.includes("orbit-beta-tester"))) return true;
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n === BETA_NFT_NAME.toLowerCase() ||
    n.includes("beta tester") ||
    n.includes("orbit beta")
  );
}
