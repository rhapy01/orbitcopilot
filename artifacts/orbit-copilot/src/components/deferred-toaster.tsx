import { useEffect, useState, type ComponentType } from "react";

/** Mount toast UI after idle so Radix toast CSS/JS stay off the critical path. */
export function DeferredToaster() {
  const [Toaster, setToaster] = useState<ComponentType | null>(null);

  useEffect(() => {
    const load = () => {
      import("@/components/ui/toaster").then((m) => setToaster(() => m.Toaster));
    };

    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(load, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const t = globalThis.setTimeout(load, 1200);
    return () => globalThis.clearTimeout(t);
  }, []);

  if (!Toaster) return null;
  return <Toaster />;
}
