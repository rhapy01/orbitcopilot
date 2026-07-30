import "./lib/load-env";

import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import stellarTomlRouter from "./routes/stellar-toml";
import mcpHttpRouter, {
  createMcpOAuthRouter,
  mcpKeysRouter,
} from "./routes/mcp";
import { logger } from "./lib/logger";
import { rateLimit } from "./lib/rate-limit";
import { sessionMiddleware } from "./lib/session";

const app: Express = express();

const corsHeaders = [
  "Authorization",
  "Content-Type",
  "Accept",
  "Mcp-Session-Id",
  "MCP-Protocol-Version",
  "X-Api-Key",
  "X-Orbit-Mcp-Key",
  "X-Orbit-Session",
  "X-Orbit-Embed-Token",
];

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
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: corsHeaders,
    exposedHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version", "X-Orbit-MCP"],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));

// Allow ChatGPT/Claude MCP App iframes to embed Orbit approve surfaces via API redirects
app.use((req, res, next) => {
  const path = req.path || "";
  if (path.startsWith("/embed/") || path.startsWith("/approve/")) {
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://chatgpt.com https://chat.openai.com https://claude.ai https://www.claude.ai https://*.oaiusercontent.com https://*.claudemcpcontent.com https://*.mcp.claude.com",
    );
    res.setHeader(
      "Permissions-Policy",
      "publickey-credentials-get=*, publickey-credentials-create=*, clipboard-write=*",
    );
  }
  next();
});
app.use("/api", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/mcp", rateLimit({ windowMs: 60_000, max: 60 }));
app.use("/authorize", rateLimit({ windowMs: 60_000, max: 30 }));
app.use("/api/auth/send-otp", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/email/continue", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/verify-otp", rateLimit({ windowMs: 15 * 60_000, max: 10 }));
app.use("/api/auth/email/send-otp", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/recover/send-otp", rateLimit({ windowMs: 15 * 60_000, max: 5 }));
app.use("/api/auth/recover/complete", rateLimit({ windowMs: 60 * 60_000, max: 10 }));
app.use("/api/internal-wallet/export", rateLimit({ windowMs: 60 * 60_000, max: 5 }));
app.use("/api/mcp/keys", rateLimit({ windowMs: 60_000, max: 30 }));
app.use(sessionMiddleware as express.RequestHandler);
app.use(stellarTomlRouter);

// OAuth AS (Claude/ChatGPT discovery) when Redis is up
const oauthRouter = createMcpOAuthRouter();
if (oauthRouter) {
  app.use(oauthRouter);
  // Vercel may present rewritten paths under /api/*
  app.use("/api", oauthRouter);
  logger.info("MCP OAuth authorization server mounted");
}

// Remote MCP transport + protected-resource metadata
app.use(mcpHttpRouter);
app.use("/api", mcpKeysRouter);
app.use("/api", router);

export default app;