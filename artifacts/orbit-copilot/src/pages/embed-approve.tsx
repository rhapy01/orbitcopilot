/**
 * In-chat / iframe MCP approval — no Orbit app chrome.
 */

import { useRoute } from "wouter";
import { McpApprovePanel } from "@/components/mcp-approve-panel";

export default function EmbedApprovePage() {
  const [, params] = useRoute("/embed/approve/:id");
  const id = params?.id ?? "";
  return <McpApprovePanel actionId={id} embed />;
}
