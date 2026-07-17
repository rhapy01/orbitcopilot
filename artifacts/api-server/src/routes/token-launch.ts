import { Router, type IRouter } from "express";
import {
  formatTokenLaunchHelp,
  prepareTokenDeploy,
  prepareTokenLaunch,
  prepareTokenMint,
} from "../lib/token-launch";
import { confirmTokenMetadata } from "../lib/token-metadata";

const router: IRouter = Router();

router.get("/token/help", (_req, res): void => {
  res.json({ text: formatTokenLaunchHelp() });
});

router.post("/token/launch", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!walletAddress || !code) {
    res.status(400).json({ error: "walletAddress and code required" });
    return;
  }
  try {
    const result = await prepareTokenLaunch({
      walletAddress,
      code,
      amount: typeof req.body?.amount === "string" ? req.body.amount : undefined,
      metadata: {
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        description:
          typeof req.body?.description === "string"
            ? req.body.description
            : undefined,
        image: typeof req.body?.image === "string" ? req.body.image : undefined,
        imageDataUrl:
          typeof req.body?.imageDataUrl === "string"
            ? req.body.imageDataUrl
            : undefined,
        website:
          typeof req.body?.website === "string" ? req.body.website : undefined,
        conditions:
          typeof req.body?.conditions === "string"
            ? req.body.conditions
            : undefined,
      },
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Token launch failed" });
  }
});

router.post("/token/deploy", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!walletAddress || !code) {
    res.status(400).json({ error: "walletAddress and code required" });
    return;
  }
  try {
    res.status(201).json(
      await prepareTokenDeploy({
        walletAddress,
        code,
        metadata: {
          name: typeof req.body?.name === "string" ? req.body.name : undefined,
          description:
            typeof req.body?.description === "string"
              ? req.body.description
              : undefined,
          image: typeof req.body?.image === "string" ? req.body.image : undefined,
          imageDataUrl:
            typeof req.body?.imageDataUrl === "string"
              ? req.body.imageDataUrl
              : undefined,
          website:
            typeof req.body?.website === "string" ? req.body.website : undefined,
          conditions:
            typeof req.body?.conditions === "string"
              ? req.body.conditions
              : undefined,
        },
      })
    );
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Token deploy failed" });
  }
});

router.post("/token/mint", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const amount = typeof req.body?.amount === "string" ? req.body.amount.trim() : "";
  if (!walletAddress || !code || !amount) {
    res.status(400).json({ error: "walletAddress, code, amount required" });
    return;
  }
  try {
    res.status(201).json(
      await prepareTokenMint({
        walletAddress,
        code,
        amount,
        to: typeof req.body?.to === "string" ? req.body.to : undefined,
      })
    );
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Token mint failed" });
  }
});

router.post("/token/confirm", async (req, res): Promise<void> => {
  const issuer =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
  if (
    !/^G[A-Z2-7]{55}$/.test(issuer) ||
    !/^[A-Z0-9]{1,12}$/.test(code) ||
    !/^[a-f0-9]{64}$/i.test(txHash)
  ) {
    res.status(400).json({ error: "walletAddress, code, txHash required" });
    return;
  }
  try {
    await confirmTokenMetadata({ issuer, code, txHash });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Confirmation failed" });
  }
});

export default router;
