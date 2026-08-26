## Why

租戶的 AI token 月額度目前是「用超了才在 `generateReply` 被硬擋（丟 `PLAN_LIMIT_EXCEEDED`）」，租戶事前完全沒有預警——直到客服機器人突然不回話才發現額度耗盡，體驗很差且容易造成客訴。我們需要在額度用到一定比例時「主動提醒」租戶 ADMIN，讓他們有時間聯絡升級或調整用量，而不是被硬擋打個措手不及。

## What Changes

- 新增「用量額度告警」機制：當租戶當月 AI token 用量**跨越 80%（warning）**與**跨越 100%（critical，即已達上限／耗盡）**兩個門檻時，各發送一次通知給該租戶所有啟用中的 ADMIN。
- 通知管道：**站內 Notification（bell 通知）** + **email**（沿用既有 `sendEmail` 基礎設施與試用信模板風格）。
- 觸發點掛在既有 token 累加流程之後（`recordAiUsage` → `incrMonthlyTokens` 之後檢查是否「剛跨越」門檻），只有跨越當下才發，避免每次呼叫都轟炸。
- **冪等閘**：每租戶、每月、每門檻只發一次，重複跨越（或月中重啟、並發）都不會重寄。
- 沿用既有計費範圍規則：**僅 `keySource='platform'` 的用量納入告警**；**BYOK 租戶（自備 key）與無上限（`monthlyTokens` 為 null）的租戶不觸發**任何告警。
- **明確排除（本 change 不做）**：超量計費、自動加購額度、grace 寬限期——這些牽涉金流，屬後續獨立提案。

## Capabilities

### New Capabilities
- `usage-quota-alerts`: 定義 AI token 月額度用量在跨越 warning（80%）與 critical（100%）門檻時，對租戶 ADMIN 發送站內＋email 告警的行為、門檻語意、冪等保證、以及計費範圍（platform-only、排除 BYOK／無上限）。

### Modified Capabilities
<!-- 無：token 硬擋（PLAN_LIMIT_EXCEEDED）行為不變，本 change 只在其之前「新增預警」，不改動既有擋 AI 的 spec 行為。 -->

## Impact

- **程式碼（apps/api）**：
  - `apps/api/src/modules/trial/token-quota.service.ts`：新增「跨越門檻偵測」與冪等閘邏輯（回傳剛跨越的門檻）。
  - `apps/api/src/modules/ai/llm.service.ts`：`recordAiUsage` 內累加後觸發告警發佈（fire-and-forget，不阻塞回覆）。
  - 新增告警發送流程：透過 `eventBus` → 新 event → notification worker → BullMQ（Path B，因需額外查 ADMIN 名單）；email 走既有 `sendEmail`。
  - 新增告警 email 模板（沿用 `trial-emails.ts` 的 `wrap`/`button` 風格）。
- **事件匯流排**：`apps/api/src/events/event-bus.ts` 新增 `AppEventName`（如 `usage.quota.threshold`）。
- **Worker（apps/workers）**：notification handler 既有 `notification:dispatch` job 可直接複用（無需改 handler），email 發送於 API 端 event worker 完成。
- **資料模型（packages/database）**：新增冪等狀態儲存（傾向 Redis flag，見 design；若採 DB 欄位則於 `Tenant` 新增 `quotaAlertsSent` 類比 `trialRemindersSent`）。
- **設定**：無新增必填環境變數；email 沿用既有 `EMAIL_DELIVERY_MODE`（log/smtp/webhook）。
- **平台端可視化**：`platform-usage` 標記 over-quota 列為選配（design 中討論，tasks 標為 optional）。
