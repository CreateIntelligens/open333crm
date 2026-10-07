# trial-lifecycle Specification

## Purpose

定義試用租戶開通之後的生命週期：試用政策的參數、到期前提醒、到期自動停用、試用期間的 AI token 額度，以及轉為付費方案時脫離試用。申請與開通見 `trial-application`。

## Requirements

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
試用租戶的 AI 月額度 SHALL 與其他租戶相同，由 `token-quota` 的「呼叫 LLM 之前檢查月額度」執行。本月用量達到試用方案的有效 `monthlyTokens` 時，系統 MUST NOT 呼叫 LLM，MUST 拋出 `PLAN_LIMIT_EXCEEDED`。

#### Scenario: 試用租戶用盡 token
- **GIVEN** trial 方案 monthlyTokens=200000，某試用租戶本月的用量已達 200000
- **WHEN** 新的 inbound 訊息觸發 AI 自動回覆
- **THEN** LLM MUST NOT 被呼叫，錯誤 MUST 為 PLAN_LIMIT_EXCEEDED

### Requirement: 轉為付費方案時脫離試用
試用租戶是 `trialEndsAt` 不是 null 的租戶。下列兩個操作 MUST 讓試用租戶脫離試用：

- 平台核准該租戶 `type=upgrade` 的方案異動申請（`approveRequest()`）。
- 平台以「轉付費」操作轉換該租戶（`convertToPaid()`）。

脫離試用時，系統 MUST 在同一次更新中把 `trialEndsAt` 設為 null、`purgedAt` 設為 null、`isActive` 設為 true。脫離試用之後，到期排程與軟刪排程 MUST NOT 再處理這個租戶。

其他操作 MUST NOT 改變試用狀態：核准 `token_topup` 申請，以及平台在租戶編輯頁改方案（`updateTenant()`）。

`trialEndsAt` 已經是 null 的租戶，核准 `upgrade` 申請時 MUST NOT 改變 `isActive` 與 `purgedAt`。

#### Scenario: 核准試用租戶的升級申請
- **WHEN** 平台核准一筆 `type=upgrade` 的申請，申請的租戶 `trialEndsAt` 不是 null、`isActive=true`
- **THEN** 該租戶的 `planId` MUST 是申請的目標方案，`trialEndsAt` MUST 是 null，`isActive` MUST 是 true

#### Scenario: 申請審核期間試用已到期並被軟刪
- **WHEN** 平台核准一筆 `type=upgrade` 的申請，申請的租戶 `trialEndsAt` 已過、`isActive=false`、`purgedAt` 不是 null
- **THEN** 該租戶的 `trialEndsAt` MUST 是 null，`purgedAt` MUST 是 null，`isActive` MUST 是 true

#### Scenario: 核准非試用租戶的升級申請
- **WHEN** 平台核准一筆 `type=upgrade` 的申請，申請的租戶 `trialEndsAt` 是 null、`isActive=false`
- **THEN** 該租戶的 `planId` MUST 是申請的目標方案，`isActive` MUST 仍是 false

#### Scenario: 核准試用租戶的加購申請
- **WHEN** 平台核准一筆 `type=token_topup` 的申請，申請的租戶 `trialEndsAt` 不是 null
- **THEN** 該租戶的 `trialEndsAt` MUST 不變

#### Scenario: 轉付費清除軟刪標記
- **WHEN** 平台對一個 `trialEndsAt` 不是 null、`isActive=false`、`purgedAt` 不是 null 的租戶執行「轉付費」
- **THEN** 該租戶的 `trialEndsAt` MUST 是 null，`purgedAt` MUST 是 null，`isActive` MUST 是 true

#### Scenario: 平台在編輯頁改方案不脫離試用
- **WHEN** 平台以租戶編輯頁把一個 `trialEndsAt` 不是 null 的租戶改成其他方案
- **THEN** 該租戶的 `trialEndsAt` MUST 不變

#### Scenario: 脫離試用後不被到期排程停用
- **WHEN** 一個租戶經由核准升級申請脫離試用，之後到期排程在原本的試用到期日之後執行
- **THEN** 該租戶的 `isActive` MUST 仍是 true，且系統 MUST NOT 寄出試用到期信

### Requirement: 試用方案不能當成升級或轉正式的目標
試用方案是試用政策 `trial.planSlug` 指定的方案。下列操作的目標方案是試用方案時，系統 MUST 回應 400，而且 MUST NOT 改變任何租戶或申請：

- 租戶建立 `type=upgrade` 的方案異動申請（`createPlanChangeRequest()`）。
- 平台核准 `type=upgrade` 的方案異動申請（`approveRequest()`）。這涵蓋規則上線前就已建立的申請。
- 平台以「轉正式」轉換租戶（`convertToPaid()`）。

系統 MUST 以當下的 `trial.planSlug` 判斷，MUST NOT 寫死方案的 slug。

#### Scenario: 租戶申請升級到試用方案
- **WHEN** 租戶建立 `type=upgrade` 的申請，`targetPlanSlug` 是 `trial.planSlug` 指定的方案
- **THEN** 系統 MUST 回應 400，而且 MUST NOT 建立申請

#### Scenario: 平台核准目標為試用方案的升級申請
- **WHEN** 平台核准一筆 `type=upgrade`、`status=pending` 的申請，目標方案是 `trial.planSlug` 指定的方案，申請的租戶 `trialEndsAt` 不是 null
- **THEN** 系統 MUST 回應 400；該租戶的 `planId` 與 `trialEndsAt` MUST 不變，申請的 `status` MUST 仍是 `pending`

#### Scenario: 轉正式到試用方案
- **WHEN** 平台對試用租戶執行「轉正式」，目標方案是 `trial.planSlug` 指定的方案，而這個方案的 slug 不是 `trial`
- **THEN** 系統 MUST 回應 400，而且該租戶的 `trialEndsAt` MUST 不變
