/**
 * Shared MCP approve panel — used by /approve/:id and /embed/approve/:id
 */

import { useEffect, useState, lazy, Suspense } from "react";
import { Link } from "wouter";
import { Loader2, CheckCircle2, XCircle, Shield } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import type { ChatAction, CompletedOutcome } from "@/types/chat-action";

const TransactionActionCard = lazy(() =>
  import("@/components/transaction-action-card").then((m) => ({
    default: m.TransactionActionCard,
  })),
);
const WalletConnectModal = lazy(() =>
  import("@/components/auth/wallet-connect-modal").then((m) => ({
    default: m.WalletConnectModal,
  })),
);

export type ActionPayload = {
  publicId: string;
  status: string;
  summary: string;
  walletPublicKey: string;
  action: ChatAction;
  approvalUrl: string;
  embedUrl?: string;
  embedToken?: string;
  txHash: string | null;
  error: string | null;
  expiresAt: string;
  intentText: string | null;
};

function readEmbedToken(): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get("et");
  } catch {
    return null;
  }
}

export function McpApprovePanel({
  actionId,
  embed = false,
}: {
  actionId: string;
  /** Compact in-chat / iframe mode */
  embed?: boolean;
}) {
  const wallet = useWallet();
  const [data, setData] = useState<ActionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState<CompletedOutcome | null>(null);
  const embedToken = readEmbedToken();

  useEffect(() => {
    if (!actionId) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = embedToken
          ? `?et=${encodeURIComponent(embedToken)}`
          : "";
        const res = await fetch(
          `/api/mcp/actions/${encodeURIComponent(actionId)}${qs}`,
          {
            credentials: "include",
            headers: embedToken
              ? { "X-Orbit-Embed-Token": embedToken }
              : undefined,
          },
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setData(json as ActionPayload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load action");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionId, embedToken]);

  useEffect(() => {
    if (!wallet.isConnected) {
      wallet.openConnectModal();
    }
  }, [wallet.isConnected, wallet.openConnectModal]);

  // Tell parent host (MCP App shell / ChatGPT) when done — only same-origin parents get secrets via credentials; message is status only
  useEffect(() => {
    if (!completed?.hash && data?.status !== "completed") return;
    const payload = {
      type: "orbit-mcp-approved",
      actionId,
      txHash: completed?.hash || data?.txHash,
      summary: completed?.summary || data?.summary,
    };
    try {
      // parent is MCP App shell (often blob/sandbox) — use * but payload has no secrets
      window.parent?.postMessage(payload, "*");
    } catch {
      /* ignore */
    }
  }, [completed, data?.status, data?.txHash, data?.summary, actionId]);

  async function markComplete(outcome: CompletedOutcome) {
    setCompleted(outcome);
    const token = embedToken || data?.embedToken || null;
    try {
      await fetch(`/api/mcp/actions/${encodeURIComponent(actionId)}/complete`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Orbit-Embed-Token": token } : {}),
        },
        body: JSON.stringify({
          txHash: outcome.hash,
          error: outcome.hash ? null : outcome.summary,
          ...(token ? { embedToken: token } : {}),
        }),
      });
    } catch {
      /* poll still works */
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-6 bg-background">
        <XCircle className="h-10 w-10 text-destructive" />
        <p className="text-destructive text-sm">{error || "Action not found"}</p>
      </div>
    );
  }

  const walletMismatch =
    wallet.publicKey &&
    data.walletPublicKey &&
    wallet.publicKey !== data.walletPublicKey;

  const alreadyDone = data.status !== "pending" || completed;

  return (
    <div
      className={
        embed
          ? "min-h-[320px] bg-background text-foreground"
          : "min-h-screen bg-background text-foreground"
      }
    >
      <div
        className={`mx-auto space-y-4 ${
          embed ? "max-w-md px-3 py-4" : "max-w-lg px-4 py-10 space-y-6"
        }`}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 text-primary" />
          Confirm in chat — AI cannot sign
        </div>

        <div>
          <h1
            className={`font-semibold tracking-tight ${
              embed ? "text-lg" : "text-2xl"
            }`}
          >
            Confirm transaction
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{data.summary}</p>
          {data.intentText && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              “{data.intentText}”
            </p>
          )}
        </div>

        {!wallet.isConnected && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Unlock your Orbit wallet here to confirm — stay in this panel.
            <Button
              className="mt-3 w-full"
              size={embed ? "sm" : "default"}
              onClick={() => wallet.openConnectModal()}
            >
              Unlock with Orbit
            </Button>
          </div>
        )}

        {walletMismatch && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            This action is for {data.walletPublicKey.slice(0, 4)}…
            {data.walletPublicKey.slice(-4)}. Switch to that wallet.
          </div>
        )}

        {(alreadyDone || data.status === "completed") && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 flex gap-3 items-start">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-green-700 dark:text-green-300">
                {completed?.summary || "Confirmed on-chain"}
              </p>
              {(completed?.hash || data.txHash) && (
                <a
                  className="text-xs text-primary underline break-all"
                  href={`https://stellar.expert/explorer/testnet/tx/${completed?.hash || data.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {completed?.hash || data.txHash}
                </a>
              )}
              {embed && (
                <p className="text-xs text-muted-foreground mt-2">
                  You can continue in this chat.
                </p>
              )}
            </div>
          </div>
        )}

        {data.status === "pending" &&
          !completed &&
          wallet.isConnected &&
          !walletMismatch && (
            <Suspense
              fallback={
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              }
            >
              <TransactionActionCard
                action={data.action}
                onOutcome={(info) => {
                  if (info.terminal) {
                    void markComplete({ hash: info.hash, summary: info.summary });
                  }
                }}
              />
            </Suspense>
          )}

        {(data.status === "expired" || data.status === "failed") && !completed && (
          <div className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
            {data.status === "expired"
              ? "This approval expired. Ask again in chat."
              : data.error || "Action failed."}
          </div>
        )}

        {!embed && (
          <Button asChild variant="ghost" className="w-full">
            <Link href="/">Open Orbit Copilot</Link>
          </Button>
        )}
      </div>

      <Suspense fallback={null}>
        <WalletConnectModal
          open={wallet.connectModalOpen}
          onOpenChange={wallet.setConnectModalOpen}
        />
      </Suspense>
    </div>
  );
}
