import { Router, type IRouter } from "express";
import {
  formatOrbitSupplyStatus,
  prepareOrbitSupplyClaim,
  prepareOrbitSupplyDeposit,
  prepareOrbitSupplyWithdraw,
} from "../lib/orbit-supply";

const router: IRouter = Router();

router.get("/orbit-supply/status", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  try {
    res.json({ text: await formatOrbitSupplyStatus(wallet || null) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message });
  }
});

router.post("/orbit-supply/deposit", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : String(req.body?.amount ?? "");
  const asset = typeof req.body?.asset === "string" ? req.body.asset.trim() : "";
  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  if (!amount || !asset) {
    res.status(400).json({ error: "amount and asset required" });
    return;
  }
  try {
    const result = await prepareOrbitSupplyDeposit({ walletAddress, amount, asset });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "deposit failed" });
  }
});

router.post("/orbit-supply/withdraw", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : String(req.body?.amount ?? "");
  const asset = typeof req.body?.asset === "string" ? req.body.asset.trim() : "";
  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  if (!amount || !asset) {
    res.status(400).json({ error: "amount and asset required" });
    return;
  }
  try {
    const result = await prepareOrbitSupplyWithdraw({ walletAddress, amount, asset });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "withdraw failed" });
  }
});

router.post("/orbit-supply/claim", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  try {
    const result = await prepareOrbitSupplyClaim({ walletAddress });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "claim failed" });
  }
});

export default router;
