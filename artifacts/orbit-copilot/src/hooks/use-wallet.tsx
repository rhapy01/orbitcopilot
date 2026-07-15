/**
 * Unified wallet context - production auth model.
 *
 * Signup: passkey-first → then mandatory email verify + TOTP (recovery setup)
 * Login: passkey or email OTP
 * Lost phone: email OTP + TOTP → new device share (only if both were set)
 * Export: requires recovery setup + TOTP + device share
 */

import {
 createContext,
 useContext,
 useState,
 useEffect,
 useCallback,
 useRef,
 type ReactNode,
} from "react";
import { track } from "@/lib/analytics";

export type WalletType = "external" | "internal" | null;

export interface AuthUser {
 id: number;
 email: string | null;
 displayName: string | null;
 emailVerified?: boolean;
}

export interface SecurityState {
 totpEnabled: boolean;
 passkeyCount: number;
 emailVerified: boolean;
 recoveryReady: boolean;
 requiresRecoverySetup: boolean;
}

export interface WalletState {
 type: WalletType;
 publicKey: string | null;
 isConnected: boolean;
 connecting: boolean;
 authUser: AuthUser | null;

 freighterInstalled: boolean;
 connectFreighter: () => Promise<void>;
 openConnectModal: () => void;
 connectModalOpen: boolean;
 setConnectModalOpen: (open: boolean) => void;

 signupWithPasskey: (deviceName?: string) => Promise<{ requiresRecoverySetup: boolean }>;
 /** One entry: existing verified email → login OTP; new email → signup */
 continueWithEmail: (email: string) => Promise<{ flow: "login" | "signup"; message?: string }>;
 sendOtp: (email: string) => Promise<void>;
 verifyOtp: (email: string, code: string) => Promise<{ needsRecovery: boolean; requiresRecoverySetup: boolean }>;
 loginWithPasskey: (email?: string) => Promise<{ needsRecovery: boolean; requiresRecoverySetup: boolean }>;
 registerPasskey: (deviceName?: string) => Promise<void>;
 bindEmailSendOtp: (email: string) => Promise<void>;
 bindEmailVerify: (email: string, code: string) => Promise<void>;
 recoverWallet: (email: string, code: string, totpCode: string) => Promise<void>;
 logout: () => Promise<void>;

 signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
 disconnect: () => void;

 hasDeviceShare: boolean;
 needsRecovery: boolean;
 exportWallet: (totpCode: string) => Promise<{ secretKey: string; publicKey: string }>;
 refreshSecurity: () => Promise<void>;

 totpEnabled: boolean;
 passkeyCount: number;
 emailVerified: boolean;
 recoveryReady: boolean;
 requiresRecoverySetup: boolean;
}

const defaultState: WalletState = {
 type: null,
 publicKey: null,
 isConnected: false,
 connecting: false,
 authUser: null,
 freighterInstalled: false,
 connectFreighter: async () => {},
 openConnectModal: () => {},
 connectModalOpen: false,
 setConnectModalOpen: () => {},
 signupWithPasskey: async () => ({ requiresRecoverySetup: true }),
 continueWithEmail: async () => ({ flow: "signup" as const }),
 sendOtp: async () => {},
 verifyOtp: async () => ({ needsRecovery: false, requiresRecoverySetup: true }),
 loginWithPasskey: async () => ({ needsRecovery: false, requiresRecoverySetup: true }),
 registerPasskey: async () => {},
 bindEmailSendOtp: async () => {},
 bindEmailVerify: async () => {},
 recoverWallet: async () => {},
 logout: async () => {},
 signTransaction: async () => {
 throw new Error("No wallet connected");
 },
 disconnect: () => {},
 hasDeviceShare: false,
 needsRecovery: false,
 exportWallet: async () => {
 throw new Error("No wallet connected");
 },
 refreshSecurity: async () => {},
 totpEnabled: false,
 passkeyCount: 0,
 emailVerified: false,
 recoveryReady: false,
 requiresRecoverySetup: true,
};

const WalletContext = createContext<WalletState>(defaultState);

const DEVICE_SHARE_KEY = "orbit_device_share";

function saveDeviceShare(publicKey: string, share: string) {
 try {
 localStorage.setItem(`${DEVICE_SHARE_KEY}_${publicKey}`, share);
 } catch {
 /* ignore */
 }
}

