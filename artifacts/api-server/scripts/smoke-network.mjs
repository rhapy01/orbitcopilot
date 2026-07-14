/**
 * Smoke tests for network guardrails (testnet-only execution).
 * Run: node --test scripts/smoke-network.mjs
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../dist-smoke-net");
const outfile = path.join(outDir, "network-mode.mjs");

/** @type {typeof import("../src/lib/network-mode.ts")} */
let net;

before(async () => {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [path.resolve(__dirname, "../src/lib/network-mode.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  net = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
});

describe("network guardrails", () => {
  it("blocks mainnet execution phrasing", () => {
    assert.equal(net.isMainnetExecutionAsk("swap 10 XLM on mainnet"), true);
    assert.equal(net.isMainnetExecutionAsk("send 5 USDC with real funds"), true);
    assert.equal(net.isMainnetExecutionAsk("supply USDC on main net"), true);
  });

  it("allows educating about mainnet", () => {
    assert.equal(net.isMainnetExecutionAsk("what is mainnet vs testnet?"), false);
    assert.equal(net.isMainnetExecutionAsk("explain mainnet"), false);
  });

  it("guardrail text mentions testnet", () => {
    assert.match(net.mainnetGuardrailText(), /Testnet/i);
    assert.match(net.mainnetGuardrailText(), /not enabled/i);
  });
});
