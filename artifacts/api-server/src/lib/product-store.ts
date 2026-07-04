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
    })();
  }
  await schemaReady;
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
