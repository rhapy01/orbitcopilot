/**
 * Circle CCTP V2 on Stellar Testnet — burn USDC and mint on EVM testnets.
 * Contracts: https://developers.circle.com/cctp/references/stellar-contracts
 *
 * deposit_for_burn pulls USDC via transfer_from — caller must approve
 * TokenMessengerMinter on the Circle USDC SAC first (same pattern as Circle's
 * reference scripts).
 */
import { logger } from "./logger";
import { NETWORK_PASSPHRASE } from "./stellar";
import {
  TESTNET_USDC_SAC,
  buildContractInvoke,
  simulateContractView,
} from "./onchain";

/** Stellar Testnet CCTP domain + contracts (Circle official). */
export const CCTP_STELLAR = {
  domain: 27,
  tokenMessengerMinter: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
  messageTransmitter: "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
  forwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  /** Circle USDC SAC on Stellar testnet (7 decimals). */
  usdc: TESTNET_USDC_SAC,
} as const;

/** Iris attestation API (sandbox for testnet). */
const IRIS_BASE = "https://iris-api-sandbox.circle.com";

export type CctpDestChain = "base" | "ethereum" | "arbitrum" | "optimism" | "arc";

export const CCTP_DEST_DOMAINS: Record<
  CctpDestChain,
  {
    domain: number;
    label: string;
    explorerTx: (hash: string) => string;
    explorerAddress: (addr: string) => string;
  }
> = {
  ethereum: {
    domain: 0,
    label: "Ethereum Sepolia",
    explorerTx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.etherscan.io/address/${a}`,
  },
  base: {
    domain: 6,
    label: "Base Sepolia",
    explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.basescan.org/address/${a}`,
  },
  arbitrum: {
    domain: 3,
    label: "Arbitrum Sepolia",
    explorerTx: (h) => `https://sepolia.arbiscan.io/tx/${h}`,
    explorerAddress: (a) => `https://sepolia.arbiscan.io/address/${a}`,
  },
  optimism: {
    domain: 2,
    label: "OP Sepolia",
    explorerTx: (h) => `https://sepolia-optimism.etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://sepolia-optimism.etherscan.io/address/${a}`,
  },
  /** Circle Arc Testnet — CCTP domain 26; gas is native USDC. */
  arc: {
    domain: 26,
    label: "Arc Testnet",
    explorerTx: (h) => `https://testnet.arcscan.app/tx/${h}`,
    explorerAddress: (a) => `https://testnet.arcscan.app/address/${a}`,
  },
};

export function resolveCctpDest(raw?: string | null): CctpDestChain {
  const t = (raw ?? "base").trim().toLowerCase();
  // Arc before loose substring checks — "Arc Testnet" must never become Base/OP.
  if (/\barc\b/.test(t)) return "arc";
  if (/\barbitrum\b/.test(t) || /^(arb)\b/.test(t)) return "arbitrum";
  if (/\boptimism\b/.test(t) || /^(op)\b/.test(t) || /\boptimistic\b/.test(t)) {
    return "optimism";
  }
  if (/\bethereum\b/.test(t) || /^(eth)\b/.test(t)) return "ethereum";
  if (/\bbase\b/.test(t)) return "base";
  // Exact keys from destAsset field
  if (t === "arc") return "arc";
  if (t === "arbitrum" || t === "arb") return "arbitrum";
  if (t === "optimism" || t === "op") return "optimism";
  if (t === "ethereum" || t === "eth" || t === "sepolia") return "ethereum";
  return "base";
}

function parseUsdcToStroops(raw: string): bigint {
  const t = raw.trim();
  if (!t || !/^\d+(\.\d+)?$/.test(t)) {
    throw new Error("USDC amount must be a positive number");
  }
  const [wholeRaw, fracRaw = ""] = t.split(".");
  const whole = BigInt(wholeRaw || "0");
  const fracPadded = (fracRaw + "0000000").slice(0, 7);
  const total = whole * 10_000_000n + BigInt(fracPadded || "0");
  if (total <= 0n) throw new Error("USDC amount must be positive");
  return total;
}

