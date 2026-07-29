import { Router, type IRouter } from "express";
import {
  fetchCctpAttestation,
  formatCctpHelp,
  getCctpAllowanceStatus,
  prepareCctpApprove,
  prepareCctpBridge,
  resolveCctpDest,
} from "../lib/cctp";

const router: IRouter = Router();

router.get("/cctp/status", (_req, res): void => {
  res.json({ text: formatCctpHelp(), configured: true });
});

router.get("/cctp/allowance", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.query.walletAddress === "string" ? req.query.walletAddress.trim() : "";
  const amount = typeof req.query.amount === "string" ? req.query.amount.trim() : "";
  if (!walletAddress || !amount) {
    res.status(400).json({ error: "walletAddress and amount query required" });
    return;
  }
  try {
    const status = await getCctpAllowanceStatus({ walletAddress, amount });
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "allowance check failed" });
  }
});

router.post("/cctp/approve", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : typeof req.body?.sendAmount === "string"
        ? req.body.sendAmount.trim()
        : "";
  const destination =
    typeof req.body?.destination === "string"
      ? req.body.destination.trim()
      : typeof req.body?.destinationEvm === "string"
        ? req.body.destinationEvm.trim()
        : "";
  const destChain =
    typeof req.body?.destChain === "string"
      ? req.body.destChain
      : typeof req.body?.destAsset === "string"
        ? req.body.destAsset
        : typeof req.body?.marketHint === "string"
          ? req.body.marketHint
          : "base";

  if (!walletAddress || !amount || !destination) {
    res.status(400).json({ error: "walletAddress, amount, and destination (0x…) required" });
    return;
  }
  try {
    const result = await prepareCctpApprove({
      walletAddress,
      amount,
      destinationEvm: destination,
      destChain: resolveCctpDest(destChain),
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "CCTP approve prepare failed" });
  }
});

router.post("/cctp/bridge", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : typeof req.body?.sendAmount === "string"
        ? req.body.sendAmount.trim()
        : "";
  const destination =
    typeof req.body?.destination === "string"
      ? req.body.destination.trim()
      : typeof req.body?.destinationEvm === "string"
        ? req.body.destinationEvm.trim()
        : "";
  const destChain =
    typeof req.body?.destChain === "string"
      ? req.body.destChain
      : typeof req.body?.destAsset === "string"
        ? req.body.destAsset
        : typeof req.body?.marketHint === "string"
          ? req.body.marketHint
          : "base";
  const burnOnly = Boolean(req.body?.burnOnly);

  if (!walletAddress || !amount || !destination) {
    res.status(400).json({ error: "walletAddress, amount, and destination (0x…) required" });
    return;
  }
  try {
    const result = await prepareCctpBridge({
      walletAddress,
      amount,
      destinationEvm: destination,
      destChain: resolveCctpDest(destChain),
      burnOnly,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "CCTP bridge prepare failed" });
  }
});

router.get("/cctp/attestation", async (req, res): Promise<void> => {
  const txHash =
    typeof req.query.txHash === "string"
      ? req.query.txHash.trim()
      : typeof req.query.hash === "string"
        ? req.query.hash.trim()
        : "";
  if (!txHash) {
    res.status(400).json({ error: "txHash query required" });
    return;
  }
  try {
    const result = await fetchCctpAttestation({ stellarTxHash: txHash });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "attestation failed" });
  }
});

router.post("/cctp/attestation", async (req, res): Promise<void> => {
  const txHash =
    typeof req.body?.txHash === "string"
      ? req.body.txHash.trim()
      : typeof req.body?.hash === "string"
        ? req.body.hash.trim()
        : "";
  if (!txHash) {
    res.status(400).json({ error: "txHash required" });
    return;
  }
  try {
    const result = await fetchCctpAttestation({ stellarTxHash: txHash });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "attestation failed" });
  }
});

export default router;
