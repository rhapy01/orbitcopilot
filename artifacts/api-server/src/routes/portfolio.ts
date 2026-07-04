import { Router, type IRouter } from "express";
import { getDemoKeypair, getAccountBalances, getAssetPrice, getAccountOperations } from "../lib/stellar";
import {
  GetPortfolioSummaryResponse,
  GetRecentActivityResponse,
} from "@workspace/api-zod";
import {
  buildPortfolioIntel,
  formatEarningReport,
  formatRebalancePlan,
  getUnifiedPortfolioJson,
} from "../lib/portfolio";

const router: IRouter = Router();

router.get("/portfolio/unified", async (req, res): Promise<void> => {
  const publicKey =
    typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : "";
  if (!publicKey) {
    res.status(400).json({ error: "publicKey query parameter is required" });
    return;
  }
  try {
    const data = await getUnifiedPortfolioJson(publicKey);
    res.json(data);
  } catch (err: any) {
    req.log.error({ err }, "Unified portfolio failed");
    res.status(500).json({ error: err?.message ?? "Failed to build portfolio" });
  }
});

router.get("/portfolio/intel", async (req, res): Promise<void> => {
  const publicKey =
    typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : "";
  if (!publicKey) {
    res.status(400).json({ error: "publicKey query parameter is required" });
    return;
  }
  try {
    const intel = await buildPortfolioIntel(publicKey);
    res.json(intel);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to build portfolio intel" });
  }
});

router.get("/portfolio/earning", async (req, res): Promise<void> => {
  const publicKey =
    typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : "";
  if (!publicKey) {
    res.status(400).json({ error: "publicKey query parameter is required" });
    return;
  }
  try {
    const text = await formatEarningReport(publicKey);
    res.json({ network: "testnet", text });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed" });
  }
});

router.get("/portfolio/rebalance", async (req, res): Promise<void> => {
  const publicKey =
    typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : "";
  if (!publicKey) {
    res.status(400).json({ error: "publicKey query parameter is required" });
    return;
  }
  try {
    const text = await formatRebalancePlan(publicKey);
    res.json({ network: "testnet", text });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed" });
  }
});

router.get("/portfolio/summary", async (req, res): Promise<void> => {
  try {
    const publicKey =
      typeof req.query.publicKey === "string" ? req.query.publicKey.trim() : "";
    const address = publicKey || (await getDemoKeypair()).publicKey();
    const balances = await getAccountBalances(address);

    const gradientColors = [
      "hsl(290,70%,65%)",
      "hsl(340,80%,65%)",
      "hsl(15,90%,60%)",
      "hsl(35,95%,60%)",
      "hsl(210,90%,60%)",
    ];

    const assetValues = await Promise.all(
      balances.map(async (b) => {
        const priceUsd = await getAssetPrice(b.assetCode, b.assetIssuer ?? undefined);
        return { ...b, priceUsd, valueUsd: b.balance * priceUsd };
      })
    );

    const totalValueUsd = assetValues.reduce((s, a) => s + a.valueUsd, 0);
    const change24hPct = 3.2;
    const change24hUsd = totalValueUsd * (change24hPct / 100);
    const change7dPct = 8.7;
    const totalYieldEarned = 142.58;
    const activePositions = balances.length;

    const allocations = assetValues
      .filter((a) => a.valueUsd > 0)
      .map((a, i) => ({
        assetCode: a.assetCode,
        pct: totalValueUsd > 0 ? (a.valueUsd / totalValueUsd) * 100 : 0,
        valueUsd: a.valueUsd,
        color: gradientColors[i % gradientColors.length],
      }));

    // 30-day simulated on-chain history anchored to current real balance
    const now = Date.now();
    const performanceHistory = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(now - (29 - i) * 24 * 60 * 60 * 1000);
      const base = totalValueUsd * 0.85;
      const growth = (totalValueUsd - base) * (i / 29);
      const noise = (Math.random() - 0.5) * totalValueUsd * 0.015;
      return {
        date: date.toISOString().split("T")[0],
        valueUsd: Math.max(0, base + growth + noise),
      };
    });

    res.json(GetPortfolioSummaryResponse.parse({
      totalValueUsd,
      change24hUsd,
      change24hPct,
      change7dPct,
      totalYieldEarned,
      activePositions,
      allocations,
      performanceHistory,
    }));
  } catch (err) {
    req.log.error({ err }, "Failed to build portfolio summary");
    res.status(500).json({ error: "Failed to fetch portfolio from Stellar network" });
  }
});

router.get("/portfolio/activity", async (req, res): Promise<void> => {
  try {
    const keypair = await getDemoKeypair();
    const operations = await getAccountOperations(keypair.publicKey());

    const activity = operations.slice(0, 10).map((op: any, i: number) => {
      const typeMap: Record<string, string> = {
        payment: "payment",
        create_account: "account_created",
        change_trust: "trustline",
        manage_sell_offer: "trade",
        manage_buy_offer: "trade",
        path_payment_strict_receive: "swap",
        path_payment_strict_send: "swap",
      };

      const titleMap: Record<string, string> = {
        payment: "Payment on Stellar",
        create_account: "Account Created",
        change_trust: "Trustline Established",
        manage_sell_offer: "Trade Executed",
        manage_buy_offer: "Trade Executed",
        path_payment_strict_receive: "Asset Swap",
        path_payment_strict_send: "Asset Swap",
      };

      return {
        id: i + 1,
        type: typeMap[op.type] ?? op.type,
        title: titleMap[op.type] ?? op.type.replace(/_/g, " "),
        description: `On-chain operation on Stellar network · ${op.transaction_hash?.slice(0, 8) ?? ""}...`,
        valueUsd: null,
        assetCode: op.asset_code ?? (op.asset_type === "native" ? "XLM" : null),
        createdAt: op.created_at ?? new Date().toISOString(),
      };
    });

    res.json(GetRecentActivityResponse.parse(activity));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch activity from Stellar");
    res.status(500).json({ error: "Failed to fetch activity from Stellar network" });
  }
});

export default router;
