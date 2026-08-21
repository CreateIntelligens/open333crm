# trial-lifecycle

## ADDED Requirements

### Requirement: 試用政策參數化
試用政策 MUST 存於 PlatformSetting（key：`trial.enabled`、`trial.durationDays`、`trial.reminderDaysBefore`、`trial.verifyTokenTtlHours`、`trial.dataRetentionDays`、`trial.planSlug`），平台後台可改、MUST NOT 寫死於程式碼；DB 無值時使用程式預設。試用的功能與數值上限 MUST 由 Plan `trial` 方案 row 承載（複用 platform-core-mvp 機制），MUST NOT 另建第二套限制機制。

#### Scenario: 平台改試用天數即時生效
- **GIVEN** `trial.durationDays` 由 14 改為 30
- **WHEN** 新申請完成開通
- **THEN** 其 trialEndsAt MUST 為開通時間 +30 天（既有試用租戶不受影響）

### Requirement: 到期前提醒信
排程 MUST 每小時掃描試用中租戶（`trialEndsAt` 非 null 且 isActive），當剩餘天數到達 `trial.reminderDaysBefore` 任一檔位且該檔位未寄過（以 `Tenant.trialRemindersSent` 標記）時，MUST 寄提醒信給該租戶所有 active ADMIN agents 並記錄標記。同一檔位 MUST NOT 重複寄送（排程重跑、程式重啟均不重寄）。

#### Scenario: 到期前 7 天寄提醒
- **GIVEN** `trial.reminderDaysBefore=[7,1]`，某租戶剩 7 天且 trialRemindersSent 為空
- **WHEN** 排程執行
- **THEN** MUST 寄出提醒信且 trialRemindersSent 變為 [7]

#### Scenario: 重跑不重寄
- **GIVEN** 上述租戶 trialRemindersSent 已含 7
- **WHEN** 排程同日再次執行
- **THEN** MUST NOT 再寄 7 天檔位的提醒

#### Scenario: 停機跨檔位不漏寄
- **GIVEN** 排程停擺兩天，某租戶剩餘天數已從 8 直接變 6（跳過 7）
- **WHEN** 排程恢復執行
- **THEN** 7 天檔位的提醒 MUST 仍被補寄（判斷為 daysLeft ≤ 檔位且未寄）

### Requirement: 到期自動停用（資料保留）
排程發現 `trialEndsAt < now` 且租戶仍 active 時，MUST 將 `Tenant.isActive` 設為 false、寄到期通知信、寫 PlatformAuditLog。停用後 MUST 套用既有停用行為：登入回 `TENANT_DISABLED`、inbound 訊息被丟棄。租戶資料 MUST 保留不刪除（清除屬後續 change，`trial.dataRetentionDays` 僅先儲存）。

#### Scenario: 到期停用
- **GIVEN** 某試用租戶 trialEndsAt 已過
- **WHEN** 排程執行
- **THEN** 該租戶 isActive MUST 為 false，其成員登入 MUST 收到 TENANT_DISABLED
- **AND** 其渠道 inbound 訊息 MUST 被丟棄且資料完整保留

### Requirement: 試用 token 額度硬擋（簡化版）
`generateReply()` 呼叫 LLM 前，若租戶有效 `monthlyTokens` 非無上限，MUST 檢查當月 AiUsage 的 totalTokens 加總；已達上限 MUST 擋下 AI 回覆並回 `PLAN_LIMIT_EXCEEDED`。真人回覆 MUST 不受影響。無上限（null 或無 plan）MUST NOT 檢查。

#### Scenario: 試用租戶用盡 token
- **GIVEN** trial 方案 monthlyTokens=200000，某試用租戶當月 AiUsage 加總已達 200000
- **WHEN** 新的 inbound 訊息觸發 AI 自動回覆
- **THEN** LLM MUST NOT 被呼叫，錯誤 MUST 為 PLAN_LIMIT_EXCEEDED
- **AND** 客服人員手動回覆 MUST 照常送出
