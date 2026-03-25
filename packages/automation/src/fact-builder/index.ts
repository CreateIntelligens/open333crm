export interface MessageReceivedEvent {
  type: "message.received";
  id: string;
  content: string;
  channel: string;
  contactId: string;
  contactName: string;
  contactIsVip: boolean;
  contactTags: string[];
  contactOpenCaseCount: number;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
}

export interface CaseCreatedEvent {
  type: "case.created";
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigneeId?: string;
  contactId: string;
  contactName: string;
  teamId: string;
  teamName: string;
  channelId?: string;
}

export interface CaseStatusChangedEvent {
  type: "case.status_changed";
  id: string;
  caseId: string;
  oldStatus: string;
  newStatus: string;
  priority: string;
  assigneeId?: string;
  contactId: string;
  teamId: string;
  teamName: string;
}

export interface ContactCreatedEvent {
  type: "contact.created";
  id: string;
  name: string;
  email?: string;
  phone?: string;
  isVip: boolean;
  tags: string[];
  teamId: string;
  teamName: string;
}

export type CRMEvent =
  | MessageReceivedEvent
  | CaseCreatedEvent
  | CaseStatusChangedEvent
  | ContactCreatedEvent;

import { AutomationFact } from "../types.js";

export async function buildFactForMessageReceived(
  event: MessageReceivedEvent,
): Promise<AutomationFact> {
  return {
    event: {
      type: event.type,
      timestamp: new Date().toISOString(),
      id: event.id,
    },
    message: {
      id: event.id,
      content: event.content,
      channel: event.channel,
      direction: "inbound",
    },
    contact: {
      id: event.contactId,
      name: event.contactName,
      isVip: event.contactIsVip,
      tags: event.contactTags,
      openCaseCount: event.contactOpenCaseCount,
    },
    team: {
      id: event.teamId,
      name: event.teamName,
    },
    channel: {
      id: event.channelId,
      name: event.channelName,
    },
  };
}

export async function buildFactForCaseCreated(
  event: CaseCreatedEvent,
): Promise<AutomationFact> {
  return {
    event: {
      type: event.type,
      timestamp: new Date().toISOString(),
      id: event.id,
    },
    case: {
      id: event.id,
      status: event.status,
      priority: event.priority,
      assigneeId: event.assigneeId,
    },
    contact: {
      id: event.contactId,
      name: event.contactName,
      isVip: false,
      tags: [],
      openCaseCount: 0,
    },
    team: {
      id: event.teamId,
      name: event.teamName,
    },
    channel: event.channelId
      ? {
          id: event.channelId,
          name: "",
        }
      : undefined,
  };
}

export async function buildFactForCaseStatusChanged(
  event: CaseStatusChangedEvent,
): Promise<AutomationFact> {
  return {
    event: {
      type: event.type,
      timestamp: new Date().toISOString(),
      id: event.id,
    },
    case: {
      id: event.caseId,
      status: event.newStatus,
      priority: event.priority,
      assigneeId: event.assigneeId,
    },
    contact: {
      id: event.contactId,
      name: "",
      isVip: false,
      tags: [],
      openCaseCount: 0,
    },
    team: {
      id: event.teamId,
      name: event.teamName,
    },
  };
}

export async function buildFactForContactCreated(
  event: ContactCreatedEvent,
): Promise<AutomationFact> {
  return {
    event: {
      type: event.type,
      timestamp: new Date().toISOString(),
      id: event.id,
    },
    contact: {
      id: event.id,
      name: event.name,
      isVip: event.isVip,
      tags: event.tags,
      openCaseCount: 0,
    },
    team: {
      id: event.teamId,
      name: event.teamName,
    },
  };
}

export async function buildFact(event: CRMEvent): Promise<AutomationFact> {
  switch (event.type) {
    case "message.received":
      return buildFactForMessageReceived(event);
    case "case.created":
      return buildFactForCaseCreated(event);
    case "case.status_changed":
      return buildFactForCaseStatusChanged(event);
    case "contact.created":
      return buildFactForContactCreated(event);
    default:
      throw new Error(`Unknown event type: ${(event as CRMEvent).type}`);
  }
}
