/**
 * Meridian USDC vault (Stellar Testnet) — live coordinator vault that routes
 * into Blend via BlendAdapter.
 *
 * Contract IDs from drydocs/meridian packages/shared/src/constants.ts (verified
 * on-chain 2026-07-16: get_total_assets / get_adapter / get_position OK).
 */
import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { buildContractInvoke, getSorobanTokenBalance } from "./onchain";
import { NETWORK_PASSPHRASE } from "./stellar";
import { logger } from "./logger";

export const MERIDIAN_TESTNET = {
  vault: "CBQYEHWIRJWIPWCJFQZAOP3VAZHRWFGAUS5GZHWFDDYKMFHJ5S3YS2Q5",
  /** Blend testnet USDC (issuer GATALT…) — not Circle USDC */
  usdc: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
  musdc: "CBC5G4HXTOOZHTBCJQACZB3NJ636JHA5NEBQX5Q265QZN6XEG4LVZ5SB",
} as const;

function parse7Decimals(rawAmount: string): bigint {
  const t = rawAmount.trim();
  if (!t) return 0n;
  const [wholeRaw, fracRaw = ""] = t.replace(/^-/, "").split(".");
  const whole = BigInt(wholeRaw || "0");
  const frac = BigInt((fracRaw + "0000000").slice(0, 7) || "0");
  const total = whole * 10_000_000n + frac;
  return t.startsWith("-") ? -total : total;
}

function fromRaw(raw: bigint): number {
  return Number(raw) / 10_000_000;
}

export async function formatMeridianStatus(wallet?: string | null): Promise<string> {
  const { Contract, TransactionBuilder, Networks, BASE_FEE, scValToNative } = await import(
    "@stellar/stellar-sdk"
  );
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const rpc = new Server("https://soroban-testnet.stellar.org");
  // Any funded account works as simulation source for read calls
  const simSource = "GBZD7ZA4BHPC62YJBD5N7QUFE32FTGV2L6FMSIMIUDANNZLXEFYLKQBV";

  try {
    const account = await rpc.getAccount(
      wallet && /^G[A-Z2-7]{55}$/.test(wallet) ? wallet : simSource
    ).catch(() => rpc.getAccount(simSource));

    const c = new Contract(MERIDIAN_TESTNET.vault);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(c.call("get_total_assets"))
      .setTimeout(60)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if ((sim as any)?.error) {
      throw new Error(String((sim as any).error));
    }
    const totalRaw = BigInt(scValToNative((sim as any).result.retval) ?? 0);
    const lines = [
      `**Meridian** (Stellar Testnet)`,
      `• USDC vault → Blend adapter`,
      `• TVL: ~${fromRaw(totalRaw).toFixed(2)} USDC`,
      `• Contract: \`${MERIDIAN_TESTNET.vault.slice(0, 8)}…\``,
      ``,
      `Uses **Blend USDC** (CAQCFV…). Deposit: \"deposit 10 USDC into meridian\"`,
    ];

    if (wallet && /^G[A-Z2-7]{55}$/.test(wallet)) {
      try {
        const posTx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(c.call("get_position", Address.fromString(wallet).toScVal()))
          .setTimeout(60)
          .build();
        const posSim = await rpc.simulateTransaction(posTx);
        if (!(posSim as any)?.error) {
          const shares = BigInt(scValToNative((posSim as any).result.retval) ?? 0);
          lines.splice(3, 0, `• Your shares: ~${fromRaw(shares).toFixed(6)} mUSDC`);
        }
      } catch {
        /* optional */
      }
    }

    return lines.join("\n");
  } catch (err: any) {
    logger.warn({ err }, "Meridian status failed");
    return `Meridian status unavailable: ${err?.message ?? "unknown error"}`;
  }
}

export async function prepareMeridianDeposit(input: {
  walletAddress: string;
  amount: string;
}) {
  const wallet = input.walletAddress.trim();
  if (!/^G[A-Z2-7]{55}$/.test(wallet)) {
    throw new Error("walletAddress required");
  }
  const amountHuman = input.amount.trim();
  const amountNum = Number(amountHuman);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("amount must be positive");
  }
  const amountRaw = parse7Decimals(amountHuman);
  if (amountRaw < 1001n) {
    throw new Error("Minimum Meridian deposit is 1001 stroops");
  }

  // Soft preflight balance (Blend USDC SAC)
  try {
    const bal = await getSorobanTokenBalance(wallet, MERIDIAN_TESTNET.usdc);
    if (bal < amountRaw) {
      throw new Error(
        `Not enough Blend USDC for Meridian: need ${amountHuman}, have ~${fromRaw(bal).toFixed(6)}. Fund via testnet.blend.capital faucet (Blend USDC, not Circle USDC).`
      );
    }
  } catch (err: any) {
    if (String(err?.message ?? "").includes("Not enough Blend USDC")) throw err;
    // balance read can fail; continue to build and let simulation decide
  }

  const built = await buildContractInvoke({
    sourcePublicKey: wallet,
    contractId: MERIDIAN_TESTNET.vault,
    method: "deposit",
    args: [Address.fromString(wallet).toScVal(), nativeToScVal(amountRaw, { type: "i128" })],
  });

  return {
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase || NETWORK_PASSPHRASE,
    vaultAddress: MERIDIAN_TESTNET.vault,
    sendAmount: amountHuman,
    sendAsset: "USDC" as const,
    message: `Meridian: deposit ${amountHuman} Blend USDC into the USDC vault (routes to Blend). Sign to receive mUSDC shares.`,
  };
}

export async function prepareMeridianWithdraw(input: {
  walletAddress: string;
  /** Human-readable mUSDC shares (7 decimals) */
  shares: string;
}) {
  const wallet = input.walletAddress.trim();
  if (!/^G[A-Z2-7]{55}$/.test(wallet)) {
    throw new Error("walletAddress required");
  }
  const sharesHuman = input.shares.trim();
  const sharesNum = Number(sharesHuman);
  if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
    throw new Error("shares must be positive");
  }
  const sharesRaw = parse7Decimals(sharesHuman);

  const built = await buildContractInvoke({
    sourcePublicKey: wallet,
    contractId: MERIDIAN_TESTNET.vault,
    method: "withdraw",
    args: [Address.fromString(wallet).toScVal(), nativeToScVal(sharesRaw, { type: "i128" })],
  });

  return {
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase || NETWORK_PASSPHRASE,
    vaultAddress: MERIDIAN_TESTNET.vault,
    sendAmount: sharesHuman,
    sendAsset: "USDC" as const,
    message: `Meridian: withdraw ${sharesHuman} mUSDC shares from the vault. Sign to redeem Blend USDC.`,
  };
}
