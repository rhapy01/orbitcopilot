import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { track } from "@/lib/analytics";

interface FreighterState {
  isInstalled: boolean;
  isConnected: boolean;
  publicKey: string | null;
  network: string | null;
  networkPassphrase: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
}

const FreighterContext = createContext<FreighterState>({
  isInstalled: false,
  isConnected: false,
  publicKey: null,
  network: null,
  networkPassphrase: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  signTransaction: async () => {
    throw new Error("Freighter is not connected");
  },
});

export function FreighterProvider({ children }: { children: React.ReactNode }) {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const freighter = await import("@stellar/freighter-api");
        const connResult = await freighter.isConnected();
        if (!connResult.isConnected) {
          setIsInstalled(false);
          return;
        }
        setIsInstalled(true);

        // Already allowed — get address silently
        const isAllowedResult = await freighter.isAllowed();
        if (isAllowedResult.isAllowed) {
          const addrResult = await freighter.getAddress();
          if (!addrResult.error && addrResult.address) {
            const netResult = await freighter.getNetworkDetails();
            setPublicKey(addrResult.address);
            const isTestnet = Boolean(netResult.networkPassphrase?.includes("Test"));
            setNetwork(isTestnet ? "Testnet" : netResult.network ?? "Unknown");
            setNetworkPassphrase(netResult.networkPassphrase ?? null);
            setIsConnected(true);
            if (!isTestnet) {
              console.warn("Orbit is testnet-only. Switch Freighter to Testnet.");
            }
          }
        }
      } catch {
        setIsInstalled(false);
      }
    };
    check();
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const freighter = await import("@stellar/freighter-api");
      setIsInstalled(true);
      const accessResult = await freighter.requestAccess();
      if (accessResult.error) throw new Error(accessResult.error.message);

      const addrResult = await freighter.getAddress();
      if (addrResult.error) throw new Error(addrResult.error.message);

      const netResult = await freighter.getNetworkDetails();
      const isTestnet = Boolean(netResult.networkPassphrase?.includes("Test"));
      setPublicKey(addrResult.address);
      setNetwork(isTestnet ? "Testnet" : netResult.network ?? "Unknown");
      setNetworkPassphrase(netResult.networkPassphrase ?? null);
      setIsConnected(true);
      track("wallet_connect", {
        walletPublicKey: addrResult.address,
        metadata: { network: isTestnet ? "testnet" : netResult.network },
      });
      if (!isTestnet) {
        console.warn("Orbit is testnet-only. Switch Freighter to Testnet.");
      }
    } catch (err) {
      console.error("Freighter connect error:", err);
      track("error", {
        metadata: {
          source: "freighter_connect",
          message: err instanceof Error ? err.message : "connect failed",
        },
      });
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    track("wallet_disconnect", { walletPublicKey: publicKey });
    // Clear stored session so next connection starts fresh
    try {
      const key = `orbit-active-session-${publicKey ?? "anon"}`;
      sessionStorage.removeItem(key);
    } catch { /* ignore */ }
    setPublicKey(null);
    setNetwork(null);
    setNetworkPassphrase(null);
    setIsConnected(false);
  }, [publicKey]);

  const signTransaction = useCallback(
    async (xdr: string, passphrase: string): Promise<string> => {
      if (!publicKey) throw new Error("Connect Freighter before signing");
      const freighter = await import("@stellar/freighter-api");
      const result = await freighter.signTransaction(xdr, {
        networkPassphrase: passphrase,
        address: publicKey,
      });
      if (result.error) throw new Error(result.error.message);
      return result.signedTxXdr;
    },
    [publicKey]
  );

  return (
    <FreighterContext.Provider
      value={{
        isInstalled,
        isConnected,
        publicKey,
        network,
        networkPassphrase,
        connecting,
        connect,
        disconnect,
        signTransaction,
      }}
    >
      {children}
    </FreighterContext.Provider>
  );
}

export function useFreighter() {
  return useContext(FreighterContext);
}
