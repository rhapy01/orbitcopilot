/** Stellar Testnet passphrase (Freighter + Soroban). */
export const STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/** Public Soroban RPC for testnet. */
export const SOROBAN_RPC_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL?.trim() ||
  "https://soroban-testnet.stellar.org";