function stroopsToHuman(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const whole = v / 10_000_000n;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  const s = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${s}` : s;
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

function mapCctpSimError(err: unknown): Error {
  const msg = String((err as any)?.message ?? err ?? "");
  if (/Error\(Contract,\s*#9\)/i.test(msg)) {
    return new Error(
      "Bridge couldn’t start: not enough Circle USDC, or spending isn’t allowed yet. Confirm step 1 first, then step 2."
    );
  }
  if (/more than one operation/i.test(msg)) {
    return new Error(
      "This bridge needs two separate confirmations. Retry — Orbit will show step 1 first."
    );
  }
  if (/Error\(Contract,\s*#7105\)/i.test(msg) || /InsufficientMaxFee/i.test(msg)) {
    return new Error(
      "CCTP max fee is below Circle’s minimum for this amount. Retry the bridge (Orbit refreshes min fee from the contract)."
    );
  }
  if (/Error\(Contract,\s*#7106\)/i.test(msg)) {
    return new Error("CCTP: no TokenMessenger registered for that destination domain.");
  }
  return err instanceof Error ? err : new Error(msg || "CCTP prepare failed");
}

/** Left-pad a 0x EVM address to 32 bytes for CCTP mint_recipient / destination_caller. */
export function evmAddressToBytes32(address: string): Buffer {
  const hex = address.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error("Destination must be a 0x EVM address (40 hex chars)");
  }
  return Buffer.concat([Buffer.alloc(12, 0), Buffer.from(hex, "hex")]);
}

export function normalizeEvmAddress(raw: string): string {
  const t = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) {
    throw new Error("Destination must be a 0x EVM address (40 hex chars)");
  }
  return `0x${t.slice(2).toLowerCase()}`;
}

function zeroBytes32(): Buffer {
  return Buffer.alloc(32, 0);
}

async function readUsdcAllowance(owner: string, spender: string): Promise<bigint> {
  const { Address } = await import("@stellar/stellar-sdk");
  try {
    const v = await simulateContractView({
      sourcePublicKey: owner,
      contractId: CCTP_STELLAR.usdc,
      method: "allowance",
      args: [Address.fromString(owner).toScVal(), Address.fromString(spender).toScVal()],
    });
    return toBigInt(v);
  } catch (err) {
    logger.warn({ err }, "CCTP allowance read failed");
    return 0n;
  }
}

async function readMinFeeLocal(wallet: string, amountLocal: bigint): Promise<bigint> {
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  try {
    const v = await simulateContractView({
      sourcePublicKey: wallet,
      contractId: CCTP_STELLAR.tokenMessengerMinter,
      method: "get_min_fee_amount",
      args: [
        Address.fromString(CCTP_STELLAR.usdc).toScVal(),
        nativeToScVal(amountLocal.toString(), { type: "i128" }),
      ],
    });
    return toBigInt(v);
  } catch (err) {
    logger.warn({ err }, "CCTP min fee read failed");
    return 0n;
  }
}

async function latestLedgerSequence(): Promise<number> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const { SOROBAN_RPC } = await import("./stellar");
  const rpc = new Server(SOROBAN_RPC);
  const latest = await rpc.getLatestLedger();
  return Number(latest.sequence);
}

export type CctpBridgePending = {
  type: "cctp_bridge";
  sendAmount: string;
  sendAsset: "USDC";
  destAsset: string;
  destination: string;
  marketHint: string;
  poolContract: string;
  destinationDomain: number;
  sourceDomain: number;
  cctpStep: "burn";
};

export type CctpApproveAction = {
  type: "cctp_bridge";
  /** Step 1: USDC approve for TokenMessenger (single-op). */
  cctpStep: "approve";
  sendAmount: string;
  sendAsset: "USDC";
  destAsset: string;
  destination: string;
  marketHint: string;
  poolContract: string;
  xdr: string;
  networkPassphrase: string;
  message: string;
  pendingAction: CctpBridgePending;
};

export type CctpBridgeAction = {
  type: "cctp_bridge";
  cctpStep: "burn";
  sendAmount: string;
  sendAsset: "USDC";
  destAsset: string;
  destination: string;
  marketHint: string;
  poolContract: string;
  xdr: string;
  networkPassphrase: string;
  message: string;
  destinationDomain: number;
  sourceDomain: number;
};

async function buildUsdcApproveXdr(input: {
  walletAddress: string;
  amount: bigint;
}): Promise<{ xdr: string; networkPassphrase: string }> {
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const ledger = await latestLedgerSequence();
  const expirationLedger = ledger + 100_000;
  return buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId: CCTP_STELLAR.usdc,
    method: "approve",
    args: [
      Address.fromString(input.walletAddress).toScVal(),
      Address.fromString(CCTP_STELLAR.tokenMessengerMinter).toScVal(),
      nativeToScVal(input.amount.toString(), { type: "i128" }),
      nativeToScVal(expirationLedger, { type: "u32" }),
    ],
  });
}

/** Build USDC approve for TokenMessengerMinter (single-op — Freighter/Soroban constraint). */
export async function prepareCctpApprove(input: {
  walletAddress: string;
  amount: string;
  destinationEvm: string;
  destChain?: string;
}): Promise<CctpApproveAction> {
  if (!input.walletAddress?.startsWith("G")) {
    throw new Error("Connect a Stellar wallet first");
  }
  const destChain = resolveCctpDest(input.destChain);
  const destMeta = CCTP_DEST_DOMAINS[destChain];
  const destination = normalizeEvmAddress(input.destinationEvm);
  const amount = parseUsdcToStroops(input.amount);
  const human = stroopsToHuman(amount);

  let built: { xdr: string; networkPassphrase: string };
  try {
    built = await buildUsdcApproveXdr({ walletAddress: input.walletAddress, amount });
  } catch (err) {
    throw mapCctpSimError(err);
  }

  return {
    type: "cctp_bridge",
    cctpStep: "approve",
    sendAmount: human,
    sendAsset: "USDC",
    destAsset: destChain,
    destination,
    marketHint: `${destMeta.label} · ${destination}`,
    poolContract: CCTP_STELLAR.usdc,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase || NETWORK_PASSPHRASE,
    message: `Bridge **${human} USDC** to **${destMeta.label}** (${truncateEvmAddress(destination)}). Confirm twice in your wallet.`,
    pendingAction: {
      type: "cctp_bridge",
      cctpStep: "burn",
      sendAmount: human,
      sendAsset: "USDC",
      destAsset: destChain,
      destination,
      marketHint: `${destMeta.label} · ${destination}`,
      poolContract: CCTP_STELLAR.tokenMessengerMinter,
      destinationDomain: destMeta.domain,
      sourceDomain: CCTP_STELLAR.domain,
    },
  };
}

export async function getCctpAllowanceStatus(input: {
  walletAddress: string;
  amount: string;
}): Promise<{ allowance: string; needed: string; ready: boolean }> {
  const amount = parseUsdcToStroops(input.amount);
  const allowance = await readUsdcAllowance(
    input.walletAddress,
    CCTP_STELLAR.tokenMessengerMinter
  );
  return {
    allowance: stroopsToHuman(allowance),
    needed: stroopsToHuman(amount),
    ready: allowance >= amount,
  };
}

export async function prepareCctpBridge(input: {
  walletAddress: string;
  amount: string;
  destinationEvm: string;
  destChain?: string;
  /** When true, skip the approve gate (caller already approved or is rebuilding burn only). */
  burnOnly?: boolean;
}): Promise<CctpApproveAction | CctpBridgeAction> {
  if (!input.walletAddress?.startsWith("G")) {
    throw new Error("Connect a Stellar wallet first");
  }
  const destChain = resolveCctpDest(input.destChain);
  const destMeta = CCTP_DEST_DOMAINS[destChain];
  const destination = normalizeEvmAddress(input.destinationEvm);
  const amount = parseUsdcToStroops(input.amount);

  // Balance check (Soroban SAC)
  try {
    const { getSorobanTokenBalance } = await import("./onchain");
    const bal = await getSorobanTokenBalance(input.walletAddress, CCTP_STELLAR.usdc);
    if (bal < amount) {
      throw new Error(
        `Not enough Circle USDC to bridge: need ${stroopsToHuman(amount)}, have ~${stroopsToHuman(bal)}. Get USDC via "faucet USDC" or a swap.`
      );
    }
  } catch (err: any) {
    if (String(err?.message ?? "").includes("Not enough Circle USDC")) throw err;
    logger.warn({ err }, "CCTP balance check skipped");
  }

  // Soroban wallets reject multi-op txs — approve is a separate single-op card first.
  if (!input.burnOnly) {
    const allowance = await readUsdcAllowance(
      input.walletAddress,
      CCTP_STELLAR.tokenMessengerMinter
    );
    if (allowance < amount) {
      return prepareCctpApprove({
        walletAddress: input.walletAddress,
        amount: input.amount,
        destinationEvm: destination,
        destChain,
      });
    }
  }

  // Max fee in local (7-dec) units — must be < amount and cover destination min fee.
  const minFee = await readMinFeeLocal(input.walletAddress, amount);
  let maxFee = amount / 1000n;
  if (maxFee < 1n) maxFee = 1n;
  if (minFee > maxFee) maxFee = minFee;
  if (maxFee >= amount) maxFee = amount > 1n ? amount - 1n : 0n;

  const { Address, nativeToScVal, xdr } = await import("@stellar/stellar-sdk");
  const mintRecipient = evmAddressToBytes32(destination);
  const destinationCaller = zeroBytes32();
  const minFinality = 2000;

  let built: { xdr: string; networkPassphrase: string };
  try {
    built = await buildContractInvoke({
      sourcePublicKey: input.walletAddress,
      contractId: CCTP_STELLAR.tokenMessengerMinter,
      method: "deposit_for_burn",
      args: [
        Address.fromString(input.walletAddress).toScVal(),
        nativeToScVal(amount.toString(), { type: "i128" }),
        nativeToScVal(destMeta.domain, { type: "u32" }),
        xdr.ScVal.scvBytes(mintRecipient),
        Address.fromString(CCTP_STELLAR.usdc).toScVal(),
        xdr.ScVal.scvBytes(destinationCaller),
        nativeToScVal(maxFee.toString(), { type: "i128" }),
        nativeToScVal(minFinality, { type: "u32" }),
      ],
    });
  } catch (err) {
    throw mapCctpSimError(err);
  }

  const human = stroopsToHuman(amount);
  return {
    type: "cctp_bridge",
    cctpStep: "burn",
    sendAmount: human,
    sendAsset: "USDC",
    destAsset: destChain,
    destination,
    marketHint: `${destMeta.label} · ${destination}`,
    poolContract: CCTP_STELLAR.tokenMessengerMinter,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase || NETWORK_PASSPHRASE,
    destinationDomain: destMeta.domain,
    sourceDomain: CCTP_STELLAR.domain,
    message: `Confirm again to finish bridging **${human} USDC** to **${destMeta.label}**.`,
  };
}

export type CctpAttestationStatus = {
  status: "pending" | "complete" | "failed" | "not_found";
  message?: string;
  attestation?: string;
  eventNonce?: string;
  decoded?: unknown;
  /** Destination-chain mint/forward tx when Circle has relayed it. */
  forwardTxHash?: string;
  forwardState?: string;
  text: string;
};

const EVM_CCTP: Record<
  CctpDestChain,
  {
    rpc: string;
    messageTransmitter: string;
    tokenMessenger: string;
    usdc: string;
    chainId: number;
    label: string;
  }
> = {
  ethereum: {
    rpc: process.env.ETHEREUM_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chainId: 11155111,
    label: "Ethereum Sepolia",
  },
  base: {
    rpc: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    chainId: 84532,
    label: "Base Sepolia",
  },
  arbitrum: {
    rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    usdc: "0x75faf114eafb1BDbe2F0316DF897e267944B0759",
    chainId: 421614,
    label: "Arbitrum Sepolia",
  },
  optimism: {
    rpc: process.env.OPTIMISM_SEPOLIA_RPC_URL || "https://sepolia.optimism.io",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D3109853",
    chainId: 11155420,
    label: "OP Sepolia",
  },
  arc: {
    rpc: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    usdc: "0x3600000000000000000000000000000000000000",
    chainId: 5042002,
    label: "Arc Testnet",
  },
};

export function getEvmCctpChain(chain: CctpDestChain) {
  return EVM_CCTP[chain];
}

const MESSAGE_TRANSMITTER_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

function cctpRelayerKey(): string | null {
  const raw =
    process.env.CCTP_EVM_RELAYER_KEY?.trim() ||
    process.env.EVM_PRIVATE_KEY?.trim() ||
    "";
  if (!raw) return null;
  // Accept hex with or without 0x (common when pasted into .env)
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

/** Poll Circle Iris for a CCTP message after the Stellar burn tx. */
export async function fetchCctpAttestation(input: {
  stellarTxHash: string;
  sourceDomain?: number;
}): Promise<CctpAttestationStatus> {
  const domain = input.sourceDomain ?? CCTP_STELLAR.domain;
  const hash = input.stellarTxHash.trim();
  if (!hash) {
    return { status: "failed", text: "Missing Stellar transaction hash." };
  }

  const url = `${IRIS_BASE}/v2/messages/${domain}?transactionHash=${encodeURIComponent(hash)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = typeof data?.error === "string" ? data.error : `Iris HTTP ${res.status}`;
      if (/not found/i.test(errMsg) || res.status === 404) {
        return { status: "pending", text: "Still confirming…" };
      }
      return { status: "failed", text: errMsg };
    }

    const msg = Array.isArray(data?.messages) ? data.messages[0] : data?.message ?? data;
    if (!msg) {
      return { status: "pending", text: "Still confirming…" };
    }

    const statusRaw = String(msg.status ?? msg.messageStatus ?? "").toLowerCase();
    const attestation =
      typeof msg.attestation === "string" && msg.attestation !== "PENDING"
        ? msg.attestation
        : undefined;
    const messageBytes =
      typeof msg.message === "string" && msg.message.startsWith("0x") && msg.message.length > 4
        ? msg.message
        : undefined;
    const forwardTxHash =
      typeof msg.forwardTxHash === "string" && /^0x[a-fA-F0-9]{64}$/i.test(msg.forwardTxHash)
        ? msg.forwardTxHash
        : undefined;
    const forwardState =
      typeof msg.forwardState === "string" ? msg.forwardState : undefined;
    const complete =
      Boolean(attestation) ||
      statusRaw === "complete" ||
      statusRaw === "completed" ||
      statusRaw === "success";

    if (!complete) {
      return {
        status: "pending",
        message: messageBytes,
        eventNonce: msg.eventNonce != null ? String(msg.eventNonce) : undefined,
        decoded: msg.decodedMessage ?? msg.decodedMessageBody,
        forwardTxHash,
        forwardState,
        text: "Still confirming…",
      };
    }

    return {
      status: "complete",
      message: messageBytes,
      attestation,
      eventNonce: msg.eventNonce != null ? String(msg.eventNonce) : undefined,
      decoded: msg.decodedMessage ?? msg.decodedMessageBody,
      forwardTxHash,
      forwardState,
      text: forwardTxHash ? "Bridge complete." : "Bridge sent — destination confirming…",
    };
  } catch (err: any) {
    logger.warn({ err }, "CCTP Iris fetch failed");
    return {
      status: "failed",
      text: err?.message ?? "Could not reach Circle Iris",
    };
  }
}

