import { useState, useEffect, useCallback, createContext, useContext } from "react";

interface FreighterState {
  isInstalled: boolean;
  isConnected: boolean;
  publicKey: string | null;
  network: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const FreighterContext = createContext<FreighterState>({
  isInstalled: false,
  isConnected: false,
  publicKey: null,
  network: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
});

export function FreighterProvider({ children }: { children: React.ReactNode }) {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const freighter = await import("@stellar/freighter-api");
        const connected = await freighter.isConnected();
        setIsInstalled(true);
        if (connected) {
          const pk = await freighter.getPublicKey();
          const net = await freighter.getNetworkDetails();
          setPublicKey(pk);
          setNetwork(net.networkPassphrase?.includes("Test") ? "testnet" : "mainnet");
          setIsConnected(true);
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
      const pk = await freighter.getPublicKey();
      const net = await freighter.getNetworkDetails();
      setPublicKey(pk);
      setNetwork(net.networkPassphrase?.includes("Test") ? "testnet" : "mainnet");
      setIsConnected(true);
    } catch (err) {
      console.error("Freighter connect error:", err);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setNetwork(null);
    setIsConnected(false);
  }, []);

  return (
    <FreighterContext.Provider value={{ isInstalled, isConnected, publicKey, network, connecting, connect, disconnect }}>
      {children}
    </FreighterContext.Provider>
  );
}

export function useFreighter() {
  return useContext(FreighterContext);
}
