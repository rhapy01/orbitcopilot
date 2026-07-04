import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowUp, Plus, Loader2, Sparkles } from "lucide-react";
import { TransactionActionCard, type ChatAction } from "@/components/transaction-action-card";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { IdleCoach, idleSnapshot } from "@/components/idle-coach";
import { useFreighter } from "@/hooks/use-freighter";
import { Layout, type SidebarAction } from "@/components/layout";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  { label: "What's earning?", prompt: "What's earning?" },
  { label: "Rebalance", prompt: "Rebalance my positions" },
  { label: "Portfolio", prompt: "What's in my portfolio?" },
];

function looksLikeIntent(text: string): boolean {
  return /\b(earn|idle|rebalance|supply|liquidity|fund|stake|deploy|portfolio)\b/i.test(
    text
  );
}

type ChatMessage = {
  id: number;
  role: string;
  content: string;
  metadata?: { action?: ChatAction } | null;
  createdAt: string;
};

async function fetchMessages(wallet: string | null): Promise<ChatMessage[]> {
  const url = wallet
    ? `/api/chat/messages?wallet=${encodeURIComponent(wallet)}`
    : `/api/chat/messages`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Chat history unavailable (Postgres)");
  }
  return res.json();
}

async function fetchRecentTitle(wallet: string | null): Promise<string | null> {
  const url = wallet
    ? `/api/chat/sessions?wallet=${encodeURIComponent(wallet)}`
    : `/api/chat/sessions`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const sessions = (await res.json()) as { title?: string }[];
  return sessions[0]?.title ?? null;
}

function mergeMessages(...lists: ChatMessage[][]): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const list of lists) {
    for (const msg of list) map.set(msg.id, msg);
  }
  return [...map.values()].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });
}

