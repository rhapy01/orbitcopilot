import { Router, type IRouter } from "express";
import {
  BlendRequestType,
  buildBlendSubmitTx,
  formatBlendMarkets,
  getBlendContracts,
} from "../lib/blend";
import { timed } from "../lib/metrics";

const router: IRouter = Router();

router.get("/blend/contracts", async (req, res): Promise<void> => {
  try {
    const contracts = await getBlendContracts();
    res.json({ network: "testnet", ...contracts });
  } catch (err: any) {
    req.log.error({ err }, "Blend contracts failed");
    res.status(502).json({ error: err?.message ?? "Blend unavailable" });
  }
});

router.get("/blend/summary", async (req, res): Promise<void> => {
  try {
    const text = await formatBlendMarkets();
    res.json({ network: "testnet", text });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Blend unavailable" });
  }
});

/** Build unsigned Blend pool.submit XDR (supply / withdraw / borrow / repay). */
router.post("/blend/build", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const symbol = typeof req.body?.symbol === "string" ? req.body.symbol.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : "";
  const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "supply";

  if (!walletAddress || !symbol || !amount) {
    res.status(400).json({ error: "walletAddress, symbol, and amount are required" });
    return;
  }

  const requestType =
    action === "withdraw"
      ? BlendRequestType.Withdraw
      : action === "borrow"
        ? BlendRequestType.Borrow
        : action === "repay"
          ? BlendRequestType.Repay
          : action === "supply_collateral"
            ? BlendRequestType.SupplyCollateral
            : BlendRequestType.Supply;

  try {
    const result = await timed("blend.build", () =>
      buildBlendSubmitTx({
        walletAddress,
        requestType,
        symbol,
        amount,
      })
    );
    res.json({ ...result, action, symbol: symbol.toUpperCase(), amount });
  } catch (err: any) {
    req.log.error({ err }, "Blend build failed");
    res.status(400).json({ error: err?.message ?? "Blend build failed" });
  }
});

export default router;
