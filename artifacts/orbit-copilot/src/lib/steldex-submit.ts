/**
 * Unicorn StelDex write flow (integration guide §5–6):
 * POST via our API proxy → sign each XDR in Freighter → submit to Soroban RPC → poll SUCCESS.
 */

export const STELDEX_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const STELDEX_SOROBAN_RPC = "https://soroban-testnet.stellar.org";

export const STELDEX_FULL_RANGE = {
  tickLower: -443580,
  tickUpper: 443580,
} as const;

export const STELDEX_TOKEN_DECIMALS: Record<string, number> = {
  XLM: 7,
  pUSDC: 6,
  PUSDC: 6,
  cUSDC: 7,
  CUSDC: 7,
  EURC: 7,
  STELLAR: 7,
};

export function toSteldexUnits(human: string, decimals: number): string {
  const [wholeRaw, fracRaw = ""] = human.trim().split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + frac).toString();
}

export function steldexDecimals(symbol: string): number {
  const u = symbol.trim().toUpperCase();
  if (u === "PUSDC") return 6;
  return STELDEX_TOKEN_DECIMALS[symbol] ?? STELDEX_TOKEN_DECIMALS[u] ?? 7;
}

export type SteldexWriteEndpoint =
  | "swap"
  | "add-liquidity"
  | "remove-liquidity"
  | "stake"
  | "claim"
  | "unstake"
  | "limit-order"
  | "cancel-order";

interface SteldexStep {
  id?: string;
  label?: string | null;
  xdr?: string | null;
}

interface SteldexTxPayload {
  xdr?: string | null;
  steps?: SteldexStep[] | null;
  sequential?: boolean | null;
  resting?: boolean | null;
  error?: string;
}

async function sorobanRpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(STELDEX_SOROBAN_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Soroban RPC error");
  return data.result;
}

async function pollTx(hash: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const tx = await sorobanRpc("getTransaction", { hash });
    if (tx.status === "SUCCESS") return;
    if (tx.status === "FAILED") throw new Error("Transaction failed on-chain");
  }
  throw new Error("Confirmation timeout");
}

export async function submitSignedToSoroban(signedXdr: string): Promise<string> {
  const send = await sorobanRpc("sendTransaction", { transaction: signedXdr });
  if (send.status === "ERROR") {
    throw new Error(
      typeof send.errorResultXdr === "string"
        ? `Submit failed: ${send.errorResultXdr}`
        : "Submit failed"
    );
  }
  if (!send.hash) throw new Error("No transaction hash from Soroban RPC");
  await pollTx(send.hash);
  return send.hash as string;
}

async function postSteldex(
  endpoint: SteldexWriteEndpoint,
  body: Record<string, unknown>
): Promise<SteldexTxPayload> {
  const res = await fetch(`/api/steldex/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as SteldexTxPayload;
  if (!res.ok) {
    throw new Error(data.error || `StelDex HTTP ${res.status}`);
  }
  return data;
}

/**
 * Orchestrates multi-step StelDex writes: fetch steps, resolve each XDR with stepId,
 * sign in Freighter, submit to Soroban RPC, poll until SUCCESS.
 */
export async function buildAndSubmitSteldex(
  endpoint: SteldexWriteEndpoint,
  body: Record<string, unknown>,
  walletAddress: string,
  signTx: (xdr: string) => Promise<string>,
  onProgress?: (message: string) => void
): Promise<string> {
  const payload = { ...body, walletAddress };
  const data = await postSteldex(endpoint, payload);

  const steps: SteldexStep[] = Array.isArray(data.steps)
    ? data.steps
    : data.xdr
      ? [{ id: "tx", xdr: data.xdr }]
      : [];

  if (steps.length === 0) {
    throw new Error("No transaction steps returned from StelDex");
  }

  let lastHash = "";
  for (const step of steps) {
    const label = step.label || step.id || "transaction";
    onProgress?.(`Preparing: ${label}`);

    let xdr = step.xdr ?? undefined;

    if (!xdr && data.sequential && step.id) {
      const stepData = await postSteldex(endpoint, { ...payload, stepId: step.id });
      xdr = stepData.xdr ?? undefined;
    }

    if (!xdr) {
      throw new Error(`No XDR for step ${step.id ?? label}`);
    }

    onProgress?.(`Sign in Freighter: ${label}`);
    const signed = await signTx(xdr);

    onProgress?.(`Submitting: ${label}`);
    lastHash = await submitSignedToSoroban(signed);
  }

  return lastHash;
}

export function steldexExplorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
