import { Router, type IRouter } from "express";
import {
  REFLECTOR_ORACLES,
  formatReflectorPrices,
  getReflectorPrice,
  getReflectorPrices,
} from "../lib/reflector";

const router: IRouter = Router();

router.get("/reflector/oracles", (_req, res): void => {
  res.json({ network: "testnet", oracles: REFLECTOR_ORACLES });
});

router.get("/reflector/price", async (req, res): Promise<void> => {
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol.trim() : "XLM";
  try {
    const price = await getReflectorPrice(symbol);
    res.json({ network: "testnet", ...price });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Price unavailable" });
  }
});

router.get("/reflector/prices", async (req, res): Promise<void> => {
  const raw = typeof req.query.symbols === "string" ? req.query.symbols : "XLM,USDC,BTC,ETH";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const prices = await getReflectorPrices(symbols);
    res.json({ network: "testnet", prices });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Prices unavailable" });
  }
});

router.get("/reflector/summary", async (_req, res): Promise<void> => {
  try {
    const text = await formatReflectorPrices();
    res.json({ network: "testnet", text });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Reflector unavailable" });
  }
});

export default router;
