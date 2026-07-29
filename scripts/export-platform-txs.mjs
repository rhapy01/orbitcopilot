import fs from "fs";
import pg from "pg";

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv(".env");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 20000,
});

const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const expert = (h) =>
  h && /^[a-fA-F0-9]{64}$/.test(h)
    ? `https://stellar.expert/explorer/testnet/tx/${h}`
    : "";

try {
  const events = await pool.query(
    `SELECT id, wallet_public_key, event_type, metadata, created_at
     FROM wallet_events
     WHERE event_type IN ('tx_submit','tx_sign')
     ORDER BY created_at DESC`
  );

  let outcomes = { rows: [] };
  let beta = { rows: [] };
  try {
    outcomes = await pool.query(
      `SELECT id, wallet_public_key, summary, tx_hash, created_at
       FROM action_outcomes
       ORDER BY created_at DESC`
    );
  } catch (e) {
    console.error("action_outcomes:", e.message);
  }
  try {
    beta = await pool.query(
      `SELECT wallet_public_key, claim_tx_hash, claim_token_id, claimed_at
       FROM beta_nft_eligibility
       WHERE claimed_at IS NOT NULL AND claim_tx_hash IS NOT NULL
       ORDER BY claimed_at DESC`
    );
  } catch (e) {
    console.error("beta:", e.message);
  }

  const rows = [];
  for (const r of events.rows) {
    const meta =
      r.metadata && typeof r.metadata === "object" ? r.metadata : {};
    const txHash = meta.txHash || meta.hash || meta.tx_hash || "";
    rows.push({
      id: r.id,
      source: "wallet_event",
      event_type: r.event_type,
      action_type: meta.actionType || meta.outcome || "",
      wallet: r.wallet_public_key || "",
      tx_hash: txHash,
      explorer_url: expert(txHash),
      summary: meta.outcome || "",
      created_at: new Date(r.created_at).toISOString(),
    });
  }
  for (const r of outcomes.rows) {
    const txHash = r.tx_hash || "";
    rows.push({
      id: r.id,
      source: "action_outcome",
      event_type: "tx_submit",
      action_type: "",
      wallet: r.wallet_public_key || "",
      tx_hash: txHash,
      explorer_url: expert(txHash),
      summary: r.summary || "",
      created_at: new Date(r.created_at).toISOString(),
    });
  }
  for (const r of beta.rows) {
    const txHash = r.claim_tx_hash || "";
    rows.push({
      id: 0,
      source: "beta_nft_claim",
      event_type: "tx_submit",
      action_type: "nft_mint",
      wallet: r.wallet_public_key || "",
      tx_hash: txHash,
      explorer_url: expert(txHash),
      summary: "Orbit Beta Tester NFT claim",
      created_at: new Date(r.claimed_at).toISOString(),
    });
  }

  const byHash = new Map();
  const noHash = [];
  const score = (r) =>
    (r.summary ? 2 : 0) +
    (r.action_type ? 1 : 0) +
    (r.source === "action_outcome" ? 1 : 0);
  for (const r of rows) {
    if (!r.tx_hash) {
      noHash.push(r);
      continue;
    }
    const k = r.tx_hash.toLowerCase();
    const prev = byHash.get(k);
    if (!prev || score(r) > score(prev)) byHash.set(k, r);
  }
  const unique = [...byHash.values(), ...noHash].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1
  );

  const byAction = {};
  for (const r of unique) {
    const a =
      r.action_type ||
      (r.event_type === "tx_sign" ? "(sign-only)" : "(unknown)");
    byAction[a] = (byAction[a] || 0) + 1;
  }

  const header =
    "id,source,event_type,action_type,wallet_public_key,tx_hash,explorer_url,summary,created_at";
  const lines = [
    header,
    ...unique.map((r) =>
      [
        r.id,
        esc(r.source),
        esc(r.event_type),
        esc(r.action_type),
        esc(r.wallet),
        esc(r.tx_hash),
        esc(r.explorer_url),
        esc(r.summary),
        esc(r.created_at),
      ].join(",")
    ),
  ];
  fs.writeFileSync("orbit-platform-transactions.csv", lines.join("\n"));

  const summaryLines = [
    "metric,value",
    "network,testnet",
    `raw_rows,${rows.length}`,
    `unique_rows,${unique.length}`,
    `unique_tx_hashes,${byHash.size}`,
    `events_without_hash,${noHash.length}`,
    `wallet_event_rows,${events.rows.length}`,
    `action_outcome_rows,${outcomes.rows.length}`,
    `beta_nft_claim_rows,${beta.rows.length}`,
    ...Object.entries(byAction).map(
      ([k, v]) => `action_${k.replace(/[^a-z0-9_]/gi, "_")},${v}`
    ),
  ];
  fs.writeFileSync(
    "orbit-platform-transactions-summary.csv",
    summaryLines.join("\n")
  );

  console.log(
    JSON.stringify(
      {
        raw: rows.length,
        unique: unique.length,
        withHash: byHash.size,
        noHash: noHash.length,
        byAction,
        files: [
          "orbit-platform-transactions.csv",
          "orbit-platform-transactions-summary.csv",
        ],
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
