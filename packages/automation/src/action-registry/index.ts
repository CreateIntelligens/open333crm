import { ActionType, ActionParams, AutomationFact } from "../types.js";

const log = (type: string, message: string, ...args: unknown[]) => {
  console.log(`[${type}]`, message, ...args);
};

export interface ActionHandler {
  execute(
    params: ActionParams[ActionType],
    fact: AutomationFact,
    context: { tenantId: string; executionId: string; ruleId: string },
  ): Promise<{
    result: unknown;
    rollbackable: boolean;
    rollbackData?: unknown;
  }>;

  rollback?(data: unknown): Promise<void>;
}

const actionHandlers: Record<ActionType, ActionHandler> = {
  create_case: {
    async execute(params, _fact, context) {
      const caseData = params as NonNullable<ActionParams["create_case"]>;
      log(
        "create_case",
        "Creating case with params:",
        caseData,
        "tenant:",
        context.tenantId,
      );
      return {
        result: {
          id: `case-${Date.now()}`,
          title: caseData.title,
          priority: caseData.priority,
        },
        rollbackable: true,
        rollbackData: { caseId: `case-${Date.now()}` },
      };
    },
    async rollback(data: unknown) {
      log("create_case", "Rollback - deleting case:", data);
    },
  },

  tag_contact: {
    async execute(params, fact, context) {
      const tagData = params as NonNullable<ActionParams["tag_contact"]>;
      log(
        "tag_contact",
        "Tagging contact:",
        fact.contact?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: {
          contactId: fact.contact?.id,
          tags: tagData.tags,
          mode: tagData.mode,
        },
        rollbackable: true,
        rollbackData: {
          contactId: fact.contact?.id,
          tags: tagData.tags,
          mode: tagData.mode,
        },
      };
    },
    async rollback(data: unknown) {
      log("tag_contact", "Rollback - removing tags:", data);
    },
  },

  update_contact_field: {
    async execute(params, fact, context) {
      const fieldData = params as NonNullable<
        ActionParams["update_contact_field"]
      >;
      log(
        "update_contact_field",
        "Updating contact field:",
        fact.contact?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: {
          contactId: fact.contact?.id,
          field: fieldData.field,
          value: fieldData.value,
        },
        rollbackable: true,
        rollbackData: { contactId: fact.contact?.id, field: fieldData.field },
      };
    },
    async rollback(data: unknown) {
      log("update_contact_field", "Rollback:", data);
    },
  },

  set_case_priority: {
    async execute(params, fact, context) {
      const priorityData = params as NonNullable<
        ActionParams["set_case_priority"]
      >;
      log(
        "set_case_priority",
        "Setting case priority:",
        fact.case?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: { caseId: fact.case?.id, priority: priorityData.priority },
        rollbackable: true,
        rollbackData: {
          caseId: fact.case?.id,
          oldPriority: fact.case?.priority,
        },
      };
    },
    async rollback(data: unknown) {
      log("set_case_priority", "Rollback:", data);
    },
  },

  set_case_assignee: {
    async execute(params, fact, context) {
      const assigneeData = params as NonNullable<
        ActionParams["set_case_assignee"]
      >;
      log(
        "set_case_assignee",
        "Setting case assignee:",
        fact.case?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: { caseId: fact.case?.id, assigneeId: assigneeData.assigneeId },
        rollbackable: true,
        rollbackData: {
          caseId: fact.case?.id,
          oldAssigneeId: fact.case?.assigneeId,
        },
      };
    },
    async rollback(data: unknown) {
      log("set_case_assignee", "Rollback:", data);
    },
  },

  send_reply: {
    async execute(params, fact, context) {
      const replyData = params as NonNullable<ActionParams["send_reply"]>;
      log(
        "send_reply",
        "Sending reply to:",
        fact.contact?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: {
          contactId: fact.contact?.id,
          messageId: `msg-${Date.now()}`,
          content: replyData.content || "Auto reply",
          aiSuggested: replyData.aiSuggest,
        },
        rollbackable: false,
      };
    },
  },

  notify_supervisor: {
    async execute(params, fact, context) {
      const notifyData = params as NonNullable<
        ActionParams["notify_supervisor"]
      >;
      log(
        "notify_supervisor",
        "Notifying supervisor for contact:",
        fact.contact?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: {
          message: notifyData.message,
          channel: notifyData.channel || "email",
          contactId: fact.contact?.id,
        },
        rollbackable: false,
      };
    },
  },

  log_action: {
    async execute(params, fact, context) {
      const logData = params as NonNullable<ActionParams["log_action"]>;
      log(
        "log_action",
        "Logging action for contact:",
        fact.contact?.id,
        "tenant:",
        context.tenantId,
      );
      return {
        result: {
          message: logData.message,
          contactId: fact.contact?.id,
          timestamp: new Date().toISOString(),
        },
        rollbackable: false,
      };
    },
  },
};

export class ActionRegistry {
  private handlers: Map<ActionType, ActionHandler>;

  constructor() {
    this.handlers = new Map(
      Object.entries(actionHandlers) as [ActionType, ActionHandler][],
    );
  }

  async executeAction(
    actionType: ActionType,
    params: ActionParams[ActionType],
    fact: AutomationFact,
    context: { tenantId: string; executionId: string; ruleId: string },
  ): Promise<{
    result: unknown;
    rollbackable: boolean;
    rollbackData?: unknown;
  }> {
    const handler = this.handlers.get(actionType);
    if (!handler) {
      throw new Error(`Unknown action type: ${actionType}`);
    }
    return handler.execute(params, fact, context);
  }

  async rollbackAction(actionType: ActionType, data: unknown): Promise<void> {
    const handler = this.handlers.get(actionType);
    if (!handler?.rollback) {
      log("warn", `Action ${actionType} is not rollbackable`);
      return;
    }
    return handler.rollback(data);
  }

  isRollbackable(actionType: ActionType): boolean {
    return this.handlers.get(actionType)?.rollback !== undefined;
  }

  getAvailableActions(): ActionType[] {
    return Array.from(this.handlers.keys());
  }
}

export const actionRegistry = new ActionRegistry();
