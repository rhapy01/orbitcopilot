import { Router, type IRouter } from "express";
import { buildStellarToml } from "../lib/token-metadata";

const router: IRouter = Router();

router.get("/.well-known/stellar.toml", async (_req, res): Promise<void> => {
  try {
    const toml = await buildStellarToml();
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.send(toml);
  } catch (err: any) {
    res.status(503).send(`# stellar.toml unavailable: ${err?.message ?? "unknown error"}\n`);
  }
});

export default router;
