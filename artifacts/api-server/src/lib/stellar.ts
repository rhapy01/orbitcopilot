import { Horizon, Keypair, Asset } from "@stellar/stellar-sdk";
import { logger } from "./logger";

const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const MAINNET_HORIZON = "https://horizon.stellar.org";

export const horizonTestnet = new Horizon.Server(TESTNET_HORIZON);
export const horizonMainnet = new Horizon.Server(MAINNET_HORIZON);

// Known USDC issuer on testnet
const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
// Known USDC issuer on mainnet (Circle)
const MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

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

    // Trust USDC on testnet
    await trustAsset(_demoKeypair, new Asset("USDC", TESTNET_USDC_ISSUER));
    logger.info({ addr }, "Trusted USDC on testnet");
  } catch (err) {
    logger.error({ err }, "Friendbot funding failed");
    _funded = true; // proceed anyway
  }

  return _demoKeypair;
}

async function trustAsset(keypair: Keypair, asset: Asset): Promise<void> {
  try {
    const { TransactionBuilder, Networks, Operation, BASE_FEE } = await import("@stellar/stellar-sdk");
    const account = await horizonTestnet.loadAccount(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    await horizonTestnet.submitTransaction(tx);
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
  const account = await horizonTestnet.loadAccount(publicKey);

  return account.balances.map((b: any) => {
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
  created_at: string;
}

export async function getAccountOperations(publicKey: string): Promise<StellarOperation[]> {
  const ops = await horizonTestnet
    .operations()
    .forAccount(publicKey)
    .order("desc")
    .limit(20)
    .call();

  return ops.records as any[];
}

// Fetch XLM price in USD from the Stellar mainnet DEX
export async function getXlmPriceUsd(): Promise<number> {
  try {
    const resp = await fetch(
      `https://horizon.stellar.org/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=${MAINNET_USDC_ISSUER}&limit=1`
    );
    const data: any = await resp.json();
    if (data.bids?.[0]?.price) {
      return parseFloat(data.bids[0].price);
    }
    return 0.11; // fallback
  } catch {
    return 0.11;
  }
}

// Fetch real Stellar mainnet assets with price data via StellarExpert
export async function getPopularStellarAssets(): Promise<any[]> {
  try {
    // Use stellar.expert's public API - free, no auth required
    const resp = await fetch(
      "https://api.stellar.expert/explorer/mainnet/asset?order=desc&sort=volume7d&limit=20"
    );
    const data: any = await resp.json();
    return data._embedded?.records ?? [];
  } catch (err) {
    logger.warn({ err }, "Failed to fetch assets from StellarExpert");
    return [];
  }
}

export async function getAssetPrice(code: string, issuer?: string): Promise<number> {
  if (code === "XLM") return getXlmPriceUsd();
  if (code === "USDC") return 1.0;

  try {
    const issuerPart = issuer ? `-${issuer}` : "";
    const resp = await fetch(
      `https://api.stellar.expert/explorer/mainnet/asset/${code}${issuerPart}/price`
    );
    const data: any = await resp.json();
    // price is in XLM — convert to USD
    const xlmPrice = await getXlmPriceUsd();
    return (data.price ?? 0) * xlmPrice;
  } catch {
    return 0;
  }
}
