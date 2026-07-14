/**
 * Smoke tests for knowledge RAG (explain intent + BM25 retrieval).
 * Bundles src/lib/knowledge-rag.ts on the fly so we test the real module.
 * Run: node --test scripts/smoke-knowledge.mjs
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "../dist-smoke");
const outfile = path.join(outDir, "knowledge-rag.mjs");

/** @type {typeof import("../src/lib/knowledge-rag.ts")} */
let rag;

before(async () => {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [path.resolve(__dirname, "../src/lib/knowledge-rag.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  const url = pathToFileURL(outfile).href + `?t=${Date.now()}`;
  rag = await import(url);
});

describe("knowledge explain intent", () => {
  it("detects teach questions", () => {
    assert.equal(rag.isExplainIntent("what is DeFi?"), true);
    assert.equal(rag.isExplainIntent("explain impermanent loss"), true);
    assert.equal(rag.isExplainIntent("difference between staking and liquidity"), true);
    assert.equal(rag.isExplainIntent("CeFi vs DeFi"), true);
    assert.equal(rag.isExplainIntent("what are bridges?"), true);
    assert.equal(rag.isExplainIntent("impermanent loss?"), true);
  });

  it("does not steal action or portfolio queries", () => {
    assert.equal(rag.isExplainIntent("swap 10 XLM to pUSDC"), false);
    assert.equal(rag.isExplainIntent("supply 10 USDC on Blend"), false);
    assert.equal(rag.isExplainIntent("what's earning?"), false);
    assert.equal(rag.isExplainIntent("show my portfolio"), false);
    assert.equal(rag.isExplainIntent("what is my balance"), false);
  });
});

describe("knowledge retrieval", () => {
  it("finds DeFi vs CeFi", () => {
    const hits = rag.searchKnowledge("what is the difference between DeFi and CeFi", {
      topK: 3,
      minScore: 1.0,
    });
    assert.ok(hits.length >= 1);
    assert.ok(
      hits.some((h) => h.chunk.id === "defi-vs-cefi" || /defi|cefi/i.test(h.chunk.title))
    );
  });

  it("finds impermanent loss", () => {
    const hits = rag.searchKnowledge("explain impermanent loss", { topK: 2, minScore: 1.0 });
    assert.ok(hits.some((h) => h.chunk.id === "impermanent-loss"));
  });

  it("finds staking vs farming", () => {
    const hits = rag.searchKnowledge("staking vs yield farming vs liquidity", {
      topK: 3,
      minScore: 1.0,
    });
    assert.ok(hits.some((h) => h.chunk.id === "staking-vs-farming"));
  });

  it("finds Stellar trustlines", () => {
    const hits = rag.searchKnowledge("what is a trustline on Stellar", {
      topK: 3,
      minScore: 1.0,
    });
    assert.ok(hits.some((h) => h.chunk.id === "stellar-trustlines" || h.chunk.id === "stellar-overview"));
  });

  it("answerFromKnowledge cites sources", () => {
    const ans = rag.answerFromKnowledge("what is DeFi vs CeFi?");
    assert.ok(ans);
    assert.match(ans.text, /Sources/i);
    assert.match(ans.text, /Concept Graph|Knowledge Base|DeFi/i);
  });

  it("answerFromKnowledge ignores swaps", () => {
    assert.equal(rag.answerFromKnowledge("swap 10 XLM to USDC"), null);
  });

  it("uses concept graph for staking vs LP", () => {
    const ans = rag.tryTeachAnswer("staking vs liquidity provision");
    assert.ok(ans);
    assert.match(ans, /vs/i);
    assert.match(ans, /Concept Graph|staking|liquidity/i);
  });

  it("calculates IL when price doubles", () => {
    const ans = rag.tryTeachAnswer("calculate IL if price doubles");
    assert.ok(ans);
    assert.match(ans, /Impermanent loss/i);
    assert.match(ans, /5\.72%|5\.7%/); // classic ~5.72% IL for 2x
  });

  it("calculates health factor from numbers", () => {
    const ans = rag.tryTeachAnswer("health if collateral 100 debt 40");
    assert.ok(ans);
    assert.match(ans, /Health factor/i);
    assert.match(ans, /1\.88|1\.87/); // 100*0.75/40 = 1.875
  });
});
