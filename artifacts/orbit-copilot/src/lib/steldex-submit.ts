/**
 * Unicorn StelDex write flow (integration guide §5-6):
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

export function fromSteldexUnits(raw: string, decimals: number): string {
 const bi = BigInt(raw);
 const base = 10n ** BigInt(decimals);
 const whole = bi / base;
 const frac = bi % base;
 const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
 if (!fracStr) return whole.toString();
 return `${whole}.${fracStr}`;
}

export function formatReceiveEstimate(amount: string, destAsset: string): string {
 const n = parseFloat(amount);
 if (!Number.isFinite(n)) return amount;
 const maxDecimals = steldexDecimals(destAsset);
 if (n > 0 && n < 0.000_001) return n.toExponential(4);
 if (n < 0.01) return n.toFixed(Math.min(maxDecimals, 7));
 if (n < 1) return n.toFixed(Math.min(maxDecimals, 6));
 return n.toFixed(Math.min(maxDecimals, 4));
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

/** Decode common TransactionResult XDR prefixes into plain English. */
export function explainSorobanSubmitError(errorResultXdr: string): string {
 const x = errorResultXdr.trim();
 const lower = x.toLowerCase();
 // Horizon / RPC sometimes surface this as JSON { "transaction": "tx_too_late" }
 if (
 lower.includes("tx_too_late") ||
 lower.includes("txtoolate") ||
 lower.includes("too_late") ||
 lower.includes("too late")
 ) {
 return "This transaction expired (time bounds). Refreshing a fresh one - try again.";
 }
 // txBAD_SEQ - very common right after a trustline bumps account sequence
 if (x.startsWith("AAAAAAAAAAD////7AAAAAA") || x.includes("////7")) {
 return "Wallet sequence was out of date (often right after enabling an asset). Please try the swap again.";
 }
 // txINSUFFICIENT_BALANCE
 if (x.includes("////+") || x.includes("////-")) {
 return "Insufficient balance or fees for this transaction.";
 }
 // txNO_ACCOUNT
 if (x.startsWith("AAAAAAAAAAD////+AAAAAA")) {
 return "Account not found on the network yet. Wait a moment and try again.";
 }
 // Generic empty-looking result
 if (/^A{8,}/.test(x) && x.length < 48) {
 return "Submit rejected - usually a stale sequence after a prior transaction. Retry the swap.";
 }
 return `Submit failed: ${x.length > 40 ? x.slice(0, 40) + "…" : x}`;
}

export function isTxTooLateError(message: string): boolean {
 const r = message.toLowerCase();
 return (
 r.includes("tx_too_late") ||
 r.includes("txtoolate") ||
 r.includes("too_late") ||
 r.includes("too late") ||
 r.includes("expired (time bounds)") ||
 r.includes("time bounds") ||
 r.includes("expired while waiting") ||
 r.includes("tap refresh")
 );
}

export async function submitSignedToSoroban(signedXdr: string): Promise<string> {
 const send = await sorobanRpc("sendTransaction", { transaction: signedXdr });
 if (send.status === "ERROR") {
 const raw =
 typeof send.errorResultXdr === "string" ? send.errorResultXdr : "Submit failed";
 throw new Error(
 typeof send.errorResultXdr === "string" ? explainSorobanSubmitError(raw) : raw
 );
 }
 if (send.status === "DUPLICATE" && send.hash) {
 await pollTx(send.hash);
 return send.hash as string;
 }
 if (send.status === "TRY_AGAIN_LATER") {
 await new Promise((r) => setTimeout(r, 1500));
 const retry = await sorobanRpc("sendTransaction", { transaction: signedXdr });
 if (retry.status === "ERROR") {
 const raw =
 typeof retry.errorResultXdr === "string" ? retry.errorResultXdr : "Submit failed";
 throw new Error(
 typeof retry.errorResultXdr === "string" ? explainSorobanSubmitError(raw) : raw
 );
 }
 if (!retry.hash) throw new Error("No transaction hash from Soroban RPC");
 await pollTx(retry.hash);
 return retry.hash as string;
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
 * Retries once from scratch on sequence-stale errors (common after trustline).
 */
export async function buildAndSubmitSteldex(
 endpoint: SteldexWriteEndpoint,
 body: Record<string, unknown>,
 walletAddress: string,
 signTx: (xdr: string) => Promise<string>,
 onProgress?: (message: string, step?: { current: number; total: number }) => void
): Promise<string> {
 const run = async (): Promise<string> => {
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
 for (let i = 0; i < steps.length; i++) {
 const step = steps[i];
 const stepCount = { current: i + 1, total: steps.length };
 const label = step.label || step.id || "transaction";
 onProgress?.(`Preparing: ${label}`, stepCount);

 let xdr = step.xdr ?? undefined;

 if (!xdr && data.sequential && step.id) {
 const stepData = await postSteldex(endpoint, { ...payload, stepId: step.id });
 xdr = stepData.xdr ?? undefined;
 }

 if (!xdr) {
 throw new Error(`No XDR for step ${step.id ?? label}`);
 }

 onProgress?.(`Sign with your wallet: ${label}`, stepCount);
 const signed = await signTx(xdr);

 onProgress?.(`Submitting: ${label}`, stepCount);
 lastHash = await submitSignedToSoroban(signed);
 }

 return lastHash;
 };

 try {
 return await run();
 } catch (err: any) {
 const msg = String(err?.message ?? "");
 const retryable =
 msg.toLowerCase().includes("sequence") ||
 msg.toLowerCase().includes("out of date") ||
 msg.toLowerCase().includes("stale") ||
 msg.toLowerCase().includes("try again");
 if (!retryable) throw err;
 onProgress?.("Network catching up - rebuilding swap…");
 await new Promise((r) => setTimeout(r, 2500));
 return await run();
 }
}

export function steldexExplorerTxUrl(hash: string): string {
 return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
