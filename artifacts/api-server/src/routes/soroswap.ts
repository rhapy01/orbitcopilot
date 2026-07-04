import { Router, type IRouter } from "express";
import {
  faucetSoroswapToken,
  getSoroswapBalances,
  getSoroswapHealth,
  getSoroswapPositions,
  getSoroswapProtocols,
  getSoroswapTokens,
  isSoroswapPair,
  prepareSoroswapAddLiquidity,
  prepareSoroswapRemoveLiquidity,
  prepareSoroswapSwap,
  resolveSoroswapToken,
  soroswapConfigured,
  soroswapTestnetReady,
} from "../lib/soroswap";
import { timed } from "../lib/metrics";

const router: IRouter = Router();

router.get("/soroswap/status", async (_req, res): Promise<void> => {
  const [health, protocols, tokens, ready] = await Promise.all([
    getSoroswapHealth(),
    soroswapConfigured() ? getSoroswapProtocols() : Promise.resolve([]),
    soroswapConfigured() ? getSoroswapTokens() : Promise.resolve({}),
    soroswapTestnetReady(),
  ]);
  res.json({
    configured: soroswapConfigured(),
    ready,
    network: "testnet",
    health,
    protocols,
    tokens: Object.keys(tokens),
    docs: "https://api.soroswap.finance/docs",
  });
});

router.get("/soroswap/tokens", async (req, res): Promise<void> => {
  try {
    const tokens = await getSoroswapTokens();
    res.json({ network: "testnet", tokens });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Failed to load tokens" });
  }
});

router.get("/soroswap/balances", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet query parameter is required" });
    return;
  }
  try {
    const balances = await getSoroswapBalances(wallet);
    res.json(balances);
  } catch (err: any) {
    req.log.error({ err }, "Soroswap balances failed");
    res.status(502).json({ error: err?.message ?? "Failed to load balances" });
  }
});

/** Mint testnet tokens via Soroswap faucet (docs: POST /api/faucet). */
router.post("/soroswap/faucet", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const symbol = typeof req.body?.symbol === "string" ? req.body.symbol.trim() : "";

  if (!walletAddress || !symbol) {
    res.status(400).json({ error: "walletAddress and symbol are required" });
    return;
  }
  if (!/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress must be a Stellar G… public key" });
    return;
  }

  try {
    const token = await resolveSoroswapToken(symbol);
    if (!token) {
      res.status(400).json({
        error: `Unknown token ${symbol}. Known: ${Object.keys(await getSoroswapTokens()).join(", ")}`,
      });
      return;
    }
    const result = await faucetSoroswapToken(walletAddress, token.contract);
    res.json({ success: true, symbol: symbol.toUpperCase(), contract: token.contract, result });
  } catch (err: any) {
    req.log.error({ err }, "Soroswap faucet failed");
    res.status(400).json({ error: err?.message ?? "Faucet failed" });
  }
});

router.get("/soroswap/positions", async (req, res): Promise<void> => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  if (!wallet) {
    res.status(400).json({ error: "wallet query parameter is required" });
    return;
  }
  try {
    const positions = await getSoroswapPositions(wallet);
    res.json(positions);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Failed to load positions" });
  }
});

router.post("/soroswap/add-liquidity", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const symbolA = typeof req.body?.symbolA === "string" ? req.body.symbolA.trim() : "";
  const symbolB = typeof req.body?.symbolB === "string" ? req.body.symbolB.trim() : "";
  const amountA = typeof req.body?.amountA === "string" ? req.body.amountA.trim() : "";
  const amountB = typeof req.body?.amountB === "string" ? req.body.amountB.trim() : "";
  if (!walletAddress || !symbolA || !symbolB || !amountA || !amountB) {
    res.status(400).json({ error: "walletAddress, symbolA/B, amountA/B required" });
    return;
  }
  try {
    const result = await timed("soroswap.addLiquidity", () =>
      prepareSoroswapAddLiquidity({ walletAddress, symbolA, symbolB, amountA, amountB })
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Add liquidity failed" });
  }
});

router.post("/soroswap/remove-liquidity", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const symbolA = typeof req.body?.symbolA === "string" ? req.body.symbolA.trim() : "";
  const symbolB = typeof req.body?.symbolB === "string" ? req.body.symbolB.trim() : "";
  const liquidity = typeof req.body?.liquidity === "string" ? req.body.liquidity.trim() : "";
  if (!walletAddress || !symbolA || !symbolB || !liquidity) {
    res.status(400).json({ error: "walletAddress, symbolA/B, liquidity required" });
    return;
  }
  try {
    const result = await prepareSoroswapRemoveLiquidity({
      walletAddress,
      symbolA,
      symbolB,
      liquidity,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Remove liquidity failed" });
  }
});

/** Quote + build unsigned XDR (docs: POST /quote → POST /quote/build). */
router.post("/soroswap/swap", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const fromSymbol = typeof req.body?.fromSymbol === "string" ? req.body.fromSymbol.trim() : "";
  const toSymbol = typeof req.body?.toSymbol === "string" ? req.body.toSymbol.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : "";

  if (!walletAddress || !fromSymbol || !toSymbol || !amount) {
    res.status(400).json({
      error: "walletAddress, fromSymbol, toSymbol, and amount are required",
    });
    return;
  }

  if (!/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: "walletAddress must be a Stellar G… public key" });
    return;
  }

  if (!(await isSoroswapPair(fromSymbol, toSymbol))) {
    res.status(400).json({ error: "Pair not listed on Soroswap testnet" });
    return;
  }

  try {
    const result = await prepareSoroswapSwap({
      walletAddress,
      fromSymbol,
      toSymbol,
      amount,
    });
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "Soroswap swap build failed");
    res.status(400).json({ error: err?.message ?? "Soroswap swap failed" });
  }
});

export default router;
