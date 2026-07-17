import "./lib/load-env";

import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { rateLimit } from "./lib/rate-limit";
import { sessionMiddleware } from "./lib/session";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// NFT/token launch media accepts base64 payloads up to 8 MB.
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api", rateLimit({ windowMs: 60_000, max: 120 }));
// OTP is stricter: 5 attempts per 15 minutes
app.use("/api/auth/send-otp", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/email/continue", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/verify-otp", rateLimit({ windowMs: 15 * 60_000, max: 10 }));
app.use("/api/auth/email/send-otp", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/recover/send-otp", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/recover/complete", rateLimit({ windowMs: 60 * 60_000, max: 10 }));
app.use("/api/internal-wallet/export", rateLimit({ windowMs: 60 * 60_000, max: 5 }));
app.use(sessionMiddleware as express.RequestHandler);
app.use("/api", router);

export default app;
