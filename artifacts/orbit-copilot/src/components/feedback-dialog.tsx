import { useState } from "react";
import { MessageSquareHeart, Star } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFreighter } from "@/hooks/use-freighter";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export function FeedbackDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const { publicKey } = useFreighter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          message: message.trim(),
          walletPublicKey: publicKey ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send feedback");
      }
      setStatus("done");
      setMessage("");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
      }, 1200);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          track("feedback_open", { walletPublicKey: publicKey });
          setStatus("idle");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary",
            triggerClassName
          )}
          aria-label="Send feedback"
        >
          <MessageSquareHeart className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How is Orbit working for you?</DialogTitle>
          <DialogDescription>
            Quick feedback helps us validate the product. Testnet users welcome.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex items-center justify-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className="rounded-lg p-1.5 hover:bg-primary/10"
                aria-label={`${n} stars`}
              >
                <Star
                  className={cn(
                    "h-7 w-7",
                    n <= rating
                      ? "fill-primary text-primary"
                      : "text-muted-foreground"
                  )}
                />
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What worked? What was confusing?"
            rows={4}
            className="w-full resize-none rounded-xl border border-primary/15 bg-background px-3 py-2 text-sm outline-none ring-primary/20 focus:ring-2"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {status === "done" ? (
            <p className="text-center text-sm font-medium text-primary">
              Thanks — feedback saved.
            </p>
          ) : (
            <button
              type="button"
              disabled={message.trim().length < 3 || status === "sending"}
              onClick={submit}
              className="rounded-full bg-orbit-gradient px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Submit feedback"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
