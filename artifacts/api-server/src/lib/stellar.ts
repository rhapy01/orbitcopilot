import { Horizon, Keypair, Asset } from "@stellar/stellar-sdk";
import { logger } from "./logger";

/** Orbit is testnet-only. */
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";

export const horizon = new Horizon.Server(TESTNET_HORIZON);

/** Classic testnet USDC (Circle test issuer). */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Well-known classic assets on Stellar testnet. */
export const KNOWN_TESTNET_ASSETS: Record<string, string | null> = {
  XLM: null,
  USDC: TESTNET_USDC_ISSUER,
};

let _demoKeypair: Keypair | null = null;
let _funded = false;

export async function getDemoKeypair(): Promise<Keypair> {
  if (_demoKeypair && _funded) return _demoKeypair;

  _demoKeypair = Keypair.random();
  const addr = _demoKeypair.publicKey();

  try {
    logger.info({ addr }, "Funding demo account via Friendbot");
    const resp = await fetch(`https://friendbot.stellar.org?addr=${addr}`);
    if (!resp.ok) throw new Error(`Friendbot error ${resp.status}`);
    _funded = true;
    logger.info({ addr }, "Demo account funded");
    await trustAsset(_demoKeypair, new Asset("USDC", TESTNET_USDC_ISSUER));
  } catch (err) {
    logger.error({ err }, "Friendbot funding failed");
    _funded = true;
  }

  return _demoKeypair;
}

