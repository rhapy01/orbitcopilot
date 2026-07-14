export type AnalyticsEvent =
  | "page_view"
  | "wallet_connect"
  | "wallet_disconnect"
  | "chat_send"
  | "chat_new"
  | "chat_clear"
  | "tx_sign"
  | "tx_submit"
  | "onboarding_step"
  | "feedback_open"
  | "error";

/** Fire-and-forget product analytics (Postgres-backed via API). */
export function track(
  eventType: AnalyticsEvent,
  opts?: {
    walletPublicKey?: string | null;
    metadata?: Record<string, unknown>;
  }
): void {
  const body = {
    eventType,
    walletPublicKey: opts?.walletPublicKey ?? null,
    metadata: opts?.metadata ?? null,
  };
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* non-blocking */
    });
  } catch {
    /* ignore */
  }
}
