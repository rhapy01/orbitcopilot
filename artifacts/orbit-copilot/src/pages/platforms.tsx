import { useFreighter } from "@/hooks/use-freighter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Wallet, ArrowRightLeft, Droplets, TrendingUp, Link2, Coins, Anchor, Globe, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Platform {
  id: string;
  name: string;
  category: "wallet" | "dex" | "lending" | "amm" | "bridge" | "ramp" | "stablecoin" | "liquid-staking";
  description: string;
  url: string;
  icon: React.ElementType;
  status: "live" | "beta" | "coming-soon";
  features: string[];
  gradient: string;
}

const PLATFORMS: Platform[] = [
  {
    id: "freighter",
    name: "Freighter",
    category: "wallet",
    description: "Official Stellar browser extension wallet. Connect to sign transactions, access your real XLM balance, and interact with DeFi protocols.",
    url: "https://freighter.app",
    icon: Wallet,
    status: "live",
    features: ["Sign transactions", "Real wallet data", "Mainnet & Testnet"],
    gradient: "from-purple-500/10 to-pink-500/10",
  },
  {
    id: "blend",
    name: "Blend Protocol",
    category: "lending",
    description: "Decentralized lending and borrowing protocol on Stellar. Supply assets to earn yield or borrow against your collateral.",
    url: "https://blend.capital",
    icon: Coins,
    status: "live",
    features: ["Lend XLM/USDC", "Variable APY", "Liquidation protection"],
    gradient: "from-blue-500/10 to-cyan-500/10",
  },
  {
    id: "aquarius",
    name: "Aquarius",
    category: "amm",
    description: "AMM and liquidity rewards program for Stellar DEX. Provide liquidity to SDEX pools and earn AQUA governance tokens.",
    url: "https://aqua.network",
    icon: Droplets,
    status: "live",
    features: ["AMM pools", "AQUA rewards", "Governance voting"],
    gradient: "from-cyan-500/10 to-teal-500/10",
  },
  {
    id: "phoenix",
    name: "Phoenix Protocol",
    category: "dex",
    description: "Next-gen DEX on Stellar with concentrated liquidity pools, multi-hop swaps, and LP incentives.",
    url: "https://phoenix-hub.io",
    icon: Zap,
    status: "live",
    features: ["Concentrated liquidity", "Low fees", "LP incentives"],
    gradient: "from-orange-500/10 to-red-500/10",
  },
  {
    id: "stellarx",
    name: "StellarX",
    category: "dex",
    description: "Full-featured DEX and trading platform built on Stellar's native order book. Trade 500+ asset pairs with zero platform fees.",
    url: "https://stellarx.com",
    icon: ArrowRightLeft,
    status: "live",
    features: ["Order book trading", "500+ pairs", "Zero fees"],
    gradient: "from-indigo-500/10 to-purple-500/10",
  },
  {
    id: "pendulum",
    name: "Pendulum",
    category: "bridge",
    description: "Cross-chain bridge connecting Stellar to Polkadot/EVM ecosystems. Access fiat stablecoins from Stellar in broader DeFi.",
    url: "https://pendulumchain.org",
    icon: Link2,
    status: "live",
    features: ["Cross-chain bridge", "Fiat stablecoins", "EVM compatible"],
    gradient: "from-pink-500/10 to-rose-500/10",
  },
  {
    id: "moneygram",
    name: "MoneyGram Access",
    category: "ramp",
    description: "Stellar-powered on/off ramp via MoneyGram. Convert between XLM/USDC and local cash at 350,000+ locations worldwide.",
    url: "https://stellar.org/ecosystem/moneygram",
    icon: Globe,
    status: "live",
    features: ["Cash on/off ramp", "350k+ locations", "XLM & USDC"],
    gradient: "from-yellow-500/10 to-orange-500/10",
  },
  {
    id: "lobstr",
    name: "Lobstr Wallet",
    category: "wallet",
    description: "Mobile-first Stellar wallet with built-in trading, vaults, and staking. Available on iOS, Android, and as a browser extension.",
    url: "https://lobstr.co",
    icon: Anchor,
    status: "live",
    features: ["Mobile wallet", "Built-in DEX", "Stellar vaults"],
    gradient: "from-teal-500/10 to-green-500/10",
  },
  {
    id: "ultrastellar",
    name: "Ultra Stellar",
    category: "liquid-staking",
    description: "Liquid staking for XLM via the lXLM token. Earn staking rewards while keeping liquidity to use in Stellar DeFi.",
    url: "https://ultrastellar.com",
    icon: TrendingUp,
    status: "beta",
    features: ["Liquid staking", "lXLM token", "DeFi composable"],
    gradient: "from-violet-500/10 to-indigo-500/10",
  },
];

