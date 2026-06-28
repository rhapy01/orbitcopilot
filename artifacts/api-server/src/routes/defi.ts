import { Router, type IRouter } from "express";
import { db, defiOpportunitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetDefiOpportunitiesResponse,
  GetDefiOpportunityParams,
  GetDefiOpportunityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/defi/opportunities", async (_req, res): Promise<void> => {
  const opportunities = await db.select().from(defiOpportunitiesTable);
  res.json(GetDefiOpportunitiesResponse.parse(opportunities));
});

router.get("/defi/opportunities/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetDefiOpportunityParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [opp] = await db
    .select()
    .from(defiOpportunitiesTable)
    .where(eq(defiOpportunitiesTable.id, params.data.id));

  if (!opp) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }

  res.json(GetDefiOpportunityResponse.parse(opp));
});

export default router;
