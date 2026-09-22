import { z } from "zod";

export const lineMcpPreviewRequestSchema = z.object({
  operation: z.enum(["direct_send", "broadcast"]),
  conversationId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  contentType: z.string().max(80).optional(),
  content: z.record(z.unknown()).optional(),
  broadcastId: z.string().uuid().optional(),
});

export const lineMcpConfirmationRequestSchema = z.object({
  confirmationToken: z.string().min(1).max(4096),
  confirmation: z.literal(true),
});

export const lineMcpDirectSendSchema = z.object({
  conversationId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  contentType: z.string().max(80).optional(),
  content: z.record(z.unknown()).optional(),
  confirmationToken: z.string().min(1).max(4096).optional(),
  confirmation: z.literal(true).optional(),
});

export const lineMcpBroadcastInitiateSchema = z.object({
  broadcastId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  materialId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  targetType: z.enum(["all", "segment", "tags", "contacts"]).optional(),
  targetConfig: z.object({
    tagIds: z.array(z.string().uuid()).optional(),
    contactIds: z.array(z.string().uuid()).optional(),
  }).optional(),
  scheduledAt: z.string().optional(),
  confirmationToken: z.string().min(1).max(4096).optional(),
  confirmation: z.literal(true).optional(),
});

export type LineMcpPreviewRequest = z.infer<typeof lineMcpPreviewRequestSchema>;
export type LineMcpConfirmationRequest = z.infer<typeof lineMcpConfirmationRequestSchema>;

export type LineMcpAuditOutcome =
  | "previewed"
  | "confirmed"
  | "rejected"
  | "dispatched"
  | "failed";

export interface LineMcpAuditRecord {
  tenantId: string;
  agentId: string;
  cliSessionId: string;
  operation: "direct_send" | "broadcast";
  outcome: LineMcpAuditOutcome;
  channelId?: string;
  conversationId?: string;
  contactId?: string;
  broadcastId?: string;
  errorCode?: string;
}
