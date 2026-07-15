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

/** Build unsigned Blend pool.submit XDR (supply / withdraw / borrow / repay / claim). */
router.post("/blend/build", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const symbol = typeof req.body?.symbol === "string" ? req.body.symbol.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : "";
  const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "supply";
  const requestTypeOverride =
    typeof req.body?.requestType === "number" && Number.isFinite(req.body.requestType)
      ? Number(req.body.requestType)
      : null;

  if (action === "claim") {
    if (!walletAddress) {
      res.status(400).json({ error: "walletAddress required" });
      return;
    }
    try {
      const { buildBlendClaimTx } = await import("../lib/blend");
      const result = await timed("blend.claim", () =>
        buildBlendClaimTx({ walletAddress })
      );
      res.json({ ...result, action: "claim" });
    } catch (err: any) {
      req.log.error({ err }, "Blend claim failed");
      res.status(400).json({ error: err?.message ?? "Blend claim failed" });
    }
    return;
  }

  if (!walletAddress || !symbol || !amount) {
    res.status(400).json({ error: "walletAddress, symbol, and amount are required" });
    return;
  }

  // Default supply/withdraw → collateral variants so users can borrow against deposits
  const requestType =
    requestTypeOverride != null
      ? requestTypeOverride
      : action === "withdraw" || action === "withdraw_collateral"
        ? BlendRequestType.WithdrawCollateral
        : action === "borrow"
          ? BlendRequestType.Borrow
          : action === "repay"
            ? BlendRequestType.Repay
            : action === "supply" || action === "supply_collateral"
              ? BlendRequestType.SupplyCollateral
              : BlendRequestType.SupplyCollateral;

  try {
    const result = await timed("blend.build", () =>
      buildBlendSubmitTx({
        walletAddress,
        requestType,
        symbol,
        amount,
      })
    );
    res.json({ ...result, action, symbol: symbol.toUpperCase(), amount, requestType });
  } catch (err: any) {
    req.log.error({ err }, "Blend build failed");
    res.status(400).json({ error: err?.message ?? "Blend build failed" });
  }
});

/** Circle USDC → Blend USDC 1:1 via Orbit bridge. */
router.post("/blend/swap-usdc", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string" ? req.body.amount.trim() : String(req.body?.amount ?? "");
  if (!walletAddress || !amount) {
    res.status(400).json({ error: "walletAddress and amount required" });
    return;
  }
  try {
    const { prepareCircleToBlendUsdcSwap } = await import("../lib/blend");
    const result = await prepareCircleToBlendUsdcSwap({ walletAddress, amount });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "swap failed" });
  }
});

export default router;
