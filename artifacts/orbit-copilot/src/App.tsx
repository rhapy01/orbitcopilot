import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { DeferredAnalytics } from "@/components/deferred-analytics";
import { DeferredToaster } from "@/components/deferred-toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { WalletProvider } from "@/hooks/use-wallet";
import { EvmWalletProvider } from "@/hooks/use-evm-wallet";
import { track } from "@/lib/analytics";
import ChatPage from "@/pages/chat";

const StatsPage = lazy(() => import("@/pages/stats"));
const SettingsPage = lazy(() => import("@/pages/settings"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  useEffect(() => {
    track("page_view", { metadata: { path: window.location.pathname } });
  }, []);

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={ChatPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={ChatPage} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="orbit-theme">
      <WalletProvider>
        <EvmWalletProvider>
        <QueryClientProvider client={queryClient}>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <DeferredToaster />
            <DeferredAnalytics />
        </QueryClientProvider>
        </EvmWalletProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}

export default App;
