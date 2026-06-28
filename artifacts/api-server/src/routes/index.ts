import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import walletRouter from "./wallet";
import portfolioRouter from "./portfolio";
import defiRouter from "./defi";
import assetsRouter from "./assets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(walletRouter);
router.use(portfolioRouter);
router.use(defiRouter);
router.use(assetsRouter);

export default router;
