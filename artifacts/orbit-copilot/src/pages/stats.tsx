import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Loader2, Activity, Users, MessageSquare, Star } from "lucide-react";

type Stats = {
  events: {
    total: number;
    uniqueWallets: number;
    byType: Record<string, number>;
    recent: {
      id: number;
      walletPublicKey: string | null;
      eventType: string;
      createdAt: string;
    }[];
  };
  feedback: {
    total: number;
    averageRating: number;
    recent: {
      id: number;
      rating: number;
      message: string;
      walletPublicKey: string | null;
      createdAt: string;
    }[];
  };
  level4: {
    minUsersTarget: number;
    uniqueWallets: number;
    usersTargetMet: boolean;
  };
};

async function fetchStats(): Promise<Stats> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("Failed to load stats");
  return res.json();
}

export default function StatsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["product-stats"],
    queryFn: fetchStats,
    refetchInterval: 15_000,
  });

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              <span className="text-orbit-gradient">Product analytics</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live usage for monitoring and Level 4 validation (wallet events +
              feedback). Balances stay on-chain.
            </p>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {isError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {(error as Error)?.message ?? "Stats unavailable"}
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  icon={Users}
                  label="Unique wallets"
                  value={String(data.events.uniqueWallets)}
                  hint={`Target ${data.level4.minUsersTarget}+`}
                  highlight={data.level4.usersTargetMet}
                />
                <StatCard
                  icon={Activity}
                  label="Events"
                  value={String(data.events.total)}
                />
                <StatCard
                  icon={MessageSquare}
                  label="Feedback"
                  value={String(data.feedback.total)}
                />
                <StatCard
                  icon={Star}
                  label="Avg rating"
                  value={
                    data.feedback.total
                      ? `${data.feedback.averageRating}/5`
                      : "—"
                  }
                />
              </div>

              <section className="rounded-2xl border border-primary/10 bg-card p-4 ring-1 ring-primary/10">
                <h2 className="mb-3 text-sm font-semibold">Events by type</h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.events.byType).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No events yet</p>
                  ) : (
                    Object.entries(data.events.byType).map(([type, n]) => (
                      <span
                        key={type}
                        className="rounded-full border border-primary/20 bg-orbit-gradient-subtle px-3 py-1 text-xs font-medium"
                      >
                        {type}: {n}
                      </span>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-primary/10 bg-card p-4 ring-1 ring-primary/10">
                <h2 className="mb-3 text-sm font-semibold">Recent wallet events</h2>
                <ul className="space-y-2 text-sm">
                  {data.events.recent.length === 0 && (
                    <li className="text-muted-foreground">No events yet</li>
                  )}
                  {data.events.recent.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0"
                    >
                      <span className="font-medium text-primary">{e.eventType}</span>
                      <span className="text-muted-foreground">
                        {e.walletPublicKey ?? "anon"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl border border-primary/10 bg-card p-4 ring-1 ring-primary/10">
                <h2 className="mb-3 text-sm font-semibold">Feedback summary</h2>
                <ul className="space-y-3 text-sm">
                  {data.feedback.recent.length === 0 && (
                    <li className="text-muted-foreground">No feedback yet</li>
                  )}
                  {data.feedback.recent.map((f) => (
                    <li key={f.id} className="rounded-xl bg-orbit-gradient-subtle px-3 py-2">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-primary">
                          {f.rating}/5
                        </span>
                        <span>{f.walletPublicKey ?? "anon"}</span>
                      </div>
                      <p>{f.message}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ring-1 ${
        highlight
          ? "border-primary/40 bg-orbit-gradient-subtle ring-primary/20"
          : "border-primary/10 bg-card ring-primary/10"
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
