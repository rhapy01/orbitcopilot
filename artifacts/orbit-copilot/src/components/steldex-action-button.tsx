import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFreighter } from "@/hooks/use-freighter";
import { submitSignedToSoroban, STELDEX_NETWORK_PASSPHRASE } from "@/hooks/use-soroban";
import type { SteldexTxResult, SteldexTxStep } from "@workspace/api-client-react";

type Status = "idle" | "connecting" | "building" | "signing" | "submitting" | "success" | "error";

interface SteldexActionButtonProps {
  label: string;
  busyLabel?: string;
  className?: string;
  size?: "sm" | "default";
  build: (stepId?: string) => Promise<SteldexTxResult>;
  onSuccess?: () => void;
}

export function SteldexActionButton({
  label,
  busyLabel,
  className,
  size = "sm",
  build,
  onSuccess,
}: SteldexActionButtonProps) {
  const { isConnected, connect, connecting, signTransaction } = useFreighter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [resting, setResting] = useState(false);

  const run = async () => {
    setError(null);
    setResting(false);
    try {
      if (!isConnected) {
        setStatus("connecting");
        await connect();
      }

      setStatus("building");
      const result = await build();

      if (result.resting) {
        setResting(true);
        setStatus("success");
        return;
      }

      const steps: SteldexTxStep[] =
        result.steps && result.steps.length > 0
          ? result.steps
          : result.xdr
            ? [{ id: "tx", xdr: result.xdr }]
            : [];

      if (steps.length === 0) throw new Error("StelDex did not return a transaction to sign");

      let lastHash = "";
      for (const step of steps) {
        let xdr = step.xdr;
        if (!xdr && result.sequential && step.id) {
          setStatus("building");
          const stepResult = await build(step.id);
          xdr = stepResult.xdr;
        }
        if (!xdr) throw new Error(`StelDex did not return a transaction for step "${step.id}"`);

        setStatus("signing");
        const signed = await signTransaction(xdr, STELDEX_NETWORK_PASSPHRASE);

        setStatus("submitting");
        lastHash = await submitSignedToSoroban(signed);
      }

      setHash(lastHash);
      setStatus("success");
      onSuccess?.();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
      setStatus("error");
    }
  };

  const isBusy = status === "connecting" || status === "building" || status === "signing" || status === "submitting";

  if (status === "success") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {resting ? "Order placed on-chain" : "Confirmed on-chain"}
        </div>
        {hash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            View on explorer <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-start gap-1.5 text-xs text-destructive">
          <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
        <Button size={size} variant="outline" className={className} onClick={run}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <Button size={size} className={className} onClick={run} disabled={isBusy}>
      {isBusy && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
      {!isBusy && !isConnected && <Wallet className="w-3.5 h-3.5 mr-1.5" />}
      {isBusy
        ? status === "connecting"
          ? "Connecting Freighter..."
          : status === "building"
            ? "Preparing..."
            : status === "signing"
              ? "Confirm in Freighter..."
              : "Submitting..."
        : !isConnected
          ? "Connect & " + label
          : (busyLabel ?? label)}
    </Button>
  );
}
