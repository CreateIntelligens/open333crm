# 06 — 事件驅動自動化 (Automation Engine)

## 設計哲學

自動化是系統的「神經系統」。用戶不該每次都手動做重複的事，
而是讓系統在對的時機，主動執行對的動作。

核心原則：
- **事件優先**：所有動作都源於事件，不是靠 Polling
- **可視化規則**：業務人員能設定規則，不需要工程師
- **審計軌跡**：每次自動化執行都留有記錄

---

## 自動化規則結構

```
AutomationRule
  │
  ├── Trigger（觸發器）— 什麼事情發生？
  │     └── 一個規則 = 一個觸發器
  │
  ├── Conditions（條件）— 要滿足什麼？
  │     └── 多個條件可用 AND / OR 組合
  │
  └── Actions（動作）— 要做什麼？
        └── 多個動作，依序執行
```

---

## 觸發器（Triggers）完整清單

### 渠道事件
| 觸發器 | 說明 | 參數 |
|--------|------|------|
| `contact.followed` | 用戶追蹤渠道 | channel_id |
| `contact.unfollowed` | 用戶取消追蹤 | channel_id |
| `message.received` | 收到任何訊息 | channel_id |
| `keyword.matched` | 訊息命中關鍵字 | keywords[], match_mode |
| `postback.received` | 用戶點擊按鈕（LINE/FB postback）| data |

### 聯繫人事件
| 觸發器 | 說明 |
|--------|------|
| `contact.created` | 新聯繫人建立 |
| `contact.tag_added` | 被貼標籤 |
| `contact.tag_removed` | 標籤被移除 |
| `contact.attribute_updated` | 聯繫人屬性更新 |

### Case 事件
| 觸發器 | 說明 |
|--------|------|
| `case.created` | 案件建立 |
| `case.assigned` | 案件被指派 |
| `case.status_changed` | 案件狀態改變 |
| `case.sla_warning` | SLA 即將到期（提前 N 分鐘） |
| `case.sla_breached` | SLA 已違規 |
| `case.closed` | 案件關閉 |

### 排程事件
| 觸發器 | 說明 |
|--------|------|
| `schedule.once` | 指定時間執行一次 |
| `schedule.cron` | Cron 表達式排程 |
| `schedule.daily` | 每天指定時間 |

---

## 條件（Conditions）

```typescript
interface Condition {
  field: string;     // 'contact.tag', 'contact.channel', 'message.text', 'case.priority'
  operator: Operator;
  value: any;
}

type Operator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'has_tag' | 'not_has_tag'
  | 'in' | 'not_in'
  | 'is_empty' | 'is_not_empty';
```

---

## 動作（Actions）完整清單

### 訊息動作
| 動作 | 說明 |
|------|------|
| `send_message` | 發送文字訊息給聯繫人 |
| `send_template` | 發送模板訊息（LINE Flex / FB Template）|
| `send_quick_reply` | 發送帶快速回覆選項的訊息 |
| `assign_bot` | 切換到 Bot 模式自動回覆 |
| `assign_agent` | 切換到真人客服 |

### 聯繫人動作
| 動作 | 說明 |
|------|------|
| `add_tag` | 貼標 |
| `remove_tag` | 移除標籤 |
| `set_attribute` | 設定聯繫人屬性值 |

### Case 動作
| 動作 | 說明 |
|------|------|
| `create_case` | 建立案件（可設定標題/分類/優先級）|
| `assign_case` | 指派給 Agent 或 Team |
| `update_case_status` | 更新案件狀態 |
| `escalate_case` | 升級案件 |
| `add_case_note` | 新增案件備註 |

### 通知動作
| 動作 | 說明 |
|------|------|
| `notify_agent` | 通知客服人員（系統通知）|
| `notify_supervisor` | 通知主管 |
| `send_email` | 發 Email（需設定 SMTP）|

### 外部整合
| 動作 | 說明 |
|------|------|
| `call_webhook` | 呼叫外部 API（POST，含自訂 Headers）|
| `delay` | 延遲 N 分鐘/小時後繼續後續動作 |

---

## 真實業務場景範例（家電業者）

### 場景 1：新用戶加入 LINE OA 歡迎流程

```yaml
name: LINE OA 新用戶歡迎
trigger: contact.followed
  channel_id: line-official-001
conditions: []
actions:
  - send_message: "您好！歡迎加入🏠 XX家電官方帳號！請問有什麼我可以為您服務的嗎？"
  - delay: 2s
  - send_quick_reply:
      text: "請選擇您的需求"
      options:
        - label: 🛠 維修申請
          postback: "REPAIR_REQUEST"
        - label: 📦 購買諮詢
          postback: "PURCHASE_INQUIRY"
        - label: 📋 保固查詢
          postback: "WARRANTY_CHECK"
  - add_tag: "已加入LINE"
```

### 場景 2：關鍵字觸發開案

```yaml
name: 故障投訴自動開案
trigger: keyword.matched
  keywords: ["故障", "壞掉", "不動了", "維修", "退換貨"]
  match_mode: any
conditions:
  - case.open.count: equals 0   # 避免重複開案
actions:
  - create_case:
      title: "自動開案：疑似產品問題"
      priority: high
      category: 維修
  - send_message: "您好，我們已為您建立服務案件，服務人員將盡快與您聯繫！"
  - notify_supervisor: "高優先案件建立，請確認指派"
```

### 場景 3：SLA 警告通知

```yaml
name: SLA 即將到期通知
trigger: case.sla_warning
  minutes_before: 30
conditions:
  - case.assignee: is_not_empty
actions:
  - notify_agent: "⚠️ 案件 #{case.id} SLA 將在 30 分鐘內到期，請儘快處理！"
  - add_case_note: "系統自動提醒：SLA 警告已發送"
```

### 場景 4：定期保固提醒（行銷）

```yaml
name: 月度保固到期提醒
trigger: schedule.cron
  expression: "0 10 1 * *"   # 每月1日早上10點
conditions: []
actions:
  - call_webhook:
      url: /internal/marketing/warranty-reminder
      method: POST
      # 由 Marketing Service 處理受眾分群和發送
```

---

## Automation Engine 執行架構

```
Event Bus 收到事件
    │
    ▼
Automation Engine Worker
  ├── 查詢符合此事件的 Rule 清單
  ├── 逐一評估 Conditions
  ├── 若條件通過 → 執行 Actions（可能有 delay queue）
  └── 記錄 ExecutionLog（成功/失敗/跳過原因）

ExecutionLog
  rule_id, trigger_event_id, started_at, completed_at
  actions_executed[], success, error_message?
```

---

## 防止濫發保護

- **Frequency Cap**：同一聯繫人在 X 小時內，同一規則最多觸發 N 次
- **Global Quiet Hours**：設定全局靜音時段（如：晚上 10 點到早上 8 點不主動發送）
- **Opt-out 尊重**：聯繫人若貼了 `do_not_disturb` 標籤，`send_message` 類動作自動跳過
