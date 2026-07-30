import { Router, type IRouter } from "express";
import {
  completeCctpBridgeIn,
  completeCctpDestination,
  fetchCctpAttestation,
  formatCctpHelp,
  getCctpAllowanceStatus,
  prepareCctpApprove,
  prepareCctpBridge,
  prepareCctpBridgeIn,
  prepareCctpMintAndForward,
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

/** Poll Iris + optionally relay receiveMessage; returns destination mint tx when ready. */
router.post("/cctp/complete", async (req, res): Promise<void> => {
  const txHash =
    typeof req.body?.txHash === "string"
      ? req.body.txHash.trim()
      : typeof req.body?.hash === "string"
        ? req.body.hash.trim()
        : typeof req.body?.stellarTxHash === "string"
          ? req.body.stellarTxHash.trim()
          : "";
  const destChain =
    typeof req.body?.destChain === "string"
      ? req.body.destChain
      : typeof req.body?.destAsset === "string"
        ? req.body.destAsset
        : typeof req.body?.marketHint === "string"
          ? req.body.marketHint
          : "base";
  if (!txHash) {
    res.status(400).json({ error: "txHash required" });
    return;
  }
  try {
    const result = await completeCctpDestination({
      stellarTxHash: txHash,
      destChain: resolveCctpDest(destChain),
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "CCTP complete failed" });
  }
});

/** EVM → Stellar: prepare approve or burn calldata. */
router.post("/cctp/bridge-in", async (req, res): Promise<void> => {
  const amount =
    typeof req.body?.amount === "string"
      ? req.body.amount.trim()
      : typeof req.body?.sendAmount === "string"
        ? req.body.sendAmount.trim()
        : "";
  const stellarRecipient =
    typeof req.body?.stellarRecipient === "string"
      ? req.body.stellarRecipient.trim()
      : typeof req.body?.destination === "string"
        ? req.body.destination.trim()
        : "";
  const sourceChain =
    typeof req.body?.sourceChain === "string"
      ? req.body.sourceChain
      : typeof req.body?.destAsset === "string"
        ? req.body.destAsset
        : typeof req.body?.marketHint === "string"
          ? req.body.marketHint
          : "arc";
  const burnOnly = Boolean(req.body?.burnOnly);
  if (!amount || !stellarRecipient) {
    res.status(400).json({ error: "amount and stellarRecipient (G…) required" });
    return;
  }
  try {
    const result = await prepareCctpBridgeIn({
      amount,
      sourceChain: resolveCctpDest(sourceChain),
      stellarRecipient,
      burnOnly,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "CCTP bridge-in prepare failed" });
  }
});

/** After Iris attestation: build Stellar mint_and_forward XDR. */
router.post("/cctp/bridge-in/mint", async (req, res): Promise<void> => {
  const walletAddress =
    typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const attestation =
    typeof req.body?.attestation === "string" ? req.body.attestation.trim() : "";
  const sourceChain =
    typeof req.body?.sourceChain === "string" ? req.body.sourceChain : "arc";
  if (!walletAddress || !message || !attestation) {
    res.status(400).json({ error: "walletAddress, message, and attestation required" });
    return;
  }
  try {
    const result = await prepareCctpMintAndForward({
      walletAddress,
      message,
      attestation,
      sourceChain: resolveCctpDest(sourceChain),
      amount: typeof req.body?.amount === "string" ? req.body.amount : undefined,
      stellarRecipient:
        typeof req.body?.stellarRecipient === "string"
          ? req.body.stellarRecipient
          : undefined,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "mint_and_forward prepare failed" });
  }
});

/** Poll Iris for EVM burn, then return mint action when ready. */
router.post("/cctp/bridge-in/complete", async (req, res): Promise<void> => {
  const txHash =
    typeof req.body?.txHash === "string"
      ? req.body.txHash.trim()
      : typeof req.body?.hash === "string"
        ? req.body.hash.trim()
        : "";
  const sourceChain =
    typeof req.body?.sourceChain === "string"
      ? req.body.sourceChain
      : typeof req.body?.destAsset === "string"
        ? req.body.destAsset
        : "arc";
  if (!txHash) {
    res.status(400).json({ error: "txHash required" });
    return;
  }
  try {
    const result = await completeCctpBridgeIn({
      evmTxHash: txHash,
      sourceChain: resolveCctpDest(sourceChain),
      stellarWallet:
        typeof req.body?.walletAddress === "string"
          ? req.body.walletAddress.trim()
          : undefined,
      stellarRecipient:
        typeof req.body?.stellarRecipient === "string"
          ? req.body.stellarRecipient.trim()
          : undefined,
      amount: typeof req.body?.amount === "string" ? req.body.amount : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "CCTP bridge-in complete failed" });
  }
});

export default router;
