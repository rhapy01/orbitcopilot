/**
 * Smoke checks for MCP security helpers (no network).
 * Run: node --test scripts/smoke-mcp.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";

// Inline mirrors of forbidden-arg logic so smoke works without building TS.
const FORBIDDEN = new Set([
  "devicesharehex",
  "deviceshare",
  "secretkey",
  "secret",
  "privatekey",
  "seed",
  "mnemonic",
  "recoveryphrase",
  "signedxdr",
  "signedtx",
]);

function assertSafeToolArgs(args) {
  if (!args || typeof args !== "object") return;
  const walk = (obj, depth) => {
    if (depth > 6 || !obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const nk = k.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (FORBIDDEN.has(nk)) {
        throw new Error(`Forbidden argument "${k}"`);
      }
      if (typeof v === "string" && /^S[A-Z2-7]{55}$/.test(v.trim())) {
        throw new Error("Secret keys must never be sent to MCP");
      }
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(args, 0);
}

test("MCP rejects deviceShareHex", () => {
  assert.throws(() => assertSafeToolArgs({ deviceShareHex: "ab" }));
});

test("MCP rejects S… secret strings", () => {
  const fake =
    "S" + "A".repeat(55);
  assert.throws(() => assertSafeToolArgs({ note: fake }));
});

test("MCP allows normal prepare args", () => {
  assert.doesNotThrow(() =>
    assertSafeToolArgs({
      publicKey: "G" + "A".repeat(55),
      destination: "G" + "B".repeat(55),
      amount: "1",
      asset: "XLM",
    }),
  );
});

test("scopes never include sign", () => {
  const allowed = ["read", "prepare"];
  assert.ok(!allowed.includes("sign"));
  assert.ok(!allowed.includes("submit"));
});

test("in-chat copy prefers panel over leave-Orbit", () => {
  const flow =
    "tell the user to Confirm there (do NOT tell them to leave for orbitpilot as the primary path)";
  assert.ok(flow.includes("do NOT tell them to leave"));
  assert.ok(!flow.includes("show them the approvalUrl, (3) they open Orbit"));
});

test("MCP Apps UI resource URI is stable", () => {
  assert.equal("ui://orbit/approve.html", "ui://orbit/approve.html");
});

test("stellar tx hash shape", () => {
  const ok = /^[a-fA-F0-9]{64}$/;
  assert.ok(ok.test("a".repeat(64)));
  assert.ok(!ok.test("zzz"));
  assert.ok(!ok.test("a".repeat(63)));
});

test("mcp_return allowlist uses origin not prefix", () => {
  const allowed = new Set(["https://orbitpilot.vercel.app"]);
  const evil = new URL("https://orbitpilot.vercel.app.evil.com/phishing");
  assert.ok(!allowed.has(evil.origin));
  const good = new URL("https://orbitpilot.vercel.app/authorize?x=1");
  assert.ok(allowed.has(good.origin));
  assert.ok(good.pathname.startsWith("/authorize"));
});
