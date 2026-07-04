import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { FreighterProvider } from "@/hooks/use-freighter";
import { track } from "@/lib/analytics";
import ChatPage from "@/pages/chat";
import StatsPage from "@/pages/stats";

const queryClient = new QueryClient();

function Router() {
  useEffect(() => {
    track("page_view", { metadata: { path: window.location.pathname } });
  }, []);

  return (
    <Switch>
      <Route path="/" component={ChatPage} />
      <Route path="/stats" component={StatsPage} />
      <Route component={ChatPage} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="orbit-theme">
      <FreighterProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
            <Analytics />
          </TooltipProvider>
        </QueryClientProvider>
      </FreighterProvider>
    </ThemeProvider>
  );
}

export default App;
