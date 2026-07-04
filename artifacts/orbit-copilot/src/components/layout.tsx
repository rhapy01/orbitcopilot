import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useFreighter } from "@/hooks/use-freighter";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

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
  | { type: "prompt"; prompt: string }
  | { type: "focus-input" };

export function Layout({
  children,
  onSidebarAction,
  recentTitle,
}: {
  children: React.ReactNode;
  onSidebarAction?: (action: SidebarAction) => void;
  recentTitle?: string | null;
}) {
  const { theme, setTheme } = useTheme();
  const { isConnected, publicKey, network, connect, disconnect, connecting } = useFreighter();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showSun = theme === "dark";

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
      onSidebarAction?.(action);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, onSidebarAction]
  );

  const navItems = [
    { icon: Search, label: "Search chats", action: { type: "focus-input" } as SidebarAction },
    {
      icon: PieChart,
      label: "Portfolio",
      action: { type: "prompt", prompt: "What's in my portfolio?" } as SidebarAction,
    },
    {
      icon: TrendingUp,
      label: "Markets",
      action: { type: "prompt", prompt: "Price of XLM" } as SidebarAction,
    },
    {
      icon: LayoutGrid,
      label: "Protocols",
      action: { type: "prompt", prompt: "What protocols are integrated?" } as SidebarAction,
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
            onClick={() => runSidebarAction(item.action)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-primary/10 hover:text-primary active:bg-primary/15"
          >
            <item.icon className="h-4 w-4 shrink-0 text-primary/70" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-2">
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recents
        </p>
        {recentTitle ? (
          <button
            type="button"
            onClick={() => isMobile && setSidebarOpen(false)}
            className="w-full truncate rounded-lg bg-orbit-gradient-subtle px-3 py-2 text-left text-sm font-medium text-foreground ring-1 ring-primary/15"
          >
            {recentTitle}
          </button>
        ) : (
          <p className="px-3 text-xs text-muted-foreground">No chats yet</p>
        )}
      </div>

      <div className="border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {isConnected && publicKey ? (
          <div className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-primary/5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orbit-gradient text-xs font-semibold text-white">
              {publicKey.slice(1, 3)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{shorten(publicKey)}</p>
              <p className="text-xs text-primary/80">{network ?? "Testnet"}</p>
            </div>
            <button
              type="button"
              onClick={disconnect}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
              aria-label="Disconnect"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={connect}
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
            Connect Freighter
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
            <FeedbackDialog />
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
            {!isConnected && (
              <button
                type="button"
                onClick={connect}
                disabled={connecting}
                className="ml-1 rounded-full bg-orbit-gradient px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90"
              >
                {connecting ? "…" : "Connect"}
              </button>
            )}
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
