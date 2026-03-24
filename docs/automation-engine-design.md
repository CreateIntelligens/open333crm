# Automation Engine Design — MVP v1.0

> Version: 1.0  
> Date: 2026-03-24  
> Status: Draft

---

## 1. Overview

自動化引擎的目標是將「規則判斷」與「業務邏輯」徹底解耦。

核心設計原則：

- 規則用 JSON AST 表達，不手刻 if/else
- 規則與資料來源解耦（fact 注入）
- 支援 priority 與 stop processing
- 支援 scope 多層覆蓋
- 執行結果可觀測、可回滾

---

## 2. 整體架構

```
┌─────────────────────────────────────────────────────────────────┐
│                    AutomationDispatcher                         │
│         (Orchestrator：串起事件 → 規則 → 執行)                  │
└─────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
   │ AutomationFact │   │ AutomationRule │   │    Event       │
   │    Builder     │   │    Service     │   │   Listener    │
   │   (獨立 Fact    │   │   (CRUD/API)   │   │ (domain events│
   │   組裝層)       │   │                │   │  監聽)         │
   └────────────────┘   └────────────────┘   └────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
   ┌─────────────────────────────────────────────────────────────┐
   │              AutomationEngine (json-rules-engine)            │
   │           - 接收 fact + rules                                │
   │           - 執行 AST 判斷                                    │
   │           - 回傳命中的 actions                               │
   │           - 處理 priority 與 stop processing                │
   └─────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌─────────────────────────────────────────────────────────────┐
   │              AutomationActionRegistry                       │
   │   - 註冊各類 action handler                                 │
   │   - 同步執行輕量 action                                     │
   │   - 非同步執行重操作 action (轉 queue)                       │
   │   - 支援 rollback-ready architecture                      │
   └─────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌─────────────────────────────────────────────────────────────┐
   │              ExecutionLog + Rollback                        │
   │   - 記錄每次執行                                           │
   │   - 支援單次 / 批次回滾                                     │
   └─────────────────────────────────────────────────────────────┘
```

---

## 3. 部件職責

### 3.1 AutomationRuleService

- 規則 CRUD、啟停、scope 查詢、priority 排序
- 資料驗證（conditionsJson、actionsJson 結構）
- **不負責執行 action，也不直接做規則判斷**

### 3.2 AutomationFactBuilder

- 依事件型別（message/case/contact/system）組裝標準 fact
- 把 core services 查來的資料轉成單一 JSON
- **讓規則與資料來源解耦**

### 3.3 AutomationEngine

- 封裝 `json-rules-engine`
- 接收 fact + candidate rules，執行判斷
- 回傳命中的 rule 與 actions
- 處理 priority 與 stop processing

### 3.4 AutomationActionRegistry

- 註冊各種 action handler
- engine 只透過 registry 分派，不認識業務細節

### 3.5 AutomationDispatcher / Orchestrator

- 接收事件後，串起：找規則 → build facts → run engine → execute actions
- 決定哪些 action 同步做、哪些丟 queue

---

## 4. 資料模型

### 4.1 規則主表 (automation_rules)

| 欄位           | 類型        | 說明                                              |
| -------------- | ----------- | ------------------------------------------------- |
| id             | UUID        | 主鍵                                              |
| name           | string      | 規則名稱                                          |
| description    | string?     | 描述                                              |
| enabled        | boolean     | 是否啟用                                          |
| eventType      | string      | 觸發事件，例如 `message.received`、`case.created` |
| priority       | integer     | 優先級，數字越大越高                              |
| stopProcessing | boolean     | 命中後是否停止後續規則                            |
| scopeType      | enum        | tenant / team / channel                           |
| scopeId        | UUID?       | 對應的 ID                                         |
| conditionsJson | jsonb       | json-rules-engine 條件樹 (AST)                    |
| actionsJson    | jsonb       | action 陣列                                       |
| createdAt      | timestamptz | 建立時間                                          |
| updatedAt      | timestamptz | 更新時間                                          |

### 4.2 Execution Log 表 (automation_executions)

| 欄位             | 類型        | 說明                              |
| ---------------- | ----------- | --------------------------------- |
| id               | UUID        | 主鍵                              |
| eventType        | string      | 觸發的事件類型                    |
| eventId          | UUID?       | 事件關聯 ID                       |
| factSnapshot     | jsonb       | 當時注入的 fact                   |
| candidateRuleIds | UUID[]      | 候選規則 ID                       |
| matchedRuleIds   | UUID[]      | 命中的規則 ID                     |
| actionsExecuted  | jsonb       | 執行的 actions（含結果）          |
| stoppedAt        | UUID?       | 因 stopProcessing 而中止的規則 ID |
| status           | enum        | success / partial / failed        |
| createdAt        | timestamptz | 執行時間                          |

### 4.3 Action Result 表 (automation_action_results)

| 欄位           | 類型         | 說明                           |
| -------------- | ------------ | ------------------------------ |
| id             | UUID         | 主鍵                           |
| executionId    | UUID         | 關聯的 execution               |
| actionType     | string       | action 類型                    |
| params         | jsonb        | 執行參數                       |
| beforeSnapshot | jsonb?       | 執行前狀態（可回滾用）         |
| afterSnapshot  | jsonb?       | 執行後狀態                     |
| status         | enum         | success / failed / rolled_back |
| errorMessage   | string?      | 錯誤訊息                       |
| rollbackable   | boolean      | 是否支援回滾                   |
| rolledBackAt   | timestamptz? | 回滾時間                       |

---

## 5. Fact 命名空間

