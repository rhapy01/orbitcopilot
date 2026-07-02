import React from "react";
import { Link, useLocation } from "wouter";
import { MessageSquare, PieChart, WalletCards, Sprout, Search, Settings, Orbit, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Copilot", icon: MessageSquare },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/wallet", label: "Wallet", icon: WalletCards },
  { href: "/defi", label: "Earn", icon: Sprout },
  { href: "/assets", label: "Markets", icon: Search },
  { href: "/platforms", label: "Ecosystem", icon: LayoutGrid },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar p-4 shrink-0">
        <div className="flex items-center gap-2 px-2 mb-8">
          <Orbit className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold bg-orbit-gradient bg-clip-text text-transparent">Orbit</span>
        </div>
        
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <span
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-accent/10 cursor-pointer",
                    isActive ? "bg-accent/10 text-primary" : "text-sidebar-foreground"
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive ? "text-primary" : "text-muted-foreground")} />
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-2 p-4 border-b bg-background shrink-0">
          <Orbit className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold bg-orbit-gradient bg-clip-text text-transparent">Orbit</span>
        </header>

        <div className="flex-1 overflow-auto pb-[calc(env(safe-area-inset-bottom)+4rem)] md:pb-0">
          {children}
        </div>
      </main>

      {/* Mobile Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-background p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <span className="flex flex-col items-center justify-center p-1 cursor-pointer">
                <item.icon
                  className={cn(
                    "h-5 w-5 mb-0.5 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span className={cn(
                  "text-[9px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  {item.label}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
