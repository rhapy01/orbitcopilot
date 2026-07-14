import { Router, type IRouter } from "express";
import {
  getDemoKeypair,
  getAccountBalances,
  getAccountOperations,
  getAssetPrice,
  buildTransaction,
  submitSignedTransaction,
  buildAddTrustlineTransaction,
  resolveClassicTrustline,
  SOROBAN_ASSET_ISSUERS,
} from "../lib/stellar";
import { getSteldexWalletBalances } from "../lib/steldex";
import {
  GetWalletResponse,
  GetWalletAssetsResponse,
  GetTransactionsResponse,
  BuildTransactionBody,
  BuildTransactionResponse,
  SubmitTransactionBody,
  SubmitTransactionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/wallet", async (req, res): Promise<void> => {
  const publicKey = typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : null;

  try {
    let address: string;
    let balances;

    if (publicKey) {
      address = publicKey;
      balances = await getAccountBalances(address);
    } else {
      const keypair = await getDemoKeypair();
      address = keypair.publicKey();
      balances = await getAccountBalances(address);
    }

    const xlmBalance = balances.find((b) => b.assetCode === "XLM")?.balance ?? 0;

    let totalValueUsd = 0;
    for (const b of balances) {
      const price = await getAssetPrice(b.assetCode, b.assetIssuer ?? undefined);
      totalValueUsd += b.balance * price;
    }

    res.json(
      GetWalletResponse.parse({
        id: 1,
        address,
        network: "Stellar Testnet",
        totalValueUsd,
        xlmBalance,
        isActive: true,
        createdAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    req.log.error({ err }, "Failed to fetch wallet from Stellar testnet");
    res.status(500).json({ error: "Failed to fetch wallet data from Stellar testnet" });
  }
});

router.get("/wallet/assets", async (req, res): Promise<void> => {
  const publicKey = typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : null;

  try {
    let address: string;
    let balances;
    if (publicKey) {
      address = publicKey;
      balances = await getAccountBalances(publicKey);
    } else {
      const keypair = await getDemoKeypair();
      address = keypair.publicKey();
      balances = await getAccountBalances(address);
    }

    const steldex = await getSteldexWalletBalances(address).catch(() => []);
    const seen = new Set(
      balances.map((b) => (b.assetCode.toUpperCase() === "CUSDC" ? "USDC" : b.assetCode.toUpperCase()))
    );
    for (const s of steldex) {
      const code = s.asset.toUpperCase() === "CUSDC" ? "USDC" : s.asset;
      if (seen.has(code.toUpperCase())) continue;
      balances.push({
        assetCode: code,
        assetIssuer: null,
        balance: s.balance,
        logoUrl: null,
      });
      seen.add(code.toUpperCase());
    }

    const assets = await Promise.all(
      balances.map(async (b, i) => {
        const priceUsd = await getAssetPrice(b.assetCode, b.assetIssuer ?? undefined);
        return {
          id: i + 1,
          assetCode: b.assetCode,
          assetIssuer: b.assetIssuer,
          balance: b.balance,
          valueUsd: b.balance * priceUsd,
          priceUsd,
          change24h: 0,
          logoUrl: b.logoUrl,
        };
      })
    );

    res.json(GetWalletAssetsResponse.parse(assets));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch wallet assets from Stellar testnet");
    res.status(500).json({ error: "Failed to fetch assets from Stellar testnet" });
  }
});

router.get("/wallet/transactions", async (req, res): Promise<void> => {
  const publicKey = typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : null;

  try {
    let address: string;
    let operations;

    if (publicKey) {
      address = publicKey;
      operations = await getAccountOperations(address);
    } else {
      const keypair = await getDemoKeypair();
      address = keypair.publicKey();
      operations = await getAccountOperations(address);
    }

    const txns = operations.map((op: any, i: number) => {
      let type: string = "receive";
      let assetCode = "XLM";
      let amount = 0;

      if (op.type === "payment") {
        type = op.from === address ? "send" : "receive";
        assetCode = op.asset_type === "native" ? "XLM" : op.asset_code ?? "XLM";
        amount = parseFloat(op.amount ?? "0");
      } else if (op.type === "create_account") {
        type = "receive";
        assetCode = "XLM";
        amount = parseFloat(op.starting_balance ?? "0");
      } else if (op.type === "manage_sell_offer" || op.type === "manage_buy_offer") {
        type = "swap";
        assetCode = op.selling_asset_code ?? op.buying_asset_code ?? "XLM";
        amount = parseFloat(op.amount ?? "0");
      } else if (op.type === "change_trust") {
        type = "receive";
        assetCode = op.asset_code ?? "XLM";
        amount = 0;
      } else if (op.type === "path_payment_strict_send" || op.type === "path_payment_strict_receive") {
        type = "swap";
        assetCode = op.asset_type === "native" ? "XLM" : op.asset_code ?? "XLM";
        amount = parseFloat(op.amount ?? "0");
      }

      return {
        id: i + 1,
        type,
        assetCode,
        amount,
        valueUsd: 0,
        status: "completed" as const,
        counterparty: op.from !== address ? op.from : op.to,
        description: `${op.type.replace(/_/g, " ")} on Stellar testnet`,
        hash: op.transaction_hash ?? null,
        createdAt: op.created_at ?? new Date().toISOString(),
      };
    });

    res.json(GetTransactionsResponse.parse(txns));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch transactions from Stellar testnet");
    res.status(500).json({ error: "Failed to fetch transactions from Stellar testnet" });
  }
});

router.post("/wallet/build-transaction", async (req, res): Promise<void> => {
  const parsed = BuildTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await buildTransaction(parsed.data);
    res.json(BuildTransactionResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build transaction");
    res.status(400).json({ error: err?.message ?? "Failed to build transaction" });
  }
});

router.post("/wallet/submit-transaction", async (req, res): Promise<void> => {
  const parsed = SubmitTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await submitSignedTransaction(parsed.data.signedXdr, parsed.data.networkPassphrase);
  res.json(SubmitTransactionResponse.parse(result));
});

router.post("/wallet/add-trustline", async (req, res): Promise<void> => {
  try {
    const { walletAddress, assetCode, assetIssuer } = req.body as {
      walletAddress?: string;
      assetCode?: string;
      assetIssuer?: string;
    };
    if (!walletAddress || !assetCode) {
      res.status(400).json({ error: "walletAddress and assetCode are required" });
      return;
    }
    // Resolve issuer: use provided, classic SAC map (cUSDC→USDC), or known issuers
    const classic = resolveClassicTrustline(assetCode);
    const code = classic?.assetCode ?? assetCode;
    const issuer =
      assetIssuer ?? classic?.assetIssuer ?? SOROBAN_ASSET_ISSUERS[assetCode.toUpperCase()];
    if (!issuer) {
      res.status(400).json({ error: `Unknown issuer for ${assetCode}. Provide assetIssuer.` });
      return;
    }
    const { xdr, networkPassphrase } = await buildAddTrustlineTransaction(
      walletAddress,
      code,
      issuer
    );
    res.json({ xdr, networkPassphrase, assetCode: code, assetIssuer: issuer });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Failed to build trustline transaction" });
  }
});

export default router;
