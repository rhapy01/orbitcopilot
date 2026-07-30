/**
 * MCP connector panel — PayBox-style: share one URL, OAuth does the rest.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";

type McpKeyRow = {
  id: number;
  keyPrefix: string;
  label: string;
  scopes: string[];
  bindPublicKey: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const CONNECTOR_URL = "https://orbitpilot.vercel.app/mcp";

async function mcpFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/mcp${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function McpKeysPanel({ publicKey: _publicKey }: { publicKey: string | null }) {
  const [keys, setKeys] = useState<McpKeyRow[]>([]);
  const [connectorUrl, setConnectorUrl] = useState(CONNECTOR_URL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const data = await mcpFetch<{ keys: McpKeyRow[]; connectorUrl?: string }>("/keys");
    setKeys(data.keys ?? []);
    if (data.connectorUrl) setConnectorUrl(data.connectorUrl);
  }, []);

  useEffect(() => {
    void refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load"),
    );
  }, [refresh]);

  async function revoke(id: number) {
    setError(null);
    setLoading(true);
    try {
      await mcpFetch(`/keys/${id}`, { method: "DELETE" });
      setSuccess("AI access revoked");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setLoading(false);
    }
  }

  const active = keys.filter((k) => !k.revokedAt);

  return (
    <div className="space-y-4 mt-2">
      <p className="text-sm text-slate-400 leading-relaxed">
        Like PayBox: paste one link into Claude or ChatGPT. Ask for a swap, vault,
        predict, NFT, bridge — anything Orbit does. Confirm in the chat panel; your
        Orbit wallet signs there. The AI never holds keys.
      </p>

      <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3 space-y-2">
        <p className="text-xs text-violet-300 uppercase tracking-wide">
          Connector URL
        </p>
        <p className="font-mono text-sm text-white break-all">{connectorUrl}</p>
        <Button
          type="button"
          size="sm"
          className="w-full bg-violet-600 hover:bg-violet-700"
          onClick={async () => {
            await navigator.clipboard.writeText(connectorUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? (
            <Check className="w-4 h-4 mr-2" />
          ) : (
            <Copy className="w-4 h-4 mr-2" />
          )}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>

      <ol className="text-sm text-slate-400 space-y-2 list-decimal list-inside leading-relaxed">
        <li>
          <strong className="text-slate-200">Claude</strong> — Settings → Connectors →
          Add custom connector → paste URL → Connect
        </li>
        <li>
          <strong className="text-slate-200">ChatGPT</strong> — Developer mode → Plugins →
          New → paste URL → Authentication: <em>OAuth</em> → Connect
        </li>
        <li>Sign in to Orbit in the browser popup, then Allow</li>
      </ol>

      <a
        href="https://orbitpilot.vercel.app/docs/mcp"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
      >
        Docs <ExternalLink className="w-3 h-3" />
      </a>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <Check className="w-4 h-4" />
          {success}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs text-slate-500 uppercase">Connected AIs</p>
        {active.length === 0 && (
          <p className="text-sm text-slate-500">
            None yet — connections appear after you Allow in Claude/ChatGPT.
          </p>
        )}
        {active.map((k) => (
          <div
            key={k.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-[#2a2d3e] p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="text-slate-200 truncate">{k.label}</p>
              <p className="text-xs text-slate-500">
                {(k.scopes ?? []).join(", ")}
                {k.bindPublicKey ? " · wallet-bound" : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-400 hover:text-red-300 shrink-0"
              disabled={loading}
              onClick={() => void revoke(k.id)}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
