import { useEffect, useState } from "react";
import { Check, Circle, Wallet, Droplets, MessageCircle } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "orbit-onboarding-v1";

type Steps = {
  connect: boolean;
  fund: boolean;
  chat: boolean;
};

function loadSteps(): Steps {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { connect: false, fund: false, chat: false };
    return { connect: false, fund: false, chat: false, ...JSON.parse(raw) };
  } catch {
    return { connect: false, fund: false, chat: false };
  }
}

function saveSteps(steps: Steps) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(steps));
}

export function OnboardingChecklist({
  hasChatted,
  onFund,
}: {
  hasChatted: boolean;
  onFund?: () => void;
}) {
  const { isConnected, publicKey, openConnectModal, connecting } = useWallet();
  const [steps, setSteps] = useState<Steps>(() =>
    typeof window !== "undefined"
      ? loadSteps()
      : { connect: false, fund: false, chat: false }
  );
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("orbit-onboarding-dismissed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isConnected && publicKey && !steps.connect) {
      const next = { ...steps, connect: true };
      setSteps(next);
      saveSteps(next);
      track("onboarding_step", {
        walletPublicKey: publicKey,
        metadata: { step: "connect" },
      });
    }
  }, [isConnected, publicKey, steps]);

  useEffect(() => {
    if (hasChatted && !steps.chat) {
      const next = { ...steps, chat: true };
      setSteps(next);
      saveSteps(next);
      track("onboarding_step", {
        walletPublicKey: publicKey,
        metadata: { step: "chat" },
      });
    }
  }, [hasChatted, steps, publicKey]);

  async function handleFund() {
    if (!publicKey || funding) return;
    setFunding(true);
    setFundError(null);
    try {
      const res = await fetch("/api/friendbot/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setFundError(data.message || data.error || "Friendbot funding failed");
        onFund?.();
        return;
      }
      const next = { ...steps, fund: true };
      setSteps(next);
      saveSteps(next);
      track("onboarding_step", {
        walletPublicKey: publicKey,
        metadata: { step: "fund" },
      });
    } catch (err: any) {
      setFundError(err?.message ?? "Friendbot funding failed");
      onFund?.();
    } finally {
      setFunding(false);
    }
  }

  if (dismissed) return null;

  const items = [
    {
      key: "connect" as const,
      label: "Connect your wallet",
      done: steps.connect || isConnected,
      icon: Wallet,
      action: !isConnected ? (
        <button
          type="button"
          onClick={openConnectModal}
          disabled={connecting}
          className="text-xs font-medium text-primary hover:underline"
        >
          {connecting ? "Connecting…" : "Connect"}
        </button>
      ) : null,
    },
    {
      key: "fund" as const,
      label: "Fund wallet (Friendbot)",
      done: steps.fund,
      icon: Droplets,
      action: (
        <button
          type="button"
          onClick={handleFund}
          disabled={!publicKey || funding}
          className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
        >
          {funding ? "Funding…" : "Fund"}
        </button>
      ),
    },
    {
      key: "chat" as const,
      label: "Ask Orbit anything",
      done: steps.chat || hasChatted,
      icon: MessageCircle,
      action: null,
    },
  ];

  const allDone = items.every((i) => i.done);

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-primary/15 bg-card/80 p-4 shadow-sm ring-1 ring-primary/10">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Get started</p>
          <p className="text-xs text-muted-foreground">
            Three steps to your first on-chain action
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("orbit-onboarding-dismissed", "1");
            setDismissed(true);
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {allDone ? "Done" : "Skip"}
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-3 rounded-xl px-2 py-1.5"
          >
            {item.done ? (
              <Check className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <item.icon
              className={cn(
                "h-4 w-4 shrink-0",
                item.done ? "text-primary" : "text-muted-foreground"
              )}
            />
            <span
              className={cn(
                "flex-1 text-sm",
                item.done && "text-muted-foreground line-through"
              )}
            >
              {item.label}
            </span>
            {!item.done && item.action}
          </li>
        ))}
      </ul>
      {fundError && (
        <p className="mt-2 text-[11px] text-destructive">{fundError}</p>
      )}
    </div>
  );
}
