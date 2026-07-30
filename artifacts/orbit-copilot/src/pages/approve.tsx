/**
 * Full-page fallback approve (hosts without MCP Apps).
 */

import { useRoute } from "wouter";
import { McpApprovePanel } from "@/components/mcp-approve-panel";

export default function ApprovePage() {
  const [, params] = useRoute("/approve/:id");
  const id = params?.id ?? "";
  return <McpApprovePanel actionId={id} embed={false} />;
}
