export interface MessageFact {
  type: 'message.received';
  channelId: string;
  contactId: string;
  content: string;
  contentType: 'text' | 'image' | 'file';
  tags: string[];
}

export interface CaseFact {
  type: 'case.status_changed';
  caseId: string;
  status: string;
  priority: string;
}

export type CRMFact = MessageFact | CaseFact;
