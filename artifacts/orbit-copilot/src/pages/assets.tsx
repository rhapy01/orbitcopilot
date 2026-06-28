import { useState } from "react";
import { useGetAssets, useGetMarketOverview } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, ArrowUpRight, ArrowDownRight, Flame, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AssetsPage() {
  const { data: assets = [], isLoading: isAssetsLoading } = useGetAssets();
  const { data: overview, isLoading: isOverviewLoading } = useGetMarketOverview();
  const [search, setSearch] = useState("");

  const filteredAssets = assets.filter(a => 
    a.code.toLowerCase().includes(search.toLowerCase()) || 
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-1">Market</h1>
        <p className="text-muted-foreground">Discover and track Stellar network assets</p>
      </div>

      {/* Market Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border shadow-sm bg-gradient-to-br from-background to-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
              <Flame className="w-4 h-4 mr-2 text-orange-500" />
              Trending
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isOverviewLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                {overview?.trending.slice(0, 3).map(asset => (
                  <div key={asset.code} className="flex justify-between items-center">
                    <span className="font-bold">{asset.code}</span>
                    <span className="text-green-500 text-sm font-medium">+{asset.change24h.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
              <TrendingUp className="w-4 h-4 mr-2 text-green-500" />
              Top Gainers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isOverviewLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                {overview?.topGainers.slice(0, 3).map(asset => (
                  <div key={asset.code} className="flex justify-between items-center">
                    <span className="font-bold">{asset.code}</span>
                    <span className="text-green-500 text-sm font-medium">+{asset.change24h.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
              <TrendingDown className="w-4 h-4 mr-2 text-red-500" />
              Top Losers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isOverviewLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                {overview?.topLosers.slice(0, 3).map(asset => (
                  <div key={asset.code} className="flex justify-between items-center">
                    <span className="font-bold">{asset.code}</span>
                    <span className="text-red-500 text-sm font-medium">{asset.change24h.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold whitespace-nowrap">All Assets</h2>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search assets..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-muted/50 border-transparent"
            />
          </div>
        </div>

        <Card className="border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 border-b">
                <tr>
                  <th className="px-6 py-4 font-medium">Asset</th>
                  <th className="px-6 py-4 font-medium text-right">Price</th>
                  <th className="px-6 py-4 font-medium text-right">24h Change</th>
                  <th className="px-6 py-4 font-medium text-right hidden sm:table-cell">Market Cap</th>
                  <th className="px-6 py-4 font-medium text-right hidden md:table-cell">Volume (24h)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isAssetsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><Skeleton className="h-8 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="px-6 py-4 hidden sm:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                      <td className="px-6 py-4 hidden md:table-cell"><Skeleton className="h-4 w-20 ml-auto" /></td>
                    </tr>
                  ))
                ) : filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      No assets match your search.
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map(asset => (
                    <tr key={asset.code} className="hover:bg-muted/30 transition-colors cursor-pointer group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {asset.logoUrl ? (
                            <img src={asset.logoUrl} alt={asset.code} className="w-8 h-8 rounded-full bg-muted p-1" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                              {asset.code.slice(0, 2)}
                            </div>
                          )}
                          <div>
                            <div className="font-bold group-hover:text-primary transition-colors">{asset.code}</div>
                            <div className="text-xs text-muted-foreground">{asset.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        ${asset.priceUsd.toFixed(4)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className={cn(
                          "inline-flex items-center font-medium",
                          asset.change24h >= 0 ? "text-green-500" : "text-destructive"
                        )}>
                          {asset.change24h >= 0 ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                          {Math.abs(asset.change24h).toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-muted-foreground hidden sm:table-cell">
                        ${(asset.marketCapUsd / 1000000).toFixed(1)}M
                      </td>
                      <td className="px-6 py-4 text-right text-muted-foreground hidden md:table-cell">
                        ${(asset.volume24hUsd / 1000000).toFixed(1)}M
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