/**
 * Resolve destination mint tx: Iris forwardTxHash, or Orbit relayer receiveMessage.
 * Never returns a wallet-address URL — only a real destination tx when available.
 */
export async function completeCctpDestination(input: {
  stellarTxHash: string;
  destChain?: string;
}): Promise<{
  status: "pending" | "complete" | "failed";
  stellarTxHash: string;
  destinationTxHash?: string;
  destinationExplorerUrl?: string;
  destLabel: string;
  text: string;
}> {
  const destChain = resolveCctpDest(input.destChain);
  const destMeta = CCTP_DEST_DOMAINS[destChain];
  const stellarTxHash = input.stellarTxHash.trim();
  const attest = await fetchCctpAttestation({ stellarTxHash });

  if (attest.forwardTxHash) {
    return {
      status: "complete",
      stellarTxHash,
      destinationTxHash: attest.forwardTxHash,
      destinationExplorerUrl: destMeta.explorerTx(attest.forwardTxHash),
      destLabel: destMeta.label,
      text: "Bridge complete.",
    };
  }

  if (attest.status === "failed") {
    return {
      status: "failed",
      stellarTxHash,
      destLabel: destMeta.label,
      text: attest.text,
    };
  }

  if (attest.status !== "complete" || !attest.message || !attest.attestation) {
    return {
      status: "pending",
      stellarTxHash,
      destLabel: destMeta.label,
      text: "Waiting for confirmation…",
    };
  }

  const key = cctpRelayerKey();
  if (!key) {
    return {
      status: "pending",
      stellarTxHash,
      destLabel: destMeta.label,
      text: "Waiting for destination confirmation…",
    };
  }

  try {
    const { ethers } = await import("ethers");
    const chain = EVM_CCTP[destChain];
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const wallet = new ethers.Wallet(key, provider);
    const transmitter = new ethers.Contract(
      chain.messageTransmitter,
      MESSAGE_TRANSMITTER_ABI,
      wallet
    );
    const tx = await transmitter.receiveMessage(attest.message, attest.attestation);
    const receipt = await tx.wait();
    const destinationTxHash = String(receipt?.hash ?? tx.hash);
    return {
      status: "complete",
      stellarTxHash,
      destinationTxHash,
      destinationExplorerUrl: destMeta.explorerTx(destinationTxHash),
      destLabel: destMeta.label,
      text: "Bridge complete.",
    };
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? "");
    // Already minted / nonce used — treat as success if we can find forwardTxHash on retry
    if (/already|nonce|used|InvalidMessage/i.test(msg)) {
      const again = await fetchCctpAttestation({ stellarTxHash });
      if (again.forwardTxHash) {
        return {
          status: "complete",
          stellarTxHash,
          destinationTxHash: again.forwardTxHash,
          destinationExplorerUrl: destMeta.explorerTx(again.forwardTxHash),
          destLabel: destMeta.label,
          text: "Bridge complete.",
        };
      }
    }
    logger.warn({ err }, "CCTP EVM receiveMessage failed");
    return {
      status: "pending",
      stellarTxHash,
      destLabel: destMeta.label,
      text: "Destination still confirming…",
    };
  }
}

