/**
 * Append sports prediction markets on the existing Orbit Predict contract.
 * Does NOT redeploy — create_market only for catalog IDs 4+.
 *
 * Requires:
 *   ORBIT_PREDICT_CONTRACT_ID
 *   ORBIT_ADMIN_SECRET_KEY  (S… admin secret)
 *
 * Usage:
 *   node artifacts/api-server/scripts/seed-predict-sports.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const candidates = [
    resolve(__dirname, "../../../.env"),
    resolve(__dirname, "../../.env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

/** Must match PREDICT_SPORTS_SEED / PREDICT_MARKETS ids ≥ 4 in predict.ts */
const SPORTS = [
  {
    slug: "chelsea-arsenal-epl",
    question: "Will Chelsea beat Arsenal in the Premier League?",
  },
  {
    slug: "chelsea-arsenal-fa-cup",
    question: "Will Chelsea beat Arsenal in the FA Cup?",
  },
  {
    slug: "liverpool-city-epl",
    question: "Will Liverpool beat Manchester City in the Premier League?",
  },
];

const contractId = process.env.ORBIT_PREDICT_CONTRACT_ID?.trim();
const secret = process.env.ORBIT_ADMIN_SECRET_KEY?.trim();

if (!contractId) {
  console.error("Set ORBIT_PREDICT_CONTRACT_ID");
  process.exit(1);
}
if (!secret || !secret.startsWith("S")) {
  console.error("Set ORBIT_ADMIN_SECRET_KEY to the admin S… secret (testnet only)");
  process.exit(1);
}

const {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
} = await import("@stellar/stellar-sdk");
const { Server } = await import("@stellar/stellar-sdk/rpc");

const rpc = new Server(
  process.env.SOROBAN_RPC_URL?.trim() || "https://soroban-testnet.stellar.org"
);
const admin = Keypair.fromSecret(secret);
const account = await rpc.getAccount(admin.publicKey());
const contract = new Contract(contractId);

async function marketCount() {
  let acc = await rpc.getAccount(admin.publicKey());
  const tx = new TransactionBuilder(acc, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("market_count"))
    .setTimeout(60)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  const retval = sim?.result?.retval;
  if (!retval) return 0;
  return Number(scValToNative(retval));
}

async function createMarket(question, slug) {
  let acc = await rpc.getAccount(admin.publicKey());
  let tx = new TransactionBuilder(acc, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "create_market",
        nativeToScVal(question, { type: "string" }),
        nativeToScVal(slug, { type: "string" })
      )
    )
    .setTimeout(120)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(admin);
  const sent = await rpc.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(JSON.stringify(sent));
  }
  // Wait for success
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await rpc.getTransaction(sent.hash);
    if (st.status === "SUCCESS") return sent.hash;
    if (st.status === "FAILED") throw new Error(`create_market failed: ${sent.hash}`);
  }
  return sent.hash;
}

const before = await marketCount();
console.log(`Contract ${contractId} has ${before} market(s).`);

if (before >= 4 + SPORTS.length) {
  console.log("Sports markets already seeded (count >= 7). Nothing to do.");
  process.exit(0);
}

// Only create markets that are missing by index (append-only).
const need = Math.max(0, 4 + SPORTS.length - before);
const toCreate = SPORTS.slice(Math.max(0, before - 4));
if (!toCreate.length) {
  console.log("No sports markets left to create.");
  process.exit(0);
}

console.log(`Creating ${toCreate.length} market(s) (need ~${need})…`);
for (const m of toCreate) {
  console.log(`  create_market ${m.slug}…`);
  const hash = await createMarket(m.question, m.slug);
  console.log(`  ok tx ${hash}`);
}

const after = await marketCount();
console.log(`Done. market_count=${after}`);
console.log('Chat: "list sports markets" then "buy yes for Chelsea over Arsenal with 30 XLM"');
