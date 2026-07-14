/**
 * Connect modal — passkey-first signup, email login, lost-phone recovery,
 * and mandatory email + TOTP recovery setup after signup.
 */

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Loader2,
  Mail,
  Fingerprint,
  Wallet,
  AlertCircle,
  CheckCircle2,
  Shield,
  KeyRound,
  QrCode,
} from "lucide-react";

type Step =
  | "choose"
  | "email"
  | "otp"
  | "setup-email"
  | "setup-email-otp"
  | "setup-totp"
  | "setup-totp-confirm"
  | "recover-email"
  | "recover-codes"
  | "done";

interface WalletConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletConnectModal({ open, onOpenChange }: WalletConnectModalProps) {
  const wallet = useWallet();

  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpData, setTotpData] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function reset() {
    setStep("choose");
    setEmail("");
    setOtpCode("");
    setTotpCode("");
    setTotpData(null);
    setError(null);
    setLoading(false);
  }

  function handleClose(val: boolean) {
    // Don't allow dismissing mid recovery-setup if they just signed up without email+TOTP
    if (!val && wallet.type === "internal" && wallet.requiresRecoverySetup) {
      // allow close but they'll see banner in layout
    }
    onOpenChange(val);
    if (!val) reset();
  }

  useEffect(() => {
    if (!open) return;
    if (wallet.type === "internal" && wallet.needsRecovery && wallet.recoveryReady) {
      setStep("recover-email");
    } else if (wallet.type === "internal" && wallet.requiresRecoverySetup) {
      if (!wallet.emailVerified) setStep("setup-email");
      else if (!wallet.totpEnabled) setStep("setup-totp");
    }
  }, [open, wallet.type, wallet.needsRecovery, wallet.recoveryReady, wallet.requiresRecoverySetup, wallet.emailVerified, wallet.totpEnabled]);

  async function afterLogin(result: { needsRecovery: boolean; requiresRecoverySetup: boolean }) {
    if (result.needsRecovery) {
      if (result.requiresRecoverySetup === false || wallet.recoveryReady) {
        setStep("recover-email");
        return;
      }
      setError(
        "This device isn't unlocked and recovery isn't set up (email + authenticator). Use the original device."
      );
      setStep("choose");
      return;
    }
    if (result.requiresRecoverySetup) {
      setStep("setup-email");
      return;
    }
    setStep("done");
    setTimeout(() => handleClose(false), 1000);
  }

  async function handleSignupPasskey(pendingBindEmail?: string) {
    setError(null);
    setLoading(true);
    try {
      const result = await wallet.signupWithPasskey();
      const toBind = (pendingBindEmail ?? email).trim();
      if (toBind && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toBind)) {
        try {
          await wallet.bindEmailSendOtp(toBind);
          setStep("setup-email-otp");
          return;
        } catch (bindErr) {
          const flow = (bindErr as Error & { flow?: string }).flow;
          if (flow === "login" || /already in use|already has an Orbit/i.test(
            bindErr instanceof Error ? bindErr.message : ""
          )) {
            try {
              await wallet.logout();
            } catch {
              /* ignore */
            }
            // Server already sent login OTP when flow === "login"
            if (flow !== "login") {
              await wallet.continueWithEmail(toBind);
            }
            setOtpCode("");
            setStep("otp");
            return;
          }
          throw bindErr;
        }
      }
      if (result.requiresRecoverySetup) setStep("setup-email");
      else {
        setStep("done");
        setTimeout(() => handleClose(false), 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey signup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeyLogin() {
    setError(null);
    setLoading(true);
    try {
      const result = await wallet.loginWithPasskey(email || undefined);
      await afterLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey login failed");
    } finally {
      setLoading(false);
    }
  }

  /** One email field: existing → login OTP; new → passkey signup then verify that email */
  async function handleContinueWithEmail() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { flow } = await wallet.continueWithEmail(email);
      if (flow === "login") {
        setOtpCode("");
        setStep("otp");
        return;
      }
      // New email — create passkey wallet, then bind + verify this address
      await handleSignupPasskey(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue with email");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyLoginOtp() {
    if (otpCode.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const result = await wallet.verifyOtp(email, otpCode);
      await afterLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setOtpCode("");
    } finally {
      setLoading(false);
    }
  }

  async function handleFreighter() {
    setError(null);
    setLoading(true);
    try {
      await wallet.connectFreighter();
      handleClose(false);
    } catch (err) {
      setError(
        wallet.freighterInstalled
          ? err instanceof Error
            ? err.message
            : "Connection failed"
          : "Freighter not found — install from freighter.app"
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Recovery setup: email ─────────────────────────────────────────────────
  async function handleBindEmailSend() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email — required to recover if you lose your phone");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await wallet.bindEmailSendOtp(email);
      setStep("setup-email-otp");
    } catch (err) {
      const flow = (err as Error & { flow?: string }).flow;
      const msg = err instanceof Error ? err.message : "Failed to send code";
      if (flow === "login" || /already in use|already has an Orbit/i.test(msg)) {
        try {
          await wallet.logout();
        } catch {
          /* ignore */
        }
        if (flow !== "login") {
          await wallet.continueWithEmail(email);
        }
        setOtpCode("");
        setStep("otp");
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleBindEmailVerify() {
    if (otpCode.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      await wallet.bindEmailVerify(email, otpCode);
      setOtpCode("");
      setStep("setup-totp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
      setOtpCode("");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupTotp() {
    setError(null);
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
      setStep("setup-totp-confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "TOTP setup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmTotp() {
    if (totpCode.length !== 6) return;
    setError(null);
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
      await wallet.refreshSecurity();
      setStep("done");
      setTimeout(() => handleClose(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid authenticator code");
    } finally {
      setLoading(false);
    }
  }

  // ── Lost phone recover ────────────────────────────────────────────────────
  async function handleRecoverSendOtp() {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter the email on your Orbit account");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await fetch("/api/auth/recover/send-otp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      });
      setStep("recover-codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send recovery email");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecoverComplete() {
    if (otpCode.length !== 6 || totpCode.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      await wallet.recoverWallet(email, otpCode, totpCode);
      setStep("done");
      setTimeout(() => handleClose(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-[#0f1117] border-[#1e2236] text-white">
        {step === "choose" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold">Connect wallet</DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                Enter your email — we’ll sign you in if you already have an account, or create one if you don’t.
              </p>
            </DialogHeader>

            <div className="space-y-3 mt-4">
              <div className="rounded-xl border border-[#2a2d3e] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
                    <Mail className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Orbit embedded wallet</p>
                    <p className="text-xs text-slate-500">Email · passkey · recoverable via authenticator</p>
                  </div>
                </div>
                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => { setError(null); setStep("email"); }}
                  disabled={loading}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Continue with email
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-[#2a2d3e] text-slate-300 hover:bg-[#1a1d2e]"
                  onClick={handlePasskeyLogin}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Fingerprint className="w-4 h-4 mr-2" />}
                  Use passkey on this device
                </Button>
                <Button
                  variant="link"
                  className="w-full text-xs text-amber-400/90"
                  onClick={() => { setError(null); setStep("recover-email"); }}
                >
                  Lost your phone? Recover with email + authenticator
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#1e2236]" />
                <span className="text-xs text-slate-500">or</span>
                <div className="flex-1 h-px bg-[#1e2236]" />
              </div>

              <Button
                variant="outline"
                className="w-full border-[#2a2d3e] text-slate-300 hover:bg-[#1a1d2e]"
                onClick={handleFreighter}
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
                Connect Freighter
              </Button>
            </div>

            {error && (
              <div className="flex items-center gap-2 mt-3 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
          </>
        )}

        {step === "email" && (
          <>
            <DialogHeader>
              <DialogTitle>Continue with email</DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                If this email already has an Orbit wallet, we’ll send a sign-in code. If it’s new, we’ll create a wallet and verify the address.
              </p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-[#1a1d2e] border-[#2a2d3e] text-white"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleContinueWithEmail();
                }}
              />
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" className="text-slate-400" onClick={() => setStep("choose")}>Back</Button>
                <Button className="flex-1 bg-violet-600 hover:bg-violet-700" onClick={handleContinueWithEmail} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "otp" && (
          <>
            <DialogHeader>
              <DialogTitle>Check your email</DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                Sign-in code sent to <span className="text-violet-400">{email}</span>
              </p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} className="border-[#2a2d3e] bg-[#1a1d2e] text-white text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="text-slate-400"
                  onClick={() => {
                    setOtpCode("");
                    setStep("email");
                  }}
                >
                  Back
                </Button>
                <Button className="flex-1 bg-violet-600 hover:bg-violet-700" onClick={handleVerifyLoginOtp} disabled={loading || otpCode.length !== 6}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                </Button>
              </div>
              <p className="text-xs text-slate-500 text-center">
                This is a sign-in code for your existing account — not a new signup.
              </p>
            </div>
          </>
        )}

        {step === "setup-email" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-violet-400" />
                Protect against phone loss
              </DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                Verify an email now. Together with an authenticator app, this is the <strong className="text-slate-200">only</strong> way to recover if you lose your phone.
              </p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Recovery email</Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-[#1a1d2e] border-[#2a2d3e] text-white"
                  autoFocus
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleBindEmailSend} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send verification code"}
              </Button>
              <p className="text-xs text-slate-500 text-center">
                Already used this email before? We’ll detect that and send a sign-in code instead.
              </p>
            </div>
          </>
        )}

        {step === "setup-email-otp" && (
          <>
            <DialogHeader>
              <DialogTitle>Verify email</DialogTitle>
              <p className="text-sm text-slate-400 mt-1">Enter the code sent to {email}</p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} className="border-[#2a2d3e] bg-[#1a1d2e] text-white text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleBindEmailVerify} disabled={loading || otpCode.length !== 6}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify email"}
              </Button>
            </div>
          </>
        )}

        {step === "setup-totp" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-violet-400" />
                Set up authenticator
              </DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                Required for recovery and export. Use Google Authenticator, Authy, or 1Password.
              </p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleSetupTotp} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
              </Button>
            </div>
          </>
        )}

        {step === "setup-totp-confirm" && totpData && (
          <>
            <DialogHeader>
              <DialogTitle>Scan QR code</DialogTitle>
              <p className="text-sm text-slate-400 mt-1">Then enter the 6-digit code to confirm</p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="flex justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpData.otpauthUrl)}`}
                  alt="TOTP QR"
                  width={180}
                  height={180}
                  className="rounded-lg"
                />
              </div>
              <p className="text-xs text-slate-500 text-center font-mono">{totpData.secret}</p>
              <Input
                placeholder="000000"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                className="bg-[#1a1d2e] border-[#2a2d3e] text-white text-center text-xl tracking-widest"
              />
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={handleConfirmTotp} disabled={loading || totpCode.length !== 6}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enable recovery"}
              </Button>
            </div>
          </>
        )}

        {step === "recover-email" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-violet-400" />
                Recover wallet
              </DialogTitle>
              <p className="text-sm text-slate-400 mt-1">
                Email code + authenticator code required. This invalidates your old device.
              </p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input
                type="email"
                placeholder="Recovery email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-[#1a1d2e] border-[#2a2d3e] text-white"
                autoFocus
              />
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" className="text-slate-400" onClick={() => setStep("choose")}>Back</Button>
                <Button className="flex-1 bg-violet-600 hover:bg-violet-700" onClick={handleRecoverSendOtp} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send email code"}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "recover-codes" && (
          <>
            <DialogHeader>
              <DialogTitle>Enter both codes</DialogTitle>
              <p className="text-sm text-slate-400 mt-1">Email OTP and authenticator app</p>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Email code</Label>
                <Input
                  placeholder="000000"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="bg-[#1a1d2e] border-[#2a2d3e] text-white text-center tracking-widest"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Authenticator code</Label>
                <Input
                  placeholder="000000"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  className="bg-[#1a1d2e] border-[#2a2d3e] text-white text-center tracking-widest"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
              <Button
                className="w-full bg-violet-600 hover:bg-violet-700"
                onClick={handleRecoverComplete}
                disabled={loading || otpCode.length !== 6 || totpCode.length !== 6}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Restore this device"}
              </Button>
            </div>
          </>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-lg font-medium">Ready</p>
            <p className="text-sm text-slate-400 text-center">
              {wallet.recoveryReady
                ? "Wallet protected — recoverable with email + authenticator"
                : "Your Orbit wallet is connected"}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
