/**
 * MCP App HTML shell — hosts render this in-chat; it embeds Orbit approve UI.
 */

import { publicMcpBaseUrl } from "./mcp-auth";

export const ORBIT_APPROVE_UI_URI = "ui://orbit/approve.html";

/** Interactive approve panel for Claude / ChatGPT MCP Apps. */
export function buildOrbitApproveAppHtml(): string {
  const origin = publicMcpBaseUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orbit · Confirm</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0b0d14; color: #e8eaf0;
      font-family: ui-sans-serif, system-ui, sans-serif; }
    #wrap { display: flex; flex-direction: column; height: 100%; min-height: 360px; }
    #status { padding: 10px 12px; font-size: 12px; color: #9aa3b5; border-bottom: 1px solid #2a2d3e; }
    #frame { flex: 1; width: 100%; border: 0; background: #0b0d14; min-height: 340px; }
    .err { color: #f87171; }
    .ok { color: #4ade80; }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="status">Preparing Orbit confirmation…</div>
    <iframe
      id="frame"
      title="Orbit approve"
      allow="publickey-credentials-get *; publickey-credentials-create *; clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
    ></iframe>
  </div>
  <script type="module">
import { App, PostMessageTransport } from "https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@1.7.5/dist/src/app.js";

const ORIGIN = ${JSON.stringify(origin)};
let ORIGIN_HOST = "orbitpilot.vercel.app";
try { ORIGIN_HOST = new URL(ORIGIN).hostname; } catch (_) {}
const statusEl = document.getElementById("status");
const frame = document.getElementById("frame");
let loadedActionId = null;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

function extractActionId(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.actionId === "string") return payload.actionId;
  if (typeof payload.publicId === "string") return payload.publicId;
  const pending = payload.pendingActions;
  if (Array.isArray(pending) && pending[0] && typeof pending[0].actionId === "string") {
    return pending[0].actionId;
  }
  if (typeof payload.embedUrl === "string") {
    const m = payload.embedUrl.match(/\\/embed\\/approve\\/([^/?#]+)/);
    if (m) return m[1];
  }
  const c0 = payload.content && payload.content[0];
  if (c0 && typeof c0.text === "string") {
    try {
      return extractActionId(JSON.parse(c0.text));
    } catch (_) {}
  }
  if (payload.structuredContent && typeof payload.structuredContent === "object") {
    return extractActionId(payload.structuredContent);
  }
  return null;
}

function safeEmbedUrl(embedUrl, actionId) {
  if (typeof embedUrl === "string" && embedUrl.length > 0) {
    try {
      const u = new URL(embedUrl, ORIGIN);
      if (u.hostname !== ORIGIN_HOST) return null;
      if (!u.pathname.startsWith("/embed/approve/")) return null;
      return u.toString();
    } catch (_) {
      return null;
    }
  }
  if (actionId && /^[a-zA-Z0-9_-]{8,128}$/.test(actionId)) {
    return ORIGIN + "/embed/approve/" + encodeURIComponent(actionId) + "?embed=1";
  }
  return null;
}

function loadAction(actionId, embedUrl) {
  const url = safeEmbedUrl(embedUrl, actionId);
  if (!url) {
    setStatus("Waiting for a transaction to confirm…", "");
    return;
  }
  loadedActionId = actionId || extractActionId({ embedUrl: url });
  frame.src = url;
  setStatus("Confirm below — stay in this chat", "");
}

function extractEmbedUrl(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.embedUrl === "string") return payload.embedUrl;
  const pending = payload.pendingActions;
  if (Array.isArray(pending) && pending[0] && typeof pending[0].embedUrl === "string") {
    return pending[0].embedUrl;
  }
  if (payload.structuredContent) return extractEmbedUrl(payload.structuredContent);
  const c0 = payload.content && payload.content[0];
  if (c0 && typeof c0.text === "string") {
    try { return extractEmbedUrl(JSON.parse(c0.text)); } catch (_) {}
  }
  return null;
}

function applyPayload(payload) {
  loadAction(extractActionId(payload), extractEmbedUrl(payload));
}

function notifyHost(payload) {
  try {
    window.parent.postMessage(payload, "*");
  } catch (_) {}
}

let app = null;

window.addEventListener("message", (ev) => {
  // Only trust Orbit-origin embed iframe
  let okOrigin = false;
  try {
    okOrigin = new URL(ev.origin).hostname === ORIGIN_HOST;
  } catch (_) {}
  if (!okOrigin) return;

  if (ev.data && ev.data.type === "orbit-mcp-approved") {
    if (loadedActionId && ev.data.actionId && ev.data.actionId !== loadedActionId) {
      return;
    }
    setStatus("Confirmed · " + (ev.data.txHash || "done"), "ok");
    notifyHost(ev.data);
    try {
      if (app && typeof app.sendMessage === "function") {
        app.sendMessage({ role: "user", content: [{ type: "text", text: "Confirmed: " + (ev.data.txHash || "ok") }] });
      }
    } catch (_) {}
  }
});

try {
  if (window.openai && window.openai.toolOutput) {
    const out = window.openai.toolOutput;
    applyPayload(typeof out === "string" ? JSON.parse(out) : out);
  }
  if (window.openai && typeof window.openai.addEventListener === "function") {
    window.openai.addEventListener("toolOutput", () => {
      const out = window.openai.toolOutput;
      applyPayload(typeof out === "string" ? JSON.parse(out) : out);
    });
  }
} catch (_) {}

app = new App({ name: "orbit-approve", version: "1.0.0" });
app.ontoolresult = (result) => {
  applyPayload(result);
};
app.ontoolinput = (params) => {
  void params;
};
await app.connect(new PostMessageTransport());
setStatus("Waiting for Orbit tool result…", "");
  </script>
</body>
</html>`;
}

/** CSP + permissions for MCP Apps hosts embedding this resource. */
export function orbitApproveResourceUiMeta() {
  const origin = publicMcpBaseUrl();
  let host = "orbitpilot.vercel.app";
  try {
    host = new URL(origin).host;
  } catch {
    /* keep default */
  }
  return {
    csp: {
      connectDomains: [origin, `https://${host}`],
      resourceDomains: [
        origin,
        `https://${host}`,
        "https://cdn.jsdelivr.net",
      ],
      frameDomains: [origin, `https://${host}`],
    },
    permissions: {
      clipboardWrite: {},
    },
  };
}
