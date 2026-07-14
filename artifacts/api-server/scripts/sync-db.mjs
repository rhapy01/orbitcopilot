/**
 * Sync Neon Postgres with all Orbit schema (migrations + product/chat DDL).
 * Usage: node artifacts/api-server/scripts/sync-db.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

const envPath = path.join(root, ".env");
const env = fs.readFileSync(envPath, "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) {
  console.error("DATABASE_URL missing in .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

async function run(label, sql) {
  process.stdout.write(`→ ${label}… `);
  await client.query(sql);
  console.log("ok");
}

await client.connect();
console.log("Connected to Neon\n");

// Track applied migrations
await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const migrationsDir = path.join(root, "lib/db/migrations");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const already = await client.query(
    `SELECT 1 FROM schema_migrations WHERE id = $1`,
    [file]
  );
  if (already.rowCount > 0) {
    console.log(`→ ${file} (already applied)`);
    continue;
  }
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
    await client.query("COMMIT");
    console.log(`→ ${file} applied`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// Product / analytics tables (also created at runtime by ensureProductSchema)
await run(
  "product tables",
  `
  CREATE TABLE IF NOT EXISTS wallet_events (
    id serial PRIMARY KEY,
    wallet_public_key text,
    event_type text NOT NULL,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS wallet_events_wallet_idx ON wallet_events (wallet_public_key);
  CREATE INDEX IF NOT EXISTS wallet_events_type_idx ON wallet_events (event_type);

  CREATE TABLE IF NOT EXISTS feedback (
    id serial PRIMARY KEY,
    wallet_public_key text,
    rating integer NOT NULL,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS user_intents (
    id serial PRIMARY KEY,
    wallet_public_key text NOT NULL,
    intent_text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS user_intents_wallet_idx ON user_intents (wallet_public_key);

  CREATE TABLE IF NOT EXISTS action_outcomes (
    id serial PRIMARY KEY,
    wallet_public_key text NOT NULL,
    summary text NOT NULL,
    tx_hash text,
    before_idle text,
    after_note text,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS beta_nft_eligibility (
    wallet_public_key text PRIMARY KEY,
    feedback_id integer,
    whitelisted_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz,
    claim_token_id integer,
    claim_tx_hash text
  );
  CREATE INDEX IF NOT EXISTS beta_nft_eligibility_claimed_idx
    ON beta_nft_eligibility (claimed_at)
    WHERE claimed_at IS NOT NULL;
`
);

// Chat tables (match chat-store / drizzle schema)
await run(
  "chat tables",
  `
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id serial PRIMARY KEY,
    wallet_public_key text NOT NULL DEFAULT '',
    title text NOT NULL DEFAULT 'New chat',
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id serial PRIMARY KEY,
    session_id integer,
    wallet_public_key text,
    role text NOT NULL,
    content text NOT NULL,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS session_id integer;
  ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS wallet_public_key text;
  CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id);
`
);

const tables = await client.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`);

console.log("\nPublic tables:");
for (const row of tables.rows) {
  console.log(`  • ${row.tablename}`);
}

const migs = await client.query(
  `SELECT id, applied_at FROM schema_migrations ORDER BY id`
);
console.log("\nMigrations:");
for (const row of migs.rows) {
  console.log(`  • ${row.id} @ ${row.applied_at.toISOString?.() ?? row.applied_at}`);
}

await client.end();
console.log("\nDB sync complete.");
