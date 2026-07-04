import { NETWORK_PASSPHRASE, SOROBAN_RPC } from "./stellar";
import type { xdr } from "@stellar/stellar-sdk";

/** Native XLM Stellar Asset Contract on testnet. */
export const NATIVE_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** Classic Circle testnet USDC as SAC (used by Aquarius pools). */
export const TESTNET_USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export function requirePredictContract(): string {
  const id = process.env.ORBIT_PREDICT_CONTRACT_ID?.trim();
  if (!id || !id.startsWith("C")) {
    throw new Error(
      "Orbit Predict is fully on-chain. Deploy contracts/orbit-predict and set ORBIT_PREDICT_CONTRACT_ID=C…"
    );
  }
  return id;
}

export function requirePerpsContract(): string {
  const id = process.env.ORBIT_PERPS_CONTRACT_ID?.trim();
  if (!id || !id.startsWith("C")) {
    throw new Error(
      "Orbit Perps is fully on-chain. Deploy contracts/orbit-perps and set ORBIT_PERPS_CONTRACT_ID=C…"
    );
  }
  return id;
}

/** Build an unsigned Soroban contract invocation for Freighter. */
export async function buildContractInvoke(input: {
  sourcePublicKey: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}): Promise<{ xdr: string; networkPassphrase: string }> {
  const { Contract, TransactionBuilder, Networks, BASE_FEE } = await import(
    "@stellar/stellar-sdk"
  );
  const { Server, assembleTransaction } = await import("@stellar/stellar-sdk/rpc");

  const rpc = new Server(SOROBAN_RPC);
  const account = await rpc.getAccount(input.sourcePublicKey);
  const contract = new Contract(input.contractId);
  const op = contract.call(input.method, ...input.args);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();

  const simulated = await rpc.simulateTransaction(tx);
  if ((simulated as any)?.error) {
    throw new Error(`Simulation failed: ${(simulated as any).error}`);
  }

  const assembled = assembleTransaction(tx, simulated).build();
  return {
    xdr: assembled.toXDR(),
    networkPassphrase: NETWORK_PASSPHRASE,
  };
}

/** Soroban unit enum variant: vec [Symbol("Yes")] */
export async function enumUnit(name: string): Promise<xdr.ScVal> {
  const { xdr: x } = await import("@stellar/stellar-sdk");
  return x.ScVal.scvVec([x.ScVal.scvSymbol(name)]);
}