export function formatCctpHelp(): string {
  return (
    "Bridge out: `bridge 1 USDC to base 0xYourAddress` or `bridge 1 USDC to arc 0x…`\n" +
    "Bridge in: `bridge in 10 USDC from base` (uses your connected G…) or `from arc to G…`"
  );
}

export function truncateEvmAddress(addr: string): string {
  const a = addr.trim();
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Stellar contract strkey → 32-byte CCTP bytes32. */
export async function stellarContractToBytes32(contractId: string): Promise<Buffer> {
  const { StrKey } = await import("@stellar/stellar-sdk");
  const raw = Buffer.from(StrKey.decodeContract(contractId));
  if (raw.length !== 32) throw new Error("Invalid Stellar contract id for CCTP bytes32");
  return raw;
}

/** Circle CctpForwarder hook: version(0) + utf8 length + G/M/C strkey. */
export function buildCctpForwarderHookData(forwardRecipientStrkey: string): Buffer {
  const recipient = forwardRecipientStrkey.trim();
  if (!/^[GMC][A-Z0-9]{55}$/.test(recipient)) {
    throw new Error("Stellar recipient must be a G… / M… / C… address");
  }
  const recipientBytes = Buffer.from(recipient, "utf8");
  const hookData = Buffer.alloc(32 + recipientBytes.length);
  hookData.writeUInt32BE(0, 24); // version
  hookData.writeUInt32BE(recipientBytes.length, 28);
  recipientBytes.copy(hookData, 32);
  return hookData;
}

function parseUsdcEvm6(raw: string): bigint {
  const t = raw.trim();
  if (!t || !/^\d+(\.\d+)?$/.test(t)) {
    throw new Error("USDC amount must be a positive number");
  }
  const [wholeRaw, fracRaw = ""] = t.split(".");
  const whole = BigInt(wholeRaw || "0");
  const fracPadded = (fracRaw + "000000").slice(0, 6);
  const total = whole * 1_000_000n + BigInt(fracPadded || "0");
  if (total <= 0n) throw new Error("USDC amount must be positive");
  return total;
}

export type CctpBridgeInAction = {
  type: "cctp_bridge_in";
  cctpStep: "evm_approve" | "evm_burn" | "mint_and_forward";
  sendAmount: string;
  sendAsset: "USDC";
  destAsset: "stellar";
  sourceChain: CctpDestChain;
  destination: string;
  sourceDomain: number;
  destinationDomain: number;
  chainId: number;
  marketHint: string;
  message: string;
  /** EVM calldata steps */
  evmTx?: { to: string; data: string; value: string; chainId: number };
  pendingAction?: Omit<CctpBridgeInAction, "message" | "pendingAction"> & {
    message?: string;
  };
  /** Stellar mint step */
  xdr?: string;
  networkPassphrase?: string;
  poolContract?: string;
};

/**
 * Prepare EVM → Stellar bridge-in.
 * Step 1: USDC approve TokenMessengerV2
 * Step 2: depositForBurnWithHook (mintRecipient=destinationCaller=CctpForwarder)
 * Step 3 (later): Stellar mint_and_forward after Iris attestation
 */
export async function prepareCctpBridgeIn(input: {
  amount: string;
  sourceChain?: string;
  stellarRecipient: string;
  burnOnly?: boolean;
}): Promise<CctpBridgeInAction> {
  const sourceChain = resolveCctpDest(input.sourceChain);
  const chain = EVM_CCTP[sourceChain];
  const destMeta = CCTP_DEST_DOMAINS[sourceChain];
  const recipient = input.stellarRecipient.trim();
  if (!/^[GMC][A-Z0-9]{55}$/.test(recipient)) {
    throw new Error("Bridge-in needs a Stellar G… recipient");
  }
  const amount = parseUsdcEvm6(input.amount);
  const human = input.amount.trim();

  const { ethers } = await import("ethers");
  const forwarderBytes32 = `0x${(await stellarContractToBytes32(CCTP_STELLAR.forwarder)).toString("hex")}`;
  const hookData = `0x${buildCctpForwarderHookData(recipient).toString("hex")}`;
  const maxFee = amount / 1000n > 0n ? amount / 1000n : 0n;
  const minFinality = 2000;

  const erc20 = new ethers.Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);
  const messenger = new ethers.Interface([
    "function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData) returns (uint64)",
  ]);

  const approveData = erc20.encodeFunctionData("approve", [chain.tokenMessenger, amount]);
  const burnData = messenger.encodeFunctionData("depositForBurnWithHook", [
    amount,
    CCTP_STELLAR.domain,
    forwarderBytes32,
    chain.usdc,
    forwarderBytes32,
    maxFee,
    minFinality,
    hookData,
  ]);

  const burnAction: CctpBridgeInAction = {
    type: "cctp_bridge_in",
    cctpStep: "evm_burn",
    sendAmount: human,
    sendAsset: "USDC",
    destAsset: "stellar",
    sourceChain,
    destination: recipient,
    sourceDomain: destMeta.domain,
    destinationDomain: CCTP_STELLAR.domain,
    chainId: chain.chainId,
    marketHint: `${chain.label} → Stellar · ${recipient.slice(0, 4)}…${recipient.slice(-4)}`,
    message: `Confirm again to send **${human} USDC** from **${chain.label}** to Stellar.`,
    evmTx: {
      to: chain.tokenMessenger,
      data: burnData,
      value: "0x0",
      chainId: chain.chainId,
    },
  };

  if (input.burnOnly) {
    return burnAction;
  }

  return {
    type: "cctp_bridge_in",
    cctpStep: "evm_approve",
    sendAmount: human,
    sendAsset: "USDC",
    destAsset: "stellar",
    sourceChain,
    destination: recipient,
    sourceDomain: destMeta.domain,
    destinationDomain: CCTP_STELLAR.domain,
    chainId: chain.chainId,
    marketHint: burnAction.marketHint,
    message: `Bridge **${human} USDC** from **${chain.label}** → **Stellar** (${recipient.slice(0, 4)}…${recipient.slice(-4)}). Connect an EVM wallet, then confirm twice.`,
    evmTx: {
      to: chain.usdc,
      data: approveData,
      value: "0x0",
      chainId: chain.chainId,
    },
    pendingAction: burnAction,
  };
}

