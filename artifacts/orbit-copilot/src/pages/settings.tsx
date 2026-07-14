import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useWallet } from "@/hooks/use-wallet";
import { SecuritySettings } from "@/components/auth/security-settings";
import { ArrowLeft, Shield, Network, Wallet, Mail } from "lucide-react";

function shorten(key: string) {
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}

export default function SettingsPage() {
  const {
    isConnected,
    publicKey,
    type: walletType,
    authUser,
    openConnectModal,
    requiresRecoverySetup,
    recoveryReady,
    totpEnabled,
    passkeyCount,
    emailVerified,
  } = useWallet();
  const [securityOpen, setSecurityOpen] = useState(false);

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-6">
          <div>
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to chat
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">
              <span className="text-orbit-gradient">Settings</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Network, wallet, and recovery for Orbit Copilot.
            </p>
          </div>

          <section className="space-y-2 rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Network className="h-4 w-4 text-primary" />
              Network
            </div>
            <p className="text-sm text-muted-foreground">
              Execution is{" "}
              <span className="font-medium text-foreground">Stellar Testnet</span>{" "}
              only. Mainnet signing is not enabled.
            </p>
            <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
              Test SDF Network ; September 2015
            </p>
          </section>

          <section className="space-y-2 rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Wallet className="h-4 w-4 text-primary" />
              Wallet
            </div>
            {!isConnected || !publicKey ? (
              <button
                type="button"
                onClick={openConnectModal}
                className="rounded-full bg-orbit-gradient px-3 py-1.5 text-xs font-medium text-white"
              >
                Connect wallet
              </button>
            ) : (
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Type: </span>
                  {walletType === "internal" ? "Orbit Wallet" : "Freighter"}
                </p>
                {walletType === "internal" && authUser?.email && (
                  <p className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    {authUser.email}
                  </p>
                )}
                <p className="font-mono text-xs">{shorten(publicKey)}</p>
              </div>
            )}
          </section>

          {walletType === "internal" && isConnected && (
            <section className="space-y-2 rounded-2xl border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Shield className="h-4 w-4 text-primary" />
                Security & recovery
              </div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Email verified: {emailVerified ? "yes" : "no"}</li>
                <li>Authenticator (TOTP): {totpEnabled ? "on" : "off"}</li>
                <li>Passkeys: {passkeyCount}</li>
                <li>
                  Recovery ready:{" "}
                  {recoveryReady
                    ? "yes"
                    : requiresRecoverySetup
                      ? "setup required"
                      : "incomplete"}
                </li>
              </ul>
              <button
                type="button"
                onClick={() => setSecurityOpen(true)}
                className="mt-1 rounded-full border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
              >
                Open security settings
              </button>
            </section>
          )}
        </div>
      </div>
      <SecuritySettings open={securityOpen} onOpenChange={setSecurityOpen} />
    </Layout>
  );
}
