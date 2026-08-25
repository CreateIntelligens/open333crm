# Proposal: trial-signup

## Why

目前開通租戶只能靠 seed，潛在客戶無法自助體驗產品。需要「免費試用站台自助申請」：填 email → 驗證 → 自動開通一個受限租戶。試用的天數、功能、token 額度、人數上限全部是平台層可改的參數（功能與數值上限長在 platform-core-mvp 的 Plan `trial` 方案上；天數/提醒/開關等政策參數存 PlatformSetting）。一個 email 只能申請一次、到期不能重複申請；到期前寄提醒信、到期即停用（複用既有 `Tenant.isActive` 停用機制，資料保留）。

依賴：`platform-core-mvp`（Plan/天花板/maxAgents 硬擋/provisionTenant/平台後台）、`ai-usage-tracking`（AiUsage 表，供 token 額度檢查）。

## What Changes

- **新增 `TrialSignup` 全域表**：申請記錄（email lowercase、emailNormalized 唯一鍵防 gmail 別名重複、siteName、passwordHash、狀態機、驗證 token hash、重寄節流欄位、開通結果）。**row 永不刪除 = 一 email 一次、到期不能再申請**。
- **試用政策參數（PlatformSetting KV）**：`trial.enabled`（總開關）、`trial.durationDays`、`trial.reminderDaysBefore`、`trial.verifyTokenTtlHours`、`trial.dataRetentionDays`、`trial.planSlug`；typed accessor 帶程式預設值。
- **`Tenant` 加欄位**：`trialEndsAt DateTime?`（null=非試用）、`trialRemindersSent Json`（提醒冪等標記）。
- **公開申請 API**（`/api/v1/trial`，比照 shortlink/webchat 公開路由先例＋逐路由 rate limit）：
  - `POST /signups`：防枚舉統一回 202；寄驗證信
  - `GET /verify`：token 原子消耗與開通同一 transaction（呼叫 platform-core-mvp 的 `provisionTenant()`）；失敗全回滾可重試
  - `POST /resend`：節流重寄（冷卻 60s、上限 5 次、新 token 覆蓋舊）
- **到期與提醒排程**：`trial.scheduler.ts` in-process 每小時掃描（比照 analytics.scheduler per-tenant fan-out）——到期前 N 天寄提醒（DB 標記冪等）、到期 `isActive=false` ＋到期信＋稽核。
- **試用 token 額度硬擋（簡化版）**：`generateReply()` 前置檢查當月 `AiUsage` token 加總 ≥ 有效 `monthlyTokens` 時擋 AI 回覆（Redis 即時計數器屬 platform-control-plane 後續）。
- **Email SMTP 模式**：`email.service.ts` 加 `smtp` delivery mode（nodemailer），SMTP 設定走 env；四封平台級信件（驗證/提醒/到期/開通完成）以程式碼內 MJML 模板＋既有渲染管線產生。
- **前端**：`/trial` 公開申請頁（含 playcaptcha）、`/trial/verify` 驗證結果頁、`/admin/trial` 平台試用設定與申請列表頁、登入頁加「免費試用」連結。

## Capabilities

### New Capabilities
- `trial-application`: 申請/驗證/自動開通流程——TrialSignup 模型、防枚舉、token 一次性、開通 transaction、email 唯一與正規化、重寄節流、總開關。
- `trial-lifecycle`: 試用生命週期——政策參數（PlatformSetting）、到期提醒信（冪等）、到期停用、token 額度簡化硬擋、資料保留。
- `transactional-email`: email.service 的 SMTP 寄送模式與平台級信件模板。

### Modified Capabilities
（無——登入/停用/webhook 行為完全複用既有機制，無 requirement 變更。）

## Impact

- **DB**：schema.prisma 新增 `TrialSignup`；`Tenant` 加 `trialEndsAt`、`trialRemindersSent`（PlatformSetting 已由 platform-core-mvp 建立）。**必須產正式 migration**。
- **API**：新模組 `apps/api/src/modules/trial/`（routes/service/scheduler/emails/email-normalizer/trial-policy accessor）；`email.service.ts` + `env.ts` 加 SMTP；`llm.service.ts` generateReply 前置 token 檢查；`index.ts` 掛路由與 scheduler；`packages/core/src/rbac/seed-roles.ts` 型別放寬（若 platform-core-mvp 未涵蓋）。
- **前端**：`apps/web/src/app/trial/`、`app/trial/verify/`、`app/admin/trial/`、login 頁連結。
- **新依賴**：`nodemailer`（apps/api）。
- 無 socket 事件、無 workers 變更。
