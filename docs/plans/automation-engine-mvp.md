# Automation Engine MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Automation Engine MVP，包含 Rule CRUD、Fact Builder、Action Registry 與 Execution Log，支援 8 個 MVP Actions 與基本 Rollback

**Architecture:** 採用 json-rules-engine 為核心，透過獨立的 Fact Builder 組裝事實，由 Action Registry 執行命中的動作。規則儲存採用單表 + JSON 設計，支援 scope 多層覆蓋與 priority 語意。

**Tech Stack:** TypeScript, json-rules-engine, Prisma, PostgreSQL, Fastify

---

## 1. 資料模型規劃

### 1.1 新增 Prisma Schema

**Files:**

- Modify: `packages/database/prisma/schema.prisma`

新增以下 Model：

```prisma
model AutomationRule {
  id              String   @id @default(uuid())
  name            String
  description     String?
  enabled         Boolean  @default(true)
  eventType       String
  priority        Int      @default(0)
  stopProcessing  Boolean  @default(false)
  scopeType       ScopeType
  scopeId         String?
  conditionsJson Json
  actionsJson     Json
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenantId        String
}

model AutomationExecution {
  id              String   @id @default(uuid())
  eventType       String
  eventId        String?
  factSnapshot   Json
  candidateRuleIds String[]
  matchedRuleIds String[]
  actionsExecuted Json
  stoppedAt       String?
  status          ExecutionStatus
  createdAt       DateTime @default(now())

  tenantId        String
}

model AutomationActionResult {
  id              String   @id @default(uuid())
  executionId     String
  actionType     String
  params         Json
  beforeSnapshot Json?
  afterSnapshot  Json?
  status          ActionResultStatus
  errorMessage   String?
  rollbackable   Boolean  @default(false)
  rolledBackAt   DateTime?
  createdAt      DateTime @default(now())

  tenantId        String
}

enum ScopeType {
  TENANT
  TEAM
  CHANNEL
}

enum ExecutionStatus {
  SUCCESS
  PARTIAL
  FAILED
}

enum ActionResultStatus {
  SUCCESS
  FAILED
  ROLLED_BACK
}
```

### 1.2 Migration

- [ ] 產出 Prisma Migration

```bash
cd packages/database && pnpm prisma migrate dev --name automation_engine
```

---

## 2. 核心套件結構

### 2.1 建立套件

**Files:**

- Create: `packages/automation/src/index.ts`
- Create: `packages/automation/src/types.ts`
- Create: `packages/automation/src/fact-builder/index.ts`
- Create: `packages/automation/src/engine/index.ts`
- Create: `packages/automation/src/action-registry/index.ts`
- Create: `packages/automation/src/dispatcher/index.ts`
- Create: `packages/automation/src/services/rule-service.ts`
- Create: `packages/automation/src/services/execution-service.ts`

### 2.2 類型定義 (types.ts)

```typescript
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
    value: any;
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

export interface AutomationAction {
  type: keyof ActionParams;
  params: ActionParams[keyof ActionParams];
  rollbackable: boolean;
}
```

---

## 3. Fact Builder 實作

### 3.1 測試

**Files:**

- Create: `packages/automation/src/fact-builder/__tests__/fact-builder.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { buildFactForMessageReceived } from "../fact-builder";

describe("FactBuilder", () => {
  it("should build fact for message.received event", async () => {
    const event = {
      type: "message.received" as const,
      id: "msg-123",
      content: "產品故障",
      channel: "LINE",
      contactId: "contact-456",
      contactName: "王小明",
      contactIsVip: true,
      contactTags: ["customer"],
      contactOpenCaseCount: 2,
      teamId: "team-789",
      teamName: "客服部",
      channelId: "channel-001",
      channelName: "官方帳號",
    };

    const fact = await buildFactForMessageReceived(event);

    expect(fact.event.type).toBe("message.received");
    expect(fact.contact?.isVip).toBe(true);
    expect(fact.message?.content).toBe("產品故障");
  });
});
```

- [ ] **Step 2: Run test**

````bash
cd packages/automation && pnpm test src/fact-builder/__tests__/fact-builder.test.ts
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