/** After EVM burn + Iris attestation → Stellar mint_and_forward XDR. */
export async function prepareCctpMintAndForward(input: {
  walletAddress: string;
  message: string;
  attestation: string;
  sourceChain?: string;
  amount?: string;
  stellarRecipient?: string;
}): Promise<CctpBridgeInAction> {
  if (!input.walletAddress?.startsWith("G")) {
    throw new Error("Connect a Stellar wallet to finish receiving USDC");
  }
  const messageHex = input.message.trim();
  const attestationHex = input.attestation.trim();
  if (!messageHex.startsWith("0x") || !attestationHex.startsWith("0x")) {
    throw new Error("Iris message and attestation must be 0x-prefixed hex");
  }
  const messageBytes = Buffer.from(messageHex.slice(2), "hex");
  const attestationBytes = Buffer.from(attestationHex.slice(2), "hex");
  const { xdr } = await import("@stellar/stellar-sdk");
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId: CCTP_STELLAR.forwarder,
    method: "mint_and_forward",
    args: [xdr.ScVal.scvBytes(messageBytes), xdr.ScVal.scvBytes(attestationBytes)],
  });
  const sourceChain = resolveCctpDest(input.sourceChain);
  const chain = EVM_CCTP[sourceChain];
  return {
    type: "cctp_bridge_in",
    cctpStep: "mint_and_forward",
    sendAmount: input.amount ?? "",
    sendAsset: "USDC",
    destAsset: "stellar",
    sourceChain,
    destination: input.stellarRecipient ?? input.walletAddress,
    sourceDomain: CCTP_DEST_DOMAINS[sourceChain].domain,
    destinationDomain: CCTP_STELLAR.domain,
    chainId: chain.chainId,
    marketHint: `${chain.label} → Stellar`,
    message: "Sign once more on Stellar to finish receiving your USDC.",
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase || NETWORK_PASSPHRASE,
    poolContract: CCTP_STELLAR.forwarder,
  };
}

