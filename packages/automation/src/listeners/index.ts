import { dispatcher } from "../dispatcher/index.js";
import { buildFact, CRMEvent } from "../fact-builder/index.js";

export type SupportedEventType =
  | "message.received"
  | "case.created"
  | "case.status_changed"
  | "contact.created";

/**
 * Converts a generic event object into a CRMEvent for the fact builder.
 */
function toCRMEvent(
  eventType: string,
  payload: Record<string, unknown>,
): CRMEvent {
  switch (eventType) {
    case "message.received":
      return {
        type: "message.received",
        id: (payload.id as string) || (payload.messageId as string) || "",
        content: (payload.content as string) || "",
        channel: (payload.channel as string) || "unknown",
        contactId:
          (payload.contactId as string) || (payload.contactUid as string) || "",
        contactName: (payload.contactName as string) || "",
        contactIsVip: (payload.contactIsVip as boolean) || false,
        contactTags: (payload.contactTags as string[]) || [],
        contactOpenCaseCount: (payload.contactOpenCaseCount as number) || 0,
        teamId: (payload.teamId as string) || "",
        teamName: (payload.teamName as string) || "",
        channelId: (payload.channelId as string) || "",
        channelName: (payload.channelName as string) || "",
      };
    case "case.created":
      return {
        type: "case.created",
        id: (payload.caseId as string) || (payload.id as string) || "",
        title: (payload.title as string) || "",
        status: (payload.status as string) || "OPEN",
        priority: (payload.priority as string) || "MEDIUM",
        assigneeId: payload.assigneeId as string | undefined,
        contactId: (payload.contactId as string) || "",
        contactName: (payload.contactName as string) || "",
        teamId: (payload.teamId as string) || "",
        teamName: (payload.teamName as string) || "",
        channelId: payload.channelId as string | undefined,
      };
    case "case.status_changed":
      return {
        type: "case.status_changed",
        id: (payload.caseId as string) || (payload.id as string) || "",
        caseId: (payload.caseId as string) || "",
        oldStatus: (payload.oldStatus as string) || "",
        newStatus: (payload.newStatus as string) || "",
        priority: (payload.priority as string) || "MEDIUM",
        assigneeId: payload.assigneeId as string | undefined,
        contactId: (payload.contactId as string) || "",
        teamId: (payload.teamId as string) || "",
        teamName: (payload.teamName as string) || "",
      };
    case "contact.created":
      return {
        type: "contact.created",
        id: (payload.contactId as string) || (payload.id as string) || "",
        name: (payload.name as string) || "",
        email: payload.email as string | undefined,
        phone: payload.phone as string | undefined,
        isVip: (payload.isVip as boolean) || false,
        tags: (payload.tags as string[]) || [],
        teamId: (payload.teamId as string) || "",
        teamName: (payload.teamName as string) || "",
      };
    default:
      throw new Error(`Unsupported event type: ${eventType}`);
  }
}

/**
 * Handles an incoming event and dispatches automation rules.
 * Called from the API layer (EventBus subscriber or direct invocation).
 */
export async function handleAutomationEvent(
  eventType: string,
  payload: Record<string, unknown>,
  tenantId: string,
): Promise<{
  executed: boolean;
  executionId?: string;
  matchedRules?: string[];
  actionsExecuted?: number;
  error?: string;
}> {
  try {
    const crmEvent = toCRMEvent(eventType, payload);
    const fact = await buildFact(crmEvent);

    const result = await dispatcher.dispatchManual(eventType, fact, tenantId);

    return {
      executed: true,
      executionId: result.executionId,
      matchedRules: result.matchedRules,
      actionsExecuted: result.actionsExecuted,
    };
  } catch (error) {
    return {
      executed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
