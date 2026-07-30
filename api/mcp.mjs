/**
 * Vercel entry for /api/mcp and rewritten /mcp → /api/mcp
 * Same Express app as api/index.mjs (routes include /mcp and /api/mcp).
 */
import app from "../artifacts/api-server/dist/index.mjs";

export default app;
