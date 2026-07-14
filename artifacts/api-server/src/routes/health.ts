import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getMetricsSnapshot } from "../lib/metrics";
import { soroswapConfigured } from "../lib/soroswap";
import { llmConfigured } from "../lib/llm";
import { getDataPlaneStatus } from "../lib/data-plane";
import { getProductStats } from "../lib/product-store";
import { isWalletCryptoConfigured } from "../lib/crypto";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const plane = await getDataPlaneStatus();
  // Liveness: process is up. Data-plane readiness is reported separately.
  const data = HealthCheckResponse.parse({ status: "ok" });
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  res.json({
    ...data,
    dataPlane: plane,
    auth: {
      kmsConfigured: isWalletCryptoConfigured(),
      webauthnRpId: process.env.WEBAUTHN_RP_ID || null,
      webauthnOrigin: process.env.WEBAUTHN_ORIGIN || null,
      production: isProd,
      passkeySignupReady: isWalletCryptoConfigured(),
    },
  });
});

router.get("/metrics", async (_req, res) => {
  const plane = await getDataPlaneStatus();
  let product: Awaited<ReturnType<typeof getProductStats>> | null = null;
  try {
    product = await getProductStats();
  } catch {
    product = null;
  }
  res.json({
    network: "testnet",
    soroswapConfigured: soroswapConfigured(),
    llmConfigured: llmConfigured(),
    dataPlane: plane,
    product,
    ...getMetricsSnapshot(),
  });
});

export default router;