```typescript
export interface MessageReceivedEvent {
  type: 'message.received';
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

export async function buildFactForMessageReceived(event: MessageReceivedEvent): Promise<AutomationFact> {
  return {
    event: {
      type: event.type,
      timestamp: new Date().toISOString(),
      id: event.id
    },
    message: {
      id: event.id,
      content: event.content,
      channel: event.channel,
      direction: 'inbound'
    },
    contact: {
      id: event.contactId,
      name: event.contactName,
      isVip: event.contactIsVip,
      tags: event.contactTags,
      openCaseCount: event.contactOpenCaseCount
    },
    team: {
      id: event.teamId,
      name: event.teamName
    },
    channel: {
      id: event.channelId,
      name: event.channelName
    }
  };
}
````

- [ ] **Step 4: Run test again**

````bash
cd packages/automation && pnpm test src/fact-builder/__tests__/fact-builder.test.ts
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/automation/src/fact-builder/
git commit -m "feat(automation): add FactBuilder for message.received event"
````

### 3.2 其餘 Event Fact Builders

- [ ] `buildFactForCaseCreated`
- [ ] `buildFactForCaseStatusChanged`
- [ ] `buildFactForContactCreated`
- [ ] `buildFactForContactTagged`

---

## 4. Engine 實作

### 4.1 測試

**Files:**

- Create: `packages/automation/src/engine/__tests__/engine.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { AutomationEngine } from "../engine";

describe("AutomationEngine", () => {
  it("should run rules and return matched actions", async () => {
    const engine = new AutomationEngine();

    const fact = {
      event: { type: "message.received", timestamp: new Date().toISOString() },
      contact: {
        id: "c1",
        name: "Test",
        isVip: true,
        tags: [],
        openCaseCount: 0,
      },
      message: {
        id: "m1",
        content: "故障",
        channel: "LINE",
        direction: "inbound",
      },
    };

    const rules = [
      {
        id: "rule-1",
        name: "VIP 故障開案",
        priority: 100,
        stopProcessing: true,
        conditionsJson: {
          all: [
            { fact: "contact.isVip", operator: "equal", value: true },
            { fact: "message.content", operator: "contains", value: "故障" },
          ],
        },
        actionsJson: [
          {
            type: "create_case",
            params: { title: "VIP 故障", priority: "high" },
          },
        ],
      },
    ];

    const result = await engine.run(fact, rules);

    expect(result.matchedRules).toHaveLength(1);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("create_case");
  });

  it("should respect priority and stopProcessing", async () => {
    const engine = new AutomationEngine();

    const fact = {
      event: { type: "message.received", timestamp: new Date().toISOString() },
      contact: {
        id: "c1",
        name: "Test",
        isVip: true,
        tags: [],
        openCaseCount: 0,
      },
      message: {
        id: "m1",
        content: "故障",
        channel: "LINE",
        direction: "inbound",
      },
    };

    const rules = [
      {
        id: "rule-low",
        name: "一般故障",
        priority: 10,
        stopProcessing: false,
        conditionsJson: {
          all: [
            { fact: "message.content", operator: "contains", value: "故障" },
          ],
        },
        actionsJson: [{ type: "log_action", params: { message: "一般故障" } }],
      },
      {
        id: "rule-high",
        name: "VIP 故障最高",
        priority: 100,
        stopProcessing: true,
        conditionsJson: {
          all: [
            { fact: "contact.isVip", operator: "equal", value: true },
            { fact: "message.content", operator: "contains", value: "故障" },
          ],
        },
        actionsJson: [
          {
            type: "create_case",
            params: { title: "VIP 故障", priority: "high" },
          },
        ],
      },
    ];

    const result = await engine.run(fact, rules);

    // Should only execute high priority rule due to stopProcessing
    expect(result.matchedRules).toHaveLength(1);
    expect(result.matchedRules[0].id).toBe("rule-high");
  });
});
```

- [ ] **Step 2: Run test** (should fail - module not found)

- [ ] **Step 3: Write implementation**

```typescript
import { Engine, Rule, Fact } from "json-rules-engine";

export interface EngineRule {
  id: string;
  name: string;
  priority: number;
  stopProcessing: boolean;
  conditionsJson: any;
  actionsJson: any[];
}

export interface EngineResult {
  matchedRules: EngineRule[];
  actions: Array<{
    type: string;
    params: any;
    ruleId: string;
  }>;
  stoppedAt?: string;
}

export class AutomationEngine {
  private engine: Engine;

  constructor() {
    this.engine = new Engine([], { prioritySort: "asc" });
  }

