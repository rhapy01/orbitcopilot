import { Router, type IRouter } from "express";
import { getDemoKeypair, getAccountBalances, getAccountOperations, getXlmPriceUsd, getAssetPrice } from "../lib/stellar";
import {
  GetWalletResponse,
  GetWalletAssetsResponse,
  GetTransactionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/wallet", async (req, res): Promise<void> => {
  try {
    const keypair = await getDemoKeypair();
    const address = keypair.publicKey();
    const balances = await getAccountBalances(address);
    const xlmBalance = balances.find((b) => b.assetCode === "XLM")?.balance ?? 0;
    const xlmPrice = await getXlmPriceUsd();

    let totalValueUsd = 0;
    for (const b of balances) {
      const price = await getAssetPrice(b.assetCode, b.assetIssuer ?? undefined);
      totalValueUsd += b.balance * price;
    }

    res.json(GetWalletResponse.parse({
      id: 1,
      address,
      network: "Stellar Testnet",
      totalValueUsd,
      xlmBalance,
      isActive: true,
      createdAt: new Date().toISOString(),
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch wallet from Stellar");
    res.status(500).json({ error: "Failed to fetch wallet data from Stellar network" });
  }
});

router.get("/wallet/assets", async (req, res): Promise<void> => {
  try {
    const keypair = await getDemoKeypair();
    const balances = await getAccountBalances(keypair.publicKey());

    const assets = await Promise.all(
      balances.map(async (b, i) => {
        const priceUsd = await getAssetPrice(b.assetCode, b.assetIssuer ?? undefined);
        const change24h = b.assetCode === "XLM" ? -1.2 : b.assetCode === "USDC" ? 0.0 : (Math.random() - 0.5) * 10;
        return {
          id: i + 1,
          assetCode: b.assetCode,
          assetIssuer: b.assetIssuer,
          balance: b.balance,
          valueUsd: b.balance * priceUsd,
          priceUsd,
          change24h,
          logoUrl: b.logoUrl,
        };
      })
    );

    res.json(GetWalletAssetsResponse.parse(assets));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch wallet assets from Stellar");
    res.status(500).json({ error: "Failed to fetch assets from Stellar network" });
  }
});

router.get("/wallet/transactions", async (req, res): Promise<void> => {
  try {
    const keypair = await getDemoKeypair();
    const operations = await getAccountOperations(keypair.publicKey());

    const txns = operations.map((op: any, i: number) => {
      let type: string = "receive";
      let assetCode = "XLM";
      let amount = 0;

      if (op.type === "payment") {
        type = op.from === keypair.publicKey() ? "send" : "receive";
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
      }

      return {
        id: i + 1,
        type,
        assetCode,
        amount,
        valueUsd: 0,
        status: "completed" as const,
        counterparty: op.from !== keypair.publicKey() ? op.from : op.to,
        description: `${op.type.replace(/_/g, " ")} on Stellar`,
        hash: op.transaction_hash ?? null,
        createdAt: op.created_at ?? new Date().toISOString(),
      };
    });

    res.json(GetTransactionsResponse.parse(txns));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch transactions from Stellar");
    res.status(500).json({ error: "Failed to fetch transactions from Stellar network" });
  }
});

export default router;
