import { Router, type IRouter } from "express";
import {
  confirmPredictionBet,
  formatPredictionMarkets,
  formatPredictionPositions,
  listPredictionMarkets,
  listPredictionPositions,
  preparePredictionBet,
} from "../lib/predict";

const router: IRouter = Router();

router.get("/predict/markets", async (_req, res): Promise<void> => {
  try {
    const markets = await listPredictionMarkets();
    res.json({ network: "testnet", markets });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Failed to list markets" });
  }
});

router.get("/predict/summary", async (_req, res): Promise<void> => {
  try {
    res.json({ network: "testnet", text: await formatPredictionMarkets() });
  } catch (err: any) {
    res.status(502).json({ error: err?.message });
  }
});

router.get("/predict/positions", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet required" });
    return;
  }
  try {
    const positions = await listPredictionPositions(wallet);
    res.json({ network: "testnet", positions });
  } catch (err: any) {
    res.status(502).json({ error: err?.message });
  }
});

router.post("/predict/bet", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const marketHint = typeof req.body?.marketHint === "string" ? req.body.marketHint.trim() : "";
  const outcomeRaw = typeof req.body?.outcome === "string" ? req.body.outcome.trim().toLowerCase() : "yes";
  const amountXlm = typeof req.body?.amountXlm === "string" ? req.body.amountXlm.trim() : "";
  const outcome = outcomeRaw === "no" || outcomeRaw === "n" ? "no" : "yes";

  if (!walletAddress || !marketHint || !amountXlm) {
    res.status(400).json({ error: "walletAddress, marketHint, amountXlm required" });
    return;
  }

  try {
    const result = await preparePredictionBet({
      walletAddress,
      marketHint,
      outcome,
      amountXlm,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Bet failed" });
  }
});

router.post("/predict/confirm", async (req, res): Promise<void> => {
  const positionId = Number(req.body?.positionId);
  const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
  if (!positionId || !txHash) {
    res.status(400).json({ error: "positionId and txHash required" });
    return;
  }
  try {
    const pos = await confirmPredictionBet(positionId, txHash);
    res.json(pos);
  } catch (err: any) {
    res.status(400).json({ error: err?.message });
  }
});

router.get("/predict/positions/text", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet required" });
    return;
  }
  res.json({ text: await formatPredictionPositions(wallet) });
});

export default router;
