import { Router, type IRouter } from "express";
import { PROTOCOL_REGISTRY, formatProtocolRegistry } from "../lib/protocols";
import { soroswapConfigured, soroswapTestnetReady } from "../lib/soroswap";
import { llmConfigured } from "../lib/llm";

const router: IRouter = Router();

router.get("/protocols", async (_req, res): Promise<void> => {
  const soroswapReady = soroswapConfigured() ? await soroswapTestnetReady() : false;
  const protocols = PROTOCOL_REGISTRY.map((p) => {
    if (p.id === "soroswap") {
      return {
        ...p,
        status: !soroswapConfigured()
          ? "partial"
          : soroswapReady
            ? "live"
            : "external-down",
      };
    }
    return p;
  });

  res.json({
    network: "testnet",
    llmConfigured: llmConfigured(),
    soroswapConfigured: soroswapConfigured(),
    soroswapReady,
    protocols,
  });
});

router.get("/protocols/summary", async (_req, res): Promise<void> => {
  res.json({ network: "testnet", text: formatProtocolRegistry() });
});

export default router;