/** Iris poll after EVM burn, then optionally build mint XDR. */
export async function completeCctpBridgeIn(input: {
  evmTxHash: string;
  sourceChain?: string;
  stellarWallet?: string;
  stellarRecipient?: string;
  amount?: string;
}): Promise<{
  status: "pending" | "complete" | "failed";
  text: string;
  message?: string;
  attestation?: string;
  action?: CctpBridgeInAction;
}> {
  const sourceChain = resolveCctpDest(input.sourceChain);
  const sourceDomain = CCTP_DEST_DOMAINS[sourceChain].domain;
  const attest = await fetchCctpAttestation({
    stellarTxHash: input.evmTxHash,
    sourceDomain,
  });
  if (attest.status === "failed") {
    return { status: "failed", text: attest.text };
  }
  if (attest.status !== "complete" || !attest.message || !attest.attestation) {
    return {
      status: "pending",
      text: "Waiting for confirmation…",
      message: attest.message,
      attestation: attest.attestation,
    };
  }
  if (!input.stellarWallet?.startsWith("G")) {
    return {
      status: "complete",
      text: "Almost done — connect Stellar to finish.",
      message: attest.message,
      attestation: attest.attestation,
    };
  }
  const action = await prepareCctpMintAndForward({
    walletAddress: input.stellarWallet,
    message: attest.message,
    attestation: attest.attestation,
    sourceChain,
    amount: input.amount,
    stellarRecipient: input.stellarRecipient,
  });
  return {
    status: "complete",
    text: "Almost done — confirm once more on Stellar.",
    message: attest.message,
    attestation: attest.attestation,
    action,
  };
}
