import type { Prisma } from "@prisma/client";
import type { TenantDb } from "../../lib/tenant-db.js";
import type { LineMcpAuditRecord } from "./line-mcp.schemas.js";
import { writeTenantAudit } from "../tenant-audit/tenant-audit.service.js";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "channelAccessToken",
  "channelSecret",
  "loginChannelSecret",
  "apiKey",
  "token",
  "accessToken",
  "replyToken",
  "messageContent",
]);

export function redactLineMcpPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLineMcpPayload);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEYS.has(key) ? REDACTED : redactLineMcpPayload(nested),
    ]),
  );
}

export async function writeLineMcpAudit(
  prisma: TenantDb,
  record: LineMcpAuditRecord,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await writeTenantAudit(prisma, {
    tenantId: record.tenantId,
    actorId: record.agentId,
    action: `mcp.line.${record.operation}.${record.outcome}`,
    targetType: record.operation === "direct_send" ? "conversation" : "broadcast",
    targetId: record.conversationId ?? record.broadcastId,
    payload: redactLineMcpPayload({
      cliSessionId: record.cliSessionId,
      channelId: record.channelId,
      contactId: record.contactId,
      errorCode: record.errorCode,
      ...payload,
    }) as Prisma.InputJsonValue,
  });
}
