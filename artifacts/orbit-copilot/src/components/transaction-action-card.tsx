import { useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Sprout,
  Wallet,
  XCircle,
} from "lucide-react";
import { useBuildTransaction, useSubmitTransaction } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useFreighter } from "@/hooks/use-freighter";
import {
  STELDEX_FULL_RANGE,
  STELDEX_NETWORK_PASSPHRASE,
  buildAndSubmitSteldex,
  steldexDecimals,
  steldexExplorerTxUrl,
  toSteldexUnits,
  type SteldexWriteEndpoint,
} from "@/lib/steldex-submit";
import { track } from "@/lib/analytics";
import { actionConfidence, outcomeSummary } from "@/lib/action-confidence";

export interface ChatAction {
  type:
    | "send"
    | "swap"
    | "soroswap_swap"
    | "soroswap_add_liquidity"
    | "soroswap_remove_liquidity"
    | "steldex_swap"
    | "steldex_stake"
    | "steldex_claim"
    | "steldex_unstake"
    | "steldex_add_liquidity"
    | "steldex_remove_liquidity"
    | "steldex_limit_order"
    | "steldex_cancel_order"
    | "blend_supply"
    | "blend_withdraw"
    | "blend_borrow"
    | "blend_repay"
    | "predict_bet"
    | "perp_open";
  requestType?: number;
  sendAmount?: string;
  sendAsset?: string;
  destination?: string;
  destAsset?: string;
  poolContract?: string;
  pair?: string;
  amountB?: string;
  token0Contract?: string;
  token1Contract?: string;
  fromTokenContract?: string;
  toTokenContract?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  lockWeeks?: number;
  limitPrice?: string;
  orderType?: string;
  orderId?: string;
  amount0Min?: string;
  amount1Min?: string;
  positionId?: number;
  marketHint?: string;
  outcome?: string;
  side?: string;
  leverage?: number;
  marginUsdc?: string;
  stopLoss?: number;
  takeProfit?: number;
  entryPrice?: number;
  liquidationPrice?: number;
  notionalUsdc?: number;
  xdr?: string;
  networkPassphrase?: string;
}

type Status = "idle" | "building" | "signing" | "submitting" | "success" | "error";

function isSteldexAction(type: ChatAction["type"]) {
  return type.startsWith("steldex_");
}

function isSorobanAction(type: ChatAction["type"]) {
  return (
    type.startsWith("steldex_") ||
    type.startsWith("soroswap_") ||
    type.startsWith("blend_")
  );
}

function isOrbitNativeAction(type: ChatAction["type"]) {
  return type === "predict_bet" || type === "perp_open";
}

function actionTitle(action: ChatAction): string {
  switch (action.type) {
    case "send":
      return "Send Payment";
    case "swap":
      return "Swap (Classic DEX)";
    case "soroswap_swap":
      return "Soroswap Swap";
    case "soroswap_add_liquidity":
      return "Soroswap Add LP";
    case "soroswap_remove_liquidity":
      return "Soroswap Remove LP";
    case "blend_supply":
      return "Blend Supply";
    case "blend_withdraw":
      return "Blend Withdraw";
    case "blend_borrow":
      return "Blend Borrow";
    case "blend_repay":
      return "Blend Repay";
    case "predict_bet":
      return "Prediction Bet";
    case "perp_open":
      return "Open Perpetual";
    case "steldex_swap":
      return "StelDex Swap";
    case "steldex_add_liquidity":
      return "Add Liquidity";
    case "steldex_remove_liquidity":
      return "Remove Liquidity";
    case "steldex_stake":
      return "Stake LP";
    case "steldex_claim":
      return "Claim Rewards";
    case "steldex_unstake":
      return "Unstake LP";
    case "steldex_limit_order":
      return "Limit Order";
    case "steldex_cancel_order":
      return "Cancel Order";
  }
}

function steldexEndpoint(type: ChatAction["type"]): SteldexWriteEndpoint {
  switch (type) {
    case "steldex_swap":
      return "swap";
    case "steldex_add_liquidity":
      return "add-liquidity";
    case "steldex_remove_liquidity":
      return "remove-liquidity";
    case "steldex_stake":
      return "stake";
    case "steldex_claim":
      return "claim";
    case "steldex_unstake":
      return "unstake";
    case "steldex_limit_order":
      return "limit-order";
    case "steldex_cancel_order":
      return "cancel-order";
    default:
      throw new Error("Not a StelDex action");
  }
}

