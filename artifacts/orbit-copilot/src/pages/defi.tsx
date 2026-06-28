import { useState } from "react";
import { useGetDefiOpportunities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sprout, ShieldAlert, ArrowRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DefiPage() {
  const { data: opps = [], isLoading } = useGetDefiOpportunities();
  const [filter, setFilter] = useState<string>("all");

  const filteredOpps = filter === "all" 
    ? opps 
    : opps.filter(o => o.riskLevel === filter);

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Earn Yield</h1>
          <p className="text-muted-foreground">Discover DeFi opportunities on Stellar</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button 
            variant={filter === "all" ? "default" : "outline"} 
            onClick={() => setFilter("all")}
            size="sm"
            className={filter === "all" ? "bg-orbit-gradient text-white border-0" : ""}
          >
            All
          </Button>
          <Button 
            variant={filter === "low" ? "default" : "outline"} 
            onClick={() => setFilter("low")}
            size="sm"
            className={filter === "low" ? "bg-orbit-gradient text-white border-0" : ""}
          >
            Low Risk
          </Button>
          <Button 
            variant={filter === "medium" ? "default" : "outline"} 
            onClick={() => setFilter("medium")}
            size="sm"
            className={filter === "medium" ? "bg-orbit-gradient text-white border-0" : ""}
          >
            Medium Risk
          </Button>
          <Button 
            variant={filter === "high" ? "default" : "outline"} 
            onClick={() => setFilter("high")}
            size="sm"
            className={filter === "high" ? "bg-orbit-gradient text-white border-0" : ""}
          >
            High Risk
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[280px] w-full rounded-xl" />
          ))
        ) : filteredOpps.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No opportunities found for the selected filter.
          </div>
        ) : (
          filteredOpps.map((opp) => (
            <Card key={opp.id} className="border-border shadow-sm flex flex-col hover:border-primary/50 transition-colors group">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="outline" className={cn(
                    "capitalize",
                    opp.riskLevel === 'low' ? "text-green-500 border-green-500/30 bg-green-500/10" :
                    opp.riskLevel === 'medium' ? "text-orange-500 border-orange-500/30 bg-orange-500/10" :
                    "text-red-500 border-red-500/30 bg-red-500/10"
                  )}>
                    <ShieldAlert className="w-3 h-3 mr-1" />
                    {opp.riskLevel} Risk
                  </Badge>
                  <Badge variant="secondary" className="capitalize">
                    {opp.type.replace('_', ' ')}
                  </Badge>
                </div>
                <CardTitle className="text-xl">{opp.protocol}</CardTitle>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-2 h-10">
                  {opp.description}
                </p>
              </CardHeader>
              <CardContent className="flex-1 pb-4">
                <div className="bg-muted/40 rounded-xl p-4 flex items-center justify-between border border-border/50 group-hover:bg-primary/5 transition-colors">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Estimated APY</div>
                    <div className="text-3xl font-bold text-orbit-gradient flex items-center">
                      {opp.apy.toFixed(2)}%
                      <TrendingUp className="w-5 h-5 ml-2 text-primary" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Asset</div>
                    <div className="font-semibold">{opp.assetCode}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">TVL</div>
                    <div className="font-semibold">${(opp.tvlUsd / 1000000).toFixed(1)}M</div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-0">
                <Button className="w-full group-hover:bg-orbit-gradient group-hover:text-white transition-all border-0 shadow-none bg-secondary text-secondary-foreground">
                  Deposit
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