  async run(fact: Fact, rules: EngineRule[]): Promise<EngineResult> {
    // Clear and rebuild engine with new rules
    this.engine = new Engine([], { prioritySort: "asc" });

    // Sort rules by priority (descending)
    const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

    let stoppedAt: string | undefined;
    const matchedRules: EngineRule[] = [];
    const actions: Array<{ type: string; params: any; ruleId: string }> = [];

    for (const rule of sortedRules) {
      // Create a temporary engine for each rule to check if it matches
      const tempEngine = new Engine([], { prioritySort: "asc" });

      tempEngine.addRule({
        id: rule.id,
        name: rule.name,
        conditions: rule.conditionsJson,
        priority: rule.priority,
        onSuccess: (facts: any) => {
          matchedRules.push(rule);
          actions.push(
            ...rule.actionsJson.map((a: any) => ({
              ...a,
              ruleId: rule.id,
            })),
          );

          if (rule.stopProcessing) {
            stoppedAt = rule.id;
          }
        },
        onFailure: () => {},
      });

      await tempEngine.run(fact);

      // If stopped, break out
      if (stoppedAt) break;
    }

    return { matchedRules, actions, stoppedAt };
  }
}
```

- [ ] **Step 4: Run test again** (should pass)

- [ ] **Step 5: Commit**

```bash
git add packages/automation/src/engine/
git commit -m "feat(automation): add AutomationEngine with json-rules-engine"
```

---

## 5. Action Registry 實作

### 5.1 Registry 結構

**Files:**

- Create: `packages/automation/src/action-registry/index.ts`

```typescript
import { CaseService } from "@open333crm/case-service";
import { ContactService } from "@open333crm/contact-service";
import { MessageService } from "@open333crm/message-service";

export interface ActionHandler {
  type: string;
  execute(params: any, context: AutomationContext): Promise<ActionResult>;
  rollback?(result: ActionResult, context: AutomationContext): Promise<void>;
}

export interface AutomationContext {
  tenantId: string;
  eventType: string;
  eventId: string;
  contactId?: string;
  caseId?: string;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
  beforeSnapshot?: any;
  afterSnapshot?: any;
}
```

### 5.2 Handlers

**Files:**

- Create: `packages/automation/src/action-registry/handlers/index.ts`
- Create: `packages/automation/src/action-registry/handlers/create-case.ts`
- Create: `packages/automation/src/action-registry/handlers/tag-contact.ts`
- Create: `packages/automation/src/action-registry/handlers/update-contact-field.ts`
- Create: `packages/automation/src/action-registry/handlers/set-case-priority.ts`
- Create: `packages/automation/src/action-registry/handlers/set-case-assignee.ts`
- Create: `packages/automation/src/action-registry/handlers/send-reply.ts`
- Create: `packages/automation/src/action-registry/handlers/notify-supervisor.ts`
- Create: `packages/automation/src/action-registry/handlers/log-action.ts`

每個 handler 範例：

```typescript
import { ActionHandler, ActionResult, AutomationContext } from "../index";

export const createCaseHandler: ActionHandler = {
  type: "create_case",

  async execute(
    params: any,
    context: AutomationContext,
  ): Promise<ActionResult> {
    const caseService = new CaseService();

    const beforeSnapshot = null;
    const newCase = await caseService.create({
      title: params.title,
      priority: params.priority,
      category: params.category,
      assigneeGroup: params.assignee_group,
      sourceEvent: context.eventType,
      sourceEventId: context.eventId,
      contactId: context.contactId,
      tenantId: context.tenantId,
    });

    return {
      success: true,
      data: newCase,
      beforeSnapshot,
      afterSnapshot: newCase,
    };
  },

  async rollback(
    result: ActionResult,
    context: AutomationContext,
  ): Promise<void> {
    // Compensation: mark as system-created, or close the case
    const caseService = new CaseService();
    await caseService.updateStatus(
      result.data.id,
      "cancelled",
      context.tenantId,
    );
  },
};
```

### 5.3 Registry 測試

**Files:**

- Create: `packages/automation/src/action-registry/__tests__/registry.test.ts`

- [ ] 測試 registry 註冊與分派
- [ ] 測試同步 vs 非同步分流

---

## 6. Rule Service 實作

### 6.1 CRUD API

**Files:**

- Create: `packages/automation/src/services/rule-service.ts`

```typescript
export class AutomationRuleService {
  async createRule(data: CreateRuleDto): Promise<AutomationRule> {
    // Validate conditionsJson structure
    // Validate actionsJson structure
    return prisma.automationRule.create({ data });
  }

  async updateRule(id: string, data: UpdateRuleDto): Promise<AutomationRule> {
    return prisma.automationRule.update({ where: { id }, data });
  }

  async getRulesByEventType(
    eventType: string,
    tenantId: string,
    scope?: ScopeQuery,
  ): Promise<AutomationRule[]> {
    // Query rules by eventType
    // Apply scope filtering: channel > team > tenant
  }

  async getRuleById(id: string): Promise<AutomationRule> {
    return prisma.automationRule.findUnique({ where: { id } });
  }

