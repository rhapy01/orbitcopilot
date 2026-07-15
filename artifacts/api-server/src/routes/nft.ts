import { Router, type IRouter } from "express";
import {
 formatNftCatalog,
 formatNftHoldings,
 prepareNftBuy,
 prepareNftList,
 prepareNftMint,
 prepareNftTransfer,
} from "../lib/nft";
import {
 BETA_NFT_NAME,
 BETA_NFT_URI,
 BETA_NFT_MAX_SUPPLY,
} from "../lib/beta-nft";
import {
 getBetaNftClaimedCount,
 markBetaNftClaimed,
 resolveBetaNftStatus,
} from "../lib/product-store";

const router: IRouter = Router();

router.get("/nft/catalog", async (_req, res): Promise<void> => {
 try {
 res.json({ text: await formatNftCatalog() });
 } catch (err: any) {
 res.status(502).json({ error: err?.message });
 }
});

router.get("/nft/holdings", async (req, res): Promise<void> => {
 const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
 if (!wallet) {
 res.status(400).json({ error: "wallet required" });
 return;
 }
 try {
 const { getNftHoldings } = await import("../lib/nft");
 const { text, gallery } = await getNftHoldings(wallet);
 res.json({ text, gallery, items: gallery.items });
 } catch (err: any) {
 res.status(502).json({ error: err?.message });
 }
});

/** Prepare mint XDR for wallets whitelisted via feedback (one claim). */
router.post("/nft/claim-beta", async (req, res): Promise<void> => {
 const walletAddress =
 typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
 if (!walletAddress || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
 res.status(400).json({ error: "walletAddress required" });
 return;
 }
 try {
 const status = await resolveBetaNftStatus(walletAddress);
 if (!status.eligible) {
 res.status(403).json({
 error:
 "Not whitelisted yet. Submit feedback (heart icon) with this wallet connected to unlock the Orbit Beta Tester NFT.",
 });
 return;
 }
 if (status.claimed) {
 res.status(409).json({
 error: "Beta NFT already minted for this wallet.",
 claimTxHash: status.claimTxHash,
 });
 return;
 }
 const claimedCount = await getBetaNftClaimedCount();
 if (claimedCount >= BETA_NFT_MAX_SUPPLY) {
 res.status(410).json({
 error: `Beta collection sold out (${BETA_NFT_MAX_SUPPLY} / ${BETA_NFT_MAX_SUPPLY}).`,
 });
 return;
 }
 const result = await prepareNftMint({
 walletAddress,
 name: BETA_NFT_NAME,
 metadataUri: BETA_NFT_URI,
 });
 res.status(201).json({
 ...result,
 betaNft: true,
 supply: { claimed: claimedCount, max: BETA_NFT_MAX_SUPPLY },
 message: `Claim your "${BETA_NFT_NAME}" NFT (${claimedCount + 1}/${BETA_NFT_MAX_SUPPLY}). Sign to mint - one per wallet.`,
 });
 } catch (err: any) {
 res.status(400).json({ error: err?.message ?? "Claim failed" });
 }
});

router.post("/nft/claim-beta/confirm", async (req, res): Promise<void> => {
 const walletAddress =
 typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
 const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
 const tokenId =
 req.body?.tokenId != null && Number.isFinite(Number(req.body.tokenId))
 ? Number(req.body.tokenId)
 : null;
 if (!walletAddress || !txHash) {
 res.status(400).json({ error: "walletAddress and txHash required" });
 return;
 }
 try {
 const result = await markBetaNftClaimed({
 walletPublicKey: walletAddress,
 txHash,
 tokenId,
 });
 if (!result.ok) {
 res.status(403).json({ error: "Wallet is not whitelisted for beta NFT" });
 return;
 }
 res.json({ ok: true, alreadyClaimed: result.alreadyClaimed });
 } catch (err: any) {
 res.status(503).json({ error: err?.message ?? "Confirm failed" });
 }
});

router.post("/nft/mint", async (req, res): Promise<void> => {
 const walletAddress =
 typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
 if (!walletAddress) {
 res.status(400).json({ error: "walletAddress required" });
 return;
 }
 try {
 const result = await prepareNftMint({
 walletAddress,
 name: typeof req.body?.name === "string" ? req.body.name : undefined,
 metadataUri: typeof req.body?.metadataUri === "string" ? req.body.metadataUri : undefined,
 });
 res.status(201).json(result);
 } catch (err: any) {
 res.status(400).json({ error: err?.message ?? "Mint failed" });
 }
});

router.post("/nft/list", async (req, res): Promise<void> => {
 const walletAddress =
 typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
 const tokenId = Number(req.body?.tokenId);
 const priceXlm = typeof req.body?.priceXlm === "string" ? req.body.priceXlm.trim() : "";
 if (!walletAddress || !tokenId || !priceXlm) {
 res.status(400).json({ error: "walletAddress, tokenId, priceXlm required" });
 return;
 }
 try {
 res.status(201).json(await prepareNftList({ walletAddress, tokenId, priceXlm }));
 } catch (err: any) {
 res.status(400).json({ error: err?.message ?? "List failed" });
 }
});

router.post("/nft/buy", async (req, res): Promise<void> => {
 const walletAddress =
 typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
 const tokenId = Number(req.body?.tokenId);
 if (!walletAddress || !tokenId) {
 res.status(400).json({ error: "walletAddress, tokenId required" });
 return;
 }
 try {
 res.status(201).json(await prepareNftBuy({ walletAddress, tokenId }));
 } catch (err: any) {
 res.status(400).json({ error: err?.message ?? "Buy failed" });
 }
});

router.post("/nft/transfer", async (req, res): Promise<void> => {
 const walletAddress =
 typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
 const tokenId = Number(req.body?.tokenId);
 const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
 if (!walletAddress || !tokenId || !to) {
 res.status(400).json({ error: "walletAddress, tokenId, to required" });
 return;
 }
 try {
 res.status(201).json(await prepareNftTransfer({ walletAddress, tokenId, to }));
 } catch (err: any) {
 res.status(400).json({ error: err?.message ?? "Transfer failed" });
 }
});

export default router;
