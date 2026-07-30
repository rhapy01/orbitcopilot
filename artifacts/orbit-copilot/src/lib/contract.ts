/**
 * Contract registry: Rust contract functions <-> frontend / API call sites.
 *
 * Cross-check table for Orbit-native Soroban contracts.
 * Runtime XDR is built in API `onchain.ts` / domain libs; this file is the
 * typed method map the UI uses for titles, validation, and optional local builds.
 */
import {
  ORBIT_CONTRACT_IDS,
  assertContractMethod,
} from "./contract-registry";
import {
  STELLAR_NETWORK_PASSPHRASE,
  buildContractInvokeXdr,
  scAddress,
  scI128,
  scString,
  scU32,
} from "./soroban";

export {
  ORBIT_CONTRACT_IDS,
  ORBIT_CONTRACT_METHODS,
  ACTION_TO_CONTRACT,
  assertContractMethod,
  resolveActionContract,
} from "./contract-registry";

/** Example client-side build: Orbit Supply claim (usually built by API). */
export async function buildOrbitSupplyClaimXdr(input: {
  walletAddress: string;
  contractId?: string;
}) {
  assertContractMethod("orbit-supply", "claim");
  return buildContractInvokeXdr({
    sourcePublicKey: input.walletAddress,
    contractId: input.contractId ?? ORBIT_CONTRACT_IDS.supply,
    method: "claim",
    args: [scAddress(input.walletAddress)],
  });
}

export async function buildOrbitSupplyDepositXdr(input: {
  walletAddress: string;
  tokenContract: string;
  amountRaw: string;
  contractId?: string;
}) {
  assertContractMethod("orbit-supply", "supply");
  return buildContractInvokeXdr({
    sourcePublicKey: input.walletAddress,
    contractId: input.contractId ?? ORBIT_CONTRACT_IDS.supply,
    method: "supply",
    args: [
      scAddress(input.walletAddress),
      scAddress(input.tokenContract),
      scI128(input.amountRaw),
    ],
  });
}

export {
  STELLAR_NETWORK_PASSPHRASE,
  scAddress,
  scI128,
  scString,
  scU32,
};
