import { Router, type IRouter } from "express";
import {
  confirmPerpOpen,
  formatPerpMarkets,
  formatPerpPositions,
  listPerpMarkets,
  listPerpPositions,
  preparePerpClose,
  preparePerpOpen,
} from "../lib/perps";

const router: IRouter = Router();

router.get("/perps/markets", async (_req, res): Promise<void> => {
  try {
    const markets = await listPerpMarkets();
    res.json({ network: "testnet", markets });
  } catch (err: any) {
    res.status(502).json({ error: err?.message });
  }
});

router.get("/perps/summary", async (_req, res): Promise<void> => {
  try {
    res.json({ network: "testnet", text: await formatPerpMarkets() });
  } catch (err: any) {
    res.status(502).json({ error: err?.message });
  }
});

router.get("/perps/positions", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet required" });
    return;
  }
  try {
    res.json({ network: "testnet", positions: await listPerpPositions(wallet) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message });
  }
});

router.post("/perps/open", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const marketHint = typeof req.body?.marketHint === "string" ? req.body.marketHint.trim() : "";
  const sideRaw = typeof req.body?.side === "string" ? req.body.side.trim().toLowerCase() : "long";
  const marginUsdc = typeof req.body?.marginUsdc === "string" ? req.body.marginUsdc.trim() : "";
  const leverage = Number(req.body?.leverage ?? 1);
  const stopLoss =
    req.body?.stopLoss != null && req.body.stopLoss !== ""
      ? Number(req.body.stopLoss)
      : undefined;
  const takeProfit =
    req.body?.takeProfit != null && req.body.takeProfit !== ""
      ? Number(req.body.takeProfit)
      : undefined;

  const side = sideRaw === "short" || sideRaw === "sell" ? "short" : "long";

  if (!walletAddress || !marketHint || !marginUsdc) {
    res.status(400).json({ error: "walletAddress, marketHint, marginUsdc required" });
    return;
  }

  try {
    const result = await preparePerpOpen({
      walletAddress,
      marketHint,
      side,
      marginUsdc,
      leverage,
      stopLoss,
      takeProfit,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Open failed" });
  }
});

router.post("/perps/confirm", async (req, res): Promise<void> => {
  const positionId = Number(req.body?.positionId);
  const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
  if (!positionId || !txHash) {
    res.status(400).json({ error: "positionId and txHash required" });
    return;
  }
  try {
    res.json(await confirmPerpOpen(positionId, txHash));
  } catch (err: any) {
    res.status(400).json({ error: err?.message });
  }
});

router.post("/perps/close", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const positionId = req.body?.positionId != null ? Number(req.body.positionId) : undefined;
  const marketHint =
    typeof req.body?.marketHint === "string" ? req.body.marketHint.trim() : undefined;

  if (!walletAddress) {
    res.status(400).json({ error: "walletAddress required" });
    return;
  }

  try {
    const result = await preparePerpClose({ walletAddress, positionId, marketHint });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Close failed" });
  }
});

router.get("/perps/positions/text", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet required" });
    return;
  }
  res.json({ text: await formatPerpPositions(wallet) });
});

export default router;
