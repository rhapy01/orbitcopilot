import { useEffect, useState, type ComponentType } from "react";

/** Load Vercel Analytics after idle so it doesn't compete with critical path JS. */
export function DeferredAnalytics() {
  const [Analytics, setAnalytics] = useState<ComponentType | null>(null);

  useEffect(() => {
    const load = () => {
      import("@vercel/analytics/react").then((m) => setAnalytics(() => m.Analytics));
    };

    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(load, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const t = globalThis.setTimeout(load, 1500);
    return () => globalThis.clearTimeout(t);
  }, []);

  if (!Analytics) return null;
  return <Analytics />;
}
