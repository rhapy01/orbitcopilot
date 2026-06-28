import { useGetWallet, useGetWalletAssets, useGetTransactions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, ArrowRightLeft, Download, Upload, Zap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function WalletPage() {
  const { data: wallet, isLoading: isLoadingWallet } = useGetWallet();
  const { data: assets = [], isLoading: isLoadingAssets } = useGetWalletAssets();
  const { data: txs = [], isLoading: isLoadingTxs } = useGetTransactions();

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-1">Wallet</h1>
        {isLoadingWallet ? (
          <Skeleton className="h-5 w-48 mt-2" />
        ) : (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm font-mono bg-muted px-2 py-1 rounded-md text-muted-foreground">
              {wallet?.address.slice(0, 8)}...{wallet?.address.slice(-8)}
            </span>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
              {wallet?.network}
            </Badge>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Assets List */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Assets</h2>
          <Card className="border-border shadow-sm overflow-hidden">
            {isLoadingAssets ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No assets found</div>
            ) : (
              <div className="divide-y divide-border">
                {assets.map((asset) => (
                  <div key={asset.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-4">
                      {asset.logoUrl ? (
                        <img src={asset.logoUrl} alt={asset.assetCode} className="w-10 h-10 rounded-full bg-muted p-1" />
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
                      <div className="font-bold">${asset.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className={cn(
                        "text-xs font-medium flex items-center justify-end mt-1",
                        asset.change24h >= 0 ? "text-green-500" : "text-destructive"
                      )}>
                        {asset.change24h >= 0 ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
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
                {[1, 2, 3, 4].map(i => (
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
                  
                  if (tx.type === 'receive') { Icon = Download; iconBg = "bg-green-500/10 text-green-500"; }
                  else if (tx.type === 'send') { Icon = Upload; iconBg = "bg-blue-500/10 text-blue-500"; }
                  else if (tx.type === 'swap') { Icon = RefreshCw; iconBg = "bg-purple-500/10 text-purple-500"; }
                  else if (tx.type === 'yield') { Icon = Zap; iconBg = "bg-orange-500/10 text-orange-500"; }

                  return (
                    <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", iconBg)}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-medium capitalize">{tx.type} {tx.assetCode}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          {tx.type === 'send' || tx.type === 'withdraw' ? '-' : '+'}{tx.amount} {tx.assetCode}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          ${tx.valueUsd.toFixed(2)}
                        </div>
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
