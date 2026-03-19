# 04 — Case 管理流程 (Case Management)

## 什麼是 Case？

Case（案件）是 open333CRM **真正 CRM** 的核心。
它代表「一個客戶問題，從被發現到被解決的完整生命週期」。

**與 Conversation 的關係：**
- Conversation = 對話紀錄（渠道層）
- Case = 問題追蹤（業務層）
- 一個 Conversation 可以開一個 Case
- 一個 Case 可以跨多個 Conversation（客戶用不同渠道追問）

---

## Case 狀態機

```
                    ┌─────────┐
                    │  OPEN   │  ← 建立時
                    └────┬────┘
                         │ 指派給 Agent
                         ▼
                   ┌──────────────┐
                   │ IN_PROGRESS  │  ← Agent 正在處理
                   └──────┬───────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       ┌─────────┐  ┌──────────┐  ┌──────────┐
       │ PENDING │  │ RESOLVED │  │ESCALATED │
       │(等待回應)│  │ (已解決) │  │ (已升級) │
       └────┬────┘  └────┬─────┘  └────┬─────┘
            │            │              │
            │ 客戶回覆   │ 確認       重新指派
            ▼            ▼              ▼
       IN_PROGRESS   ┌────────┐   IN_PROGRESS
                     │ CLOSED │
                     └────────┘
```

### 狀態說明

| 狀態 | 說明 | 誰可以觸發 |
|------|------|-----------|
| `open` | 案件建立，尚未指派 | System / Agent |
| `in_progress` | 已指派，處理中 | Agent |
| `pending` | 等待客戶回覆或第三方 | Agent |
| `resolved` | Agent 認為已解決，等待確認 | Agent |
| `escalated` | 需要升級處理（如情況嚴重） | Agent / System |
| `closed` | 正式關閉 | Agent / System（確認後） |

---

## Case 建立方式

### 方式一：手動建立
客服人員在對話中點選「開案」，填入案件標題/分類/優先級。

### 方式二：自動化規則建立
```
觸發：message.received（關鍵字包含「故障」、「退款」）
條件：Contact 標籤包含「VIP」
動作：create_case（Priority: high, Category: 投訴）
```

### 方式三：客戶自助開案
Web Chat Widget 中，客戶點選「報告問題」直接建立 Case。

---

## 指派機制

### 手動指派
Supervisor 或 Agent 直接選擇指派給誰。

### 自動輪派（Round Robin）
```
新 Case 建立 → 查詢 Team 中目前負荷最輕的 Agent → 自動指派
```

### 技能指派（Skill Based，v1.1）
```
Agent 設定技能標籤（如：冰箱維修、洗衣機報修）
Case 分類對應技能 → 系統自動找有對應技能的 Agent
```

---

## SLA 機制

SLA（Service Level Agreement）讓案件有時間壓力與可量化品質。

```typescript
interface SLAPolicy {
  id: string;
  name: string;
  priority: Priority;
  firstResponseTarget: number;   // 分鐘：第一次回應時間目標
  resolutionTarget: number;      // 分鐘：解決時間目標
  warningAt: number;             // SLA 到期前幾分鐘發預警（如：30分鐘前）
}
```

**SLA 預設範例**
| Priority | 首次回應 | 解決時間 |
|----------|---------|---------|
| low      | 8 小時  | 3 天    |
| medium   | 4 小時  | 1 天    |
| high     | 1 小時  | 4 小時  |
| urgent   | 15 分鐘 | 1 小時  |

**SLA 到期流程：**
1. SLA 警告（到期前 N 分鐘）→ 通知 Agent
2. SLA 違規（已超時）→ 通知 Supervisor + 升級 Priority

---

## 事件升級（Escalation）

升級不等於轉手，而是提高重視程度、觸發更多關注。

### 升級觸發條件
- SLA 即將違規
- 客戶在同一 Case 連續發 3 次以上訊息無回應
- Automation Rule 偵測到負面情緒語意（LLM 分析）
- Agent 手動標記升級

### 升級動作
- 提升 Priority
- 通知 Supervisor（系統通知 + Email）
- 可選：重新指派給資深 Agent

---

## Case 關聯功能

### 合併 Case
- 同一個客戶在不同渠道開了重複的案件 → 合併為一個
- 合併時保留所有對話歷程

### 關聯 Case
- 「這個問題和另一個案件相關」→ 建立 Case 關聯，方便一起處理

### 子案件（Sub-case，v1.1）
- 大案件拆分多個子任務，分別指派給不同 Agent

---

## 案件關閉 & 滿意度調查

```
Case Resolved → 系統等待 24 小時 → 自動發送滿意度調查訊息
客戶回覆 → 記錄 CSAT 分數（1~5）→ Case 正式 Closed
若客戶未回覆 → 72 小時後自動 Close（不計 CSAT）
```

---

## Case Dashboard 指標

| 指標 | 說明 |
|------|------|
| Open Cases | 目前開啟案件總數 |
| SLA Breach Rate | SLA 違規率（%） |
| Avg First Response Time | 平均首次回應時間 |
| Avg Resolution Time | 平均解決時間 |
| CSAT Score | 客戶滿意度平均分 |
| Cases by Agent | 每個 Agent 的案件量 |
| Cases by Category | 案件分類比例 |
