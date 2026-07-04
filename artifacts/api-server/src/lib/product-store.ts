import { db, walletEventsTable, feedbackTable } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

let schemaReady: Promise<void> | null = null;

export async function ensureProductSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS wallet_events (
          id serial PRIMARY KEY,
          wallet_public_key text,
          event_type text NOT NULL,
          metadata jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS wallet_events_wallet_idx
        ON wallet_events (wallet_public_key)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS wallet_events_type_idx
        ON wallet_events (event_type)
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS feedback (
          id serial PRIMARY KEY,
          wallet_public_key text,
          rating integer NOT NULL,
          message text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS user_intents (
          id serial PRIMARY KEY,
          wallet_public_key text NOT NULL,
          intent_text text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS user_intents_wallet_idx
        ON user_intents (wallet_public_key)
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS action_outcomes (
          id serial PRIMARY KEY,
          wallet_public_key text NOT NULL,
          summary text NOT NULL,
          tx_hash text,
          before_idle text,
          after_note text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })();
  }
  await schemaReady;
}

export type StoredIntent = {
  text: string;
  createdAt: string;
};

export type StoredOutcome = {
  summary: string;
  txHash: string | null;
  beforeIdle: string | null;
  afterNote: string | null;
  createdAt: string;
};

export async function recordIntent(
  walletPublicKey: string,
  intentText: string
): Promise<void> {
  await ensureProductSchema();
  await db.execute(sql`
    INSERT INTO user_intents (wallet_public_key, intent_text)
    VALUES (${walletPublicKey}, ${intentText.slice(0, 500)})
  `);
}

export async function getLastIntent(
  walletPublicKey: string
): Promise<StoredIntent | null> {
  await ensureProductSchema();
  const res = await db.execute(sql`
    SELECT intent_text AS text, created_at AS "createdAt"
    FROM user_intents
    WHERE wallet_public_key = ${walletPublicKey}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = res.rows?.[0] as
    | { text?: string; createdAt?: Date | string }
    | undefined;
  if (!row?.text) return null;
  return {
    text: row.text,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

export async function recordOutcome(input: {
  walletPublicKey: string;
  summary: string;
  txHash?: string | null;
  beforeIdle?: string | null;
  afterNote?: string | null;
}): Promise<void> {
  await ensureProductSchema();
  await db.execute(sql`
    INSERT INTO action_outcomes (
      wallet_public_key, summary, tx_hash, before_idle, after_note
    ) VALUES (
      ${input.walletPublicKey},
      ${input.summary.slice(0, 500)},
      ${input.txHash ?? null},
      ${input.beforeIdle ?? null},
      ${input.afterNote ?? null}
    )
  `);
  await recordWalletEvent({
    walletPublicKey: input.walletPublicKey,
    eventType: "tx_submit",
    metadata: {
      outcome: input.summary,
      txHash: input.txHash,
      beforeIdle: input.beforeIdle,
    },
  });
}

export async function getLastOutcome(
  walletPublicKey: string
): Promise<StoredOutcome | null> {
  await ensureProductSchema();
  const res = await db.execute(sql`
    SELECT summary, tx_hash AS "txHash", before_idle AS "beforeIdle",
           after_note AS "afterNote", created_at AS "createdAt"
    FROM action_outcomes
    WHERE wallet_public_key = ${walletPublicKey}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = res.rows?.[0] as
    | {
        summary?: string;
        txHash?: string | null;
        beforeIdle?: string | null;
        afterNote?: string | null;
        createdAt?: Date | string;
      }
    | undefined;
  if (!row?.summary) return null;
  return {
    summary: row.summary,
    txHash: row.txHash ?? null,
    beforeIdle: row.beforeIdle ?? null,
    afterNote: row.afterNote ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}

export async function recordWalletEvent(input: {
  walletPublicKey?: string | null;
  eventType: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await ensureProductSchema();
  await db.insert(walletEventsTable).values({
    walletPublicKey: input.walletPublicKey ?? null,
    eventType: input.eventType,
    metadata: (input.metadata ?? null) as never,
  });
}

export async function insertFeedback(input: {
  walletPublicKey?: string | null;
  rating: number;
  message: string;
}): Promise<void> {
  await ensureProductSchema();
  await db.insert(feedbackTable).values({
    walletPublicKey: input.walletPublicKey ?? null,
    rating: input.rating,
    message: input.message,
  });
}

function rowNum(row: Record<string, unknown> | undefined, key: string): number {
  if (!row) return 0;
  const v = row[key];
  return typeof v === "number" ? v : Number(v) || 0;
}

export async function getProductStats() {
  await ensureProductSchema();

  const totalEvents = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM wallet_events
  `);
  const uniqueWalletsRes = await db.execute(sql`
    SELECT COUNT(DISTINCT wallet_public_key)::int AS n
    FROM wallet_events
    WHERE wallet_public_key IS NOT NULL
  `);
  const byTypeRes = await db.execute(sql`
    SELECT event_type AS type, COUNT(*)::int AS n
    FROM wallet_events
    GROUP BY event_type
  `);
  const feedbackAgg = await db.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(AVG(rating), 0)::float AS avg
    FROM feedback
  `);

  const recent = await db
    .select({
      id: walletEventsTable.id,
      walletPublicKey: walletEventsTable.walletPublicKey,
      eventType: walletEventsTable.eventType,
      metadata: walletEventsTable.metadata,
      createdAt: walletEventsTable.createdAt,
    })
    .from(walletEventsTable)
    .orderBy(desc(walletEventsTable.createdAt))
    .limit(25);

  const feedbackRecent = await db
    .select({
      id: feedbackTable.id,
      rating: feedbackTable.rating,
      message: feedbackTable.message,
      walletPublicKey: feedbackTable.walletPublicKey,
      createdAt: feedbackTable.createdAt,
    })
    .from(feedbackTable)
    .orderBy(desc(feedbackTable.createdAt))
    .limit(20);

  const total = rowNum(totalEvents.rows?.[0] as Record<string, unknown>, "n");
  const uniqueWallets = rowNum(
    uniqueWalletsRes.rows?.[0] as Record<string, unknown>,
    "n"
  );
  const feedbackTotal = rowNum(
    feedbackAgg.rows?.[0] as Record<string, unknown>,
    "n"
  );
  const avgRating = rowNum(
    feedbackAgg.rows?.[0] as Record<string, unknown>,
    "avg"
  );

  const byType: Record<string, number> = {};
  for (const row of byTypeRes.rows ?? []) {
    const r = row as Record<string, unknown>;
    const type = String(r.type ?? "");
    if (type) byType[type] = rowNum(r, "n");
  }

  return {
    network: "testnet" as const,
    events: {
      total,
      uniqueWallets,
      byType,
      recent: recent.map((r) => ({
        id: r.id,
        walletPublicKey: r.walletPublicKey
          ? `${r.walletPublicKey.slice(0, 4)}…${r.walletPublicKey.slice(-4)}`
          : null,
        eventType: r.eventType,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    feedback: {
      total: feedbackTotal,
      averageRating: Math.round(avgRating * 10) / 10,
      recent: feedbackRecent.map((f) => ({
        id: f.id,
        rating: f.rating,
        message: f.message,
        walletPublicKey: f.walletPublicKey
          ? `${f.walletPublicKey.slice(0, 4)}…${f.walletPublicKey.slice(-4)}`
          : null,
        createdAt: f.createdAt.toISOString(),
      })),
    },
    level4: {
      minUsersTarget: 10,
      uniqueWallets,
      usersTargetMet: uniqueWallets >= 10,
    },
  };
}
