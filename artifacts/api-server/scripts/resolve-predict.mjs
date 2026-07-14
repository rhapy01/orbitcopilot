/**
 * Admin helper: resolve an Orbit Predict market on Stellar Testnet.
 *
 * Requires:
 *   ORBIT_PREDICT_CONTRACT_ID
 *   ORBIT_ADMIN_SECRET_KEY  (S… secret of the contract admin)
 *
 * Usage:
 *   node scripts/resolve-predict.mjs brazil-wins yes
 *   node scripts/resolve-predict.mjs btc-100k no
 *
 * After resolve, winners can chat: "claim yes on brazil-wins"
 *
 * Prefer Stellar CLI if you have it (see contracts/README.md). This script uses
 * the JS SDK with the same Outcome enum encoding as chat bets (Symbol Yes/No).
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

const MARKETS = {
  "brazil-wins": 0,
  "btc-100k": 1,
  "xlm-up-week": 2,
  "eth-flip": 3,
  "chelsea-arsenal-epl": 4,
  "chelsea-arsenal-fa-cup": 5,
  "liverpool-city-epl": 6,
};

const slugArg = (process.argv[2] || "").trim().toLowerCase().replace(/\s+/g, "-");
const outcomeRaw = (process.argv[3] || "").trim().toLowerCase();
const outcomeName = outcomeRaw === "no" || outcomeRaw === "n" ? "No" : "Yes";

if (!slugArg || !(slugArg in MARKETS)) {
  console.error(
    "Usage: node scripts/resolve-predict.mjs <slug> <yes|no>\nSlugs:",
    Object.keys(MARKETS).join(", ")
  );
  process.exit(1);
}

const marketId = MARKETS[slugArg];
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
  xdr,
} = await import("@stellar/stellar-sdk");
const { Server, assembleTransaction } = await import("@stellar/stellar-sdk/rpc");

const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

const admin = Keypair.fromSecret(secret);
const rpc = new Server(SOROBAN_RPC);
const account = await rpc.getAccount(admin.publicKey());
const contract = new Contract(contractId);
const outcomeScVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(outcomeName)]);

const tx = new TransactionBuilder(account, {
  fee: BASE_FEE,
  networkPassphrase: NETWORK,
})
  .addOperation(
    contract.call(
      "resolve_market",
      nativeToScVal(marketId, { type: "u32" }),
      outcomeScVal
    )
  )
  .setTimeout(60)
  .build();

const sim = await rpc.simulateTransaction(tx);
if ("error" in sim && sim.error) {
  console.error("Simulation failed:", sim.error);
  process.exit(1);
}
const assembled = assembleTransaction(tx, sim).build();
assembled.sign(admin);
const sent = await rpc.sendTransaction(assembled);
console.log(`Submitted resolve ${slugArg} → ${outcomeName}`);
console.log("hash:", sent.hash);
console.log(`status: ${sent.status}`);
console.log(
  `Winners can now claim in chat: claim ${outcomeName.toLowerCase()} on ${slugArg}`
);
