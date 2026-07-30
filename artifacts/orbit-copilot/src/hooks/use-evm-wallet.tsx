/**
 * EVM wallet layer for CCTP bridge-in.
 * - injected: MetaMask / browser wallet (window.ethereum)
 * - internal: Orbit secp256k1 key (2-of-2 shares, same pattern as Stellar)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type EvmWalletKind = "injected" | "internal" | null;

export type EvmTxRequest = {
  to: string;
  data: string;
  value?: string;
  chainId: number;
};

type EvmWalletState = {
  evmAddress: string | null;
  evmKind: EvmWalletKind;
  evmConnecting: boolean;
  hasInjectedProvider: boolean;
  connectInjected: () => Promise<string>;
  ensureOrbitEvm: () => Promise<string>;
  disconnectEvm: () => void;
  sendEvmTx: (
    tx: EvmTxRequest,
    opts?: { sourceChain?: string; address?: string; kind?: EvmWalletKind }
  ) => Promise<string>;
  switchChain: (chainId: number) => Promise<void>;
};

const EVM_SHARE_KEY = "orbit_evm_device_share";

export function saveEvmShare(address: string, share: string) {
  try {
    localStorage.setItem(`${EVM_SHARE_KEY}_${address.toLowerCase()}`, share);
  } catch {
    /* ignore */
  }
}

export function loadEvmShare(address: string): string | null {
  try {
    return localStorage.getItem(`${EVM_SHARE_KEY}_${address.toLowerCase()}`);
  } catch {
    return null;
  }
}

/** Persist Orbit embedded EVM key alongside Stellar (same internal wallet). */
export function persistInternalEvmSession(
  address: string,
  deviceShareHex?: string
) {
  try {
    localStorage.setItem("orbit_evm_address", address);
    localStorage.setItem("orbit_evm_kind", "internal");
  } catch {
    /* ignore */
  }
  if (deviceShareHex) saveEvmShare(address, deviceShareHex);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("orbit-evm-synced", { detail: { address, kind: "internal" } })
    );
  }
}

function getEthereum(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

async function switchOrAddChain(ethereum: any, chainId: number): Promise<void> {
  const hex = `0x${chainId.toString(16)}`;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
  } catch (err: any) {
    // 4902 = unknown chain — try add for Arc / Base Sepolia
    if (err?.code !== 4902 && err?.code !== -32603) throw err;
    const added: Record<number, Record<string, unknown>> = {
      84532: {
        chainId: hex,
        chainName: "Base Sepolia",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://sepolia.base.org"],
        blockExplorerUrls: ["https://sepolia.basescan.org"],
      },
      5042002: {
        chainId: hex,
        chainName: "Arc Testnet",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: ["https://rpc.testnet.arc.io"],
        blockExplorerUrls: ["https://testnet.arcscan.app"],
      },
      11155111: {
        chainId: hex,
        chainName: "Ethereum Sepolia",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
        blockExplorerUrls: ["https://sepolia.etherscan.io"],
      },
    };
    const params = added[chainId];
    if (!params) throw err;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [params],
    });
  }
}

const defaultState: EvmWalletState = {
  evmAddress: null,
  evmKind: null,
  evmConnecting: false,
  hasInjectedProvider: false,
  connectInjected: async () => {
    throw new Error("EVM provider not ready");
  },
  ensureOrbitEvm: async () => {
    throw new Error("EVM provider not ready");
  },
  disconnectEvm: () => {},
  sendEvmTx: async () => {
    throw new Error("No EVM wallet connected");
  },
  switchChain: async () => {},
};

const EvmWalletContext = createContext<EvmWalletState>(defaultState);

