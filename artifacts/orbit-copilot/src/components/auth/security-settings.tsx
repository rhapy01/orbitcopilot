/**
 * Security settings — email, passkeys, TOTP, export.
 * Lost-phone recovery = verified email + TOTP only (no passphrase).
 */

import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Fingerprint,
  ShieldCheck,
  QrCode,
  Loader2,
  Plus,
  Check,
  AlertCircle,
  Download,
  Mail,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";

interface SecuritySettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Tab = "overview" | "email" | "passkey" | "totp" | "export";

export function SecuritySettings({ open, onOpenChange }: SecuritySettingsProps) {
  const wallet = useWallet();
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [passkeyName, setPasskeyName] = useState("");
  const [email, setEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const [totpData, setTotpData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");

  const [exportTotp, setExportTotp] = useState("");
  const [exportedSecret, setExportedSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  if (wallet.type !== "internal") return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "email", label: "Email" },
    { id: "passkey", label: "Passkeys" },
    { id: "totp", label: "Authenticator" },
    { id: "export", label: "Export" },
  ];

  async function handleRegisterPasskey() {
    clearMessages();
    setLoading(true);
    try {
      await wallet.registerPasskey(passkeyName || undefined);
      setSuccess("Passkey registered");
      setPasskeyName("");
      await wallet.refreshSecurity();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendEmailOtp() {
    clearMessages();
    setLoading(true);
    try {
      await wallet.bindEmailSendOtp(email);
      setEmailSent(true);
      setSuccess("Code sent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send";
      setError(
        /already in use|already has an Orbit account/i.test(msg)
          ? "This email already belongs to another Orbit account. Log out, then use Connect → Sign in with email."
          : msg
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyEmail() {
    clearMessages();
    setLoading(true);
    try {
      await wallet.bindEmailVerify(email, emailOtp);
      setSuccess("Email verified");
      setEmailSent(false);
      setEmailOtp("");
      await wallet.refreshSecurity();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupTotp() {
    clearMessages();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/setup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTotpData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyTotp() {
    clearMessages();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess("Authenticator enabled — lost-phone recovery is ready");
      setTotpData(null);
      setTotpCode("");
      await wallet.refreshSecurity();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    clearMessages();
    setLoading(true);
    try {
      const result = await wallet.exportWallet(exportTotp);
      setExportedSecret(result.secretKey);
      setShowSecret(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[#0f1117] border-[#1e2236] text-white">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-violet-400" />
            Security settings
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 bg-[#1a1d2e] rounded-lg p-1 mt-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                clearMessages();
                if (t.id !== "export") setExportedSecret(null);
              }}
              className={`flex-1 text-[11px] py-1.5 px-1 rounded-md whitespace-nowrap ${
                tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-3 mt-2">
            <div className={`rounded-lg border p-3 text-sm ${wallet.recoveryReady ? "border-green-900/50 bg-green-950/20 text-green-300" : "border-amber-900/50 bg-amber-950/20 text-amber-200"}`}>
              {wallet.recoveryReady
                ? "Lost-phone recovery is ON — email + authenticator can restore this wallet."
                : "Recovery incomplete — verify email and enable authenticator, or a lost phone means permanent loss."}
            </div>
            <div className="rounded-lg border border-[#2a2d3e] p-4 space-y-2 text-sm">
              <p className="text-xs text-slate-500 uppercase">Account</p>
              <p>{wallet.authUser?.email ?? "No email yet"}</p>
              <p className="text-xs font-mono text-slate-500 break-all">{wallet.publicKey}</p>
            </div>
            <div className="rounded-lg border border-[#2a2d3e] p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>Email verified</span><span className={wallet.emailVerified ? "text-green-400" : "text-slate-500"}>{wallet.emailVerified ? "Yes" : "No"}</span></div>
              <div className="flex justify-between"><span>Authenticator</span><span className={wallet.totpEnabled ? "text-green-400" : "text-slate-500"}>{wallet.totpEnabled ? "On" : "Off"}</span></div>
              <div className="flex justify-between"><span>Passkeys</span><span>{wallet.passkeyCount}</span></div>
              <div className="flex justify-between"><span>This device</span><span className={wallet.hasDeviceShare ? "text-green-400" : "text-amber-400"}>{wallet.hasDeviceShare ? "Ready" : "Needs recovery"}</span></div>
            </div>
          </div>
        )}

        {tab === "email" && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-slate-400">
              Verified email is required for lost-phone recovery (with authenticator).
            </p>
            {wallet.emailVerified && (
              <div className="flex items-center gap-2 text-green-400 text-sm bg-green-900/20 rounded-lg p-3">
                <Check className="w-4 h-4" /> {wallet.authUser?.email}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300">{wallet.emailVerified ? "Change email" : "Email"}</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-[#1a1d2e] border-[#2a2d3e] text-white"
              />
            </div>
            {emailSent && (
              <Input
                placeholder="6-digit code"
                maxLength={6}
                value={emailOtp}
                onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ""))}
                className="bg-[#1a1d2e] border-[#2a2d3e] text-white text-center tracking-widest"
              />
            )}
            {error && <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
            {success && <div className="flex items-center gap-2 text-green-400 text-sm"><Check className="w-4 h-4" />{success}</div>}
            {!emailSent ? (
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleSendEmailOtp} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
                Send verification code
              </Button>
            ) : (
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleVerifyEmail} disabled={loading || emailOtp.length !== 6}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Verify email"}
              </Button>
            )}
          </div>
        )}

        {tab === "passkey" && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-slate-400">Passkeys are for signing in — not for recovery. Keep email + TOTP set.</p>
            <Input
              placeholder="Device name (optional)"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              className="bg-[#1a1d2e] border-[#2a2d3e] text-white"
            />
            {error && <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
            {success && <div className="flex items-center gap-2 text-green-400 text-sm"><Check className="w-4 h-4" />{success}</div>}
            <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleRegisterPasskey} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              <Fingerprint className="w-4 h-4 mr-2" /> Register passkey
            </Button>
          </div>
        )}

        {tab === "totp" && (
          <div className="space-y-4 mt-2">
            {!totpData ? (
              <>
                <p className="text-sm text-slate-400">Authenticator is required for recovery and secret export.</p>
                {wallet.totpEnabled && (
                  <div className="flex items-center gap-2 text-green-400 text-sm bg-green-900/20 rounded-lg p-3">
                    <Check className="w-4 h-4" /> Authenticator enabled
                  </div>
                )}
                {error && <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
                <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleSetupTotp} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <QrCode className="w-4 h-4 mr-2" />}
                  {wallet.totpEnabled ? "Re-configure" : "Set up authenticator"}
                </Button>
              </>
            ) : (
              <>
                <div className="flex justify-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpData.otpauthUrl)}`}
                    alt="TOTP QR"
                    width={180}
                    height={180}
                    className="rounded-lg"
                  />
                </div>
                <p className="text-xs text-center font-mono text-slate-400">{totpData.secret}</p>
                <Input
                  placeholder="000000"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  className="bg-[#1a1d2e] border-[#2a2d3e] text-white text-center tracking-widest"
                />
                {error && <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
                <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleVerifyTotp} disabled={loading || totpCode.length !== 6}>
                  Confirm
                </Button>
              </>
            )}
          </div>
        )}

        {tab === "export" && (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200/90">
              Reveals your full Stellar secret key (S…). Anyone with it controls your funds.
            </div>
            {!wallet.recoveryReady && (
              <p className="text-xs text-amber-400">Verify email and enable authenticator before exporting.</p>
            )}
            {!exportedSecret ? (
              <>
                <Input
                  placeholder="Authenticator code"
                  maxLength={6}
                  value={exportTotp}
                  onChange={(e) => setExportTotp(e.target.value.replace(/\D/g, ""))}
                  className="bg-[#1a1d2e] border-[#2a2d3e] text-white text-center tracking-widest"
                />
                {error && <div className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700"
                  onClick={handleExport}
                  disabled={loading || !wallet.recoveryReady || !wallet.hasDeviceShare || exportTotp.length !== 6}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                  Reveal secret key
                </Button>
              </>
            ) : (
              <>
                <div className="relative">
                  <Input
                    readOnly
                    type={showSecret ? "text" : "password"}
                    value={exportedSecret}
                    className="bg-[#1a1d2e] border-[#2a2d3e] text-white font-mono text-xs pr-20"
                  />
                  <div className="absolute right-1 top-1 flex gap-1">
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowSecret((v) => !v)}>
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={async () => {
                        await navigator.clipboard.writeText(exportedSecret);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
                <Button variant="outline" className="w-full border-[#2a2d3e]" onClick={() => { setExportedSecret(null); setExportTotp(""); }}>
                  Hide
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
