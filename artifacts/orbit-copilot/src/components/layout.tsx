import { useState, useEffect, useCallback, useRef } from "react";
import {
 Orbit,
 PanelLeft,
 SquarePen,
 Search,
 PieChart,
 TrendingUp,
 LayoutGrid,
 Wallet,
 Loader2,
 LogOut,
 Moon,
 Sun,
 ChevronDown,
 X,
 BarChart3,
 Shield,
 Mail,
 BookOpen,
 Sparkles,
 Settings,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useWallet } from "@/hooks/use-wallet";
import { WalletConnectModal } from "@/components/auth/wallet-connect-modal";
import { SecuritySettings } from "@/components/auth/security-settings";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { PortfolioDrawer } from "@/components/portfolio-drawer";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

type BetaNftStatus = {
 eligible: boolean;
 claimed: boolean;
 canClaim: boolean;
};

function shorten(key: string) {
 return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function useIsMobile(breakpoint = 768) {
 const [isMobile, setIsMobile] = useState(() =>
 typeof window !== "undefined" ? window.innerWidth < breakpoint : false
 );

 useEffect(() => {
 const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
 const onChange = () => setIsMobile(mq.matches);
 onChange();
 mq.addEventListener("change", onChange);
 return () => mq.removeEventListener("change", onChange);
 }, [breakpoint]);

 return isMobile;
}

export type SidebarAction =
 | { type: "new-chat" }
 | { type: "select-session"; sessionId: number }
 | { type: "prompt"; prompt: string }
 | { type: "prefill"; prompt: string }
 | { type: "focus-input" }
 | { type: "open-portfolio" };

export function Layout({
 children,
 onSidebarAction,
 recentSessions,
 activeSessionId,
}: {
 children: React.ReactNode;
 onSidebarAction?: (action: SidebarAction) => void;
 recentSessions?: { id: number; title: string }[];
 activeSessionId?: number | null;
}) {
 const { theme, setTheme } = useTheme();
 const {
 isConnected,
 publicKey,
 type: walletType,
 authUser,
 connecting,
 disconnect,
 logout,
 connectModalOpen,
 setConnectModalOpen,
 openConnectModal,
 needsRecovery,
 requiresRecoverySetup,
 recoveryReady,
 } = useWallet();
 const isMobile = useIsMobile();
 const [sidebarOpen, setSidebarOpen] = useState(false);
 const [searchQuery, setSearchQuery] = useState("");
 const [securityOpen, setSecurityOpen] = useState(false);
 const [portfolioOpen, setPortfolioOpen] = useState(false);
 const searchInputRef = useRef<HTMLInputElement>(null);
 const showSun = theme === "dark";

 // Derived display info
 const walletLabel = walletType === "internal"
 ? (authUser?.email ?? "Orbit Wallet")
 : publicKey ? shorten(publicKey) : null;
 const walletSub = walletType === "internal" ? "Orbit Wallet" : "Testnet";

 const { data: betaNft } = useQuery({
 queryKey: ["beta-nft-status", publicKey],
 queryFn: async (): Promise<BetaNftStatus | null> => {
 const res = await fetch(
 `/api/nft/beta-status?wallet=${encodeURIComponent(publicKey!)}`
 );
 if (!res.ok) return null;
 return res.json();
 },
 enabled: Boolean(isConnected && publicKey),
 staleTime: 15_000,
 });

 const openPortfolio = useCallback(() => {
 if (!isConnected || !publicKey) {
 openConnectModal();
 return;
 }
 setPortfolioOpen(true);
 if (isMobile) setSidebarOpen(false);
 }, [isConnected, publicKey, openConnectModal, isMobile]);

 useEffect(() => {
 setSidebarOpen(!isMobile);
 }, [isMobile]);

 useEffect(() => {
 if (!isMobile || !sidebarOpen) return;
 const prev = document.body.style.overflow;
 document.body.style.overflow = "hidden";
 return () => {
 document.body.style.overflow = prev;
 };
 }, [isMobile, sidebarOpen]);

 const runSidebarAction = useCallback(
 (action: SidebarAction) => {
 if (action.type === "open-portfolio") {
 openPortfolio();
 return;
 }
 onSidebarAction?.(action);
 if (isMobile) setSidebarOpen(false);
 },
 [isMobile, onSidebarAction, openPortfolio]
 );

 const navItems = [
 {
 icon: Search,
 label: "Search chats",
 action: { type: "focus-input" } as SidebarAction,
 onClick: () => {
 setSearchQuery("");
 setTimeout(() => searchInputRef.current?.focus(), 50);
 },
 },
 {
 icon: PieChart,
 label: "Portfolio",
 action: { type: "open-portfolio" } as SidebarAction,
 onClick: openPortfolio,
 },
 {
 icon: TrendingUp,
 label: "Markets",
 action: { type: "prefill", prompt: "Price of XLM" } as SidebarAction,
 onClick: undefined,
 },
 {
 icon: LayoutGrid,
 label: "Protocols",
 action: { type: "prefill", prompt: "What protocols are integrated?" } as SidebarAction,
 onClick: undefined,
 },
 {
 icon: BookOpen,
 label: "Learn DeFi",
 action: { type: "prompt", prompt: "What is DeFi vs CeFi?" } as SidebarAction,
 onClick: undefined,
 },
 ];

 const sidebar = (
 <div className="flex h-full w-[260px] max-w-[85vw] flex-col bg-sidebar">
 <div className="flex h-14 items-center justify-between px-3">
 <div className="flex items-center gap-2 px-1">
 <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orbit-gradient shadow-sm">
 <Orbit className="h-4 w-4 text-white" />
 </div>
 <span className="text-[15px] font-bold text-orbit-gradient">Orbit</span>
 </div>
 <button
 type="button"
 onClick={() => setSidebarOpen(false)}
 className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Close sidebar"
 >
 {isMobile ? <X className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
 </button>
 </div>

 <div className="px-3 pb-2">
 <button
 type="button"
 onClick={() => runSidebarAction({ type: "new-chat" })}
 className="flex w-full items-center gap-2 rounded-full bg-orbit-gradient px-3 py-2.5 text-sm font-medium text-white shadow-md transition-opacity hover:opacity-90"
 >
 <SquarePen className="h-4 w-4" />
 New chat
 </button>
 </div>

 <nav className="flex flex-col gap-0.5 px-2 py-1">
 {navItems.map((item) => (
 <button
 key={item.label}
 type="button"
 onClick={() => item.onClick ? item.onClick() : runSidebarAction(item.action)}
 className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-primary/10 hover:text-primary active:bg-primary/15"
 >
 <item.icon className="h-4 w-4 shrink-0 text-primary/70" />
 {item.label}
 </button>
 ))}
 </nav>

 <div className="mt-4 flex-1 overflow-y-auto px-2">
 <div className="px-1 pb-2">
 <div className="flex items-center gap-1.5 rounded-lg border border-sidebar-border bg-background/50 px-2.5 py-1.5">
 <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 <input
 ref={searchInputRef}
 type="text"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Search chats…"
 className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
 />
 {searchQuery && (
 <button
 type="button"
 onClick={() => setSearchQuery("")}
 className="text-muted-foreground hover:text-foreground"
 >
 <X className="h-3 w-3" />
 </button>
 )}
 </div>
 </div>
 <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 Recents
 </p>
 {recentSessions && recentSessions.length > 0 ? (
 <div className="flex flex-col gap-0.5">
 {recentSessions
 .filter((s) =>
 searchQuery.trim()
 ? s.title.toLowerCase().includes(searchQuery.toLowerCase())
 : true
 )
 .map((session) => (
 <button
 key={session.id}
 type="button"
 onClick={() =>
 runSidebarAction({
 type: "select-session",
 sessionId: session.id,
 })
 }
 className={cn(
 "w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10",
 activeSessionId === session.id
 ? "bg-orbit-gradient-subtle font-medium text-foreground ring-1 ring-primary/15"
 : "text-sidebar-foreground"
 )}
 >
 {session.title}
 </button>
 ))}
 {searchQuery.trim() &&
 recentSessions.filter((s) =>
 s.title.toLowerCase().includes(searchQuery.toLowerCase())
 ).length === 0 && (
 <p className="px-3 py-2 text-xs text-muted-foreground">No results</p>
 )}
 </div>
 ) : (
 <p className="px-3 text-xs text-muted-foreground">No chats yet</p>
 )}
 </div>

 <div className="border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
 {isConnected && publicKey ? (
 <div className="space-y-2">
 {needsRecovery && recoveryReady && (
 <button
 type="button"
 onClick={openConnectModal}
 className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-left text-xs text-amber-600 dark:text-amber-300"
 >
 Restore this device (email + authenticator)
 </button>
 )}
 {requiresRecoverySetup && (
 <button
 type="button"
 onClick={openConnectModal}
 className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-left text-xs text-red-600 dark:text-red-300"
 >
 Set email + authenticator - required to recover a lost phone
 </button>
 )}
 <div className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-primary/5">
 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orbit-gradient text-xs font-semibold text-white">
 {walletType === "internal" ? <Mail className="h-4 w-4" /> : publicKey.slice(1, 3)}
 </div>
 <div className="min-w-0 flex-1">
 <p className="truncate text-sm font-medium">{walletLabel}</p>
 <p className="text-xs text-primary/80">{walletSub}</p>
 </div>
 <div className="flex items-center gap-0.5">
 {walletType === "internal" && (
 <button
 type="button"
 onClick={() => setSecurityOpen(true)}
 className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Security settings"
 title="Security settings"
 >
 <Shield className="h-4 w-4" />
 </button>
 )}
 <button
 type="button"
 onClick={() => walletType === "internal" ? logout() : disconnect()}
 className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Disconnect"
 >
 <LogOut className="h-4 w-4" />
 </button>
 </div>
 </div>
 </div>
 ) : (
 <button
 type="button"
 onClick={openConnectModal}
 disabled={connecting}
 className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium hover:bg-primary/5"
 >
 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orbit-gradient text-white">
 {connecting ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Wallet className="h-4 w-4" />
 )}
 </div>
 Connect wallet
 </button>
 )}
 </div>
 </div>
 );

 return (
 <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
 {/* Desktop sidebar */}
 <aside
 className={cn(
 "hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 ease-out md:flex",
 sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden border-0"
 )}
 >
 {sidebarOpen ? sidebar : null}
 </aside>

 {/* Mobile drawer */}
 {isMobile && (
 <>
 <div
 className={cn(
 "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden",
 sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
 )}
 onClick={() => setSidebarOpen(false)}
 aria-hidden={!sidebarOpen}
 />
 <aside
 className={cn(
 "fixed inset-y-0 left-0 z-50 border-r border-sidebar-border shadow-xl transition-transform duration-200 ease-out md:hidden",
 sidebarOpen ? "translate-x-0" : "-translate-x-full"
 )}
 >
 {sidebar}
 </aside>
 </>
 )}

 {/* Main column */}
 <div className="flex min-w-0 flex-1 flex-col bg-background">
 <header className="flex h-14 shrink-0 items-center justify-between px-2 sm:px-4">
 <div className="flex min-w-0 items-center gap-0.5">
 {(isMobile || !sidebarOpen) && (
 <button
 type="button"
 onClick={() => setSidebarOpen(true)}
 className="mr-0.5 rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Open sidebar"
 >
 <PanelLeft className="h-5 w-5" />
 </button>
 )}
 <button
 type="button"
 className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[15px] font-semibold hover:bg-primary/5"
 >
 <span className="truncate text-orbit-gradient">Orbit</span>
 <ChevronDown className="h-4 w-4 shrink-0 text-primary/60" />
 </button>
 </div>
 <div className="flex shrink-0 items-center gap-1">
 {betaNft?.canClaim && (
 <button
 type="button"
 onClick={() =>
 onSidebarAction?.({
 type: "prompt",
 prompt:
 "i have submitted my feedback, mint my beta tester nft",
 })
 }
 className="mr-0.5 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-orbit-gradient-subtle px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
 title="Claim your Orbit beta tester NFT"
 >
 <Sparkles className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Claim NFT</span>
 </button>
 )}
 {isConnected && publicKey && (
 <button
 type="button"
 onClick={openPortfolio}
 className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Open portfolio"
 title="Portfolio"
 >
 <PieChart className="h-4 w-4" />
 </button>
 )}
 <FeedbackDialog
 onWhitelisted={(prompt) =>
 onSidebarAction?.({ type: "prompt", prompt })
 }
 />
 <Link
 href="/settings"
 className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Settings"
 >
 <Settings className="h-4 w-4" />
 </Link>
 <Link
 href="/stats"
 className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Product analytics"
 >
 <BarChart3 className="h-4 w-4" />
 </Link>
 <button
 type="button"
 onClick={() => setTheme(showSun ? "light" : "dark")}
 className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
 aria-label="Toggle theme"
 >
 {showSun ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
 </button>
 {(!isConnected || needsRecovery || requiresRecoverySetup) && (
 <button
 type="button"
 onClick={openConnectModal}
 disabled={connecting}
 className="ml-1 rounded-full bg-orbit-gradient px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90"
 >
 {connecting ? "…" : needsRecovery ? "Restore" : "Connect"}
 </button>
 )}
 </div>
 </header>

 <main className="flex min-h-0 flex-1 flex-col">{children}</main>
 </div>

 {/* Modals */}
 <WalletConnectModal open={connectModalOpen} onOpenChange={setConnectModalOpen} />
 <SecuritySettings open={securityOpen} onOpenChange={setSecurityOpen} />
 <PortfolioDrawer
 open={portfolioOpen}
 onClose={() => setPortfolioOpen(false)}
 publicKey={publicKey}
 onAction={(command) => {
 setPortfolioOpen(false);
 onSidebarAction?.({ type: "prompt", prompt: command });
 }}
 />
 </div>
 );
}
