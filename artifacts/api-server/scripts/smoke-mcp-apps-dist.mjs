/**
 * Static verification of in-chat MCP approve path (Claude/ChatGPT hosts).
 * Live host confirmation still requires a human in Claude/ChatGPT after deploy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "index.mjs");

test("built MCP server includes Apps UI + embed approve", () => {
  const m = readFileSync(dist, "utf8");
  assert.ok(m.includes("ui://orbit/approve.html"), "UI resource URI");
  assert.ok(m.includes("/embed/approve/"), "embed approve URL");
  assert.ok(m.includes("do NOT tell them to leave"), "in-chat primary copy");
  assert.ok(
    m.includes("text/html;profile=mcp-app") || m.includes("RESOURCE_MIME_TYPE") || m.includes("mcp-app"),
    "MCP Apps MIME",
  );
  assert.ok(m.includes("sameSite") && m.includes("none"), "iframe cookie SameSite=None");
});
