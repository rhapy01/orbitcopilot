import { logger } from "./logger";
import { NETWORK_PASSPHRASE } from "./stellar";

const DEFINDEX_API_BASE = "https://api.defindex.io";
const DEFINDEX_NETWORK = "testnet";

/**
 * Official DeFindex testnet deployments:
 * https://github.com/defindex-io/stellar-contracts/blob/main/public/testnet.contracts.json
 * Verified live via GET /vault/{id}?network=testnet + POST /deposit (2026-07-16).
 */
export const DEFINDEX_TESTNET = {
  xlmVault: "CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6",
  usdcVault: "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN",
  cetesVault: "CBIS5TEMTNNOTBE3WXPQUAGUEDYZZVIWAKTXEQCOUJ34OJJ3FJ5NLF2P",
  /** Blend USDC SAC used by the USDC vault (not Circle classic USDC). */
  blendUsdcSac: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
  cetesSac: "CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC",
} as const;

export type DefindexAsset = "XLM" | "USDC" | "CETES";

export function defindexConfigured(): boolean {
  return Boolean(process.env.DEFINDEX_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.DEFINDEX_API_KEY?.trim() || "";
  if (!key) {
    throw new Error("DeFindex not configured. Set DEFINDEX_API_KEY in .env.");
  }
  return key;
}

export function normalizeDefindexAsset(raw: string): DefindexAsset | null {
  const u = raw.trim().toUpperCase();
  if (u === "XLM" || u === "NATIVE") return "XLM";
  if (u === "USDC" || u === "BLENDUSDC" || u === "BUSDC") return "USDC";
  if (u === "CETES") return "CETES";
  return null;
}

function vaultForAsset(asset: DefindexAsset): string {
  if (asset === "USDC") return DEFINDEX_TESTNET.usdcVault;
  if (asset === "CETES") return DEFINDEX_TESTNET.cetesVault;
  return DEFINDEX_TESTNET.xlmVault;
}

function parse7DecimalsToStroops(rawAmount: string): bigint {
  const t = rawAmount.trim();
  if (!t) return 0n;
  const isNeg = t.startsWith("-");
  const normalized = isNeg ? t.slice(1) : t;
  const [wholeRaw, fracRaw = ""] = normalized.split(".");
  const whole = BigInt(wholeRaw || "0");
  const fracPadded = (fracRaw + "0000000").slice(0, 7);
  const frac = BigInt(fracPadded || "0");
  const total = whole * 10_000_000n + frac;
  return isNeg ? -total : total;
}

function stroopsToNumber(stroops: bigint): number {
  if (stroops > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount too large for DeFindex JSON number. Use a smaller amount.");
  }
  return Number(stroops);
}

async function defindexFetch(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: any }> {
  let finalUrl = `${DEFINDEX_API_BASE}${path}`;
  if (!finalUrl.includes("network=")) {
    finalUrl += `${finalUrl.includes("?") ? "&" : "?"}network=${DEFINDEX_NETWORK}`;
  }

  const res = await fetch(finalUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function formatApiError(data: any, status: number, fallback: string): string {
  const code = typeof data?.errorCode === "number" ? ` (#${data.errorCode})` : "";
  if (typeof data?.message === "string" && data.message.includes("MissingTrustline")) {
    return "Wallet is missing the vault token trustline/balance (Blend USDC for USDC vault, Blend CETES for CETES vault). Fund via Blend testnet faucet, then retry.";
  }
  if (typeof data?.error === "string" && data.error !== "Bad Request" && data.error !== "Simulation Failed") {
    return `${data.error}${code}`;
  }
  if (typeof data?.message === "string") return `${data.message}${code}`;
  if (Array.isArray(data?.message)) return data.message.join("; ");
  if (typeof data?.error === "string") return `${data.error}${code}`;
  return `${fallback} (HTTP ${status})`;
}

export type DefindexVaultInfo = {
  address: string;
  name: string;
  symbol: string;
  apy: number | null;
  assetSymbol: DefindexAsset;
};

export async function getDefindexVaultInfo(asset: DefindexAsset): Promise<DefindexVaultInfo> {
  const address = vaultForAsset(asset);
  const [infoRes, apyRes] = await Promise.all([
    defindexFetch(`/vault/${address}`),
    defindexFetch(`/vault/${address}/apy`),
  ]);

  if (!infoRes.ok) {
    throw new Error(formatApiError(infoRes.data, infoRes.status, "Could not load DeFindex vault"));
  }

  const apy =
    typeof apyRes.data?.apy === "number"
      ? apyRes.data.apy
      : typeof infoRes.data?.apy === "number"
        ? infoRes.data.apy
        : null;

  return {
    address,
    name: String(infoRes.data?.name ?? `DeFindex ${asset} Vault`),
    symbol: String(infoRes.data?.symbol ?? "DFXV"),
    apy,
    assetSymbol: asset,
  };
}

/** @deprecated use getDefindexVaultInfo("XLM") */
export async function getDefindexXlmVaultInfo(): Promise<DefindexVaultInfo> {
  return getDefindexVaultInfo("XLM");
}

export async function formatDefindexStatus(): Promise<string> {
  if (!defindexConfigured()) {
    return "DeFindex is not configured. Set DEFINDEX_API_KEY in .env.";
  }
  try {
    const [xlm, usdc, cetes] = await Promise.all([
      getDefindexVaultInfo("XLM"),
      getDefindexVaultInfo("USDC"),
      getDefindexVaultInfo("CETES"),
    ]);
    const line = (v: DefindexVaultInfo) => {
      const apy = v.apy != null ? `${v.apy.toFixed(2)}% APY` : "APY n/a";
      return `• ${v.assetSymbol}: ${apy} (\`${v.address.slice(0, 8)}…\`)`;
    };
    return [
      `**DeFindex** (Stellar Testnet)`,
      line(xlm),
      line(usdc),
      line(cetes),
      ``,
      `USDC vault uses **Blend USDC**. CETES is the Blend CETES token.`,
      `Deposit: \"deposit 10 XLM into defindex\" / \"deposit 5 USDC into defindex\" / \"deposit 5 CETES into defindex\"`,
      `Withdraw: \"withdraw 5 XLM from defindex\"`,
    ].join("\n");
  } catch (err: any) {
    return `DeFindex status unavailable: ${err?.message ?? "unknown error"}`;
  }
}

type PrepResult = {
  xdr: string;
  networkPassphrase: string;
  vaultAddress: string;
  sendAmount: string;
  sendAsset: DefindexAsset;
  message: string;
};

export async function prepareDefindexDeposit(input: {
  walletAddress: string;
  amount: string;
  asset: string;
}): Promise<PrepResult> {
  const wallet = input.walletAddress.trim();
  if (!/^G[A-Z2-7]{55}$/.test(wallet)) {
    throw new Error("walletAddress required (Stellar public key)");
  }

  const asset = normalizeDefindexAsset(input.asset);
  if (!asset) {
    throw new Error("DeFindex supports XLM, USDC, or CETES only.");
  }

  const amountHuman = input.amount.trim();
  const amountNum = Number(amountHuman);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("amount must be a positive number");
  }

  const depositStroops = parse7DecimalsToStroops(amountHuman);
  if (depositStroops < 1001n) {
    throw new Error("Minimum DeFindex deposit is 1001 stroops (>= 0.0001001).");
  }

  const vaultAddress = vaultForAsset(asset);
  logger.info({ vaultAddress, amountHuman, asset, wallet }, "DeFindex deposit building XDR");

  const { ok, status, data } = await defindexFetch(`/vault/${vaultAddress}/deposit`, {
    method: "POST",
    body: JSON.stringify({
      amounts: [stroopsToNumber(depositStroops)],
      caller: wallet,
      invest: true,
      slippageBps: 50,
    }),
  });

  if (!ok) {
    throw new Error(formatApiError(data, status, "DeFindex deposit failed"));
  }
  if (!data?.xdr || typeof data.xdr !== "string") {
    throw new Error("DeFindex did not return an unsigned XDR");
  }

  let vaultLabel = `DeFindex ${asset} vault`;
  try {
    const info = await getDefindexVaultInfo(asset);
    const apyNote = info.apy != null ? ` (~${info.apy.toFixed(2)}% APY)` : "";
    vaultLabel = `${info.name}${apyNote}`;
  } catch {
    /* optional */
  }

  const tokenNote =
    asset === "USDC"
      ? " Uses Blend USDC. "
      : asset === "CETES"
        ? " Uses Blend CETES. "
        : " ";

  return {
    xdr: data.xdr,
    networkPassphrase: NETWORK_PASSPHRASE,
    vaultAddress,
    sendAmount: amountHuman,
    sendAsset: asset,
    message: `DeFindex: deposit ${amountHuman} ${asset} into ${vaultLabel}.${tokenNote}Sign to receive dfTokens.`,
  };
}

export async function prepareDefindexWithdraw(input: {
  walletAddress: string;
  amount: string;
  asset: string;
}): Promise<PrepResult> {
  const wallet = input.walletAddress.trim();
  if (!/^G[A-Z2-7]{55}$/.test(wallet)) {
    throw new Error("walletAddress required (Stellar public key)");
  }

  const asset = normalizeDefindexAsset(input.asset);
  if (!asset) {
    throw new Error("DeFindex supports XLM, USDC, or CETES only.");
  }

  const amountHuman = input.amount.trim();
  const amountNum = Number(amountHuman);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("amount must be a positive number");
  }

  const withdrawStroops = parse7DecimalsToStroops(amountHuman);
  if (withdrawStroops < 1n) {
    throw new Error("Withdraw amount too small");
  }

  const vaultAddress = vaultForAsset(asset);
  logger.info({ vaultAddress, amountHuman, asset, wallet }, "DeFindex withdraw building XDR");

  const { ok, status, data } = await defindexFetch(`/vault/${vaultAddress}/withdraw`, {
    method: "POST",
    body: JSON.stringify({
      amounts: [stroopsToNumber(withdrawStroops)],
      caller: wallet,
      slippageBps: 50,
    }),
  });

  if (!ok) {
    throw new Error(formatApiError(data, status, "DeFindex withdraw failed"));
  }
  if (!data?.xdr || typeof data.xdr !== "string") {
    throw new Error("DeFindex did not return an unsigned XDR");
  }

  return {
    xdr: data.xdr,
    networkPassphrase: NETWORK_PASSPHRASE,
    vaultAddress,
    sendAmount: amountHuman,
    sendAsset: asset,
    message: `DeFindex: withdraw ${amountHuman} ${asset} from the ${asset} vault. Sign to redeem dfTokens.`,
  };
}

/** Back-compat wrappers */
export async function prepareDefindexDepositXlm(input: {
  walletAddress: string;
  amountXlm: string;
}) {
  return prepareDefindexDeposit({
    walletAddress: input.walletAddress,
    amount: input.amountXlm,
    asset: "XLM",
  });
}

export async function prepareDefindexWithdrawXlm(input: {
  walletAddress: string;
  amountXlm: string;
}) {
  return prepareDefindexWithdraw({
    walletAddress: input.walletAddress,
    amount: input.amountXlm,
    asset: "XLM",
  });
}
