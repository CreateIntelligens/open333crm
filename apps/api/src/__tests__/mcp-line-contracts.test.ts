import assert from "node:assert/strict";
import {
  lineMcpConfirmationRequestSchema,
  lineMcpPreviewRequestSchema,
} from "../modules/mcp/line-mcp.schemas.js";
import {
  MCP_LINE_BROADCAST_SCOPE,
  MCP_LINE_READ_SCOPE,
  MCP_LINE_SEND_SCOPE,
  requiredMcpScopeForTool,
} from "../modules/mcp/mcp.constants.js";

const preview = lineMcpPreviewRequestSchema.parse({
  operation: "direct_send",
  conversationId: "00000000-0000-0000-0000-000000000001",
  contentType: "text",
  content: { text: "確認訊息" },
});

assert.equal(preview.operation, "direct_send");
assert.throws(() => lineMcpConfirmationRequestSchema.parse({ confirmation: false }));
assert.deepEqual(
  lineMcpConfirmationRequestSchema.parse({
    confirmation: true,
    confirmationToken: "token",
  }),
  { confirmation: true, confirmationToken: "token" },
);
assert.equal(requiredMcpScopeForTool("crm_line_list_conversations"), MCP_LINE_READ_SCOPE);
assert.equal(requiredMcpScopeForTool("crm_line_direct_send"), MCP_LINE_SEND_SCOPE);
assert.equal(requiredMcpScopeForTool("crm_line_broadcast_initiate"), MCP_LINE_BROADCAST_SCOPE);
assert.equal(requiredMcpScopeForTool("crm_search_contacts"), undefined);

console.log("mcp-line-contracts.test.ts passed");
