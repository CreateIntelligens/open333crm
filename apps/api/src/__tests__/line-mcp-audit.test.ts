import assert from "node:assert/strict";
import { redactLineMcpPayload, writeLineMcpAudit } from "../modules/mcp/line-mcp-audit.js";

assert.deepEqual(redactLineMcpPayload({
  channelAccessToken: "secret",
  nested: { replyToken: "reply-secret", value: "safe" },
}), {
  channelAccessToken: "[REDACTED]",
  nested: { replyToken: "[REDACTED]", value: "safe" },
});

const calls: unknown[] = [];
await writeLineMcpAudit({
  tenantAuditLog: {
    create: async (args: unknown) => {
      calls.push(args);
      return {};
    },
  },
} as never, {
  tenantId: "tenant-1",
  agentId: "agent-1",
  cliSessionId: "cli-1",
  operation: "direct_send",
  outcome: "dispatched",
  conversationId: "conversation-1",
}, {
  channelAccessToken: "secret",
  messageContent: "private content",
});

const payload = (calls[0] as { data: { payload: Record<string, unknown> } }).data.payload;
assert.equal(payload.channelAccessToken, "[REDACTED]");
assert.equal(payload.messageContent, "[REDACTED]");
assert.equal(payload.cliSessionId, "cli-1");

console.log("line-mcp-audit.test.ts passed");
process.exit(0);
