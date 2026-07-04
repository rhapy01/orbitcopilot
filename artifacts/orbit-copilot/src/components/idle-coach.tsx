import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
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

/** Coach content rendered as an assistant chat reply (not a modal). */
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
      <div className="flex items-center gap-2 text-[15px] leading-7 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Reading your on-chain positions…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="text-[15px] leading-7 text-destructive">
        {(error as Error)?.message ?? "Could not load your portfolio."}{" "}
        <button type="button" onClick={() => refetch()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  const idleLabel = data.idleAssets
    .map((a) => `${a.amount} ${a.asset}`)
    .join(" · ");

  return (
    <div className="space-y-3 text-[15px] leading-7 text-foreground">
      <p className="font-medium">{data.headline}</p>
      <p className="text-muted-foreground">{data.opportunity}</p>

      {idleLabel && (
        <p>
          <span className="text-muted-foreground">Idle now: </span>
          <span className="font-medium">{idleLabel}</span>
          {data.earningCount > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · {data.earningCount} earning
            </span>
          )}
        </p>
      )}

      <ul className="space-y-1 text-sm">
        {data.goldenPath.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            {s.done ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <Circle
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  data.goldenPath.step === s.id
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              />
            )}
            <span
              className={cn(
                s.done && "text-muted-foreground line-through",
                data.goldenPath.step === s.id &&
                  !s.done &&
                  "font-medium text-foreground"
              )}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ul>

      {data.primaryMove && (
        <div className="space-y-2 border-t border-primary/10 pt-3">
          <p className="text-sm text-muted-foreground">
            Recommended · {data.primaryMove.protocol}
          </p>
          <p className="font-medium leading-snug">{data.primaryMove.title}</p>
          <p className="text-sm text-muted-foreground">{data.primaryMove.reason}</p>
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
            className="inline-flex items-center gap-2 rounded-full bg-orbit-gradient px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            Review &amp; continue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {(data.lastIntent || data.lastOutcome) && (
        <div className="space-y-1 border-t border-primary/10 pt-3 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <History className="h-3.5 w-3.5 text-primary" />
            Orbit remembers
          </p>
          {data.lastIntent && (
            <p>
              Last intent:{" "}
              <span className="text-foreground">&ldquo;{data.lastIntent.text}&rdquo;</span>
            </p>
          )}
          {data.lastOutcome && (
            <p>
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
