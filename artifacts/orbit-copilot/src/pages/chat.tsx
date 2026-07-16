import {
 useState,
 useRef,
 useEffect,
 useCallback,
 useMemo,
} from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowUp, Loader2, Sparkles, TrendingUp, Repeat2, LayoutDashboard, RotateCcw, Coins } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TransactionActionCard, type ChatAction } from "@/components/transaction-action-card";
import { NftGallery, type NftGalleryPayload } from "@/components/nft-gallery";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { useWallet } from "@/hooks/use-wallet";
import { Layout, type SidebarAction } from "@/components/layout";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const BETA_CLAIM_PROMPT =
 "i have submitted my feedback, mint my beta tester nft";

/** Keep the empty state light on mobile - a few high-signal demos only. */
const QUICK_ACTIONS = [
 { label: "What's earning?", prompt: "What's earning?", icon: TrendingUp },
 { label: "List sports markets", prompt: "list sports markets", icon: Sparkles },
 { label: "Swap XLM → pUSDC", prompt: "Swap 10 XLM to pUSDC", icon: Repeat2 },
 { label: "Get testnet USDC", prompt: "faucet USDC", icon: Coins },
 {
 label: "Claim beta NFT",
 prompt: BETA_CLAIM_PROMPT,
 icon: Sparkles,
 betaClaim: true,
 },
 { label: "Portfolio", prompt: "What's in my portfolio?", icon: LayoutDashboard },
  { label: "Deposit DeFindex", prompt: "deposit 10 XLM into defindex", icon: Sparkles },
];

function looksLikeIntent(text: string): boolean {
 return /\b(earn|idle|rebalance|supply|liquidity|fund|stake|deploy|portfolio|nft|predict|perp|mint|swap|defi|cefi|impermanent|health|apr|apy|explain)\b/i.test(
 text
 );
}

function isConnectWalletIntent(text: string): boolean {
 const lower = text.toLowerCase();
 return (
 /\bconnect\b(?:\s+my)?\s+wallet\b/.test(lower) ||
 /\bconnect\b.*\bfreighter\b/.test(lower) ||
 /\blink\b(?:\s+my)?\s+wallet\b/.test(lower)
 );
}

type ChatMessage = {
 id: number;
 role: string;
 content: string;
 metadata?: {
 action?: ChatAction;
 actions?: ChatAction[];
 gallery?: NftGalleryPayload;
 } | null;
 createdAt: string;
};

type ChatSession = {
 id: number;
 title: string;
 updatedAt: string;
 createdAt: string;
};

function sessionStorageKey(wallet: string | null): string {
 return `orbit-active-session-${wallet ?? "anon"}`;
}

function readStoredSessionId(wallet: string | null): number | null {
 try {
 const raw = sessionStorage.getItem(sessionStorageKey(wallet));
 if (!raw) return null;
 const id = parseInt(raw, 10);
 return Number.isFinite(id) && id > 0 ? id : null;
 } catch {
 return null;
 }
}

function storeSessionId(wallet: string | null, sessionId: number | null): void {
 try {
 const key = sessionStorageKey(wallet);
 if (sessionId == null) sessionStorage.removeItem(key);
 else sessionStorage.setItem(key, String(sessionId));
 } catch {
 /* ignore */
 }
}

async function fetchMessages(
 sessionId: number | null,
 wallet: string | null
): Promise<ChatMessage[]> {
 if (!sessionId) return [];
 const params = new URLSearchParams({
 sessionId: String(sessionId),
 });
 if (wallet) params.set("wallet", wallet);
 const res = await fetch(`/api/chat/messages?${params}`);
 if (res.status === 403 || res.status === 404) {
 // Session belongs to a different wallet - treat as empty
 return [];
 }
 if (!res.ok) {
 const err = await res.json().catch(() => ({}));
 throw new Error(err.error || "Chat history unavailable (Postgres)");
 }
 return res.json();
}

async function fetchSessions(wallet: string | null): Promise<ChatSession[]> {
 const url = wallet
 ? `/api/chat/sessions?wallet=${encodeURIComponent(wallet)}`
 : `/api/chat/sessions`;
 const res = await fetch(url);
 if (!res.ok) return [];
 return res.json();
}


function sortMessages(list: ChatMessage[]): ChatMessage[] {
 return [...list].sort((a, b) => {
 const ta = Date.parse(a.createdAt);
 const tb = Date.parse(b.createdAt);
 if (ta !== tb) return ta - tb;
 return a.id - b.id;
 });
}

