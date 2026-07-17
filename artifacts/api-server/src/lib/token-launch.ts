/**
 * Chat token launchpad — classic Stellar asset + SAC (SEP-41).
 *
 * Flow: user is issuer → deploy SAC for CODE:ISSUER → mint initial supply via SAC.
 * Compatible with Horizon DEX / trustlines and Soroban DeFi.
 */

import { NETWORK_PASSPHRASE, SOROBAN_RPC } from "./stellar";
import { buildContractInvoke } from "./onchain";
import {
  registerTokenMetadata,
  tokenHomeDomain,
  type TokenMetadataInput,
} from "./token-metadata";

function normalizeCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 1 || code.length > 12) {
    throw new Error("Token code must be 1–12 letters/numbers (e.g. FOOX, ORBIT)");
  }
  return code;
}

function toStroops(human: string, decimals = 7): string {
  const [w, f = ""] = human.trim().split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt((w || "0") + frac).toString();
}

export async function resolveTokenContractId(
  code: string,
  issuer: string
): Promise<string> {
  const { Asset, Networks } = await import("@stellar/stellar-sdk");
  const asset = new Asset(normalizeCode(code), issuer);
  return asset.contractId(Networks.TESTNET);
}

async function isContractDeployed(contractId: string): Promise<boolean> {
  try {
    const { Server } = await import("@stellar/stellar-sdk/rpc");
    const rpc = new Server(SOROBAN_RPC);
    await rpc.getContractWasmByContractId(contractId);
    return true;
  } catch {
    try {
      const { Server } = await import("@stellar/stellar-sdk/rpc");
      const rpc = new Server(SOROBAN_RPC);
      // Older SDK path: getLedgerEntries on contract instance
      const { Address } = await import("@stellar/stellar-sdk");
      const key = Address.fromString(contractId).toScAddress();
      void key;
      const live = await (rpc as any).getContractData?.(contractId);
      return Boolean(live);
    } catch {
      return false;
    }
  }
}

/** Deploy SAC for CODE issued by the user's wallet. */
export async function prepareTokenDeploy(input: {
  walletAddress: string;
  code: string;
  metadata?: TokenMetadataInput;
}) {
  const code = normalizeCode(input.code);
  const { Asset, Operation, TransactionBuilder, Networks, BASE_FEE } =
    await import("@stellar/stellar-sdk");
  const { Server, assembleTransaction } = await import("@stellar/stellar-sdk/rpc");

  if (typeof (Operation as any).createStellarAssetContract !== "function") {
    throw new Error(
      "Token launch requires @stellar/stellar-sdk with Operation.createStellarAssetContract"
    );
  }

  const asset = new Asset(code, input.walletAddress);
  const contractId = asset.contractId(Networks.TESTNET);
  await registerTokenMetadata({
    issuer: input.walletAddress,
    code,
    contractId,
    metadata: input.metadata,
  });

  if (await isContractDeployed(contractId)) {
    return {
      type: "token_deploy" as const,
      alreadyDeployed: true,
      code,
      issuer: input.walletAddress,
      contractId,
      homeDomain: tokenHomeDomain(),
      xdr: null as string | null,
      networkPassphrase: NETWORK_PASSPHRASE,
      message: `${code} SAC already exists at ${contractId}. Say "mint 1000000 ${code}" to issue supply.`,
    };
  }

  const rpc = new Server(SOROBAN_RPC);
  const account = await rpc.getAccount(input.walletAddress);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ homeDomain: tokenHomeDomain() }))
    .addOperation(
      (Operation as any).createStellarAssetContract({ asset })
    )
    .setTimeout(300)
    .build();

  const simulated = await rpc.simulateTransaction(tx);
  if ((simulated as any)?.error) {
    throw new Error(`SAC deploy simulation failed: ${(simulated as any).error}`);
  }
  const assembled = assembleTransaction(tx, simulated).build();

  return {
    type: "token_deploy" as const,
    alreadyDeployed: false,
    code,
    issuer: input.walletAddress,
    contractId,
    homeDomain: tokenHomeDomain(),
    xdr: assembled.toXDR(),
    networkPassphrase: NETWORK_PASSPHRASE,
    message: `Deploy SEP-41 SAC for ${code} (issuer = your wallet). After it confirms, say "mint 1000000 ${code}".`,
  };
}

/** Mint initial supply via SAC (issuer admin). Amount in whole tokens (7 decimals). */
export async function prepareTokenMint(input: {
  walletAddress: string;
  code: string;
  amount: string;
  to?: string;
}) {
  const code = normalizeCode(input.code);
  const contractId = await resolveTokenContractId(code, input.walletAddress);
  const to = input.to?.trim() || input.walletAddress;
  const amount = toStroops(input.amount);

  if (!(await isContractDeployed(contractId))) {
    throw new Error(
      `${code} SAC is not deployed yet. Say "launch token ${code}" first, sign the deploy, then mint.`
    );
  }

  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  const built = await buildContractInvoke({
    sourcePublicKey: input.walletAddress,
    contractId,
    method: "mint",
    args: [
      Address.fromString(to).toScVal(),
      nativeToScVal(BigInt(amount), { type: "i128" }),
    ],
  });

  return {
    type: "token_mint" as const,
    code,
    amount: input.amount,
    to,
    contractId,
    xdr: built.xdr,
    networkPassphrase: built.networkPassphrase,
    message: `Mint ${input.amount} ${code} to ${to.slice(0, 4)}…${to.slice(-4)} via SAC. Sign to issue.`,
  };
}

/** High-level chat entry: deploy if needed, otherwise mint. */
export async function prepareTokenLaunch(input: {
  walletAddress: string;
  code: string;
  amount?: string;
  metadata?: TokenMetadataInput;
}) {
  const code = normalizeCode(input.code);
  const deploy = await prepareTokenDeploy({
    walletAddress: input.walletAddress,
    code,
    metadata: input.metadata,
  });

  if (!deploy.alreadyDeployed && deploy.xdr) {
    return {
      ...deploy,
      type: "token_deploy" as const,
      nextStep: input.amount
        ? `After confirm, say: mint ${input.amount} ${code}`
        : `After confirm, say: mint 1000000 ${code}`,
      message: `Launch ${code}: step 1 — deploy the Stellar Asset Contract (SEP-41). ${
        input.amount
          ? `Then mint ${input.amount} ${code}.`
          : `Then mint your supply.`
      }`,
    };
  }

  const amount = input.amount?.trim() || "1000000";
  const minted = await prepareTokenMint({
    walletAddress: input.walletAddress,
    code,
    amount,
  });
  return {
    ...minted,
    type: "token_mint" as const,
    message: `SAC ready. Minting ${amount} ${code} to your wallet.`,
  };
}

export function formatTokenLaunchHelp(): string {
  return [
    "Orbit token launchpad (classic asset + SEP-41 SAC, testnet):",
    "",
    '• Launch: "launch token FOOX" or "launch token FOOX supply 1000000"',
    '• Mint more: "mint 50000 FOOX"',
    "• You are the issuer — keep your Freighter/Orbit key safe",
    "• After mint, add liquidity on Aquarius/Soroswap or trade on Stellar DEX",
    "",
    "Standards: classic Stellar asset + SAC (SEP-41), same pattern wallets/DeFi expect.",
  ].join("\n");
}
