export type EventType =
  | "message.received"
  | "message.postback"
  | "case.created"
  | "case.status_changed"
  | "case.assigned"
  | "contact.created"
  | "contact.tagged";

export interface AutomationFact {
  event: {
    type: EventType;
    timestamp: string;
    id?: string;
  };
  message?: {
    id: string;
    content: string;
    channel: string;
    direction: "inbound" | "outbound";
  };
  contact?: {
    id: string;
    name: string;
    isVip: boolean;
    tags: string[];
    openCaseCount: number;
  };
  case?: {
    id: string;
    status: string;
    priority: string;
    assigneeId?: string;
  };
  team?: {
    id: string;
    name: string;
  };
  channel?: {
    id: string;
    name: string;
  };
}

export interface ActionParams {
  create_case?: {
    title: string;
    priority: string;
    category?: string;
    assignee_group?: string;
  };
  tag_contact?: {
    tags: string[];
    mode: "add" | "remove";
  };
  update_contact_field?: {
    field: string;
    value: unknown;
  };
  set_case_priority?: {
    priority: string;
  };
  set_case_assignee?: {
    assigneeId: string;
  };
  send_reply?: {
    templateId?: string;
    content?: string;
    aiSuggest?: boolean;
  };
  notify_supervisor?: {
    message: string;
    channel?: string;
  };
  log_action?: {
    message: string;
  };
}

export type ActionType = keyof ActionParams;

export interface AutomationAction {
  type: ActionType;
  params: ActionParams[ActionType];
  order: number;
  continueOnError?: boolean;
}

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  eventType: EventType;
  priority: number;
  stopProcessing: boolean;
  scopeType: "TENANT" | "TEAM" | "CHANNEL";
  scopeId?: string;
  conditionsJson: unknown;
  actionsJson: AutomationAction[];
  createdAt: Date;
  updatedAt: Date;
  tenantId: string;
}

export interface AutomationExecution {
  id: string;
  eventType: string;
  eventId?: string;
  factSnapshot: AutomationFact;
  candidateRuleIds: string[];
  matchedRuleIds: string[];
  actionsExecuted: ActionExecutionResult[];
  stoppedAt?: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  createdAt: Date;
  tenantId: string;
}

export interface ActionExecutionResult {
  actionType: ActionType;
  ruleId: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  result?: unknown;
  error?: string;
  rollbackable: boolean;
  rollbackData?: unknown;
}

export type ScopeType = "TENANT" | "TEAM" | "CHANNEL";

export type ExecutionStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export type ActionResultStatus = "SUCCESS" | "FAILED" | "ROLLED_BACK";

export interface RuleCondition {
  fact: string;
  operator:
    | "equal"
    | "notEqual"
    | "greaterThan"
    | "lessThan"
    | "contains"
    | "in"
    | "notIn";
  value: unknown;
}

export interface RuleConditionGroup {
  any?: RuleCondition[];
  all?: RuleCondition[];
}

export interface RollbackContext {
  actionType: ActionType;
  executionId: string;
  ruleId: string;
  beforeSnapshot: unknown;
  timestamp: Date;
}