async function trustAsset(keypair: Keypair, asset: Asset): Promise<void> {
  try {
    const { TransactionBuilder, Networks, Operation, BASE_FEE } = await import("@stellar/stellar-sdk");
    const account = await horizon.loadAccount(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    await horizon.submitTransaction(tx);
  } catch (err) {
    logger.warn({ err }, "Trust operation failed (asset may already be trusted)");
  }
}

export interface StellarBalance {
  assetCode: string;
  assetIssuer: string | null;
  balance: number;
  logoUrl: string | null;
}

export async function getAccountBalances(publicKey: string): Promise<StellarBalance[]> {
  const account = await horizon.loadAccount(publicKey);
  return _parseBalances(account.balances);
}

function _parseBalances(balances: any[]): StellarBalance[] {
  return balances.map((b: any) => {
    if (b.asset_type === "native") {
      return {
        assetCode: "XLM",
        assetIssuer: null,
        balance: parseFloat(b.balance),
        logoUrl: "https://stellar.expert/img/vendor/stellar/XLM.svg",
      };
    }
    return {
      assetCode: b.asset_code,
      assetIssuer: b.asset_issuer,
      balance: parseFloat(b.balance),
      logoUrl: null,
    };
  });
}

export interface StellarOperation {
  id: string;
  type: string;
  amount?: string;
  asset_code?: string;
  asset_type?: string;
  from?: string;
  to?: string;
  starting_balance?: string;
  selling_asset_code?: string;
  buying_asset_code?: string;
  transaction_hash?: string;
  created_at: string;
}

export async function getAccountOperations(publicKey: string): Promise<StellarOperation[]> {
  const ops = await horizon
    .operations()
    .forAccount(publicKey)
    .order("desc")
    .limit(25)
    .call();
  return ops.records as any[];
}

export async function getXlmPriceUsd(): Promise<number> {
  try {
    const resp = await fetch(
      `https://horizon-testnet.stellar.org/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=${TESTNET_USDC_ISSUER}&limit=1`
    );
    const data: any = await resp.json();
    if (data.bids?.[0]?.price) return parseFloat(data.bids[0].price);
  } catch {
    // fall through
  }
  return 0.11;
}

export async function getPopularStellarAssets(): Promise<any[]> {
  try {
    const resp = await fetch(
      "https://api.stellar.expert/explorer/testnet/asset?order=desc&sort=volume7d&limit=20"
    );
    const data: any = await resp.json();
    return data._embedded?.records ?? [];
  } catch (err) {
    logger.warn({ err }, "Failed to fetch assets from StellarExpert testnet");
    return [];
  }
}

export async function getAssetPrice(code: string, _issuer?: string): Promise<number> {
  if (code === "XLM") return getXlmPriceUsd();
  if (code === "USDC" || code === "pUSDC" || code === "cUSDC") return 1.0;
  return 0;
}

export function resolveKnownAsset(codeRaw: string): Asset | null {
  const code = Object.keys(KNOWN_TESTNET_ASSETS).find(
    (k) => k.toLowerCase() === codeRaw.toLowerCase()
  );
  if (!code) return null;
  const issuer = KNOWN_TESTNET_ASSETS[code];
  return issuer ? new Asset(code, issuer) : Asset.native();
}

export interface BuildTxParams {
  type: "send" | "swap";
  sourcePublicKey: string;
  sendAsset: string;
  sendAmount: string;
  destination?: string | null;
  destAsset?: string | null;
}

export interface BuildTxResult {
  xdr: string;
  networkPassphrase: string;
  estimatedDestAmount: string | null;
  destMin: string | null;
}

/** Classic payment or path-payment on Stellar testnet. */
export async function buildTransaction(params: BuildTxParams): Promise<BuildTxResult> {
  const { TransactionBuilder, Networks, Operation, BASE_FEE } = await import("@stellar/stellar-sdk");

  const sendAsset = resolveKnownAsset(params.sendAsset);
  if (!sendAsset) {
    throw new Error(
      `Unsupported asset "${params.sendAsset}". Supported classic: ${Object.keys(KNOWN_TESTNET_ASSETS).join(", ")}`
    );
  }

  const account = await horizon.loadAccount(params.sourcePublicKey);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  });

  let estimatedDestAmount: string | null = null;
  let destMin: string | null = null;

  if (params.type === "send") {
    if (!params.destination) throw new Error("destination is required for a send transaction");
    if (!/^G[A-Z0-9]{55}$/.test(params.destination)) {
      throw new Error("destination is not a valid Stellar address");
    }
    builder.addOperation(
      Operation.payment({
        destination: params.destination,
        asset: sendAsset,
        amount: params.sendAmount,
      })
    );
  } else {
    if (!params.destAsset) throw new Error("destAsset is required for a swap transaction");
    const destAsset = resolveKnownAsset(params.destAsset);
    if (!destAsset) {
      throw new Error(
        `Unsupported asset "${params.destAsset}". Supported classic: ${Object.keys(KNOWN_TESTNET_ASSETS).join(", ")}`
      );
    }

    const paths = await horizon.strictSendPaths(sendAsset, params.sendAmount, [destAsset]).call();
    const best = paths.records.sort(
      (a, b) => parseFloat(b.destination_amount) - parseFloat(a.destination_amount)
    )[0];
    if (!best) {
      throw new Error("No liquidity path found on the testnet Stellar DEX for this swap");
    }

    estimatedDestAmount = best.destination_amount;
    destMin = (parseFloat(best.destination_amount) * 0.99).toFixed(7);

    builder.addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset,
        sendAmount: params.sendAmount,
        destination: params.sourcePublicKey,
        destAsset,
        destMin,
        path: best.path as any,
      })
    );
  }

  const tx = builder.setTimeout(120).build();

  return {
    xdr: tx.toXDR(),
    networkPassphrase: Networks.TESTNET,
    estimatedDestAmount,
    destMin,
  };
}

export async function submitSignedTransaction(
  signedXdr: string,
  networkPassphrase: string
): Promise<{ success: boolean; hash: string | null; error: string | null }> {
  const { TransactionBuilder } = await import("@stellar/stellar-sdk");
  try {
    const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    const result = await horizon.submitTransaction(tx as any);
    return { success: true, hash: result.hash, error: null };
  } catch (err: any) {
    const extras = err?.response?.data?.extras?.result_codes;
    const message = extras ? JSON.stringify(extras) : err?.message ?? "Transaction submission failed";
    logger.error({ err: message }, "Transaction submission failed");
    return { success: false, hash: null, error: message };
  }
}