const CATEGORY_LABELS: Record<Platform["category"], string> = {
  wallet: "Wallet",
  dex: "DEX",
  lending: "Lending",
  amm: "AMM",
  bridge: "Bridge",
  ramp: "On/Off Ramp",
  stablecoin: "Stablecoin",
  "liquid-staking": "Liquid Staking",
};

const CATEGORY_COLORS: Record<Platform["category"], string> = {
  wallet: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  dex: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  lending: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  amm: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  bridge: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  ramp: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  stablecoin: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  "liquid-staking": "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
};

export default function PlatformsPage() {
  const { isInstalled, isConnected, connecting, connect, publicKey } = useFreighter();

  const categories = ["wallet", "dex", "lending", "amm", "bridge", "ramp", "liquid-staking"] as const;

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-1">Stellar Ecosystem</h1>
        <p className="text-muted-foreground">
          Orbit connects you to every major protocol on Stellar — wallets, DEXes, lending markets, bridges, and more.
        </p>
      </div>

      {/* Freighter Connect Banner */}
      <Card className={cn(
        "border-2 overflow-hidden",
        isConnected ? "border-green-500/30 bg-green-500/5" : "border-primary/30 bg-orbit-gradient-subtle"
      )}>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-orbit-gradient flex items-center justify-center shrink-0">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-bold text-lg">Freighter Wallet</h2>
                  {isConnected && (
                    <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                      Connected
                    </Badge>
                  )}
                  {!isInstalled && (
                    <Badge variant="outline" className="text-muted-foreground">Not Installed</Badge>
                  )}
                </div>
                {isConnected && publicKey ? (
                  <p className="text-sm text-muted-foreground font-mono">
                    {publicKey.slice(0, 8)}...{publicKey.slice(-8)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isInstalled
                      ? "Connect your Freighter wallet to use real on-chain data across all platforms."
                      : "Install the Freighter browser extension to connect your Stellar wallet."}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {!isInstalled ? (
                <Button
                  className="bg-orbit-gradient text-white border-0 hover:opacity-90"
                  onClick={() => window.open("https://freighter.app", "_blank")}
                >
                  Install Freighter
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              ) : !isConnected ? (
                <Button
                  className="bg-orbit-gradient text-white border-0 hover:opacity-90"
                  onClick={connect}
                  disabled={connecting}
                >
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => window.open("https://freighter.app", "_blank")}>
                  Manage
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platforms by category */}
      {categories.map((cat) => {
        const group = PLATFORMS.filter((p) => p.category === cat);
        if (!group.length) return null;
        return (
          <div key={cat} className="space-y-4">
            <h2 className="text-lg font-bold text-muted-foreground uppercase tracking-wider text-xs">
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.map((platform) => {
                const Icon = platform.icon;
                return (
                  <Card
                    key={platform.id}
                    className={cn(
                      "border-border shadow-sm flex flex-col hover:border-primary/40 transition-all group cursor-pointer",
                      `bg-gradient-to-br ${platform.gradient}`
                    )}
                    onClick={() => window.open(platform.url, "_blank")}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-background/80 border border-border flex items-center justify-center shadow-sm">
                            <Icon className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-base group-hover:text-primary transition-colors">
                              {platform.name}
                            </CardTitle>
                            <Badge variant="outline" className={cn("text-[10px] mt-1", CATEGORY_COLORS[platform.category])}>
                              {CATEGORY_LABELS[platform.category]}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge
                            className={cn(
                              "text-[10px]",
                              platform.status === "live"
                                ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
                                : platform.status === "beta"
                                ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {platform.status === "live" ? "Live" : platform.status === "beta" ? "Beta" : "Soon"}
                          </Badge>
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3">
                      <CardDescription className="text-xs leading-relaxed line-clamp-3">
                        {platform.description}
                      </CardDescription>
                      <div className="flex flex-wrap gap-1.5">
                        {platform.features.map((f) => (
                          <span
                            key={f}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-background/70 border border-border text-muted-foreground"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
