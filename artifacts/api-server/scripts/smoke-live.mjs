/**
 * Live production smoke checks for Orbit Copilot Greenbelt surfaces.
 * Usage: node scripts/smoke-live.mjs [baseUrl]
 */
import assert from "node:assert/strict";

const base = (process.argv[2] || "https://orbitpilot.vercel.app").replace(/\/$/, "");

async function check(name, fn) {
  process.stdout.write(`• ${name}… `);
  try {
    await fn();
    console.log("ok");
  } catch (err) {
    console.log("FAIL");
    console.error(`  ${err?.message || err}`);
    throw err;
  }
}

let failed = 0;

async function run(name, fn) {
  try {
    await check(name, fn);
  } catch {
    failed += 1;
  }
}

console.log(`Smoke live: ${base}\n`);

await run("GET /api/healthz", async () => {
  const res = await fetch(`${base}/api/healthz`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.dataPlane?.ready, true);
});

await run("GET /api/stats", async () => {
  const res = await fetch(`${base}/api/stats`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.events);
  assert.ok(data.feedback);
  assert.ok(data.level4);
  assert.ok(data.betaNft);
});

await run("GET /api/feedback/summary", async () => {
  const res = await fetch(`${base}/api/feedback/summary`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Orbit Copilot/i);
});

await run("GET /api/nft/catalog", async () => {
  const res = await fetch(`${base}/api/nft/catalog`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.text, /Beta/i);
  assert.match(data.text, /CAG4ST6/i);
});

await run("GET /nft/orbit-beta-tester.json", async () => {
  const res = await fetch(`${base}/nft/orbit-beta-tester.json`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.name, "Orbit Co-Pilot Beta tester");
  assert.match(data.animation_url, /orbitpilot-tester\.mp4/);
  assert.ok(data.attributes?.some((a) => String(a.value) === "7777"));
});

await run("HEAD /orbitpilot-tester.mp4", async () => {
  const res = await fetch(`${base}/orbitpilot-tester.mp4`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /video\/mp4|octet-stream/i);
});

await run("POST /api/nft/claim-beta without wallet", async () => {
  const res = await fetch(`${base}/api/nft/claim-beta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

await run("POST /api/nft/claim-beta not whitelisted", async () => {
  // Valid-format but unused testnet-looking key (not whitelisted)
  const wallet =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const res = await fetch(`${base}/api/nft/claim-beta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: wallet }),
  });
  // 400 invalid key OR 403 not whitelisted — both acceptable gates
  assert.ok([400, 403].includes(res.status), `unexpected ${res.status}`);
});

await run("POST /api/feedback without wallet", async () => {
  const res = await fetch(`${base}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: 5, message: "smoke test without wallet" }),
  });
  assert.equal(res.status, 400);
});

console.log(failed ? `\n${failed} check(s) failed` : "\nAll live smoke checks passed");
process.exit(failed ? 1 : 0);
