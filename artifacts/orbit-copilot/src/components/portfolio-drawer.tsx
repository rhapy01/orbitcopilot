import { useQuery } from "@tanstack/react-query";
import {
 X,
 Loader2,
 ArrowRight,
 ExternalLink,
 Sparkles,
 Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AssetRow = {
 assetCode: string;
 balance: number;
 valueUsd: number;
};

type TxRow = {
 id: number;
 type: string;
 assetCode: string;
 amount: number;
 description: string;
 hash: string | null;
 createdAt: string;
};

type CoachBrief = {
 headline: string;
 opportunity: string;
 idleCount: number;
 earningCount: number;
 primaryMove: {
 title: string;
 reason: string;
 command: string;
 protocol: string;
 } | null;
};

type PortfolioPosition = {
 id: string;
 protocol: string;
 kind: string;
 label: string;
 asset: string;
 amount: string;
 status: string;
 note: string;
 suggestion?: string;
 meta?: { aprPercent?: number; valueUsd?: number };
};

type PortfolioIntel = {
 positions: PortfolioPosition[];
 summary: {
 earning: number;
 idle: number;
 borrowing: number;
 pending: number;
 };
};

async function fetchJson<T>(url: string): Promise<T | null> {
 try {
 const res = await fetch(url);
 if (!res.ok) return null;
 return res.json();
 } catch {
 return null;
 }
}

export function PortfolioDrawer({
 open,
 onClose,
 publicKey,
 onAction,
}: {
 open: boolean;
 onClose: () => void;
 publicKey: string | null;
 onAction: (command: string) => void;
}) {
 const enabled = open && Boolean(publicKey);

 const { data: assets, isLoading: assetsLoading } = useQuery({
 queryKey: ["wallet-assets", publicKey],
 queryFn: () =>
 fetchJson<AssetRow[]>(
 `/api/wallet/assets?publicKey=${encodeURIComponent(publicKey!)}`
 ),
 enabled,
 staleTime: 20_000,
 });

 const { data: coach, isLoading: coachLoading } = useQuery({
 queryKey: ["portfolio-coach", publicKey],
 queryFn: () =>
 fetchJson<CoachBrief>(
 `/api/portfolio/coach?publicKey=${encodeURIComponent(publicKey!)}`
 ),
 enabled,
 staleTime: 20_000,
 });

 const { data: intel, isLoading: intelLoading } = useQuery({
 queryKey: ["portfolio-intel", publicKey],
 queryFn: () =>
 fetchJson<PortfolioIntel>(
 `/api/portfolio/intel?publicKey=${encodeURIComponent(publicKey!)}`
 ),
 enabled,
 staleTime: 20_000,
 });

 const { data: txs, isLoading: txsLoading } = useQuery({
 queryKey: ["wallet-transactions", publicKey],
 queryFn: () =>
 fetchJson<TxRow[]>(
 `/api/wallet/transactions?publicKey=${encodeURIComponent(publicKey!)}`
 ),
 enabled,
 staleTime: 30_000,
 });

 const hubPositions =
 intel?.positions.filter(
 (p) =>
 p.kind === "lend" ||
 p.kind === "borrow" ||
 p.kind === "farm" ||
 p.kind === "lp" ||
 p.kind === "order" ||
 (p.kind === "wallet" && p.status === "idle" && Number(p.amount) > 0)
 ) ?? [];

 if (!open) return null;

 return (
 <>
 <div
 className="fixed inset-0 z-[60] bg-black/40"
 onClick={onClose}
 aria-hidden
 />
 <aside
 className={cn(
 "fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
 )}
 role="dialog"
 aria-label="Portfolio"
 >
 <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
 <div className="flex items-center gap-2">
 <Wallet className="h-4 w-4 text-primary" />
 <h2 className="text-sm font-semibold">Portfolio</h2>
 </div>
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Close"
 >
 <X className="h-4 w-4" />
 </button>
 </div>

 <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
 {!publicKey ? (
 <p className="text-sm text-muted-foreground">
 Connect a wallet to see balances and recent activity.
 </p>
 ) : (
 <>
 <section>
 <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 Balances
 </h3>
 {assetsLoading ? (
 <Loader2 className="h-4 w-4 animate-spin text-primary" />
 ) : !assets?.length ? (
 <p className="text-sm text-muted-foreground">
 No balances yet - fund with Friendbot.
 </p>
 ) : (
 <ul className="space-y-2">
 {assets
 .filter((a) => a.balance > 0)
 .slice(0, 12)
 .map((a) => (
 <li
 key={a.assetCode}
 className="flex items-center justify-between rounded-xl border border-primary/10 bg-card px-3 py-2 text-sm"
 >
 <span className="font-medium">{a.assetCode}</span>
 <span className="text-muted-foreground">
 {a.balance.toLocaleString(undefined, {
 maximumFractionDigits: 4,
 })}
 {a.valueUsd > 0 && (
 <span className="ml-2 text-xs">
 ≈${a.valueUsd.toFixed(2)}
 </span>
 )}
 </span>
 </li>
 ))}
 </ul>
 )}
 </section>

 <section>
 <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 Coach
 </h3>
 {coachLoading ? (
 <Loader2 className="h-4 w-4 animate-spin text-primary" />
 ) : !coach ? (
 <p className="text-sm text-muted-foreground">Coach unavailable.</p>
 ) : (
 <div className="space-y-2 rounded-xl border border-primary/15 bg-orbit-gradient-subtle p-3">
 <p className="text-sm font-medium">{coach.headline}</p>
 <p className="text-xs text-muted-foreground">{coach.opportunity}</p>
 <p className="text-xs text-muted-foreground">
 Idle {coach.idleCount} · Earning {coach.earningCount}
 </p>
 {coach.primaryMove && (
 <button
 type="button"
 onClick={() => {
 onAction(coach.primaryMove!.command);
 onClose();
 }}
 className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-orbit-gradient px-3 py-1.5 text-xs font-medium text-white"
 >
 {coach.primaryMove.title}
 <ArrowRight className="h-3.5 w-3.5" />
 </button>
 )}
 </div>
 )}
 </section>

 <section>
 <div className="mb-2 flex items-center justify-between">
 <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 Positions
 </h3>
 {intel?.summary && (
 <span className="text-[10px] text-muted-foreground">
 Earn {intel.summary.earning} · Idle {intel.summary.idle} ·
 Debt {intel.summary.borrowing}
 </span>
 )}
 </div>
 {intelLoading ? (
 <Loader2 className="h-4 w-4 animate-spin text-primary" />
 ) : !hubPositions.length ? (
 <p className="text-sm text-muted-foreground">
 No open positions yet - supply, LP, farm, or bet from chat.
 </p>
 ) : (
 <ul className="space-y-2">
 {hubPositions.slice(0, 14).map((p) => {
 const apr = p.meta?.aprPercent;
 return (
 <li
 key={p.id}
 className="rounded-xl border border-border px-3 py-2 text-sm"
 >
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <p className="truncate font-medium">{p.label}</p>
 <p className="text-xs text-muted-foreground">
 {p.protocol} · {p.status}
 {apr != null && apr > 0
 ? ` · ~${apr.toFixed(1)}% APR`
 : ""}
 </p>
 </div>
 <span className="shrink-0 text-xs text-muted-foreground">
 {p.amount} {p.asset}
 </span>
 </div>
 {p.suggestion && (
 <button
 type="button"
 onClick={() => {
 onAction(p.suggestion!);
 onClose();
 }}
 className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
 >
 {p.suggestion}
 <ArrowRight className="h-3 w-3" />
 </button>
 )}
 </li>
 );
 })}
 </ul>
 )}
 </section>

 <section>
 <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 Recent activity
 </h3>
 {txsLoading ? (
 <Loader2 className="h-4 w-4 animate-spin text-primary" />
 ) : !txs?.length ? (
 <p className="text-sm text-muted-foreground">No recent Horizon ops.</p>
 ) : (
 <ul className="space-y-2">
 {txs.slice(0, 8).map((tx) => (
 <li
 key={`${tx.id}-${tx.hash ?? tx.createdAt}`}
 className="rounded-xl border border-border px-3 py-2 text-sm"
 >
 <div className="flex items-center justify-between gap-2">
 <span className="font-medium capitalize">{tx.type}</span>
 <span className="text-muted-foreground">
 {tx.amount > 0
 ? `${tx.amount.toLocaleString(undefined, {
 maximumFractionDigits: 4,
 })} ${tx.assetCode}`
 : tx.assetCode}
 </span>
 </div>
 <p className="mt-0.5 truncate text-xs text-muted-foreground">
 {tx.description}
 </p>
 {tx.hash && (
 <a
 href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
 target="_blank"
 rel="noreferrer"
 className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
 >
 Explorer <ExternalLink className="h-3 w-3" />
 </a>
 )}
 </li>
 ))}
 </ul>
 )}
 </section>

 <button
 type="button"
 onClick={() => {
 onAction("What's in my portfolio?");
 onClose();
 }}
 className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/20 py-2.5 text-sm font-medium hover:bg-primary/5"
 >
 <Sparkles className="h-4 w-4 text-primary" />
 Ask Orbit for full report
 </button>
 </>
 )}
 </div>
 </aside>
 </>
 );
}
