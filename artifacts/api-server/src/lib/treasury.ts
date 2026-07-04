import { NETWORK_PASSPHRASE, horizon, TESTNET_USDC_ISSUER } from "./stellar";
import { logger } from "./logger";

/**
 * Orbit treasury receives prediction stakes and perp margin (testnet).
 * Prefer ORBIT_TREASURY_PUBLIC_KEY (+ ORBIT_TREASURY_SECRET for payouts) in .env.
 * If unset, an ephemeral Friendbot-funded treasury is created for this process.
 */
let _ephemeral: { publicKey: string; secret: string } | null = null;

export async function ensureTreasury(): Promise<string> {
  const key = process.env.ORBIT_TREASURY_PUBLIC_KEY?.trim();
  if (key && /^G[A-Z2-7]{55}$/.test(key)) return key;

  if (_ephemeral) {
    process.env.ORBIT_TREASURY_PUBLIC_KEY = _ephemeral.publicKey;
    if (!process.env.ORBIT_TREASURY_SECRET) {
      process.env.ORBIT_TREASURY_SECRET = _ephemeral.secret;
    }
    return _ephemeral.publicKey;
  }

  const { Keypair } = await import("@stellar/stellar-sdk");
  const kp = Keypair.random();
  await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(kp.publicKey())}`);
  // Trust USDC so margin payments can be received
  try {
    const { TransactionBuilder, Networks, Operation, BASE_FEE, Asset } =
      await import("@stellar/stellar-sdk");
    const account = await horizon.loadAccount(kp.publicKey());
    const usdc = new Asset("USDC", TESTNET_USDC_ISSUER);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: usdc }))
      .setTimeout(30)
      .build();
    tx.sign(kp);
    await horizon.submitTransaction(tx);
  } catch (err) {
    logger.warn({ err }, "Treasury USDC trustline setup skipped/failed");
  }

  _ephemeral = { publicKey: kp.publicKey(), secret: kp.secret() };
  process.env.ORBIT_TREASURY_PUBLIC_KEY = kp.publicKey();
  process.env.ORBIT_TREASURY_SECRET = kp.secret();
  logger.warn(
    { publicKey: kp.publicKey() },
    "Ephemeral Orbit treasury created — set ORBIT_TREASURY_PUBLIC_KEY and ORBIT_TREASURY_SECRET in .env to persist"
  );
  return kp.publicKey();
}

export function getTreasuryPublicKey(): string {
  const key = process.env.ORBIT_TREASURY_PUBLIC_KEY?.trim();
  if (key && /^G[A-Z2-7]{55}$/.test(key)) return key;
  if (_ephemeral) return _ephemeral.publicKey;
  throw new Error("Treasury not ready — call ensureTreasury() first");
}

export function getTreasurySecret(): string | null {
  const s = process.env.ORBIT_TREASURY_SECRET?.trim();
  return s && s.startsWith("S") ? s : null;
}

/** Build unsigned payment of XLM to treasury (prediction stakes). */
export async function buildTreasuryXlmPayment(input: {
  sourcePublicKey: string;
  amountXlm: string;
  memo: string;
}): Promise<{ xdr: string; networkPassphrase: string; destination: string }> {
  const { TransactionBuilder, Networks, Operation, BASE_FEE, Asset, Memo } =
    await import("@stellar/stellar-sdk");
  const destination = await ensureTreasury();
  const account = await horizon.loadAccount(input.sourcePublicKey);
  const memoText = input.memo.slice(0, 28);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: input.amountXlm,
      })
    )
    .addMemo(Memo.text(memoText))
    .setTimeout(120)
    .build();

  return {
    xdr: tx.toXDR(),
    networkPassphrase: NETWORK_PASSPHRASE,
    destination,
  };
}

/** Build unsigned payment of classic testnet USDC to treasury (perp margin). */
export async function buildTreasuryUsdcPayment(input: {
  sourcePublicKey: string;
  amountUsdc: string;
  memo: string;
}): Promise<{ xdr: string; networkPassphrase: string; destination: string }> {
  const { TransactionBuilder, Networks, Operation, BASE_FEE, Asset, Memo } =
    await import("@stellar/stellar-sdk");
  const destination = await ensureTreasury();
  const usdc = new Asset("USDC", TESTNET_USDC_ISSUER);
  const account = await horizon.loadAccount(input.sourcePublicKey);
  const memoText = input.memo.slice(0, 28);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: usdc,
        amount: input.amountUsdc,
      })
    )
    .addMemo(Memo.text(memoText))
    .setTimeout(120)
    .build();

  return {
    xdr: tx.toXDR(),
    networkPassphrase: NETWORK_PASSPHRASE,
    destination,
  };
}

/** Build treasury → user payout (requires ORBIT_TREASURY_SECRET). */
export async function buildTreasuryPayoutXlm(input: {
  destinationPublicKey: string;
  amountXlm: string;
  memo: string;
}): Promise<{ xdr: string; networkPassphrase: string } | null> {
  const secret = getTreasurySecret();
  if (!secret) {
    logger.warn("ORBIT_TREASURY_SECRET not set — cannot build claim payout");
    return null;
  }
  const { Keypair, TransactionBuilder, Networks, Operation, BASE_FEE, Asset, Memo } =
    await import("@stellar/stellar-sdk");
  const kp = Keypair.fromSecret(secret);
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: input.destinationPublicKey,
        asset: Asset.native(),
        amount: input.amountXlm,
      })
    )
    .addMemo(Memo.text(input.memo.slice(0, 28)))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  return { xdr: tx.toXDR(), networkPassphrase: NETWORK_PASSPHRASE };
}

export async function buildTreasuryPayoutUsdc(input: {
  destinationPublicKey: string;
  amountUsdc: string;
  memo: string;
}): Promise<{ xdr: string; networkPassphrase: string } | null> {
  const secret = getTreasurySecret();
  if (!secret) return null;
  const { Keypair, TransactionBuilder, Networks, Operation, BASE_FEE, Asset, Memo } =
    await import("@stellar/stellar-sdk");
  const kp = Keypair.fromSecret(secret);
  const usdc = new Asset("USDC", TESTNET_USDC_ISSUER);
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: input.destinationPublicKey,
        asset: usdc,
        amount: input.amountUsdc,
      })
    )
    .addMemo(Memo.text(input.memo.slice(0, 28)))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  // For USDC payouts we submit server-side if secret present
  try {
    const result = await horizon.submitTransaction(tx);
    return { xdr: tx.toXDR(), networkPassphrase: NETWORK_PASSPHRASE, hash: result.hash } as any;
  } catch (err) {
    logger.error({ err }, "Treasury USDC payout failed");
    return { xdr: tx.toXDR(), networkPassphrase: NETWORK_PASSPHRASE };
  }
}
