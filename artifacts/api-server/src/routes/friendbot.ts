import { Router, type IRouter } from "express";
import { fundWithFriendbot } from "../lib/friendbot";

const router: IRouter = Router();

router.post("/friendbot/fund", async (req, res): Promise<void> => {
  const publicKey =
    typeof req.body?.publicKey === "string"
      ? req.body.publicKey.trim()
      : typeof req.body?.walletAddress === "string"
        ? req.body.walletAddress.trim()
        : "";

  if (!publicKey) {
    res.status(400).json({ error: "publicKey is required" });
    return;
  }

  const result = await fundWithFriendbot(publicKey);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;
