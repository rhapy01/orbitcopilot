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

export function requireNftContract(): string {
 const id = process.env.ORBIT_NFT_CONTRACT_ID?.trim();
 if (!id || !id.startsWith("C")) {
 throw new Error(
 "Orbit NFT is fully on-chain. Deploy contracts/orbit-nft and set ORBIT_NFT_CONTRACT_ID=C…"
 );
 }
 return id;
}

export function requireNftFactoryContract(): string {
 const id = process.env.ORBIT_NFT_FACTORY_CONTRACT_ID?.trim();
 if (!id || !id.startsWith("C")) {
 throw new Error(
 "NFT collection factory not configured. Deploy contracts/orbit-nft-factory and set ORBIT_NFT_FACTORY_CONTRACT_ID=C…"
 );
 }
 return id;
}

export function nftFactoryConfigured(): boolean {
 const id = process.env.ORBIT_NFT_FACTORY_CONTRACT_ID?.trim();
 return Boolean(id && id.startsWith("C"));
}

export function requireOrbitSupplyContract(): string {
 const id = process.env.ORBIT_SUPPLY_CONTRACT_ID?.trim();
 if (!id || !id.startsWith("C")) {
 throw new Error(
 "Orbit Supply is fully on-chain. Deploy contracts/orbit-supply and set ORBIT_SUPPLY_CONTRACT_ID=C…"
 );
 }
 return id;
}

export function requireOrbitBlendSwapContract(): string {
 const id = process.env.ORBIT_BLEND_SWAP_CONTRACT_ID?.trim();
 if (!id || !id.startsWith("C")) {
 throw new Error(
 "Orbit Blend Swap is not configured. Deploy contracts/orbit-blend-swap, fund it with Blend USDC, and set ORBIT_BLEND_SWAP_CONTRACT_ID=C…"
 );
 }
 return id;
}

export function orbitBlendSwapConfigured(): boolean {
 const id = process.env.ORBIT_BLEND_SWAP_CONTRACT_ID?.trim();
 return Boolean(id && id.startsWith("C"));
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
 // Users often take >2 min reviewing Freighter - short bounds cause tx_too_late.
 .setTimeout(300)
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

/**
 * Read a SEP-41 / SAC token balance via Soroban simulate (not Horizon).
 * Required for StelDex assets like pUSDC/cUSDC/STELLAR that never appear on classic balances.
 */
export async function getSorobanTokenBalance(
 walletAddress: string,
 tokenContractId: string
): Promise<bigint> {
 const {
 Address,
 Contract,
 TransactionBuilder,
 Networks,
 BASE_FEE,
 scValToNative,
 } = await import("@stellar/stellar-sdk");
 const { Server } = await import("@stellar/stellar-sdk/rpc");
 const { getDemoKeypair } = await import("./stellar");

 const rpc = new Server(SOROBAN_RPC);
 // Simulation source can be any funded account; balance() reads `walletAddress`.
 const demo = await getDemoKeypair();
 const account = await rpc.getAccount(demo.publicKey());

 const contract = new Contract(tokenContractId);
 const tx = new TransactionBuilder(account, {
 fee: BASE_FEE,
 networkPassphrase: Networks.TESTNET,
 })
 .addOperation(contract.call("balance", Address.fromString(walletAddress).toScVal()))
 .setTimeout(30)
 .build();

 const sim = await rpc.simulateTransaction(tx);
 if ((sim as any)?.error) {
 throw new Error(`Token balance simulation failed: ${(sim as any).error}`);
 }
 const retval = (sim as any)?.result?.retval;
 if (retval == null) return 0n;
 const native = scValToNative(retval);
 if (typeof native === "bigint") return native;
 if (typeof native === "number") return BigInt(Math.trunc(native));
 if (typeof native === "string") return BigInt(native);
 return 0n;
}
