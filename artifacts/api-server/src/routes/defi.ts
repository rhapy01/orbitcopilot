import { Router, type IRouter } from "express";
import {
  GetDefiOpportunitiesResponse,
  GetDefiOpportunityParams,
  GetDefiOpportunityResponse,
} from "@workspace/api-zod";
import { getLiveDefiOpportunities } from "../lib/defi-live";

const router: IRouter = Router();

router.get("/defi/opportunities", async (_req, res): Promise<void> => {
  const live = await getLiveDefiOpportunities();
  const opportunities = live.map((o, i) => ({
    id: i + 1,
    protocol: o.protocol,
    type: o.type,
    assetCode: o.assetCode.slice(0, 32),
    apy: o.apy,
    tvlUsd: o.tvlUsd,
    riskLevel: o.riskLevel,
    description: o.description,
    minDeposit: o.minDeposit,
    rewards: o.rewards,
  }));
  res.json(GetDefiOpportunitiesResponse.parse(opportunities));
});

router.get("/defi/opportunities/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetDefiOpportunityParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const live = await getLiveDefiOpportunities();
  const o = live[params.data.id - 1];
  if (!o) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }

  res.json(
    GetDefiOpportunityResponse.parse({
      id: params.data.id,
      protocol: o.protocol,
      type: o.type,
      assetCode: o.assetCode.slice(0, 32),
      apy: o.apy,
      tvlUsd: o.tvlUsd,
      riskLevel: o.riskLevel,
      description: o.description,
      minDeposit: o.minDeposit,
      rewards: o.rewards,
    })
  );
});

router.get("/defi/live", async (_req, res): Promise<void> => {
  const opportunities = await getLiveDefiOpportunities();
  res.json({ network: "testnet", opportunities });
});

export default router;