function buildSteldexBody(action: ChatAction): Record<string, unknown> {
  const tickLower = action.tickLower ?? STELDEX_FULL_RANGE.tickLower;
  const tickUpper = action.tickUpper ?? STELDEX_FULL_RANGE.tickUpper;

  switch (action.type) {
    case "steldex_swap": {
      const from = action.fromTokenContract ?? action.token0Contract;
      const to = action.toTokenContract ?? action.token1Contract;
      if (!from || !to || !action.sendAmount || !action.sendAsset) {
        throw new Error("Missing swap details");
      }
      return {
        fromTokenContract: from,
        toTokenContract: to,
        amountIn: toSteldexUnits(action.sendAmount, steldexDecimals(action.sendAsset)),
        slippageBps: 50,
      };
    }
    case "steldex_add_liquidity": {
      if (
        !action.poolContract ||
        !action.token0Contract ||
        !action.token1Contract ||
        !action.sendAmount ||
        !action.amountB ||
        !action.sendAsset ||
        !action.destAsset
      ) {
        throw new Error("Missing liquidity details");
      }
      return {
        poolContract: action.poolContract,
        token0Contract: action.token0Contract,
        token1Contract: action.token1Contract,
        tickLower,
        tickUpper,
        amount0Desired: toSteldexUnits(action.sendAmount, steldexDecimals(action.sendAsset)),
        amount1Desired: toSteldexUnits(action.amountB, steldexDecimals(action.destAsset)),
      };
    }
    case "steldex_remove_liquidity": {
      if (!action.poolContract || !action.liquidity) {
        throw new Error("Missing remove-liquidity details");
      }
      return {
        poolContract: action.poolContract,
        tickLower,
        tickUpper,
        liquidity: action.liquidity,
        amount0Min: action.amount0Min ?? "0",
        amount1Min: action.amount1Min ?? "0",
      };
    }
    case "steldex_stake": {
      if (!action.poolContract) throw new Error("Missing pool");
      return {
        poolContract: action.poolContract,
        tickLower,
        tickUpper,
        stakeMax: true,
        lockWeeks: action.lockWeeks ?? 52,
        autoCompound: false,
      };
    }
    case "steldex_claim": {
      if (!action.poolContract) throw new Error("Missing pool");
      return { poolContract: action.poolContract, tickLower, tickUpper };
    }
    case "steldex_unstake": {
      if (!action.poolContract) throw new Error("Missing pool");
      return {
        poolContract: action.poolContract,
        tickLower,
        tickUpper,
        unstakeMax: true,
      };
    }
    case "steldex_limit_order": {
      const from = action.fromTokenContract ?? action.token0Contract;
      const to = action.toTokenContract ?? action.token1Contract;
      if (!from || !to || !action.sendAmount || !action.sendAsset || !action.limitPrice) {
        throw new Error("Missing limit-order details");
      }
      return {
        fromContract: from,
        toContract: to,
        amount: toSteldexUnits(action.sendAmount, steldexDecimals(action.sendAsset)),
        limitPrice: action.limitPrice,
        orderType: action.orderType ?? "Limit",
        expiryHours: 72,
      };
    }
    case "steldex_cancel_order": {
      if (!action.orderId) throw new Error("Missing order id");
      return { orderId: action.orderId };
    }
    default:
      throw new Error("Unsupported StelDex action");
  }
}

