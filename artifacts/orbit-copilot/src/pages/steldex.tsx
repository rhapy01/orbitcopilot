import { useMemo, useState } from "react";
import {
  useGetSteldexContracts,
  useGetSteldexPools,
  useGetSteldexFarmPools,
  postSteldexSwap,
  postSteldexStake,
  postSteldexClaim,
  postSteldexUnstake,
  getSteldexSwapQuote,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRightLeft, ExternalLink, Sprout } from "lucide-react";
import { useFreighter } from "@/hooks/use-freighter";
import { SteldexActionButton } from "@/components/steldex-action-button";

const FULL_RANGE = { tickLower: -443580, tickUpper: 443580 };
const TOKEN_DECIMALS: Record<string, number> = {
  XLM: 7,
  pUSDC: 6,
  cUSDC: 7,
  EURC: 7,
  STELLAR: 7,
};

function toUnits(human: string, decimals: number): string {
  const [whole, frac = ""] = human.trim().split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt((whole || "0") + padded).toString();
}

export default function SteldexPage() {
  const { publicKey, isConnected } = useFreighter();
  const { data: contracts, isLoading: contractsLoading } = useGetSteldexContracts();
  const { data: pools = [], isLoading: poolsLoading } = useGetSteldexPools();
  const { data: farmPools = [], isLoading: farmLoading, refetch: refetchFarm } = useGetSteldexFarmPools(
    { wallet: publicKey ?? "" },
    { query: { enabled: !!publicKey, queryKey: ["steldex-farm-pools", publicKey] } }
  );

  const tokenSymbols = useMemo(() => Object.keys(contracts?.tokens ?? {}), [contracts]);
  const [fromSymbol, setFromSymbol] = useState("XLM");
  const [toSymbol, setToSymbol] = useState("pUSDC");
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<{ amountOut?: string | null } | null>(null);
  const [quoting, setQuoting] = useState(false);

  const fetchQuote = async () => {
    if (!contracts?.tokens) return;
    const fromContract = contracts.tokens[fromSymbol];
    const toContract = contracts.tokens[toSymbol];
    if (!fromContract || !toContract || !amount) return;
    setQuoting(true);
    try {
      const decimals = TOKEN_DECIMALS[fromSymbol] ?? 7;
      const result = await getSteldexSwapQuote({
        fromTokenContract: fromContract,
        toTokenContract: toContract,
        amountIn: toUnits(amount, decimals),
        slippageBps: 50,
      });
      setQuote(result as { amountOut?: string | null });
    } catch {
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  };

  const outDecimals = TOKEN_DECIMALS[toSymbol] ?? 7;
  const estimatedOut = quote?.amountOut
    ? (Number(quote.amountOut) / 10 ** outDecimals).toFixed(4)
    : null;

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-6xl mx-auto">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-3xl font-bold">StelDex</h1>
          <Badge variant="outline" className="text-orange-500 border-orange-500/30 bg-orange-500/10">
            Stellar Testnet
          </Badge>
        </div>
        <p className="text-muted-foreground">
          Live AMM, farm, and limit-order router — powered by{" "}
          <a
            href="https://stellar-swap-dex.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Unicorn StelDex <ExternalLink className="w-3 h-3" />
          </a>
          . Real Soroban contracts on Testnet — trades happen on-chain, no simulated data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            Swap
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {contractsLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs text-muted-foreground">From</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setQuote(null);
                      }}
                      className="flex-1"
                    />
                    <Select
                      value={fromSymbol}
                      onValueChange={(v) => {
                        setFromSymbol(v);
                        setQuote(null);
                      }}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tokenSymbols.map((sym) => (
                          <SelectItem key={sym} value={sym}>
                            {sym}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className="text-xs text-muted-foreground">To (estimated)</label>
                  <div className="flex gap-2">
                    <Input readOnly value={estimatedOut ?? ""} placeholder="~" className="flex-1 bg-muted/40" />
                    <Select
                      value={toSymbol}
                      onValueChange={(v) => {
                        setToSymbol(v);
                        setQuote(null);
                      }}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tokenSymbols
                          .filter((s) => s !== fromSymbol)
                          .map((sym) => (
                            <SelectItem key={sym} value={sym}>
                              {sym}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <SteldexActionButton
                  label="Get quote"
                  size="sm"
                  className="rounded-xl"
                  build={async () => {
                    await fetchQuote();
                    return { xdr: undefined };
                  }}
                />
                {quoting && <span className="text-xs text-muted-foreground">Fetching on-chain quote...</span>}
              </div>

              {quote && (
                <div className="rounded-xl border bg-muted/30 p-3 text-sm flex items-center justify-between">
                  <span className="text-muted-foreground">Estimated output</span>
                  <span className="font-semibold">
                    {estimatedOut} {toSymbol}
                  </span>
                </div>
              )}

              <SteldexActionButton
                label={`Swap ${amount} ${fromSymbol} → ${toSymbol}`}
                className="w-full rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
                build={async (stepId) => {
                  if (!contracts?.tokens || !publicKey) throw new Error("Connect Freighter first");
                  const decimals = TOKEN_DECIMALS[fromSymbol] ?? 7;
                  return postSteldexSwap({
                    walletAddress: publicKey,
                    fromTokenContract: contracts.tokens[fromSymbol],
                    toTokenContract: contracts.tokens[toSymbol],
                    amountIn: toUnits(amount, decimals),
                    slippageBps: 50,
                    stepId: stepId ?? null,
                  });
                }}
                onSuccess={() => refetchFarm()}
              />
              <p className="text-xs text-muted-foreground">
                Uses Freighter on <strong>Testnet</strong>. Switch Freighter's network to Testnet before swapping.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Sprout className="w-5 h-5 text-primary" />
          Farm — stake liquidity for STELLAR rewards
        </h2>
        {!isConnected ? (
          <div className="text-sm text-muted-foreground rounded-xl border p-6 text-center">
            Connect Freighter to view your LP positions and stake into StelDex farms.
          </div>
        ) : farmLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {farmPools.map((pool: any) => (
              <Card key={pool.poolContract} className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    {pool.pair}
                    <Badge variant="secondary">
                      {pool.farm?.baseAprPercent ? `${Math.min(pool.farm.baseAprPercent, 9999).toFixed(0)}% APR` : "—"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <div>LP owned</div>
                      <div className="font-semibold text-foreground">{pool.lpLiquidity ?? "0"}</div>
                    </div>
                    <div>
                      <div>Staked</div>
                      <div className="font-semibold text-foreground">{pool.stakedLiquidity ?? "0"}</div>
                    </div>
                    <div>
                      <div>Available</div>
                      <div className="font-semibold text-foreground">{pool.availableToStake ?? "0"}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SteldexActionButton
                      label="Stake"
                      size="sm"
                      className="rounded-xl bg-orbit-gradient text-white border-0 hover:opacity-90"
                      build={async (stepId) => {
                        if (!publicKey) throw new Error("Connect Freighter first");
                        return postSteldexStake({
                          walletAddress: publicKey,
                          poolContract: pool.poolContract,
                          ...FULL_RANGE,
                          stakeMax: true,
                          lockWeeks: 52,
                          stepId: stepId ?? null,
                        });
                      }}
                      onSuccess={() => refetchFarm()}
                    />
                    <SteldexActionButton
                      label="Claim"
                      size="sm"
                      className="rounded-xl"
                      build={async () => {
                        if (!publicKey) throw new Error("Connect Freighter first");
                        return postSteldexClaim({
                          walletAddress: publicKey,
                          poolContract: pool.poolContract,
                          ...FULL_RANGE,
                        });
                      }}
                      onSuccess={() => refetchFarm()}
                    />
                    <SteldexActionButton
                      label="Unstake"
                      size="sm"
                      className="rounded-xl"
                      build={async (stepId) => {
                        if (!publicKey) throw new Error("Connect Freighter first");
                        return postSteldexUnstake({
                          walletAddress: publicKey,
                          poolContract: pool.poolContract,
                          ...FULL_RANGE,
                          unstakeMax: true,
                          stepId: stepId ?? null,
                        });
                      }}
                      onSuccess={() => refetchFarm()}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xl font-bold mb-4">All pools</h2>
        {poolsLoading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {pools.map((pool: any) => (
              <div
                key={pool.address ?? pool.contract}
                className="rounded-xl border p-3 text-sm flex items-center justify-between"
              >
                <span className="font-medium">{pool.pair}</span>
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${pool.address ?? pool.contract}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Contract <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
