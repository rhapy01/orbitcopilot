/**
 * Frontend Soroban / Stellar SDK surface.
 *
 * Orbit builds unsigned contract XDR on the API (`artifacts/api-server/src/lib/onchain.ts`)
 * and the wallet (Freighter / Orbit) signs here. This module is the client-side
 * @stellar/stellar-sdk integration: network constants, Contract helpers, and
 * optional local invoke building for verification / future client-side prep.
 */
import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

/** Stellar Testnet passphrase (Freighter + Soroban). */
export const STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;

/** Public Soroban RPC for testnet. */
export const SOROBAN_RPC_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL?.trim() ||
  "https://soroban-testnet.stellar.org";

export function getSorobanServer(): rpc.Server {
  return new rpc.Server(SOROBAN_RPC_URL);
}

/** Wrap a deployed contract id for method calls. */
export function getContract(contractId: string): Contract {
  if (!contractId.startsWith("C")) {
    throw new Error(`Invalid Soroban contract id: ${contractId}`);
  }
  return new Contract(contractId);
}

export type BuildInvokeInput = {
  sourcePublicKey: string;
  contractId: string;
  method: string;
  /** Pre-encoded ScVal args (or use helpers below). */
  args: xdr.ScVal[];
};

/**
 * Build an unsigned Soroban invoke transaction (XDR) for wallet signing.
 * Mirrors server `buildContractInvoke` so frontend + API stay aligned.
 */
export async function buildContractInvokeXdr(
  input: BuildInvokeInput
): Promise<{ xdr: string; networkPassphrase: string }> {
  const server = getSorobanServer();
  const account = await server.getAccount(input.sourcePublicKey);
  const contract = getContract(input.contractId);
  const op = contract.call(input.method, ...input.args);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error ?? "Soroban simulation failed");
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();
  return {
    xdr: assembled.toXDR(),
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  };
}

export function scAddress(gOrC: string): xdr.ScVal {
  return Address.fromString(gOrC).toScVal();
}

export function scI128(amount: bigint | string | number): xdr.ScVal {
  return nativeToScVal(BigInt(amount), { type: "i128" });
}

export function scU32(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" });
}

export function scString(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
}

export { Address, Contract, Networks, TransactionBuilder, nativeToScVal, rpc, xdr };
