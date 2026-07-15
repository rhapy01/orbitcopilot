import "./lib/load-env";

import app from "./app";
import { logger } from "./lib/logger";
import { soroswapConfigured } from "./lib/soroswap";
import { llmConfigured } from "./lib/llm";
import { getDataPlaneStatus } from "./lib/data-plane";

// Vercel serverless: export the Express app (no listen).
export default app;

const isVercel = Boolean(process.env.VERCEL);
const isServerless = isVercel || process.env.ORBIT_NO_LISTEN === "1";

if (!isServerless) {
 const rawPort = process.env["PORT"];
 if (!rawPort) {
 throw new Error("PORT environment variable is required but was not provided.");
 }
 const port = Number(rawPort);
 if (Number.isNaN(port) || port <= 0) {
 throw new Error(`Invalid PORT value: "${rawPort}"`);
 }

 app.listen(port, async (err) => {
 if (err) {
 logger.error({ err }, "Error listening on port");
 process.exit(1);
 }
 const dataPlane = await getDataPlaneStatus();
 logger.info(
 {
 port,
 dataPlane,
 soroswap: soroswapConfigured() ? "configured" : "missing SOROSWAP_API_KEY",
 llm: llmConfigured() ? "configured" : "missing OPENROUTER_API_KEY / OPENAI_API_KEY",
 predict: process.env.ORBIT_PREDICT_CONTRACT_ID?.startsWith("C")
 ? process.env.ORBIT_PREDICT_CONTRACT_ID
 : "not deployed",
 perps: process.env.ORBIT_PERPS_CONTRACT_ID?.startsWith("C")
 ? process.env.ORBIT_PERPS_CONTRACT_ID
 : "not deployed",
 },
 dataPlane.ready
 ? "Server listening (Stellar Testnet) - data plane ready"
 : "Server listening - data plane NOT ready (set DATABASE_URL + REDIS_URL)",
 );
 });
}
