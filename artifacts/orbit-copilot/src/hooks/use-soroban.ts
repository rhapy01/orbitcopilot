export const STELDEX_SOROBAN_RPC = "https://soroban-testnet.stellar.org";
export const STELDEX_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

async function sorobanRpc(method: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(STELDEX_SOROBAN_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Soroban RPC error");
  return data.result;
}

async function pollSorobanTx(hash: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const tx = await sorobanRpc("getTransaction", { hash });
    if (tx.status === "SUCCESS") return;
    if (tx.status === "FAILED") throw new Error("Transaction failed on-chain");
  }
  throw new Error("Confirmation timeout — check the explorer for final status");
}

export async function submitSignedToSoroban(signedXdr: string): Promise<string> {
  const send = await sorobanRpc("sendTransaction", { transaction: signedXdr });
  if (send.status === "ERROR") {
    throw new Error(send.errorResultXdr ? "Transaction rejected by network" : "Submit failed");
  }
  if (!send.hash) throw new Error("No transaction hash returned");
  await pollSorobanTx(send.hash);
  return send.hash;
}