export function EvmWalletProvider({ children }: { children: ReactNode }) {
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [evmKind, setEvmKind] = useState<EvmWalletKind>(null);
  const [evmConnecting, setEvmConnecting] = useState(false);
  const [hasInjectedProvider, setHasInjectedProvider] = useState(false);

  useEffect(() => {
    const restoreLocal = () => {
      try {
        const saved = localStorage.getItem("orbit_evm_address");
        const kind = localStorage.getItem("orbit_evm_kind") as EvmWalletKind;
        if (saved && kind === "internal" && loadEvmShare(saved)) {
          setEvmAddress(saved);
          setEvmKind("internal");
        } else if (saved && kind === "injected") {
          setEvmAddress(saved);
          setEvmKind("injected");
        }
      } catch {
        /* ignore */
      }
    };
    restoreLocal();

    // Probe injected providers after idle — wallet extensions are expensive on the main thread.
    const probeInjected = () => setHasInjectedProvider(Boolean(getEthereum()));
    let idleId = 0;
    let timeoutId = 0;
    if ("requestIdleCallback" in window) {
      idleId = requestIdleCallback(probeInjected, { timeout: 3000 });
    } else {
      timeoutId = globalThis.setTimeout(probeInjected, 600) as unknown as number;
    }

    const onSync = () => restoreLocal();
    window.addEventListener("orbit-evm-synced", onSync);
    return () => {
      window.removeEventListener("orbit-evm-synced", onSync);
      if (idleId && "cancelIdleCallback" in window) cancelIdleCallback(idleId);
      if (timeoutId) globalThis.clearTimeout(timeoutId);
    };
  }, []);

  const persist = useCallback((address: string, kind: EvmWalletKind) => {
    setEvmAddress(address);
    setEvmKind(kind);
    try {
      localStorage.setItem("orbit_evm_address", address);
      localStorage.setItem("orbit_evm_kind", kind ?? "");
    } catch {
      /* ignore */
    }
  }, []);

  const disconnectEvm = useCallback(() => {
    setEvmAddress(null);
    setEvmKind(null);
    try {
      localStorage.removeItem("orbit_evm_address");
      localStorage.removeItem("orbit_evm_kind");
    } catch {
      /* ignore */
    }
  }, []);

  const connectInjected = useCallback(async () => {
    const ethereum = getEthereum();
    if (!ethereum) throw new Error("No browser wallet found — install MetaMask");
    setEvmConnecting(true);
    try {
      const accounts: string[] = await ethereum.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      if (!address) throw new Error("No account returned");
      persist(address, "injected");
      return address;
    } finally {
      setEvmConnecting(false);
    }
  }, [persist]);

  const ensureOrbitEvm = useCallback(async () => {
    setEvmConnecting(true);
    try {
      const res = await fetch("/api/internal-wallet/evm", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Sign in to Orbit (email/passkey) first"
        );
      }
      let address = String(data.address);
      if (typeof data.deviceShareHex === "string" && data.deviceShareHex) {
        saveEvmShare(address, data.deviceShareHex);
      }
      if (!loadEvmShare(address)) {
        // Existing Stellar user / this device never got the EVM share — claim it.
        let stellarShare: string | null = null;
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("orbit_device_share_")) {
              stellarShare = localStorage.getItem(key);
              if (stellarShare) break;
            }
          }
        } catch {
          /* ignore */
        }
        if (!stellarShare) {
          throw new Error(
            "Orbit wallet device share missing on this browser — recover this device (email + authenticator)"
          );
        }
        const claimRes = await fetch("/api/internal-wallet/evm/claim", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceShareHex: stellarShare }),
        });
        const claimed = await claimRes.json().catch(() => ({}));
        if (!claimRes.ok) {
          throw new Error(
            typeof claimed?.error === "string"
              ? claimed.error
              : "Could not provision EVM key for this device"
          );
        }
        address = String(claimed.address);
        if (typeof claimed.deviceShareHex === "string") {
          saveEvmShare(address, claimed.deviceShareHex);
        }
      }
      if (!loadEvmShare(address)) {
        throw new Error(
          "Orbit wallet device share missing on this browser — recover this device (email + authenticator)"
        );
      }
      persist(address, "internal");
      return address;
    } finally {
      setEvmConnecting(false);
    }
  }, [persist]);

  const switchChain = useCallback(async (chainId: number) => {
    const ethereum = getEthereum();
    if (!ethereum) return;
    await switchOrAddChain(ethereum, chainId);
  }, []);

  const sendEvmTx = useCallback(
    async (
      tx: EvmTxRequest,
      opts?: { sourceChain?: string; address?: string; kind?: EvmWalletKind }
    ) => {
      const address = opts?.address ?? evmAddress;
      const kind = opts?.kind ?? evmKind;
      if (!address || !kind) {
        throw new Error("Connect an EVM wallet first (MetaMask or Orbit EVM)");
      }

      if (kind === "injected") {
        const ethereum = getEthereum();
        if (!ethereum) throw new Error("Browser wallet disconnected");
        await switchOrAddChain(ethereum, tx.chainId);
        const hash: string = await ethereum.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: address,
              to: tx.to,
              data: tx.data,
              value: tx.value ?? "0x0",
            },
          ],
        });
        return hash;
      }

      const share = loadEvmShare(address);
      if (!share) throw new Error("Orbit EVM device share missing — reconnect Orbit EVM");
      const res = await fetch("/api/internal-wallet/evm/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceShareHex: share,
          to: tx.to,
          data: tx.data,
          value: tx.value ?? "0",
          chainId: tx.chainId,
          destChain: opts?.sourceChain,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : `EVM send HTTP ${res.status}`);
      }
      return String(data.hash);
    },
    [evmAddress, evmKind]
  );

  const value = useMemo(
    () => ({
      evmAddress,
      evmKind,
      evmConnecting,
      hasInjectedProvider,
      connectInjected,
      ensureOrbitEvm,
      disconnectEvm,
      sendEvmTx,
      switchChain,
    }),
    [
      evmAddress,
      evmKind,
      evmConnecting,
      hasInjectedProvider,
      connectInjected,
      ensureOrbitEvm,
      disconnectEvm,
      sendEvmTx,
      switchChain,
    ]
  );

  return <EvmWalletContext.Provider value={value}>{children}</EvmWalletContext.Provider>;
}

export function useEvmWallet(): EvmWalletState {
  return useContext(EvmWalletContext);
}
