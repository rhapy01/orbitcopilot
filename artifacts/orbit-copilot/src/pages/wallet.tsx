import { useFreighter } from "@/hooks/use-freighter";
import { useGetWallet, useGetWalletAssets, useGetTransactions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, ArrowRightLeft, Download, Upload, Zap, RefreshCw, Wallet, ExternalLink, PlugZap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

export default function WalletPage() {
  const { isInstalled, isConnected, publicKey, network, connecting, connect } = useFreighter();
  const [, navigate] = useLocation();

  const walletParams = isConnected && publicKey ? { publicKey } : undefined;

  const { data: wallet, isLoading: isLoadingWallet } = useGetWallet(walletParams);
  const { data: assets = [], isLoading: isLoadingAssets } = useGetWalletAssets(walletParams);
  const { data: txs = [], isLoading: isLoadingTxs } = useGetTransactions(walletParams);

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-1">Wallet</h1>
        {isLoadingWallet ? (
          <Skeleton className="h-5 w-48 mt-2" />
        ) : isConnected && wallet ? (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded-md text-muted-foreground">
              {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
            </span>
            <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
              Freighter · {network}
            </Badge>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
              {wallet.network}
            </Badge>
          </div>
        ) : wallet ? (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded-md text-muted-foreground">
              {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
            </span>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              Demo · {wallet.network}
            </Badge>
          </div>
        ) : null}
      </div>

      {/* Freighter connect banner — only when NOT connected */}
      {!isConnected && (
        <Card className="border-primary/30 bg-orbit-gradient-subtle overflow-hidden">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-orbit-gradient flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold mb-0.5">Connect your Stellar wallet</p>
                  <p className="text-sm text-muted-foreground">
                    {isInstalled
                      ? "Connect Freighter to see your real mainnet balance and transactions."
                      : "Install the Freighter browser extension to connect your Stellar wallet."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isInstalled ? (
                  <Button
                    className="bg-orbit-gradient text-white border-0 hover:opacity-90"
                    onClick={() => window.open("https://freighter.app", "_blank")}
                  >
                    Install Freighter
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    className="bg-orbit-gradient text-white border-0 hover:opacity-90"
                    onClick={connect}
                    disabled={connecting}
                  >
                    <PlugZap className="w-4 h-4 mr-2" />
                    {connecting ? "Connecting..." : "Connect Freighter"}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground text-xs"
                  onClick={() => navigate("/platforms")}
                >
                  View all platforms
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Total balance summary */}
      {wallet && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-border shadow-sm bg-gradient-to-br from-background to-primary/5">
            <CardContent className="p-6">
              <div className="text-sm font-medium text-muted-foreground mb-2">Total Portfolio Value</div>
              <div className="text-4xl font-bold">
                ${wallet.totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                {wallet.xlmBalance.toLocaleString()} XLM
              </div>
            </CardContent>
          </Card>
          <Card className="border-border shadow-sm">
            <CardContent className="p-6">
              <div className="text-sm font-medium text-muted-foreground mb-2">Network</div>
              <div className="text-2xl font-bold">{wallet.network}</div>
              <div className="text-sm text-muted-foreground mt-2 truncate font-mono">
                {wallet.address.slice(0, 16)}...{wallet.address.slice(-8)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Assets List */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Assets</h2>
          <Card className="border-border shadow-sm overflow-hidden">
            {isLoadingAssets ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No assets found</div>
            ) : (
              <div className="divide-y divide-border">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {asset.logoUrl ? (
                        <img
                          src={asset.logoUrl}
                          alt={asset.assetCode}
                          className="w-10 h-10 rounded-full bg-muted p-1"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {asset.assetCode.slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <div className="font-bold">{asset.assetCode}</div>
                        <div className="text-sm text-muted-foreground">
                          {asset.balance.toLocaleString()} {asset.assetCode}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">
                        ${asset.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div
                        className={cn(
                          "text-xs font-medium flex items-center justify-end mt-1",
                          asset.change24h >= 0 ? "text-green-500" : "text-destructive"
                        )}
                      >
                        {asset.change24h >= 0 ? (
                          <ArrowUpRight className="w-3 h-3 mr-1" />
                        ) : (
                          <ArrowDownRight className="w-3 h-3 mr-1" />
                        )}
                        {Math.abs(asset.change24h).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Transactions */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Recent Transactions</h2>
          <Card className="border-border shadow-sm overflow-hidden">
            {isLoadingTxs ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : txs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No recent transactions</div>
            ) : (
              <div className="divide-y divide-border">
                {txs.map((tx) => {
                  let Icon = ArrowRightLeft;
                  let iconBg = "bg-muted text-muted-foreground";

                  if (tx.type === "receive") {
                    Icon = Download;
                    iconBg = "bg-green-500/10 text-green-500";
                  } else if (tx.type === "send") {
                    Icon = Upload;
                    iconBg = "bg-blue-500/10 text-blue-500";
                  } else if (tx.type === "swap") {
                    Icon = RefreshCw;
                    iconBg = "bg-purple-500/10 text-purple-500";
                  } else if (tx.type === "yield") {
                    Icon = Zap;
                    iconBg = "bg-orange-500/10 text-orange-500";
                  }

                  return (
                    <div
                      key={tx.id}
                      className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", iconBg)}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-medium capitalize">
                            {tx.type} {tx.assetCode}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {tx.type === "send" || tx.type === "withdraw" ? "-" : "+"}
                          {tx.amount} {tx.assetCode}
                        </div>
                        {tx.hash && (
                          <a
                            href={`https://stellar.expert/explorer/public/tx/${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary/70 hover:text-primary flex items-center justify-end gap-1 mt-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View on explorer
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