export default function ChatPage() {
  const queryClient = useQueryClient();
  const { publicKey, isConnected } = useFreighter();
  const chatKey = ["chat-messages", publicKey ?? "anon"] as const;
  const coachKey = ["portfolio-coach", publicKey ?? "anon"] as const;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([]);
  const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
  const [input, setInput] = useState("");
  const [beforeIdle, setBeforeIdle] = useState<string | null>(null);

  const { data: coach } = useQuery({
    queryKey: coachKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/portfolio/coach?publicKey=${encodeURIComponent(publicKey!)}`
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(publicKey),
    staleTime: 15_000,
  });

  useEffect(() => {
    setBeforeIdle(idleSnapshot(coach ?? undefined));
  }, [coach]);

  const {
    data: serverMessages = [],
    isLoading,
    isError: historyError,
    error: historyErr,
  } = useQuery({
    queryKey: chatKey,
    queryFn: () => fetchMessages(publicKey),
    retry: 1,
  });

  const { data: sessionTitle } = useQuery({
    queryKey: ["chat-sessions", publicKey ?? "anon"],
    queryFn: () => fetchRecentTitle(publicKey),
    retry: 1,
  });

  useEffect(() => {
    setSessionMessages([]);
    setPendingUser(null);
  }, [publicKey]);

  const messages = useMemo(
    () =>
      mergeMessages(
        serverMessages,
        sessionMessages,
        pendingUser ? [pendingUser] : []
      ),
    [serverMessages, sessionMessages, pendingUser]
  );

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, context: publicKey ?? null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Send failed");
      }
      return res.json() as Promise<ChatMessage>;
    },
    onMutate: (content) => {
      const temp: ChatMessage = {
        id: -Date.now(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setPendingUser(temp);
      return { tempId: temp.id, content };
    },
    onSuccess: (aiMessage, content, ctx) => {
      track("chat_send", {
        walletPublicKey: publicKey,
        metadata: { length: content.length },
      });
      if (publicKey && looksLikeIntent(content)) {
        void fetch("/api/portfolio/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey, intent: content }),
        }).catch(() => {});
      }
      const userMessage: ChatMessage = {
        id: ctx?.tempId ?? -Date.now(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setSessionMessages((prev) => mergeMessages(prev, [userMessage, aiMessage]));
      setPendingUser(null);
      queryClient.invalidateQueries({ queryKey: chatKey });
      queryClient.invalidateQueries({
        queryKey: ["chat-sessions", publicKey ?? "anon"],
      });
      queryClient.invalidateQueries({ queryKey: coachKey });
    },
    onError: (err) => {
      setPendingUser(null);
      track("error", {
        walletPublicKey: publicKey,
        metadata: {
          source: "chat_send",
          message: err instanceof Error ? err.message : "send failed",
        },
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/chat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: publicKey ?? null }),
      });
      if (!res.ok) throw new Error("Clear failed");
      return res.json();
    },
    onSuccess: () => {
      track("chat_clear", { walletPublicKey: publicKey });
      setSessionMessages([]);
      setPendingUser(null);
      queryClient.setQueryData(chatKey, []);
      queryClient.invalidateQueries({ queryKey: chatKey });
      queryClient.invalidateQueries({
        queryKey: ["chat-sessions", publicKey ?? "anon"],
      });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMutation.isPending]);

  const handleSend = useCallback(
    (content: string) => {
      const text = content.trim();
      if (!text || sendMutation.isPending) return;
      setInput("");
      sendMutation.mutate(text);
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    },
    [sendMutation]
  );

  const onTxOutcome = useCallback(
    (_info: { hash: string | null; summary: string }) => {
      queryClient.invalidateQueries({ queryKey: coachKey });
      // Nudge user to verify earning state on-chain
      setTimeout(() => {
        handleSend("What's earning?");
      }, 400);
    },
    [queryClient, coachKey, handleSend]
  );

  const onSidebarAction = useCallback(
    (action: SidebarAction) => {
      if (action.type === "new-chat") {
        clearMutation.mutate();
        return;
      }
      if (action.type === "focus-input") {
        inputRef.current?.focus();
        return;
      }
      if (action.type === "prompt") {
        handleSend(action.prompt);
      }
    },
    [clearMutation, handleSend]
  );

  const recentTitle =
    sessionTitle ??
    messages.find((m) => m.role === "user")?.content.slice(0, 48) ??
    null;

  const isEmpty =
    !isLoading &&
    !historyError &&
    messages.length === 0 &&
    !sendMutation.isPending;

  const composer = (
    <div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="relative flex items-end gap-1.5 rounded-[26px] border border-primary/15 bg-card px-2 py-1.5 shadow-md shadow-primary/5 ring-1 ring-primary/10 sm:gap-2 sm:rounded-[28px] sm:px-3 sm:py-2"
      >
        <button
          type="button"
          className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10 sm:mb-1.5"
          aria-label="Attach"
        >
          <Plus className="h-5 w-5" />
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(input);
            }
          }}
          placeholder="Ask anything"
          rows={1}
          disabled={sendMutation.isPending}
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 text-foreground outline-none placeholder:text-muted-foreground sm:min-h-[44px] sm:py-2.5 sm:text-[15px]"
        />
        <button
          type="submit"
          disabled={!input.trim() || sendMutation.isPending}
          className={cn(
            "mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity sm:mb-1.5",
            input.trim() && !sendMutation.isPending
              ? "bg-orbit-gradient text-white shadow-sm hover:opacity-90"
              : "bg-muted text-muted-foreground"
          )}
          aria-label="Send"
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </form>
      <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
        Orbit can make mistakes. Review transactions before signing.
      </p>
    </div>
  );

  return (
    <Layout onSidebarAction={onSidebarAction} recentTitle={recentTitle}>
      {historyError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-sm text-destructive">
            {(historyErr as Error)?.message ??
              "Chat requires Postgres (DATABASE_URL)."}
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            Start the data plane locally with{" "}
            <code className="rounded bg-muted px-1">docker compose up -d</code>,
            or set DATABASE_URL and REDIS_URL in production.
          </p>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto bg-orbit-gradient-subtle px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-8">
          {isConnected && publicKey ? (
            <div className="mb-4 w-full px-1">
              <IdleCoach publicKey={publicKey} onAction={handleSend} />
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-col items-center px-2 text-center sm:mb-8">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orbit-gradient shadow-lg shadow-primary/25 sm:h-14 sm:w-14">
                  <Sparkles className="h-6 w-6 text-white sm:h-7 sm:w-7" />
                </div>
                <h1 className="text-[22px] font-semibold tracking-tight sm:text-[28px]">
                  <span className="text-orbit-gradient">Put idle capital to work</span>
                </h1>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Connect Freighter on Testnet. Orbit shows what&apos;s idle and one move to start earning on-chain.
                </p>
              </div>
              <div className="mb-4 w-full max-w-md px-1">
                <OnboardingChecklist
                  hasChatted={messages.length > 0}
                  onFund={() => handleSend("Fund my wallet")}
                />
              </div>
            </>
          )}
          <div className="w-full max-w-3xl">{composer}</div>
          <div className="mt-3 flex w-full max-w-3xl flex-wrap items-center justify-center gap-2 px-3 sm:px-4">
            {QUICK_ACTIONS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleSend(item.prompt)}
                className="rounded-full border border-primary/20 bg-card px-3 py-1.5 text-xs text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary sm:px-4 sm:py-2 sm:text-sm"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6">
              {isLoading && messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-primary/10" />
                  <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-orbit-gradient-subtle ring-1 ring-primary/20" />
                </div>
              ) : (
                messages.map((msg) => {
                  const action = msg.metadata?.action ?? null;
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex w-full flex-col", isUser ? "items-end" : "items-start")}
                    >
                      {!isUser && (
                        <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-orbit-gradient">
                          <Sparkles className="h-3.5 w-3.5 text-white" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[92%] whitespace-pre-wrap break-words text-[15px] leading-7 sm:max-w-[75%]",
                          isUser
                            ? "rounded-[22px] bg-orbit-gradient px-3.5 py-2.5 text-white shadow-md shadow-primary/20 sm:px-4"
                            : "rounded-2xl bg-card px-3.5 py-3 text-foreground ring-1 ring-primary/10 sm:px-4"
                        )}
                      >
                        {msg.content}
                      </div>
                      {action && (
                        <div className="mt-2 w-full max-w-sm">
                          <TransactionActionCard
                            action={action}
                            beforeIdle={beforeIdle}
                            onOutcome={onTxOutcome}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {sendMutation.isPending && (
                <div className="flex items-center gap-2 px-1 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orbit-gradient">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-chart-5 [animation-delay:300ms]" />
                </div>
              )}

              {sendMutation.isError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {(sendMutation.error as Error)?.message ?? "Something went wrong. Try again."}
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0 bg-background/80 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-sm">
            {composer}
          </div>
        </>
      )}
    </Layout>
  );
}
