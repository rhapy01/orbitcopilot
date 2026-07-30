/**
 * End-to-end MCP check: initialize → tools/list → tools/call
 *
 * Usage:
 *   MCP_API_KEYS=orb_mcp_test:read+prepare node scripts/e2e-mcp.mjs
 *   MCP_URL=https://orbitpilot.vercel.app/mcp MCP_TOKEN=orb_mcp_… node scripts/e2e-mcp.mjs
 *
 * Local (starts nothing — point at a running server):
 *   MCP_URL=http://127.0.0.1:3001/mcp MCP_TOKEN=… node scripts/e2e-mcp.mjs
 */
import assert from "node:assert/strict";

const MCP_URL = (process.env.MCP_URL || "http://127.0.0.1:3001/mcp").replace(/\/$/, "");
const TOKEN =
  process.env.MCP_TOKEN ||
  process.env.MCP_API_KEYS?.split(",")[0]?.split(":")[0] ||
  "";

if (!TOKEN) {
  console.error("Set MCP_TOKEN or MCP_API_KEYS=orb_mcp_xxx:read+prepare");
  process.exit(1);
}

async function mcpRpc(method, params, id = 1) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // SSE-ish: take last data: line
    const dataLine = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .pop();
    if (dataLine) body = JSON.parse(dataLine.slice(5).trim());
    else throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.ok && body?.error) {
    throw new Error(`${method} HTTP ${res.status}: ${JSON.stringify(body.error)}`);
  }
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

console.log(`MCP E2E → ${MCP_URL}`);

const init = await mcpRpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "orbit-e2e", version: "1.0.0" },
});
assert.ok(init?.serverInfo?.name, "missing serverInfo");
console.log("✓ initialize", init.serverInfo);

await mcpRpc("notifications/initialized", {}, 2).catch(() => {
  // notification may have null id / no result — ignore
});

const listed = await mcpRpc("tools/list", {}, 3);
assert.ok(Array.isArray(listed?.tools) && listed.tools.length > 0, "no tools");
console.log(
  "✓ tools/list",
  listed.tools.map((t) => t.name).join(", "),
);

const call = await mcpRpc(
  "tools/call",
  { name: "orbit_security_policy", arguments: {} },
  4,
);
assert.ok(call?.content?.[0]?.text, "empty tool result");
const policy = JSON.parse(call.content[0].text);
assert.ok(policy.forbidden?.includes?.("Sign transactions") || Array.isArray(policy.forbidden));
console.log("✓ tools/call orbit_security_policy");

const prices = await mcpRpc(
  "tools/call",
  { name: "get_prices", arguments: { symbols: "XLM" } },
  5,
);
assert.ok(prices?.content?.[0]?.text, "prices empty");
console.log("✓ tools/call get_prices", prices.content[0].text.slice(0, 120));

console.log("\nMCP end-to-end OK");
