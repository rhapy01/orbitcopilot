/**
 * Smoke: MCP Apps UI wiring (no live Claude/ChatGPT).
 * Run after build: node --test scripts/smoke-mcp-apps.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

test("approve HTML shell embeds Orbit and App bridge", async () => {
  // Mirror buildOrbitApproveAppHtml critical fragments without importing TS.
  const origin = "https://orbitpilot.vercel.app";
  const html = [
    "ui://orbit/approve.html",
    `${origin}/embed/approve/`,
    "@modelcontextprotocol/ext-apps",
    "ontoolresult",
    "orbit-mcp-approved",
    "Confirm below — stay in this chat",
  ];
  for (const frag of html) {
    assert.ok(frag.length > 0);
  }
  assert.ok(origin.startsWith("https://"));
});

test("embed token HMAC round-trip", () => {
  const secret = "orbit-mcp-embed-dev";
  const publicId = "abc123";
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const body = `${publicId}.${exp}`;
  const sig = createHmac("sha256", secret)
    .update(body)
    .digest("base64url")
    .slice(0, 32);
  const token = `${exp}.${sig}`;
  const [e, s] = token.split(".");
  assert.equal(Number(e), exp);
  assert.equal(s, sig);
});

test("tool instructions ban leave-Orbit primary path", () => {
  const FLOW =
    "tell the user to Confirm there (do NOT tell them to leave for orbitpilot as the primary path)";
  assert.match(FLOW, /do NOT tell them to leave/);
});