Fact 採用固定命名空間，保持穩定：

```
event.*       → 事件本身資訊
message.*     → 訊息內容、來源渠道、方向、時間
contact.*    → 聯絡人屬性、標籤、VIP 狀態
case.*        → 案件狀態、开案次數、優先級
team.*        → 所屬部門
channel.*    → 渠道資訊
billing.*     → 可用 credit、方案限制
system.*      → 租戶、時間、環境資訊
```

範例 fact：

```json
{
  "event": {
    "type": "message.received",
    "timestamp": "2026-03-24T10:30:00Z"
  },
  "message": {
    "id": "msg-123",
    "content": "我的產品故障了",
    "channel": "LINE",
    "direction": "inbound"
  },
  "contact": {
    "id": "contact-456",
    "name": "王小明",
    "isVip": true,
    "tags": ["customer", "premium"],
    "openCaseCount": 2
  },
  "team": {
    "id": "team-789",
    "name": "客服部"
  },
  "channel": {
    "id": "channel-001",
    "name": "官方帳號"
  }
}
```

---

## 6. 執行流程

```
1. Domain Event 發生
   └─ 例：message.received、case.created

2. AutomationDispatcher 接收
   └─ 根據 eventType + scope 找出候選規則
   └─ scope 解析：channel > team > tenant

3. AutomationFactBuilder 組裝 fact
   └─ 用事件資料 + core services 查詢上下文
   └─ 產出標準化 JSON fact

4. AutomationEngine 執行規則判斷
   └─ 內部使用 json-rules-engine
   └─ 依 priority 高到低執行
   └─ 收集命中的 actions
   └─ 若設 stopProcessing，停止後續低權重規則

5. AutomationActionRegistry 執行 actions
   └─ 同步 action：直接執行（輕量操作）
   └─ 非同步 action：轉 queue / worker（重操作）

6. 寫入 Execution Log
   └─ 記錄事實、命中規則、執行的 actions
   └─ 若有 rollbackable action，寫入 beforeSnapshot
```

---

## 7. 同步 / 非同步邊界

### 同步執行（輕量、可預期）

- tag_contact
- update_contact_field
- set_case_priority
- log_action

### 非同步執行（外部效果、需要重試）

- send_message
- notify_supervisor
- create_case（複雜 workflow）

---

## 8. Rollback Architecture

### 設計原則

- 不是任意時間點還原
- 而是針對「可逆 action」提供補償操作
- 每個 action 記 before/after snapshot

### 可回滾 Action（類別 1）

| Action               | 回滾方式             |
| -------------------- | -------------------- |
| tag_contact          | 移除已加的 tags      |
| update_contact_field | 覆寫回 before value  |
| set_case_priority    | 恢復 before priority |
| add_case_note        | 軟刪除該 note        |

### 補償型 Action（類別 2）

| Action            | 補償方式                       |
| ----------------- | ------------------------------ |
| send_message      | 記錄失敗，另開補發 workflow    |
| notify_supervisor | 標記「已撤回」或發送更正       |
| create_case       | 標記為 system-created + 可封存 |

### 禁止批次 Action（類別 3）

- delete_contact
- refund_billing
- trigger_external_webhook
- bulk_tag

### Rollback 介面

```typescript
interface RollbackableAction {
  actionType: string;
  params: Record<string, any>;
  beforeSnapshot: Record<string, any>;

  rollback(): Promise<void>;
  getCompensation(): Promise<void>;
}
```

---

## 9. MVP Event / Action 範圍

### Event（觸發來源）v1.0

| Event               | 說明                       |
| ------------------- | -------------------------- |
| message.received    | 收到訊息                   |
| message.postback    | 收到 postback/button click |
| case.created        | 案件建立                   |
| case.status_changed | 案件狀態變更               |
| case.assigned       | 案件被指派                 |
| contact.created     | 聯絡人建立                 |
| contact.tagged      | 聯絡人被貼標（手動觸發）   |

### Action（執行動作）v1.0

| Action               | 同步/非同步 | 可回滾 | 說明                  |
| -------------------- | ----------- | ------ | --------------------- |
| create_case          | 非同步      | 補償   | 建立案件              |
| tag_contact          | 同步        | 是     | 貼標（支援新增/移除） |
| update_contact_field | 同步        | 是     | 更新欄位              |
| set_case_priority    | 同步        | 是     | 設定優先級            |
| set_case_assignee    | 同步        | 是     | 指派人員              |
| send_reply           | 非同步      | 補償   | 自動回覆（模板/AI）   |
| notify_supervisor    | 非同步      | 補償   | 通知主管              |
| log_action           | 同步        | 是     | 僅記錄（測試用）      |

---

## 10. 未來擴充方向

- Async Operator（黑名單驗證、VIP 判斷等外部 API）
- 可視化 Rule Builder UI（react-querybuilder）
- 更多事件來源（billing、schedule、external webhook）
- 批次 rollback 支援
- Rule 版本管理與發布流程
- Rule 測試與模擬模式

---

## 11. 實作檢查點

- [ ] Prisma schema 包含 rules、executions、action_results
- [ ] Migration 產出並可執行
- [ ] AutomationFactBuilder 依 eventType 組裝 fact
- [ ] AutomationEngine 包裝 json-rules-engine
- [ ] ActionRegistry 註冊 8 個 MVP action
- [ ] 同步/非同步分流機制
- [ ] Execution Log 寫入
- [ ] Rollback API（單次 / 批次）
- [ ] CRUD API for Rules
- [ ] 基本管理 UI（編輯名稱、enabled、priority、JSON）
