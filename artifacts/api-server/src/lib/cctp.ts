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
  buildContractInvokeOps,
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

export type CctpDestChain = "base" | "ethereum" | "arbitrum" | "optimism";

export const CCTP_DEST_DOMAINS: Record<
  CctpDestChain,
  { domain: number; label: string; explorerTx: (hash: string) => string }
> = {
  ethereum: {
    domain: 0,
    label: "Ethereum Sepolia",
    explorerTx: (h) => `https://sepolia.etherscan.io/tx/${h}`,
  },
  base: {
    domain: 6,
    label: "Base Sepolia",
    explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
  },
  arbitrum: {
    domain: 3,
    label: "Arbitrum Sepolia",
    explorerTx: (h) => `https://sepolia.arbiscan.io/tx/${h}`,
  },
  optimism: {
    domain: 2,
    label: "OP Sepolia",
    explorerTx: (h) => `https://sepolia-optimism.etherscan.io/tx/${h}`,
  },
};

export function resolveCctpDest(raw?: string | null): CctpDestChain {
  const t = (raw ?? "base").trim().toLowerCase();
  if (/^(eth|ethereum|sepolia)$/.test(t) || t.includes("ethereum")) return "ethereum";
  if (/^(arb|arbitrum)/.test(t)) return "arbitrum";
  if (/^(op|optimism|optimistic)/.test(t)) return "optimism";
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
      "CCTP burn failed (USDC #9): not enough Circle USDC balance, or TokenMessenger is not approved to spend it. Orbit will include an approve step — retry the bridge. If it still fails, fund USDC via \"faucet USDC\" / a swap."
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

export async function prepareCctpBridge(input: {
  walletAddress: string;
  amount: string;
  destinationEvm: string;
  destChain?: string;
}): Promise<{
  type: "cctp_bridge";
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
}> {
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

  // Max fee in local (7-dec) units — must be < amount and cover destination min fee.
  const minFee = await readMinFeeLocal(input.walletAddress, amount);
  let maxFee = amount / 1000n;
  if (maxFee < 1n) maxFee = 1n;
  if (minFee > maxFee) maxFee = minFee;
  if (maxFee >= amount) maxFee = amount > 1n ? amount - 1n : 0n;

  const { Address, nativeToScVal, xdr } = await import("@stellar/stellar-sdk");
  const mintRecipient = evmAddressToBytes32(destination);
  // destination_caller = 0 → anyone may call receiveMessage on the destination domain
  const destinationCaller = zeroBytes32();
  const minFinality = 2000; // standard finality

  const ops: Array<{ contractId: string; method: string; args: import("@stellar/stellar-sdk").xdr.ScVal[] }> =
    [];

  // CCTP burns via transfer_from — approve TokenMessengerMinter when allowance is short.
  const allowance = await readUsdcAllowance(
    input.walletAddress,
    CCTP_STELLAR.tokenMessengerMinter
  );
  if (allowance < amount) {
    const ledger = await latestLedgerSequence();
    const expirationLedger = ledger + 100_000;
    ops.push({
      contractId: CCTP_STELLAR.usdc,
      method: "approve",
      args: [
        Address.fromString(input.walletAddress).toScVal(),
        Address.fromString(CCTP_STELLAR.tokenMessengerMinter).toScVal(),
        nativeToScVal(amount.toString(), { type: "i128" }),
        nativeToScVal(expirationLedger, { type: "u32" }),
      ],
    });
  }

  ops.push({
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

  let built: { xdr: string; networkPassphrase: string };
  try {
    built = await buildContractInvokeOps({
      sourcePublicKey: input.walletAddress,
      ops,
    });
  } catch (err) {
    throw mapCctpSimError(err);
  }

  const human = stroopsToHuman(amount);
  const needsApprove = ops.length > 1;
  return {
    type: "cctp_bridge",
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
    message: [
      `Circle CCTP: bridge **${human} USDC** from Stellar Testnet → **${destMeta.label}**.`,
      `Recipient: \`${destination}\`.`,
      needsApprove
        ? "This tx first approves Circle’s TokenMessenger to spend your USDC, then burns for the bridge."
        : "Sign to burn on Stellar.",
      `After confirmation Orbit polls Circle Iris for the attestation so USDC can be minted on ${destMeta.label}.`,
    ].join(" "),
  };
}

export type CctpAttestationStatus = {
  status: "pending" | "complete" | "failed" | "not_found";
  message?: string;
  attestation?: string;
  eventNonce?: string;
  decoded?: unknown;
  text: string;
};

/** Poll Circle Iris for a CCTP message after the Stellar burn tx. */
export async function fetchCctpAttestation(input: {
  stellarTxHash: string;
  sourceDomain?: number;
}): Promise<CctpAttestationStatus> {
  const domain = input.sourceDomain ?? CCTP_STELLAR.domain;
  const hash = input.stellarTxHash.trim();
  if (!hash) {
    return { status: "failed", text: "Missing Stellar transaction hash for attestation." };
  }

  const url = `${IRIS_BASE}/v2/messages/${domain}?transactionHash=${encodeURIComponent(hash)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = typeof data?.error === "string" ? data.error : `Iris HTTP ${res.status}`;
      if (/not found/i.test(errMsg) || res.status === 404) {
        return {
          status: "pending",
          text: "Attestation not ready yet — Circle Iris usually needs 30–90s after the burn. Ask again with the tx hash shortly.",
        };
      }
      return { status: "failed", text: `Attestation lookup failed: ${errMsg}` };
    }

    const msg = Array.isArray(data?.messages) ? data.messages[0] : data?.message ?? data;
    if (!msg) {
      return {
        status: "pending",
        text: "No CCTP message yet for that tx. Wait a bit and retry attestation.",
      };
    }

    const statusRaw = String(msg.status ?? msg.messageStatus ?? "").toLowerCase();
    const attestation =
      typeof msg.attestation === "string" && msg.attestation !== "PENDING"
        ? msg.attestation
        : undefined;
    const complete =
      Boolean(attestation) ||
      statusRaw === "complete" ||
      statusRaw === "completed" ||
      statusRaw === "success";

    if (!complete) {
      return {
        status: "pending",
        message: typeof msg.message === "string" ? msg.message : undefined,
        eventNonce: msg.eventNonce != null ? String(msg.eventNonce) : undefined,
        decoded: msg.decodedMessage ?? msg.decodedMessageBody,
        text: "Circle is still attesting your burn. Try again in ~30s.",
      };
    }

    return {
      status: "complete",
      message: typeof msg.message === "string" ? msg.message : undefined,
      attestation,
      eventNonce: msg.eventNonce != null ? String(msg.eventNonce) : undefined,
      decoded: msg.decodedMessage ?? msg.decodedMessageBody,
      text: [
        "CCTP attestation ready.",
        attestation ? `Attestation: \`${attestation.slice(0, 18)}…\`` : "",
        "Anyone can call receiveMessage on the destination TokenMessenger to mint USDC to your 0x address (destination_caller was open).",
      ]
        .filter(Boolean)
        .join(" "),
    };
  } catch (err: any) {
    logger.warn({ err }, "CCTP Iris fetch failed");
    return {
      status: "failed",
      text: err?.message ?? "Could not reach Circle Iris attestation API",
    };
  }
}

export function formatCctpHelp(): string {
  return [
    "**Circle CCTP** (testnet): bridge native USDC Stellar → EVM testnets.",
    "Try: `bridge 1 USDC to base sepolia 0xYourAddress`",
    "Also: ethereum / arbitrum / optimism sepolia.",
    "Flow: sign burn on Stellar → wait for Iris attestation → mint on destination.",
  ].join("\n");
}
