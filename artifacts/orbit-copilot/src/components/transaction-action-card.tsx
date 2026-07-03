import { useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, Wallet, XCircle } from "lucide-react";
import { useBuildTransaction, useSubmitTransaction } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useFreighter } from "@/hooks/use-freighter";

export interface ChatAction {
  type: "send" | "swap";
  sendAmount: string;
  sendAsset: string;
  destination?: string;
  destAsset?: string;
}

type Status = "idle" | "building" | "signing" | "submitting" | "success" | "error";

export function TransactionActionCard({ action }: { action: ChatAction }) {
  const { isConnected, publicKey, connect, connecting, signTransaction } = useFreighter();
  const buildMutation = useBuildTransaction();
  const submitMutation = useSubmitTransaction();

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [estimatedDest, setEstimatedDest] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!publicKey) return;
    setError(null);
    setStatus("building");
    try {
      const built = await buildMutation.mutateAsync({
        data: {
          type: action.type,
          sourcePublicKey: publicKey,
          sendAsset: action.sendAsset,
          sendAmount: action.sendAmount,
          destination: action.destination ?? null,
          destAsset: action.destAsset ?? null,
        },
      });
      if (built.estimatedDestAmount) setEstimatedDest(built.estimatedDestAmount);

      setStatus("signing");
      const signedXdr = await signTransaction(built.xdr, built.networkPassphrase);

      setStatus("submitting");
      const result = await submitMutation.mutateAsync({
        data: { signedXdr, networkPassphrase: built.networkPassphrase },
      });

      if (!result.success) {
        setError(result.error ?? "Transaction failed");
        setStatus("error");
        return;
      }

      setHash(result.hash ?? null);
      setStatus("success");
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
      setStatus("error");
    }
  };

  const isBusy = status === "building" || status === "signing" || status === "submitting";

  return (
    <div className="mt-2 rounded-2xl border bg-card p-4 space-y-3 max-w-sm">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-orbit-gradient flex items-center justify-center shrink-0">
          {action.type === "send" ? (
            <ArrowRight className="w-4 h-4 text-white" />
          ) : (
            <Wallet className="w-4 h-4 text-white" />
          )}
        </div>
        <div className="text-sm font-semibold">
          {action.type === "send" ? "Send Payment" : "Swap Assets"}
        </div>
      </div>

      <div className="text-sm space-y-1.5 text-muted-foreground">
        <div className="flex justify-between">
          <span>Amount</span>
          <span className="font-medium text-foreground">
            {action.sendAmount} {action.sendAsset}
          </span>
        </div>
        {action.type === "send" && action.destination && (
          <div className="flex justify-between gap-2">
            <span>To</span>
            <span className="font-mono text-xs text-foreground truncate max-w-[160px]" title={action.destination}>
              {action.destination.slice(0, 6)}...{action.destination.slice(-6)}
            </span>
          </div>
        )}
        {action.type === "swap" && action.destAsset && (
          <div className="flex justify-between">
            <span>Receive (est.)</span>
            <span className="font-medium text-foreground">
              {estimatedDest ? `~${parseFloat(estimatedDest).toFixed(4)}` : "~"} {action.destAsset}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Network</span>
          <span className="text-foreground">Stellar Mainnet</span>
        </div>
      </div>

      {status === "success" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
            <CheckCircle2 className="w-4 h-4" />
            Transaction submitted
          </div>
          {hash && (
            <a
              href={`https://stellar.expert/explorer/public/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              View on explorer <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      ) : status === "error" ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
          <Button size="sm" variant="outline" className="w-full rounded-xl" onClick={handleExecute}>
            Try again
          </Button>
        </div>
      ) : !isConnected ? (
        <Button
          size="sm"
          className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
          onClick={connect}
          disabled={connecting}
        >
          {connecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wallet className="w-4 h-4 mr-1" />}
          Connect Freighter to continue
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
          onClick={handleExecute}
          disabled={isBusy}
        >
          {isBusy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {status === "building"
            ? "Preparing transaction..."
            : status === "signing"
              ? "Confirm in Freighter..."
              : status === "submitting"
                ? "Submitting..."
                : "Sign with Freighter"}
        </Button>
      )}
    </div>
  );
}