/** Drop duplicate user bubbles (optimistic id vs server id for same text). */
function dedupeMessages(list: ChatMessage[]): ChatMessage[] {
 const sorted = sortMessages(list);
 const out: ChatMessage[] = [];
 for (const msg of sorted) {
 const prev = out[out.length - 1];
 if (
 prev &&
 prev.role === "user" &&
 msg.role === "user" &&
 prev.content.trim() === msg.content.trim()
 ) {
 if (msg.id > 0 && prev.id <= 0) out[out.length - 1] = msg;
 continue;
 }
 out.push(msg);
 }
 return out;
}

export default function ChatPage() {
 const queryClient = useQueryClient();
 const { publicKey, isConnected, openConnectModal, connecting } = useWallet();
 const [activeSessionId, setActiveSessionId] = useState<number | null>(() =>
 readStoredSessionId(publicKey)
 );
 const chatKey = [
 "chat-messages",
 publicKey ?? "anon",
 activeSessionId ?? "none",
 ] as const;
 const sessionsKey = ["chat-sessions", publicKey ?? "anon"] as const;
 const inputRef = useRef<HTMLTextAreaElement>(null);
 const scrollRef = useRef<HTMLDivElement>(null);
 const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
 const [lessonMessages, setLessonMessages] = useState<ChatMessage[]>([]);
 const [input, setInput] = useState("");

 const { data: sessions = [] } = useQuery({
 queryKey: sessionsKey,
 queryFn: () => fetchSessions(publicKey),
 retry: 1,
 });

 useEffect(() => {
 if (sessions.length === 0) return;
 const stored = readStoredSessionId(publicKey);
 // Only restore if there's an explicitly stored session - never auto-pick latest
 if (stored && sessions.some((s) => s.id === stored)) {
 setActiveSessionId(stored);
 }
 }, [publicKey, sessions]);

 const selectSession = useCallback(
 (sessionId: number | null) => {
 setActiveSessionId(sessionId);
 storeSessionId(publicKey, sessionId);
 setPendingUser(null);
 setLessonMessages([]);
 },
 [publicKey]
 );

 const {
 data: serverMessages = [],
 isLoading,
 isError: historyError,
 error: historyErr,
 } = useQuery({
 queryKey: chatKey,
 queryFn: () => fetchMessages(activeSessionId, publicKey),
 enabled: activeSessionId != null,
 retry: 1,
 });

 const { data: betaNftStatus } = useQuery({
 queryKey: ["beta-nft-status", publicKey],
 queryFn: async () => {
 const res = await fetch(
 `/api/nft/beta-status?wallet=${encodeURIComponent(publicKey!)}`
 );
 if (!res.ok) return null;
 return res.json() as Promise<{ canClaim?: boolean; claimed?: boolean }>;
 },
 enabled: Boolean(publicKey),
 staleTime: 15_000,
 });

 const quickActions = useMemo(
 () =>
 QUICK_ACTIONS.filter((item) => {
 if ("betaClaim" in item && item.betaClaim) {
 if (!publicKey) return true;
 return Boolean(betaNftStatus?.canClaim);
 }
 return true;
 }),
 [betaNftStatus?.canClaim, publicKey]
 );

 useEffect(() => {
 setPendingUser(null);
 setLessonMessages([]);
 const stored = readStoredSessionId(publicKey);
 setActiveSessionId(stored);
 }, [publicKey]);

 const messages = useMemo(() => {
 const list = pendingUser
 ? [...serverMessages, pendingUser, ...lessonMessages]
 : [...serverMessages, ...lessonMessages];
 return dedupeMessages(list);
 }, [serverMessages, pendingUser, lessonMessages]);

 const [isSending, setIsSending] = useState(false);
 const [sendError, setSendError] = useState<string | null>(null);
 const [streamingText, setStreamingText] = useState<string | null>(null);
 const lastSentRef = useRef<string | null>(null);

 const sendMutation = useMutation({
 mutationFn: async ({
 content,
 sessionId,
 }: {
 content: string;
 sessionId: number | null;
 }) => {
 const res = await fetch("/api/chat/messages", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 "Accept": "text/event-stream",
 },
 body: JSON.stringify({
 content,
 context: publicKey ?? null,
 sessionId: sessionId ?? undefined,
 }),
 });

 if (!res.ok) {
 const err = await res.json().catch(() => ({}));
 throw new Error(err.error || "Send failed");
 }

 // SSE streaming path
 if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
 const reader = res.body.getReader();
 const decoder = new TextDecoder();
 let buffer = "";
 let accumulated = "";
 let finalMessage: ChatMessage & { sessionId?: number } | null = null;

 while (true) {
 const { done, value } = await reader.read();
 if (done) break;
 buffer += decoder.decode(value, { stream: true });
 const lines = buffer.split("\n");
 buffer = lines.pop() ?? "";
 for (const line of lines) {
 if (!line.startsWith("data: ")) continue;
 try {
 const evt = JSON.parse(line.slice(6));
 if (evt.type === "delta") {
 accumulated += evt.text;
 setStreamingText(accumulated);
 } else if (evt.type === "done") {
 finalMessage = {
 id: evt.id,
 role: evt.role,
 content: evt.content,
 metadata: evt.metadata,
 createdAt: evt.createdAt,
 sessionId: evt.sessionId,
 };
 } else if (evt.type === "error") {
 throw new Error(evt.error || "Stream error");
 }
 } catch {
 // skip malformed events
 }
 }
 }
 setStreamingText(null);
 if (!finalMessage) throw new Error("No response received");
 return finalMessage;
 }

 // Fallback: plain JSON
 return res.json() as Promise<ChatMessage & { sessionId?: number }>;
 },
 onMutate: ({ content }) => {
 setIsSending(true);
 setSendError(null);
 setStreamingText(null);
 lastSentRef.current = content;
 const temp: ChatMessage = {
 id: -Date.now(),
 role: "user",
 content,
 createdAt: new Date().toISOString(),
 };
 setPendingUser(temp);
 return { content };
 },
 onSuccess: (aiMessage, { content, sessionId: sentSessionId }) => {
 setIsSending(false);
 setStreamingText(null);
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

 const sessionId = aiMessage.sessionId ?? sentSessionId ?? activeSessionId;
 if (sessionId != null && sessionId !== activeSessionId) {
 selectSession(sessionId);
 }

 setPendingUser(null);
 const messageKey = [
 "chat-messages",
 publicKey ?? "anon",
 sessionId ?? "none",
 ] as const;

 queryClient.setQueryData<ChatMessage[]>(messageKey, (old = []) => {
 if (old.some((m) => m.id === aiMessage.id)) return old;
 const userMessage: ChatMessage = {
 id: aiMessage.id - 1,
 role: "user",
 content,
 createdAt: new Date(
 Date.parse(aiMessage.createdAt) - 1000
 ).toISOString(),
 };
 return dedupeMessages([...old, userMessage, aiMessage]);
 });
 void queryClient.invalidateQueries({ queryKey: messageKey });
 void queryClient.invalidateQueries({ queryKey: sessionsKey });
 },
 onError: (err) => {
 setIsSending(false);
 setStreamingText(null);
 setPendingUser(null);
 setSendError(err instanceof Error ? err.message : "Send failed");
 track("error", {
 walletPublicKey: publicKey,
 metadata: {
 source: "chat_send",
 message: err instanceof Error ? err.message : "send failed",
 },
 });
 },
 });

 const newChat = useCallback(() => {
 track("chat_new", { walletPublicKey: publicKey });
 setPendingUser(null);
 setInput("");
 setStreamingText(null);
 setSendError(null);
 selectSession(null);
 }, [publicKey, selectSession]);

 useEffect(() => {
 if (scrollRef.current) {
 scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
 }
 }, [messages, isSending, streamingText]);

 const handleSend = useCallback(
 (content: string) => {
 const text = content.trim();
 if (!text || isSending) return;

 // Require a wallet for everything except explicit connect intents
 if (!isConnected && !connecting) {
 if (isConnectWalletIntent(text)) {
 openConnectModal();
 return;
 }
 openConnectModal();
 return;
 }

 setInput("");
 setSendError(null);
 sendMutation.mutate({ content: text, sessionId: activeSessionId });
 if (inputRef.current) {
 inputRef.current.style.height = "auto";
 }
 },
 [sendMutation, activeSessionId, isConnected, connecting, openConnectModal, isSending]
 );

 const onTxOutcome = useCallback(
 (info?: {
 hash: string | null;
 summary: string;
 teach?: { title: string; markdown: string } | null;
 }) => {
 void queryClient.invalidateQueries({ queryKey: ["wallet-balances", publicKey ?? "anon"] });
 void queryClient.invalidateQueries({ queryKey: ["wallet-assets", publicKey] });
 void queryClient.invalidateQueries({ queryKey: ["wallet-transactions", publicKey] });
 void queryClient.invalidateQueries({ queryKey: ["portfolio-intel", publicKey] });
 void queryClient.invalidateQueries({ queryKey: ["portfolio-coach", publicKey] });
 void queryClient.invalidateQueries({ queryKey: ["chat-sessions", publicKey ?? "anon"] });
 void queryClient.invalidateQueries({ queryKey: ["beta-nft-status", publicKey] });

 const lesson = info?.teach;
 if (lesson?.markdown) {
 setLessonMessages((prev) => [
 ...prev,
 {
 id: -(Date.now() + prev.length),
 role: "assistant",
 content: lesson.markdown,
 createdAt: new Date().toISOString(),
 metadata: null,
 },
 ]);
 }
 },
 [queryClient, publicKey]
 );
 const onSidebarAction = useCallback(
 (action: SidebarAction) => {
 if (action.type === "new-chat") {
 newChat();
 return;
 }
 if (action.type === "select-session") {
 selectSession(action.sessionId);
 void queryClient.invalidateQueries({
 queryKey: [
 "chat-messages",
 publicKey ?? "anon",
 action.sessionId,
 ],
 });
 return;
 }
 if (action.type === "focus-input") {
 inputRef.current?.focus();
 return;
 }
 if (action.type === "prefill") {
 // Pre-fill the composer and focus - don't send automatically
 setInput(action.prompt);
 setTimeout(() => inputRef.current?.focus(), 50);
 return;
 }
 if (action.type === "prompt") {
 handleSend(action.prompt);
 }
 },
 [newChat, selectSession, queryClient, publicKey, handleSend]
 );

 const showThread =
 messages.length > 0 ||
 isSending ||
 pendingUser != null;

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
 onClick={() => {
 if (!isConnected) {
 openConnectModal();
 return;
 }
 handleSend("faucet USDC");
 }}
 className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10 sm:mb-1.5"
 aria-label="Get testnet USDC"
 title="Get testnet USDC (for perps / Blend)"
 >
 <Coins className="h-5 w-5" />
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
 disabled={sendMutation.isPending || isSending}
 className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 text-foreground outline-none placeholder:text-muted-foreground sm:min-h-[44px] sm:py-2.5 sm:text-[15px]"
 />
 <button
 type="submit"
 disabled={!input.trim() || isSending}
 className={cn(
 "mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity sm:mb-1.5",
 input.trim() && !isSending
 ? "bg-orbit-gradient text-white shadow-sm hover:opacity-90"
 : "bg-muted text-muted-foreground"
 )}
 aria-label="Send"
 >
 {isSending ? (
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
 <Layout
 onSidebarAction={onSidebarAction}
 recentSessions={sessions}
 activeSessionId={activeSessionId}
 >
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
 ) : !showThread ? (
 <div className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto bg-orbit-gradient-subtle px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
 {/* Heading */}
 <div className="mb-7 text-center">
 <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
 What can I help with?
 </h1>
 </div>

 {/* Composer */}
 <div className="w-full max-w-2xl">{composer}</div>

 {/* Suggestion chips */}
 <div className="mt-4 flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
 {quickActions.map((item) => (
 <button
 key={item.label}
 type="button"
 onClick={() => handleSend(item.prompt)}
 className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-card px-3.5 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
 >
 <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 {item.label}
 </button>
 ))}
 </div>

 {/* Onboarding - inline on small screens, floating on larger */}
 <div className="mt-6 w-full max-w-2xl sm:fixed sm:bottom-6 sm:right-6 sm:z-20 sm:mt-0 sm:w-72 lg:w-80">
 <OnboardingChecklist
 hasChatted={sessions.length > 0 || messages.length > 0}
 onFund={() => handleSend("Fund my wallet")}
 />
 </div>
 </div>
 ) : (
 <>
 <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
 <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6">
 {isLoading && messages.length === 0 && !publicKey ? (
 <div className="space-y-4">
 <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-primary/10" />
 <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-orbit-gradient-subtle ring-1 ring-primary/20" />
 </div>
 ) : (
 <>
 {messages.map((msg, idx) => {
 const actionsList =
 msg.metadata?.actions?.length
 ? msg.metadata.actions
 : msg.metadata?.action
 ? [msg.metadata.action]
 : [];
 const gallery = msg.metadata?.gallery ?? null;
 const isUser = msg.role === "user";
 const isLastUserMsg = isUser && idx === messages.length - 1;
 return (
 <div
 key={msg.id}
 className={cn(
 "flex w-full flex-col",
 isUser ? "items-end" : "items-start"
 )}
 >
 {!isUser && (
 <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-orbit-gradient">
 <Sparkles className="h-3.5 w-3.5 text-white" />
 </div>
 )}
 <div
 className={cn(
 "max-w-[92%] break-words text-[15px] leading-7 sm:max-w-[75%]",
 isUser
 ? "rounded-[22px] bg-orbit-gradient px-3.5 py-2.5 text-white shadow-md shadow-primary/20 sm:px-4 whitespace-pre-wrap"
 : "rounded-2xl bg-card px-3.5 py-3 text-foreground ring-1 ring-primary/10 sm:px-4"
 )}
 >
 {isUser ? msg.content : (
 <ReactMarkdown
 remarkPlugins={[remarkGfm]}
 components={{
 p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
 strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
 ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
 ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
 li: ({ children }) => <li className="leading-6">{children}</li>,
 code: ({ children }) => <code className="rounded bg-primary/10 px-1 py-0.5 text-[13px] font-mono">{children}</code>,
 h1: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
 h2: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
 h3: ({ children }) => <p className="font-medium mb-0.5">{children}</p>,
 a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>,
 }}
 >
 {msg.content}
 </ReactMarkdown>
 )}
 </div>
 {isLastUserMsg && !isSending && (
 <button
 type="button"
 onClick={() => handleSend(msg.content)}
 className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-primary transition-colors"
 title="Resend this message"
 >
 <RotateCcw className="h-2.5 w-2.5" />
 Resend
 </button>
 )}
 {gallery?.kind === "nft_holdings" && (
 <NftGallery gallery={gallery} onAction={handleSend} />
 )}
 {actionsList.length > 1 ? (
 <div className="mt-2 w-full max-w-sm">
 <TransactionActionCard
 key={`${msg.id}-queue`}
 action={actionsList[0]!}
 queue={actionsList}
 onOutcome={onTxOutcome}
 onContinue={handleSend}
 />
 </div>
 ) : actionsList.length === 1 ? (
 <div className="mt-2 w-full max-w-sm">
 <TransactionActionCard
 key={`${msg.id}-action-${actionsList[0]!.type}-${actionsList[0]!.destAsset ?? actionsList[0]!.marketHint ?? ""}`}
 action={actionsList[0]!}
 onOutcome={onTxOutcome}
 onContinue={handleSend}
 />
 </div>
 ) : null}
 </div>
 );
 })}
 </>
 )}

 {isSending && !streamingText && (
 <div className="flex items-center gap-2 px-1 py-2">
 <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orbit-gradient">
 <Sparkles className="h-3.5 w-3.5 text-white" />
 </div>
 <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
 <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
 <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-chart-5 [animation-delay:300ms]" />
 </div>
 )}

 {streamingText && (
 <div className="flex w-full flex-col items-start">
 <div className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-orbit-gradient">
 <Sparkles className="h-3.5 w-3.5 text-white" />
 </div>
 <div className="max-w-[92%] rounded-2xl bg-card px-3.5 py-3 text-[15px] leading-7 text-foreground ring-1 ring-primary/10 sm:max-w-[75%] sm:px-4">
 <ReactMarkdown
 remarkPlugins={[remarkGfm]}
 components={{
 p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
 strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
 ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
 ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
 li: ({ children }) => <li className="leading-6">{children}</li>,
 code: ({ children }) => <code className="rounded bg-primary/10 px-1 py-0.5 text-[13px] font-mono">{children}</code>,
 h1: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
 h2: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
 h3: ({ children }) => <p className="font-medium mb-0.5">{children}</p>,
 a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>,
 }}
 >
 {streamingText}
 </ReactMarkdown>
 <span className="inline-block w-1.5 h-3.5 bg-primary/60 animate-pulse ml-0.5 align-middle" />
 </div>
 </div>
 )}

 {sendError && (
 <div className="space-y-2">
 <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
 {sendError}
 </div>
 {lastSentRef.current && (
 <button
 type="button"
 onClick={() => {
 const last = lastSentRef.current;
 if (last) handleSend(last);
 }}
 className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
 >
 <RotateCcw className="h-3 w-3" />
 Retry
 </button>
 )}
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
