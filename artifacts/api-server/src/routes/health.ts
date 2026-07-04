import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getMetricsSnapshot } from "../lib/metrics";
import { soroswapConfigured } from "../lib/soroswap";
import { llmConfigured } from "../lib/llm";
import { getDataPlaneStatus } from "../lib/data-plane";
import { getProductStats } from "../lib/product-store";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const plane = await getDataPlaneStatus();
  // Liveness: process is up. Data-plane readiness is reported separately.
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    dataPlane: plane,
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
