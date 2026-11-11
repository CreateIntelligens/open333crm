## Why

Issue #339：滿意度問卷（CSAT）的兩份設計文件、主規格和程式各說各話，「工單重新解決」這條路沒有任何規格定義，
已經造成可以重現的錯誤（AUDIT CASE-04，P1）：

- 工單重開再解決時只寫新的 `resolvedAt`，不清掉上一輪的 `csatSentAt`。問卷逾時結案排程只看 `csatSentAt`，
  上一輪問卷寄出超過 72 小時的工單，**重新解決後一分鐘內就被自動結案**，並關閉底下的對話；客人也收不到這次的問卷。
- 客人連點兩次評分：`recordCsatScore()` 先在 JS 檢查 `csatScore` 是空值，再只用 id 更新，兩次請求都通過檢查，
  客人收到兩則感謝訊息、低分時主管收到兩次通知、`case.closed` 發兩次。
- 低分通知只看舊角色列舉 `role` 是 `SUPERVISOR` 的人，不含管理員，也不看渠道可見範圍（AUDIT RBAC-03）。
- 非 LINE 渠道送的是純文字「回覆 csat:分數」，缺工單 ID，客人回覆不了（AUDIT CASE-02）。
- 客服代評和客人自評寫在同一欄，報表分不出來。

2026-11-11 使用者在 issue #339 做了 8 項決定，本 change 把它們寫進主規格，再照規格修程式。

## What Changes

1. **重新開啟與改回處理中都保留**：`CLOSED → OPEN`（客人說沒解決）與 `RESOLVED → IN_PROGRESS`（客服按錯）寫進
   `case-management`。
2. **重新解決後的問卷（決定 C）**：已評分的工單保留分數，不再寄、不自動逾時結案；沒評分的清掉 `csatSentAt`
   （與 `csatRespondedAt`），重新排程寄一份，逾時從重新寄出的問卷起算。規則放在 `@open333crm/shared` 的
   `caseTransitionCsatFields()`，API 的 `transitionCase()` 與 workers 的 `update_case_status` 共用（同 #417 的作法）。
3. **以 `docs/19_CSAT_FLOW.md` 為準**並依本次決定改寫；`docs/04_CASE_MANAGEMENT.md` 的 CSAT 段落標成過時，指向 19。
4. **寄問卷延遲改成 30 分鐘**（常數 `CSAT_SURVEY_DELAY_MINUTES`），不做租戶設定、不提供關閉開關。
5. **低分（1～2 分）只通知、不升級工單**。通知對象改成有效權限（角色權限 ∩ 方案天花板）含 `case.assign`、
   啟用中、看得到工單渠道的成員，不再看 `role` 列舉。
6. **評分後關閉對話**，與逾時結案相同（`closeConversationsForCase`，`source: 'csat'`）。
7. **非 LINE 渠道不寄問卷**：渠道外掛新增選用方法 `buildCsatSurvey()`，只有 LINE 外掛實作；問卷排程與
   `sendCsatSurvey()` 依外掛能力判斷，不在 csat 模組比對 `channelType`。不寄問卷的工單停在 `RESOLVED`，
   不逾時結案，由客服手動結案。
8. **客服代評保留並標記來源**：工單新增 `csatRatedBy`（`customer`／`agent`，migration 以 `csat_rated` 事件回填）。
   報表的 CSAT 平均與好評率只算客人自評，另外回傳並顯示客服代評的筆數。

另修：評分改成條件更新認領（`csatScore: null`），沒寫入就不送感謝訊息、不發低分通知、不發 `case.closed`。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `csat-survey`：改名並修改「每次解決最多寄出一份滿意度問卷」（原「每張工單最多寄出一份滿意度問卷」）、
  修改「問卷送不出時客服看得到」；新增「工單解決 30 分鐘後寄出問卷」「只對能讓客人點選分數的渠道寄問卷」
  「工單重新解決時的問卷」「評分只處理一次」「低分只通知負責工單的成員」「評分後關閉對話」「工單記錄評分來源」。
- `inbound-message-processing`：修改「CSAT 回覆的攔截」（評分條件以條件更新寫入，同時送達只處理一次）。
- `case-management`：修改「Case Status Transition Validation」（寫明重新開啟與改回處理中的用途，以及重新解決時的問卷欄位）。
- `analytics-reports`：新增「滿意度分數只算客人自評」。
- `channel-plugins`：新增「Channel plugins declare whether they can send a CSAT survey」。

## Platform layer

AGENTS.md 表格的各列都不適用：沒有新增權限碼（低分通知沿用既有的 `case.assign`）、功能模組、方案上限、
AI 呼叫、渠道類型、租戶設定（使用者決定延遲不開放租戶設定）、平台稽核動作、BullMQ 佇列，
也沒有租戶與平台之間的申請。

## Impact

- 資料庫：`cases` 新增 `csatRatedBy` 欄位（migration `20261111100000_add_case_csat_rated_by`，含回填）。
- API：`csat.service.ts`、`csat.scheduler.ts`、`case.service.ts`、`notification.service.ts`、`analytics.service.ts`、
  `services/permission.service.ts`。
- workers：`automation-actions.ts` 的 `update_case_status`。
- 套件：`@open333crm/shared`（`caseTransitionCsatFields()`）、`@open333crm/channel-plugins`（`buildCsatSurvey()`）。
- 前端：報表 KPI 卡顯示客服代評筆數；工單詳情標示評分來源。

## 不在本 change 的範圍

- 文字回饋（`csatComment`）的客人填寫途徑。
- 非 LINE 渠道的快速回覆問卷（使用者決定等需要時再做）。
- 工單已重開（`IN_PROGRESS`）時客人點舊問卷按鈕：現況仍會記錄分數並結案，另開 issue 討論。
