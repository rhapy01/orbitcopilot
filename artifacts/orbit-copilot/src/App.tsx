import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { FreighterProvider } from "@/hooks/use-freighter";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import ChatPage from "@/pages/chat";
import PortfolioPage from "@/pages/portfolio";
import WalletPage from "@/pages/wallet";
import DefiPage from "@/pages/defi";
import AssetsPage from "@/pages/assets";
import SettingsPage from "@/pages/settings";
import PlatformsPage from "@/pages/platforms";
import SteldexPage from "@/pages/steldex";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={ChatPage} />
        <Route path="/portfolio" component={PortfolioPage} />
        <Route path="/wallet" component={WalletPage} />
        <Route path="/defi" component={DefiPage} />
        <Route path="/assets" component={AssetsPage} />
        <Route path="/platforms" component={PlatformsPage} />
        <Route path="/steldex" component={SteldexPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
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
          </TooltipProvider>
        </QueryClientProvider>
      </FreighterProvider>
    </ThemeProvider>
  );
}

export default App;