export function TransactionActionCard({
  action,
  beforeIdle,
  onOutcome,
}: {
  action: ChatAction;
  /** Snapshot of idle capital before this action (for outcome copy). */
  beforeIdle?: string | null;
  onOutcome?: (info: { hash: string | null; summary: string }) => void;
}) {
  const { isConnected, publicKey, connect, connecting, signTransaction } = useFreighter();
  const buildMutation = useBuildTransaction();
  const submitMutation = useSubmitTransaction();

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [estimatedDest, setEstimatedDest] = useState<string | null>(null);
  const [outcomeLine, setOutcomeLine] = useState<string | null>(null);
  const trackedStatus = useRef<Status>("idle");
  const confidence = actionConfidence(action);

  useEffect(() => {
    if (trackedStatus.current === status) return;
    trackedStatus.current = status;
    if (status === "signing") {
      track("tx_sign", {
        walletPublicKey: publicKey,
        metadata: { actionType: action.type },
      });
    } else if (status === "success") {
      track("tx_submit", {
        walletPublicKey: publicKey,
        metadata: { actionType: action.type, txHash: hash },
      });
      const summary = outcomeSummary(action);
      setOutcomeLine(summary);
      if (publicKey) {
        void fetch("/api/portfolio/outcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey,
            summary,
            txHash: hash,
            beforeIdle: beforeIdle ?? null,
            afterNote: "Portfolio cache refreshed — ask what's earning to verify on-chain.",
          }),
        }).catch(() => {});
      }
      onOutcome?.({ hash, summary });
    } else if (status === "error") {
      track("error", {
        walletPublicKey: publicKey,
        metadata: { source: "tx", actionType: action.type, message: error },
      });
    }
  }, [status, publicKey, action.type, hash, error, action, beforeIdle, onOutcome]);

  const handleExecute = async () => {
    if (!publicKey) return;
    setError(null);
    setProgress(null);
    setStatus("building");
    try {
      // Orbit-native prediction / perps — Soroban contract invoke (RPC submit)
      if (isOrbitNativeAction(action.type)) {
        if (!action.xdr) {
          throw new Error("Missing prepared contract transaction");
        }
        setStatus("signing");
        setProgress("Sign in Freighter…");
        const signedXdr = await signTransaction(
          action.xdr,
          action.networkPassphrase || STELDEX_NETWORK_PASSPHRASE
        );
        setStatus("submitting");
        setProgress("Submitting to Soroban…");
        const { submitSignedToSoroban } = await import("@/lib/steldex-submit");
        const txHash = await submitSignedToSoroban(signedXdr);
        setHash(txHash);
        setStatus("success");
        return;
      }

      if (action.type.startsWith("soroswap_") || action.type.startsWith("blend_")) {
        let endpoint = "";
        let body: Record<string, unknown> = { walletAddress: publicKey };

        if (action.type === "soroswap_swap") {
          if (!action.sendAmount || !action.sendAsset || !action.destAsset) {
            throw new Error("Missing swap details");
          }
          endpoint = "/api/soroswap/swap";
          body = {
            ...body,
            fromSymbol: action.sendAsset,
            toSymbol: action.destAsset,
            amount: action.sendAmount,
          };
        } else if (action.type === "soroswap_add_liquidity") {
          endpoint = "/api/soroswap/add-liquidity";
          body = {
            ...body,
            symbolA: action.sendAsset,
            symbolB: action.destAsset,
            amountA: action.sendAmount,
            amountB: action.amountB,
          };
        } else if (action.type === "soroswap_remove_liquidity") {
          endpoint = "/api/soroswap/remove-liquidity";
          body = {
            ...body,
            symbolA: action.sendAsset,
            symbolB: action.destAsset,
            liquidity: action.liquidity,
          };
        } else {
          // blend_*
          const blendAction = action.type.replace("blend_", "");
          endpoint = "/api/blend/build";
          body = {
            ...body,
            action: blendAction,
            symbol: action.sendAsset,
            amount: action.sendAmount,
          };
        }

        setProgress("Preparing transaction…");
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!data.xdr) throw new Error("No XDR returned");
        if (data.amountOutHuman) setEstimatedDest(data.amountOutHuman);

        setStatus("signing");
        setProgress("Sign in Freighter…");
        const signedXdr = await signTransaction(
          data.xdr,
          data.networkPassphrase || STELDEX_NETWORK_PASSPHRASE
        );

        setStatus("submitting");
        setProgress("Submitting to Soroban…");
        const { submitSignedToSoroban } = await import("@/lib/steldex-submit");
        const txHash = await submitSignedToSoroban(signedXdr);
        setHash(txHash);
        setStatus("success");
        return;
      }

      if (isSteldexAction(action.type)) {
        const body = buildSteldexBody(action);
        const endpoint = steldexEndpoint(action.type);

        const txHash = await buildAndSubmitSteldex(
          endpoint,
          body,
          publicKey,
          async (xdr) => {
            setStatus("signing");
            return signTransaction(xdr, STELDEX_NETWORK_PASSPHRASE);
          },
          (msg) => {
            setProgress(msg);
            if (msg.startsWith("Sign")) setStatus("signing");
            else if (msg.startsWith("Submitting")) setStatus("submitting");
            else setStatus("building");
          }
        );

        setHash(txHash);
        setStatus("success");
        return;
      }

      if (!action.sendAmount || !action.sendAsset) {
        throw new Error("Missing transaction details");
      }
      const built = await buildMutation.mutateAsync({
        data: {
          type: action.type as "send" | "swap",
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
          ) : isSorobanAction(action.type) ? (
            <Sprout className="w-4 h-4 text-white" />
          ) : (
            <Wallet className="w-4 h-4 text-white" />
          )}
        </div>
        <div className="text-sm font-semibold">{actionTitle(action)}</div>
      </div>

      <div className="text-sm space-y-1.5 text-muted-foreground">
        {action.sendAmount && action.sendAsset && action.type !== "steldex_remove_liquidity" && (
          <div className="flex justify-between">
            <span>{action.type === "steldex_add_liquidity" ? "Token A" : "Amount"}</span>
            <span className="font-medium text-foreground">
              {action.sendAmount} {action.sendAsset}
            </span>
          </div>
        )}
        {action.type === "steldex_add_liquidity" && action.amountB && action.destAsset && (
          <div className="flex justify-between">
            <span>Token B</span>
            <span className="font-medium text-foreground">
              {action.amountB} {action.destAsset}
            </span>
          </div>
        )}
        {action.type === "steldex_remove_liquidity" && action.liquidity && (
          <div className="flex justify-between">
            <span>LP liquidity</span>
            <span className="font-mono text-xs text-foreground truncate max-w-[160px]">
              {action.liquidity}
            </span>
          </div>
        )}
        {action.type === "steldex_stake" && (
          <div className="flex justify-between">
            <span>Lock</span>
            <span className="font-medium text-foreground">{action.lockWeeks ?? 52} weeks</span>
          </div>
        )}
        {action.type === "send" && action.destination && (
          <div className="flex justify-between gap-2">
            <span>To</span>
            <span
              className="font-mono text-xs text-foreground truncate max-w-[160px]"
              title={action.destination}
            >
              {action.destination.slice(0, 6)}...{action.destination.slice(-6)}
            </span>
          </div>
        )}
        {(action.type === "swap" ||
          action.type === "steldex_swap" ||
          action.type === "soroswap_swap") &&
          action.destAsset && (
          <div className="flex justify-between">
            <span>Receive (est.)</span>
            <span className="font-medium text-foreground">
              {estimatedDest ? `~${parseFloat(estimatedDest).toFixed(4)}` : "~"} {action.destAsset}
            </span>
          </div>
        )}
        {action.pair && (
          <div className="flex justify-between">
            <span>Pool</span>
            <span className="font-medium text-foreground">{action.pair}</span>
          </div>
        )}
        {action.orderId && (
          <div className="flex justify-between">
            <span>Order</span>
            <span className="font-medium text-foreground">#{action.orderId}</span>
          </div>
        )}
        {action.type === "predict_bet" && action.outcome && (
          <div className="flex justify-between">
            <span>Outcome</span>
            <span className="font-medium text-foreground">{action.outcome.toUpperCase()}</span>
          </div>
        )}
        {action.type === "predict_bet" && action.marketHint && (
          <div className="flex justify-between">
            <span>Market</span>
            <span className="font-medium text-foreground">{action.marketHint}</span>
          </div>
        )}
        {action.type === "perp_open" && (
          <>
            <div className="flex justify-between">
              <span>Side</span>
              <span className="font-medium text-foreground">
                {action.side?.toUpperCase()} {action.marketHint} {action.leverage}x
              </span>
            </div>
            {action.entryPrice != null && (
              <div className="flex justify-between">
                <span>Entry</span>
                <span className="font-medium text-foreground">${action.entryPrice.toFixed(2)}</span>
              </div>
            )}
            {action.liquidationPrice != null && (
              <div className="flex justify-between">
                <span>Liq</span>
                <span className="font-medium text-foreground">
                  ${action.liquidationPrice.toFixed(2)}
                </span>
              </div>
            )}
            {action.stopLoss != null && (
              <div className="flex justify-between">
                <span>SL</span>
                <span className="font-medium text-foreground">${action.stopLoss}</span>
              </div>
            )}
            {action.takeProfit != null && (
              <div className="flex justify-between">
                <span>TP</span>
                <span className="font-medium text-foreground">${action.takeProfit}</span>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between">
          <span>Network</span>
          <span className="text-foreground">Stellar Testnet</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Protocol</span>
          <span className="font-medium text-foreground text-right">{confidence.protocol}</span>
        </div>
      </div>

      {status !== "success" && status !== "error" && (
        <div className="rounded-xl bg-orbit-gradient-subtle px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-primary/10">
          <p className="mb-1.5 font-medium text-foreground">Before you sign</p>
          <p className="mb-1.5 text-foreground/80">{confidence.walletScope}</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {confidence.risks.slice(0, 4).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {status === "success" ? (
        <div className="space-y-2 rounded-xl border border-primary/20 bg-orbit-gradient-subtle p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-500">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Done on-chain
          </div>
          {outcomeLine && (
            <p className="text-sm text-foreground">{outcomeLine}</p>
          )}
          {beforeIdle && (
            <p className="text-xs text-muted-foreground">
              Before: idle {beforeIdle}. Ask “What&apos;s earning?” to see the updated position book.
            </p>
          )}
          {hash && (
            <a
              href={steldexExplorerTxUrl(hash)}
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
          {connecting ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Wallet className="w-4 h-4 mr-1" />
          )}
          Connect Freighter (Testnet)
        </Button>
      ) : (
        <div className="space-y-2">
          <Button
            size="sm"
            className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
            onClick={handleExecute}
            disabled={isBusy}
          >
            {isBusy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {status === "building"
              ? progress ?? "Preparing…"
              : status === "signing"
                ? progress ?? "Confirm in Freighter…"
                : status === "submitting"
                  ? progress ?? "Submitting to Soroban…"
                  : "Sign with Freighter"}
          </Button>
          {isBusy && progress && (
            <p className="text-[11px] text-muted-foreground text-center">{progress}</p>
          )}
        </div>
      )}
    </div>
  );
}
