import { logger } from "./logger";
import { withRetry } from "./retry";

const FRIENDBOT = "https://friendbot.stellar.org";

/** Fund a testnet account with XLM via Friendbot. */
export async function fundWithFriendbot(publicKey: string): Promise<{
  success: boolean;
  hash?: string;
  message: string;
}> {
  if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
    return { success: false, message: "Invalid Stellar public key" };
  }

  try {
    const res = await withRetry(
      () => fetch(`${FRIENDBOT}?addr=${encodeURIComponent(publicKey)}`),
      { label: "friendbot", retries: 1 }
    );
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.detail || data.title || `Friendbot HTTP ${res.status}`;
      // Already funded is often a 400
      if (/already|exists|op_already/i.test(String(msg))) {
        return {
          success: true,
          message: "Account is already funded on testnet.",
        };
      }
      return { success: false, message: String(msg) };
    }
    const hash = data.hash || data.result_meta_xdr ? data.hash : undefined;
    logger.info({ publicKey, hash }, "Friendbot funded account");
    return {
      success: true,
      hash,
      message: `Funded ${publicKey.slice(0, 4)}…${publicKey.slice(-4)} with testnet XLM via Friendbot.`,
    };
  } catch (err: any) {
    logger.error({ err, publicKey }, "Friendbot failed");
    return { success: false, message: err?.message ?? "Friendbot request failed" };
  }
}
