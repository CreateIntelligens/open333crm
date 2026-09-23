export const MCP_READ_SCOPE = "mcp:read";

export const MCP_LINE_READ_SCOPE = "mcp:line:read";
export const MCP_LINE_SEND_SCOPE = "mcp:line:send";
export const MCP_LINE_BROADCAST_SCOPE = "mcp:line:broadcast";

export const MCP_LINE_SCOPES = [
  MCP_LINE_READ_SCOPE,
  MCP_LINE_SEND_SCOPE,
  MCP_LINE_BROADCAST_SCOPE,
] as const;

export const MCP_LINE_CONFIRMATION_VERSION = 1;

export function requiredMcpScopeForTool(toolName: string): string | undefined {
  if (
    toolName === "crm_line_list_conversations" ||
    toolName === "crm_line_get_conversation" ||
    toolName === "crm_line_search_contacts" ||
    toolName === "crm_line_get_broadcast"
  ) {
    return MCP_LINE_READ_SCOPE;
  }
  if (toolName === "crm_line_direct_send") return MCP_LINE_SEND_SCOPE;
  if (toolName === "crm_line_broadcast_initiate") return MCP_LINE_BROADCAST_SCOPE;
  return undefined;
}