function loadDeviceShare(publicKey: string): string | null {
 try {
 return localStorage.getItem(`${DEVICE_SHARE_KEY}_${publicKey}`);
 } catch {
 return null;
 }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
 const res = await fetch(`/api${path}`, {
 credentials: "include",
 headers: { "Content-Type": "application/json" },
 ...options,
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) {
 const err = new Error(
 (data as { error?: string }).error ?? `HTTP ${res.status}`
 ) as Error & { flow?: string; status?: number };
 err.flow = (data as { flow?: string }).flow;
 err.status = res.status;
 throw err;
 }
 return data as T;
}

type AuthResponse = {
 ok?: boolean;
 user: AuthUser | null;
 security: SecurityState;
 publicKey?: string;
 deviceShareHex?: string;
};

export function WalletProvider({ children }: { children: ReactNode }) {
 const [type, setType] = useState<WalletType>(null);
 const [publicKey, setPublicKey] = useState<string | null>(null);
 const [connecting, setConnecting] = useState(false);
 const [authUser, setAuthUser] = useState<AuthUser | null>(null);
 const [freighterInstalled, setFreighterInstalled] = useState(false);
 const [totpEnabled, setTotpEnabled] = useState(false);
 const [passkeyCount, setPasskeyCount] = useState(0);
 const [emailVerified, setEmailVerified] = useState(false);
 const [recoveryReady, setRecoveryReady] = useState(false);
 const [requiresRecoverySetup, setRequiresRecoverySetup] = useState(true);
 const [hasDeviceShare, setHasDeviceShare] = useState(false);
 const [needsRecovery, setNeedsRecovery] = useState(false);
 const [connectModalOpen, setConnectModalOpen] = useState(false);

 const freighterRef = useRef<{
 networkPassphrase: string | null;
 signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
 } | null>(null);

 const applySecurity = useCallback((sec: SecurityState, user: AuthUser | null) => {
 setAuthUser(user);
 setTotpEnabled(sec.totpEnabled);
 setPasskeyCount(sec.passkeyCount);
 setEmailVerified(sec.emailVerified);
 setRecoveryReady(sec.recoveryReady);
 setRequiresRecoverySetup(sec.requiresRecoverySetup);
 }, []);

 const applyInternalWallet = useCallback((pk: string, deviceShareHex?: string) => {
 if (deviceShareHex) {
 saveDeviceShare(pk, deviceShareHex);
 setHasDeviceShare(true);
 setNeedsRecovery(false);
 } else {
 const existing = loadDeviceShare(pk);
 setHasDeviceShare(!!existing);
 setNeedsRecovery(!existing);
 }
 setPublicKey(pk);
 setType("internal");
 }, []);

 const refreshSecurity = useCallback(async () => {
 try {
 const data = await apiFetch<AuthResponse>("/auth/me");
 if (data.user && data.security) applySecurity(data.security, data.user);
 } catch {
 /* not logged in */
 }
 }, [applySecurity]);

 useEffect(() => {
 const restore = async () => {
 try {
 const data = await apiFetch<AuthResponse>("/auth/me");
 if (data.user && data.security) applySecurity(data.security, data.user);

 const walletData = await apiFetch<{
 publicKey: string;
 deviceShareHex?: string;
 recoveryReady?: boolean;
 }>("/internal-wallet");

 applyInternalWallet(walletData.publicKey, walletData.deviceShareHex);
 } catch {
 try {
 const freighter = await import("@stellar/freighter-api");
 const connResult = await freighter.isConnected();
 if (!connResult.isConnected) return;
 setFreighterInstalled(true);
 const isAllowedResult = await freighter.isAllowed();
 if (!isAllowedResult.isAllowed) return;
 const addrResult = await freighter.getAddress();
 if (addrResult.error || !addrResult.address) return;
 const netResult = await freighter.getNetworkDetails();
 const passphrase = netResult.networkPassphrase ?? "";
 if (!passphrase.includes("Test")) {
 // Stay disconnected - Orbit is testnet-only
 return;
 }
 freighterRef.current = {
 networkPassphrase: passphrase || null,
 signTransaction: async (xdr, networkPassphrase) => {
 const result = await freighter.signTransaction(xdr, {
 networkPassphrase,
 address: addrResult.address,
 });
 if (result.error) throw new Error(result.error.message);
 return result.signedTxXdr;
 },
 };
 setPublicKey(addrResult.address);
 setType("external");
 } catch {
 /* no freighter */
 }
 }
 };
 restore();
 }, [applyInternalWallet, applySecurity]);

 const openConnectModal = useCallback(() => setConnectModalOpen(true), []);

 const connectFreighter = useCallback(async () => {
 setConnecting(true);
 try {
 const freighter = await import("@stellar/freighter-api");
 setFreighterInstalled(true);
 const accessResult = await freighter.requestAccess();
 if (accessResult.error) throw new Error(accessResult.error.message);
 const addrResult = await freighter.getAddress();
 if (addrResult.error) throw new Error(addrResult.error.message);
 const netResult = await freighter.getNetworkDetails();
 const passphrase = netResult.networkPassphrase ?? "";
 const isTestnet = passphrase.includes("Test");
 if (!isTestnet) {
 throw new Error(
 "Orbit is Stellar Testnet only. Open Freighter → switch network to Testnet, then connect again."
 );
 }
 const address = addrResult.address;
 freighterRef.current = {
 networkPassphrase: passphrase || null,
 signTransaction: async (xdr, networkPassphrase) => {
 const result = await freighter.signTransaction(xdr, {
 networkPassphrase,
 address,
 });
 if (result.error) throw new Error(result.error.message);
 return result.signedTxXdr;
 },
 };
 setPublicKey(address);
 setType("external");
 setNeedsRecovery(false);
 setHasDeviceShare(false);
 track("wallet_connect", {
 walletPublicKey: address,
 metadata: { type: "freighter", network: "testnet" },
 });
 } finally {
 setConnecting(false);
 }
 }, []);

 const signupWithPasskey = useCallback(async (deviceName?: string) => {
 setConnecting(true);
 try {
 const { startRegistration } = await import("@simplewebauthn/browser");
 const options = await apiFetch<Record<string, unknown> & { userId: number }>(
 "/auth/passkey/signup-options",
 { method: "POST", body: JSON.stringify({}) }
 );
 const { userId, ...webauthnOptions } = options;
 const credential = await startRegistration(webauthnOptions as never);
 const data = await apiFetch<AuthResponse>("/auth/passkey/signup-verify", {
 method: "POST",
 body: JSON.stringify({ credential, userId, deviceName }),
 });
 if (data.user && data.security) applySecurity(data.security, data.user);
 if (!data.publicKey || !data.deviceShareHex) throw new Error("Wallet creation failed");
 applyInternalWallet(data.publicKey, data.deviceShareHex);
 track("wallet_connect", {
 walletPublicKey: data.publicKey,
 metadata: { type: "internal", method: "passkey_signup" },
 });
 return { requiresRecoverySetup: data.security?.requiresRecoverySetup ?? true };
 } finally {
 setConnecting(false);
 }
 }, [applyInternalWallet, applySecurity]);

 const sendOtp = useCallback(async (email: string) => {
 await apiFetch("/auth/send-otp", { method: "POST", body: JSON.stringify({ email }) });
 }, []);

 const continueWithEmail = useCallback(async (email: string) => {
 const data = await apiFetch<{ flow: "login" | "signup"; message?: string }>(
 "/auth/email/continue",
 { method: "POST", body: JSON.stringify({ email }) }
 );
 return { flow: data.flow, message: data.message };
 }, []);

 const finishAuthResponse = useCallback(
 (data: AuthResponse) => {
 if (data.user && data.security) applySecurity(data.security, data.user);
 const pk = data.publicKey;
 if (!pk) throw new Error("Wallet not available");
 applyInternalWallet(pk, data.deviceShareHex);
 const hasShare = !!(data.deviceShareHex || loadDeviceShare(pk));
 return {
 needsRecovery: !hasShare,
 requiresRecoverySetup: data.security?.requiresRecoverySetup ?? true,
 };
 },
 [applyInternalWallet, applySecurity]
 );

 const verifyOtp = useCallback(
 async (email: string, code: string) => {
 setConnecting(true);
 try {
 const data = await apiFetch<AuthResponse>("/auth/verify-otp", {
 method: "POST",
 body: JSON.stringify({ email, code }),
 });
 const result = finishAuthResponse(data);
 track("wallet_connect", {
 walletPublicKey: data.publicKey,
 metadata: { type: "internal", method: "otp" },
 });
 return result;
 } finally {
 setConnecting(false);
 }
 },
 [finishAuthResponse]
 );

 const loginWithPasskey = useCallback(
 async (email?: string) => {
 setConnecting(true);
 try {
 const { startAuthentication } = await import("@simplewebauthn/browser");
 const options = await apiFetch<Record<string, unknown>>("/auth/passkey/login-options", {
 method: "POST",
 body: JSON.stringify({ email }),
 });
 const credential = await startAuthentication(options as never);
 const data = await apiFetch<AuthResponse>("/auth/passkey/login-verify", {
 method: "POST",
 body: JSON.stringify({ credential, email }),
 });
 const result = finishAuthResponse(data);
 track("wallet_connect", {
 walletPublicKey: data.publicKey,
 metadata: { type: "internal", method: "passkey" },
 });
 return result;
 } finally {
 setConnecting(false);
 }
 },
 [finishAuthResponse]
 );

 const registerPasskey = useCallback(async (deviceName?: string) => {
 const { startRegistration } = await import("@simplewebauthn/browser");
 const options = await apiFetch<Record<string, unknown>>("/auth/passkey/register-options", {
 method: "POST",
 });
 const credential = await startRegistration(options as never);
 await apiFetch("/auth/passkey/register-verify", {
 method: "POST",
 body: JSON.stringify({ credential, deviceName }),
 });
 setPasskeyCount((n) => n + 1);
 }, []);

 const bindEmailSendOtp = useCallback(async (email: string) => {
 await apiFetch("/auth/email/send-otp", {
 method: "POST",
 body: JSON.stringify({ email }),
 });
 }, []);

 const bindEmailVerify = useCallback(
 async (email: string, code: string) => {
 const data = await apiFetch<AuthResponse>("/auth/email/verify", {
 method: "POST",
 body: JSON.stringify({ email, code }),
 });
 if (data.user && data.security) applySecurity(data.security, data.user);
 },
 [applySecurity]
 );

 const recoverWallet = useCallback(
 async (email: string, code: string, totpCode: string) => {
 setConnecting(true);
 try {
 const data = await apiFetch<AuthResponse>("/auth/recover/complete", {
 method: "POST",
 body: JSON.stringify({ email, code, totpCode }),
 });
 if (data.user && data.security) applySecurity(data.security, data.user);
 if (!data.publicKey || !data.deviceShareHex) {
 throw new Error("Recovery did not return a device share");
 }
 applyInternalWallet(data.publicKey, data.deviceShareHex);
 } finally {
 setConnecting(false);
 }
 },
 [applyInternalWallet, applySecurity]
 );

 const exportWallet = useCallback(
 async (totpCode: string) => {
 if (!publicKey) throw new Error("Internal wallet not loaded");
 const deviceShareHex = loadDeviceShare(publicKey);
 if (!deviceShareHex) throw new Error("Device share not found. Recover this device first.");
 return apiFetch<{ secretKey: string; publicKey: string }>("/internal-wallet/export", {
 method: "POST",
 body: JSON.stringify({ deviceShareHex, totpCode }),
 });
 },
 [publicKey]
 );

 const signTransaction = useCallback(
 async (xdr: string, networkPassphrase: string): Promise<string> => {
 if (type === "external") {
 const f = freighterRef.current;
 if (!f) throw new Error("Freighter not connected");
 return f.signTransaction(xdr, networkPassphrase);
 }
 if (type === "internal") {
 if (!publicKey) throw new Error("Internal wallet not loaded");
 const deviceShareHex = loadDeviceShare(publicKey);
 if (!deviceShareHex) {
 throw new Error(
 "Device share not found. Recover with your email + authenticator code."
 );
 }
 const data = await apiFetch<{ signedXdr: string }>("/internal-wallet/sign", {
 method: "POST",
 body: JSON.stringify({ deviceShareHex, unsignedXdr: xdr, networkPassphrase }),
 });
 return data.signedXdr;
 }
 throw new Error("No wallet connected");
 },
 [type, publicKey]
 );

 const logout = useCallback(async () => {
 if (type === "internal") {
 try {
 await apiFetch("/auth/logout", { method: "POST" });
 } catch {
 /* ignore */
 }
 }
 setPublicKey(null);
 setType(null);
 setAuthUser(null);
 setHasDeviceShare(false);
 setNeedsRecovery(false);
 setRecoveryReady(false);
 setRequiresRecoverySetup(true);
 freighterRef.current = null;
 track("wallet_disconnect", { walletPublicKey: publicKey });
 }, [type, publicKey]);

 return (
 <WalletContext.Provider
 value={{
 type,
 publicKey,
 isConnected: !!publicKey,
 connecting,
 authUser,
 freighterInstalled,
 connectFreighter,
 openConnectModal,
 connectModalOpen,
 setConnectModalOpen,
 signupWithPasskey,
 continueWithEmail,
 sendOtp,
 verifyOtp,
 loginWithPasskey,
 registerPasskey,
 bindEmailSendOtp,
 bindEmailVerify,
 recoverWallet,
 logout,
 signTransaction,
 disconnect: logout,
 hasDeviceShare,
 needsRecovery,
 exportWallet,
 refreshSecurity,
 totpEnabled,
 passkeyCount,
 emailVerified,
 recoveryReady,
 requiresRecoverySetup,
 }}
 >
 {children}
 </WalletContext.Provider>
 );
}

export function useWallet(): WalletState {
 return useContext(WalletContext);
}
