import { Router, type IRouter } from "express";
import {
  getSteldexContracts,
  getSteldexPools,
  getSteldexFarmPools,
  getSteldexFarmPositions,
  getSteldexOrders,
  getSteldexSwapQuote,
  postSteldexSwap,
  postSteldexAddLiquidity,
  postSteldexRemoveLiquidity,
  postSteldexStake,
  postSteldexClaim,
  postSteldexUnstake,
  postSteldexLimitOrder,
  postSteldexCancelOrder,
} from "../lib/steldex";
import {
  GetSteldexContractsResponse,
  GetSteldexPoolsResponse,
  GetSteldexFarmPoolsResponse,
  GetSteldexFarmPositionsResponse,
  GetSteldexOrdersResponse,
  GetSteldexSwapQuoteBody,
  GetSteldexSwapQuoteResponse,
  PostSteldexSwapBody,
  PostSteldexSwapResponse,
  PostSteldexAddLiquidityBody,
  PostSteldexAddLiquidityResponse,
  PostSteldexRemoveLiquidityBody,
  PostSteldexRemoveLiquidityResponse,
  PostSteldexStakeBody,
  PostSteldexStakeResponse,
  PostSteldexClaimBody,
  PostSteldexClaimResponse,
  PostSteldexUnstakeBody,
  PostSteldexUnstakeResponse,
  PostSteldexLimitOrderBody,
  PostSteldexLimitOrderResponse,
  PostSteldexCancelOrderBody,
  PostSteldexCancelOrderResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function requireWallet(req: any, res: any): string | null {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet query parameter is required" });
    return null;
  }
  return wallet;
}

router.get("/steldex/contracts", async (req, res): Promise<void> => {
  try {
    const result = await getSteldexContracts();
    res.json(GetSteldexContractsResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch StelDex contracts");
    res.status(502).json({ error: err?.message ?? "Failed to reach StelDex" });
  }
});

router.get("/steldex/pools", async (req, res): Promise<void> => {
  try {
    const result = await getSteldexPools();
    res.json(GetSteldexPoolsResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch StelDex pools");
    res.status(502).json({ error: err?.message ?? "Failed to reach StelDex" });
  }
});

router.get("/steldex/farm-pools", async (req, res): Promise<void> => {
  const wallet = requireWallet(req, res);
  if (!wallet) return;
  try {
    const result = await getSteldexFarmPools(wallet);
    res.json(GetSteldexFarmPoolsResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch StelDex farm pools");
    res.status(502).json({ error: err?.message ?? "Failed to reach StelDex" });
  }
});

router.get("/steldex/farm-positions", async (req, res): Promise<void> => {
  const wallet = requireWallet(req, res);
  if (!wallet) return;
  try {
    const result = await getSteldexFarmPositions(wallet);
    res.json(GetSteldexFarmPositionsResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch StelDex farm positions");
    res.status(502).json({ error: err?.message ?? "Failed to reach StelDex" });
  }
});

router.get("/steldex/orders", async (req, res): Promise<void> => {
  const wallet = requireWallet(req, res);
  if (!wallet) return;
  try {
    const result = await getSteldexOrders(wallet);
    res.json(GetSteldexOrdersResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch StelDex orders");
    res.status(502).json({ error: err?.message ?? "Failed to reach StelDex" });
  }
});

router.post("/steldex/swap-quote", async (req, res): Promise<void> => {
  const parsed = GetSteldexSwapQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await getSteldexSwapQuote(parsed.data);
    res.json(GetSteldexSwapQuoteResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch StelDex swap quote");
    res.status(400).json({ error: err?.message ?? "Failed to fetch swap quote" });
  }
});

router.post("/steldex/swap", async (req, res): Promise<void> => {
  const parsed = PostSteldexSwapBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexSwap(parsed.data);
    res.json(PostSteldexSwapResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex swap");
    res.status(400).json({ error: err?.message ?? "Failed to build swap transaction" });
  }
});

router.post("/steldex/add-liquidity", async (req, res): Promise<void> => {
  const parsed = PostSteldexAddLiquidityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexAddLiquidity(parsed.data);
    res.json(PostSteldexAddLiquidityResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex add-liquidity transaction");
    res.status(400).json({ error: err?.message ?? "Failed to build add-liquidity transaction" });
  }
});

router.post("/steldex/remove-liquidity", async (req, res): Promise<void> => {
  const parsed = PostSteldexRemoveLiquidityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexRemoveLiquidity(parsed.data);
    res.json(PostSteldexRemoveLiquidityResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex remove-liquidity transaction");
    res.status(400).json({ error: err?.message ?? "Failed to build remove-liquidity transaction" });
  }
});

router.post("/steldex/stake", async (req, res): Promise<void> => {
  const parsed = PostSteldexStakeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexStake(parsed.data);
    res.json(PostSteldexStakeResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex stake transaction");
    res.status(400).json({ error: err?.message ?? "Failed to build stake transaction" });
  }
});

router.post("/steldex/claim", async (req, res): Promise<void> => {
  const parsed = PostSteldexClaimBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexClaim(parsed.data);
    res.json(PostSteldexClaimResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex claim transaction");
    res.status(400).json({ error: err?.message ?? "Failed to build claim transaction" });
  }
});

router.post("/steldex/unstake", async (req, res): Promise<void> => {
  const parsed = PostSteldexUnstakeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexUnstake(parsed.data);
    res.json(PostSteldexUnstakeResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex unstake transaction");
    res.status(400).json({ error: err?.message ?? "Failed to build unstake transaction" });
  }
});

router.post("/steldex/limit-order", async (req, res): Promise<void> => {
  const parsed = PostSteldexLimitOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexLimitOrder(parsed.data);
    res.json(PostSteldexLimitOrderResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex limit order");
    res.status(400).json({ error: err?.message ?? "Failed to place limit order" });
  }
});

router.post("/steldex/cancel-order", async (req, res): Promise<void> => {
  const parsed = PostSteldexCancelOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await postSteldexCancelOrder(parsed.data);
    res.json(PostSteldexCancelOrderResponse.parse(result));
  } catch (err: any) {
    req.log.error({ err }, "Failed to build StelDex cancel-order transaction");
    res.status(400).json({ error: err?.message ?? "Failed to cancel order" });
  }
});

export default router;
