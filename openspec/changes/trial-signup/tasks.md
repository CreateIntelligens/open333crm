# Tasks: trial-signup

## 1. 資料模型

- [x] 1.1 schema.prisma 新增 `TrialSignup` 全域表（email、emailNormalized @unique、siteName、passwordHash、status、verifyTokenHash? @unique、verifyTokenExpiresAt、verifySentCount、lastVerifySentAt、requestIp、tenantId?、provisionedAt、failureReason、時間戳；註解 platform-global）＋ `Tenant.trialEndsAt DateTime?`、`Tenant.trialRemindersSent Json @default("[]")`
- [x] 1.2 `prisma migrate dev` 產正式 migration ＋ `prisma generate`

## 2. Email 基礎（可與其他組並行）

- [x] 2.1 env.ts：EMAIL_DELIVERY_MODE 加 `smtp`；新增 SMTP_HOST/SMTP_PORT(587)/SMTP_SECURE/SMTP_USER/SMTP_PASS（mode=smtp 時 superRefine 必填）；補 `.env.api.example`
- [x] 2.2 email.service.ts 加 `sendViaSmtp()`（nodemailer lazy singleton）；apps/api 加依賴 nodemailer + @types/nodemailer
- [x] 2.3 `modules/trial/trial-emails.ts`：四封信模板（驗證/提醒/到期/開通完成）＋ renderTemplateBody 變數替換。**改用純 HTML 非 MJML**——mjml 是可選依賴，未裝時 compileMjml fallback 會 strip 標籤把按鈕 href 丟掉（實測第一封信按鈕無連結），純 HTML 無此風險

## 3. 申請/驗證/開通 API

- [x] 3.1 `modules/trial/trial-policy.service.ts`：PlatformSetting typed accessor（trial.* 六鍵，程式預設值：enabled=false、durationDays=14、reminderDaysBefore=[7,1]、verifyTokenTtlHours=24）
- [x] 3.2 `modules/trial/email-normalizer.ts`：lowercase + gmail 去 +tag/dots（附單元測試級驗證）
- [x] 3.3 `POST /api/v1/trial/signups`（rate limit 5/10min/IP）：Zod 驗證、總開關、防枚舉分流（全新建 row 寄信 / pending 節流重寄 / provisioned 或已是 Agent 靜默）、token randomBytes(32)+sha256
- [x] 3.4 `GET /api/v1/trial/verify`：條件式 updateMany 原子消耗 token ＋ `provisionTenant()` 同 $transaction（planId=trial、trialEndsAt=now+durationDays、passwordHash 沿用）；double-click 冪等；P2002 標 failed 回明確錯誤；成功後 transaction 外寄開通完成信
- [x] 3.5 `POST /api/v1/trial/resend`（3/10min/IP）：冷卻 60s、上限 5、新 token 覆蓋；一律 202
- [x] 3.6 index.ts 掛 `/api/v1/trial` 公開路由

## 4. 生命週期

- [x] 4.1 `modules/trial/trial.scheduler.ts`：每小時＋啟動即跑；提醒（daysLeft ≤ 檔位且 ∉ trialRemindersSent → 寄該租戶 active ADMIN agents → append 標記）；到期（isActive=false＋到期信＋PlatformAuditLog）；逐租戶 try/catch；index.ts 註冊
- [x] 4.2 token 額度簡化硬擋：`generateReply()` 前置檢查（有效 monthlyTokens 非無上限時查當月 AiUsage SUM，≥ 上限 throw PLAN_LIMIT_EXCEEDED；60s 快取）

## 5. 前端

- [x] 5.1 `app/trial/page.tsx` 公開申請頁（email/站台名/密碼 + playcaptcha）→ 成功轉「請收信」畫面（含 resend 入口）
- [x] 5.2 `app/trial/verify/page.tsx`：讀 ?token 呼叫 verify；成功→站台資訊+前往登入；410→重寄入口；email 撞用→明確錯誤
- [x] 5.3 `app/admin/trial/page.tsx`：trial.* 參數表單（總開關/天數/提醒檔位/保留天數）＋ trial 方案快速連結（admin/plans）＋ TrialSignup 申請列表（狀態/failed 排查）
- [x] 5.4 login 頁加「免費試用」連結

## 6. 驗證

- [x] 6.1 typecheck 全過
- [x] 6.2 申請流端到端（EMAIL_DELIVERY_MODE=log 取連結）：申請→驗證→開通→新帳密登入→sidebar 只見 trial features→建 agent 達上限被擋
- [x] 6.3 防枚舉與唯一性：已開通 email / gmail+tag 變體再申請 → 202 無新 row；resend 節流生效
- [x] 6.4 原子性：模擬開通中途失敗（暫時性）→ token 未消耗可重試；double-click 冪等；P2002 標 failed
- [x] 6.5 生命週期：SQL 調 trialEndsAt → 觸發 scheduler → 提醒信寄出且重跑不重寄（含跳檔位補寄）→ 過期 isActive=false、登入 TENANT_DISABLED、inbound 丟棄
- [x] 6.6 token 硬擋：灌 AiUsage 至上限 → AI 回覆被 PLAN_LIMIT_EXCEEDED 擋、人工回覆正常
- [x] 6.7 SMTP 真信箱跑通驗證信一輪（Gmail SMTP 寄到 dy052340 收信+點連結開通成功）