  async toggleEnabled(id: string, enabled: boolean): Promise<AutomationRule> {
    return prisma.automationRule.update({
      where: { id },
      data: { enabled },
    });
  }
}
```

### 6.2 API Routes

**Files:**

- Create: `apps/api/src/routes/automation/rules.ts`

```typescript
// POST /api/v1/automation/rules
// GET /api/v1/automation/rules
// GET /api/v1/automation/rules/:id
// PUT /api/v1/automation/rules/:id
// DELETE /api/v1/automation/rules/:id
// PATCH /api/v1/automation/rules/:id/toggle
```

---

## 7. Dispatcher 實作

### 7.1 主流程

**Files:**

- Create: `packages/automation/src/dispatcher/index.ts`

```typescript
export class AutomationDispatcher {
  async dispatch(event: DomainEvent): Promise<DispatchResult> {
    // 1. Find candidate rules
    const rules = await this.ruleService.getRulesByEventType(
      event.type,
      event.tenantId,
      { teamId: event.teamId, channelId: event.channelId },
    );

    if (rules.length === 0) {
      return { executed: false, reason: "no_matching_rules" };
    }

    // 2. Build fact
    const fact = await this.factBuilder.build(event);

    // 3. Run engine
    const { matchedRules, actions, stoppedAt } = await this.engine.run(
      fact,
      rules,
    );

    // 4. Execute actions
    const results = await this.actionRegistry.execute(actions, {
      tenantId: event.tenantId,
      eventType: event.type,
      eventId: event.id,
      contactId: event.contactId,
      caseId: event.caseId,
    });

    // 5. Log execution
    await this.executionService.log({
      eventType: event.type,
      eventId: event.id,
      factSnapshot: fact,
      candidateRuleIds: rules.map((r) => r.id),
      matchedRuleIds: matchedRules.map((r) => r.id),
      actionsExecuted: results,
      stoppedAt,
      status: results.every((r) => r.success)
        ? "SUCCESS"
        : results.some((r) => r.success)
          ? "PARTIAL"
          : "FAILED",
    });

    return { executed: true, matchedRules, actions: results };
  }
}
```

### 7.2 Event Listeners

**Files:**

- Create: `packages/automation/src/listeners/index.ts`

Hook 到現有服務的事件：

```typescript
// message.received -> dispatcher.dispatch()
// case.created -> dispatcher.dispatch()
// contact.created -> dispatcher.dispatch()
```

---

## 8. Execution Log 與 Rollback

### 8.1 Execution Service

**Files:**

- Create: `packages/automation/src/services/execution-service.ts`

```typescript
export class AutomationExecutionService {
  async logExecution(data: ExecutionLogDto): Promise<AutomationExecution> {
    return prisma.automationExecution.create({ data });
  }

  async getExecutionById(id: string): Promise<AutomationExecution> {
    return prisma.automationExecution.findUnique({
      where: { id },
      include: { actionResults: true },
    });
  }

  async getExecutionByEvent(
    eventType: string,
    eventId: string,
  ): Promise<AutomationExecution[]> {
    return prisma.automationExecution.findMany({
      where: { eventType, eventId },
    });
  }

  async rollbackExecution(executionId: string): Promise<RollbackResult> {
    const execution = await this.getExecutionById(executionId);
    const rollbackableActions = execution.actionResults.filter(
      (r) => r.rollbackable && r.status === "SUCCESS",
    );

    const results = [];
    for (const action of rollbackableActions) {
      const handler = this.actionRegistry.getHandler(action.actionType);
      if (handler.rollback) {
        await handler.rollback(action as any, context);
        results.push({ actionId: action.id, status: "rolled_back" });
      }
    }

    return { rolledBack: results };
  }

  async rollbackBatch(executionIds: string[]): Promise<BatchRollbackResult> {
    // Rollback multiple executions
  }
}
```

### 8.2 Rollback API

**Files:**

- Modify: `apps/api/src/routes/automation/rules.ts`

```typescript
// POST /api/v1/automation/executions/:id/rollback
// POST /api/v1/automation/executions/batch-rollback
```

---

## 9. 實作檢查清單

- [ ] Task 1: Prisma Schema + Migration
- [ ] Task 2: Types 定義
- [ ] Task 3: FactBuilder - message.received
- [ ] Task 4: FactBuilder - case.created
- [ ] Task 5: FactBuilder - contact.created
- [ ] Task 6: AutomationEngine 基礎
- [ ] Task 7: ActionRegistry 結構 + 8 handlers
- [ ] Task 8: RuleService CRUD
- [ ] Task 9: API Routes
- [ ] Task 10: Dispatcher 主流程
- [ ] Task 11: Event Listeners 整合
- [ ] Task 12: Execution Log
- [ ] Task 13: Rollback API
- [ ] Task 14: 基本管理 UI

---

## 10. 預期產出

1. `packages/automation` 套件（核心邏輯）
2. 新增 3 個 Prisma Model + Migration
3. API Routes: `/api/v1/automation/*`
4. 基本管理 UI（React 元件）
5. 可運行的 End-to-End 測試案例

---

**Plan saved to:** `docs/plans/automation-engine-mvp.md`
