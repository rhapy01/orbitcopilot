import { Router, type IRouter } from "express";
import {
  defindexConfigured,
  formatDefindexStatus,
  prepareDefindexDeposit,
  prepareDefindexWithdraw,
} from "../lib/defindex";

const router: IRouter = Router();

router.get("/defindex/status", async (_req, res): Promise<void> => {
  try {
    res.json({ text: await formatDefindexStatus(), configured: defindexConfigured() });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "status failed" });
  }
});

router.post("/defindex/deposit", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : String(req.body?.amount ?? "");
  const asset =
    typeof req.body?.asset === "string" ? req.body.asset.trim() : "XLM";

  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  if (!amount) {
    res.status(400).json({ error: "amount required" });
    return;
  }
  try {
    if (!defindexConfigured()) {
      res.status(503).json({ error: "DeFindex not configured. Set DEFINDEX_API_KEY in .env." });
      return;
    }
    const result = await prepareDefindexDeposit({ walletAddress, amount, asset });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "defindex deposit failed" });
  }
});

/** @deprecated alias — XLM-only */
router.post("/defindex/deposit-xlm", async (req, res): Promise<void> => {
  req.body = { ...req.body, asset: "XLM" };
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : String(req.body?.amount ?? "");
  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  try {
    if (!defindexConfigured()) {
      res.status(503).json({ error: "DeFindex not configured. Set DEFINDEX_API_KEY in .env." });
      return;
    }
    res.json(await prepareDefindexDeposit({ walletAddress, amount, asset: "XLM" }));
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "defindex deposit failed" });
  }
});

router.post("/defindex/withdraw", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : String(req.body?.amount ?? "");
  const asset =
    typeof req.body?.asset === "string" ? req.body.asset.trim() : "XLM";

  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  if (!amount) {
    res.status(400).json({ error: "amount required" });
    return;
  }
  try {
    if (!defindexConfigured()) {
      res.status(503).json({ error: "DeFindex not configured. Set DEFINDEX_API_KEY in .env." });
      return;
    }
    const result = await prepareDefindexWithdraw({ walletAddress, amount, asset });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "defindex withdraw failed" });
  }
});

router.post("/defindex/withdraw-xlm", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : String(req.body?.amount ?? "");
  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  try {
    if (!defindexConfigured()) {
      res.status(503).json({ error: "DeFindex not configured. Set DEFINDEX_API_KEY in .env." });
      return;
    }
    res.json(await prepareDefindexWithdraw({ walletAddress, amount, asset: "XLM" }));
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "defindex withdraw failed" });
  }
});

export default router;
