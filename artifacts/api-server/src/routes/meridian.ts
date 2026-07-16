import { Router, type IRouter } from "express";
import {
  formatMeridianStatus,
  prepareMeridianDeposit,
  prepareMeridianWithdraw,
} from "../lib/meridian";

const router: IRouter = Router();

router.get("/meridian/status", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  try {
    res.json({ text: await formatMeridianStatus(wallet || null) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "status failed" });
  }
});

router.post("/meridian/deposit", async (req, res): Promise<void> => {
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
  if (!amount) {
    res.status(400).json({ error: "amount required" });
    return;
  }
  try {
    res.json(await prepareMeridianDeposit({ walletAddress, amount }));
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "meridian deposit failed" });
  }
});

router.post("/meridian/withdraw", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const shares =
    typeof req.body?.shares === "string"
      ? req.body.shares.trim()
      : typeof req.body?.amount === "string"
        ? req.body.amount.trim()
        : String(req.body?.shares ?? req.body?.amount ?? "");
  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }
  if (!shares) {
    res.status(400).json({ error: "shares (or amount) required" });
    return;
  }
  try {
    res.json(await prepareMeridianWithdraw({ walletAddress, shares }));
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "meridian withdraw failed" });
  }
});

export default router;
