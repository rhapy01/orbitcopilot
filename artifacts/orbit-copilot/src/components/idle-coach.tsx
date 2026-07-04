import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  Sparkles,
  ArrowRight,
  Check,
  Circle,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CoachData = {
  headline: string;
  opportunity: string;
  idleAssets: { asset: string; amount: string; note: string }[];
  idleCount: number;
  earningCount: number;
  primaryMove: {
    title: string;
    reason: string;
    command: string;
    from: string;
    to: string;
    protocol: string;
    riskNotes: string[];
  } | null;
  goldenPath: {
    step: string;
    label: string;
    steps: { id: string; label: string; done: boolean }[];
  };
  lastIntent: { text: string; createdAt: string } | null;
  lastOutcome: {
    summary: string;
    txHash: string | null;
    beforeIdle: string | null;
    afterNote: string | null;
    createdAt: string;
  } | null;
};

async function fetchCoach(publicKey: string): Promise<CoachData> {
  const res = await fetch(
    `/api/portfolio/coach?publicKey=${encodeURIComponent(publicKey)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Coach unavailable");
  }
  return res.json();
}

export function IdleCoach({
  publicKey,
  onAction,
}: {
  publicKey: string;
  onAction: (command: string) => void;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["portfolio-coach", publicKey],
    queryFn: () => fetchCoach(publicKey),
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl border border-primary/15 bg-card px-4 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Reading your on-chain positions…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto w-full max-w-md rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {(error as Error)?.message ?? "Could not load coach"}
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-2 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const idleLabel = data.idleAssets
    .map((a) => `${a.amount} ${a.asset}`)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <div className="rounded-2xl border border-primary/20 bg-card p-4 shadow-md shadow-primary/10 ring-1 ring-primary/15">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orbit-gradient shadow-sm">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Idle capital coach
            </p>
            <h2 className="text-lg font-semibold leading-snug tracking-tight">
              <span className="text-orbit-gradient">{data.headline}</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{data.opportunity}</p>
          </div>
        </div>

        {idleLabel && (
          <div className="mb-3 rounded-xl bg-orbit-gradient-subtle px-3 py-2 text-sm ring-1 ring-primary/10">
            <span className="text-muted-foreground">Idle now: </span>
            <span className="font-medium text-foreground">{idleLabel}</span>
            {data.earningCount > 0 && (
              <span className="ml-2 text-xs text-primary">
                · {data.earningCount} earning
              </span>
            )}
          </div>
        )}

        {/* Golden path */}
        <ol className="mb-4 flex flex-col gap-1.5">
          {data.goldenPath.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              {s.done ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Circle
                  className={cn(
                    "h-3.5 w-3.5",
                    data.goldenPath.step === s.id
                      ? "text-primary"
                      : "text-muted-foreground"
                  )}
                />
              )}
              <span
                className={cn(
                  s.done && "text-muted-foreground line-through",
                  data.goldenPath.step === s.id && !s.done && "font-medium text-foreground"
                )}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {data.primaryMove && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Recommended · {data.primaryMove.protocol}
            </p>
            <p className="text-sm font-medium">{data.primaryMove.title}</p>
            <p className="text-xs text-muted-foreground">{data.primaryMove.reason}</p>
            <button
              type="button"
              disabled={isFetching}
              onClick={() => {
                void fetch("/api/portfolio/intent", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    publicKey,
                    intent: data.primaryMove!.command,
                  }),
                }).catch(() => {});
                onAction(data.primaryMove!.command);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-orbit-gradient px-4 py-2.5 text-sm font-medium text-white shadow-md hover:opacity-90"
            >
              Review &amp; continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Intent memory */}
      {(data.lastIntent || data.lastOutcome) && (
        <div className="rounded-2xl border border-primary/10 bg-card/80 px-4 py-3 text-xs ring-1 ring-primary/10">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
            <History className="h-3.5 w-3.5 text-primary" />
            Orbit remembers
          </div>
          {data.lastIntent && (
            <p className="text-muted-foreground">
              Last intent:{" "}
              <span className="text-foreground">&ldquo;{data.lastIntent.text}&rdquo;</span>
            </p>
          )}
          {data.lastOutcome && (
            <p className="mt-1 text-muted-foreground">
              Last result:{" "}
              <span className="text-foreground">{data.lastOutcome.summary}</span>
              {data.lastOutcome.beforeIdle && (
                <span> (was idle: {data.lastOutcome.beforeIdle})</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function idleSnapshot(coach: CoachData | undefined): string | null {
  if (!coach?.idleAssets?.length) return null;
  return coach.idleAssets.map((a) => `${a.amount} ${a.asset}`).join(", ");
}
