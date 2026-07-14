import { Router, type IRouter } from "express";
import {
  AQUARIUS_ROUTER,
  AQUARIUS_TOKENS,
  buildAquariusSwap,
  findAquariusPath,
  formatAquariusPools,
  getAquariusPools,
} from "../lib/aquarius";
import { timed } from "../lib/metrics";

const router: IRouter = Router();

router.get("/aquarius/pools", async (req, res): Promise<void> => {
  try {
    const pools = await getAquariusPools(30);
    res.json({ network: "testnet", router: AQUARIUS_ROUTER, pools });
  } catch (err: any) {
    req.log.error({ err }, "Aquarius pools failed");
    res.status(502).json({ error: err?.message ?? "Aquarius unavailable" });
  }
});

router.get("/aquarius/summary", async (req, res): Promise<void> => {
  try {
    const text = await formatAquariusPools();
    res.json({ network: "testnet", text, tokens: Object.keys(AQUARIUS_TOKENS) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Aquarius unavailable" });
  }
});

/** Live find-path quote (strict send). */
router.post("/aquarius/quote", async (req, res): Promise<void> => {
  const fromSymbol = typeof req.body?.fromSymbol === "string" ? req.body.fromSymbol.trim() : "";
  const toSymbol = typeof req.body?.toSymbol === "string" ? req.body.toSymbol.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : "";
  if (!fromSymbol || !toSymbol || !amount) {
    res.status(400).json({ error: "fromSymbol, toSymbol, and amount are required" });
    return;
  }
  try {
    const quote = await timed("aquarius.quote", () =>
      findAquariusPath({ fromSymbol, toSymbol, amount })
    );
    res.json({ network: "testnet", router: AQUARIUS_ROUTER, ...quote });
  } catch (err: any) {
    req.log.error({ err }, "Aquarius quote failed");
    res.status(400).json({ error: err?.message ?? "Aquarius quote failed" });
  }
});

/** Prepare Aquarius router `swap_chained` XDR for wallet signing. */
router.post("/aquarius/build", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const fromSymbol =
    typeof req.body?.fromSymbol === "string"
      ? req.body.fromSymbol.trim()
      : typeof req.body?.sendAsset === "string"
        ? req.body.sendAsset.trim()
        : "";
  const toSymbol =
    typeof req.body?.toSymbol === "string"
      ? req.body.toSymbol.trim()
      : typeof req.body?.destAsset === "string"
        ? req.body.destAsset.trim()
        : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : typeof req.body?.sendAmount === "string"
        ? req.body.sendAmount.trim()
        : "";
  const slippageBps =
    typeof req.body?.slippageBps === "number" ? req.body.slippageBps : undefined;

  if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "Valid walletAddress is required" });
    return;
  }
  if (!fromSymbol || !toSymbol || !amount) {
    res.status(400).json({ error: "fromSymbol, toSymbol, and amount are required" });
    return;
  }

  try {
    const built = await timed("aquarius.build", () =>
      buildAquariusSwap({
        walletAddress,
        fromSymbol,
        toSymbol,
        amount,
        slippageBps,
      })
    );
    res.json({
      network: "testnet",
      router: AQUARIUS_ROUTER,
      ...built,
      amountOutHuman: built.estimatedDestAmount,
    });
  } catch (err: any) {
    req.log.error({ err }, "Aquarius build failed");
    res.status(400).json({ error: err?.message ?? "Aquarius build failed" });
  }
});

export default router;
