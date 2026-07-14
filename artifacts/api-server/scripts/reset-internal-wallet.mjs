/**
 * Testnet: wipe an embedded wallet so the next login recreates it under current KMS_SECRET.
 * Use when signing fails with "unable to authenticate data" after KMS rotation.
 *
 * Usage:
 *   node artifacts/api-server/scripts/reset-internal-wallet.mjs --email=user@example.com
 *   node artifacts/api-server/scripts/reset-internal-wallet.mjs --user-id=1
 *
 * Requires DATABASE_URL in repo .env (same Neon as production).
 * After running: user must Continue with email / log in again to get a new device share.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const envPath = path.join(root, ".env");
const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const url = (process.env.DATABASE_URL || env.match(/^DATABASE_URL=(.+)$/m)?.[1] || "").trim();
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);

const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : null;
const userIdArg = typeof args["user-id"] === "string" ? Number(args["user-id"]) : null;

if (!email && !(userIdArg && Number.isFinite(userIdArg))) {
  console.error("Pass --email=... or --user-id=...");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const userRes = email
  ? await client.query(`SELECT id, email FROM users WHERE lower(email) = $1`, [email])
  : await client.query(`SELECT id, email FROM users WHERE id = $1`, [userIdArg]);

if (userRes.rowCount === 0) {
  console.error("User not found");
  await client.end();
  process.exit(1);
}

const user = userRes.rows[0];
const walletRes = await client.query(
  `SELECT stellar_public_key, created_at FROM internal_wallets WHERE user_id = $1`,
  [user.id]
);

console.log("User:", { id: user.id, email: user.email });
if (walletRes.rowCount === 0) {
  console.log("No internal_wallets row — nothing to delete. Next login will create one.");
  await client.end();
  process.exit(0);
}

const oldPk = walletRes.rows[0].stellar_public_key;
console.log("Deleting wallet:", oldPk, "created", walletRes.rows[0].created_at);

await client.query(`DELETE FROM internal_wallets WHERE user_id = $1`, [user.id]);
console.log(
  "Done. Have the user log in again (Continue with email). They get a NEW testnet G-address; old funds stay on",
  oldPk
);
await client.end();
