# Design: trial-signup

## Context

- 依賴 platform-core-mvp：`Plan`（trial 方案 row 承載功能/上限）、`getEffectiveLimit`、天花板交集、`provisionTenant(tx, …)`、admin 前端骨架、PlatformSetting。依賴 ai-usage-tracking：`AiUsage` 表。
- 既有可複用：`Tenant.isActive` 停用（auth.service 擋 TENANT_DISABLED、webhook 丟棄 inbound）、`Agent.email` 全域唯一、`seedRolesForTenant`、`email.service.ts`（log/webhook 模式）、MJML 渲染（core/templates）、`renderTemplateBody` 變數替換、analytics.scheduler 的 per-tenant fan-out、@fastify/rate-limit 逐路由、playcaptcha（web 已依賴）。
- 既有 login/createAgent 是 email 精確比對（大小寫敏感）。

## Goals / Non-Goals

**Goals:**
- 零人工全自動開通，但平台總開關可關閉入口。
- 一 email 一次（含 gmail 別名變體）；到期不能重複申請。
- 天數/提醒/開關/保留天數為 PlatformSetting 參數；功能/上限為 trial Plan 參數——全部平台可改零改碼。
- 到期停用與提醒信可靠且冪等（重啟/重跑不重寄、不漏停）。

**Non-Goals:**
- 試用轉正式流程（屬 plan-change-request，platform-control-plane 後續；現階段平台後台手動改 planId+清 trialEndsAt 即可）。
- 到期資料自動清除（保留天數參數先存，purge job 後續）。
- Redis 即時 token 計數器（簡化版 AiUsage 加總足夠）。
- 站內通知/socket 事件（全部走 email）。

## Decisions

### D1. TrialSignup 狀態機精簡為三態，驗證消耗與開通同 transaction
`pending_verification → provisioned | failed`。不設獨立 `verified` 中間態：`GET /verify` 內以**條件式 `updateMany` 原子消耗 token**（where tokenHash+status+未過期 → set tokenHash=null），與 `provisionTenant` 同一 `$transaction`——失敗整體回滾、token 未消耗、重按連結即重試，天然無孤兒資料。count=0 時查 status：已 provisioned → 冪等回成功頁（double-click）；否則 410 過期/失效。

### D2. email 雙欄位：原始 lowercase 供登入、normalized 供唯一鍵
`email = trim().toLowerCase()`（建 Agent 用它——既有 login 精確比對，統一小寫避免登入打不進）；`emailNormalized` 對 gmail.com/googlemail.com 去 `+tag` 與 dots，`@unique` 擋別名重複申請。「是否已是 Agent」用 insensitive 查詢檢查一次。

### D3. 防枚舉：POST /signups 一律 202 同文案
內部分流：全新→建 row 寄信；pending 未過期→視節流重寄；已 provisioned / email 已是任一租戶 Agent→靜默不寄。`trial.enabled=false` 回 403 TRIAL_CLOSED（總開關非枚舉面）；**總開關關閉不影響已寄出驗證信的 verify**（不背刺）。rate limit：signups 5 次/10 分/IP、verify 10/分、resend 3/10 分（比照 auth.routes 逐路由 config.rateLimit）。

### D4. 驗證 token：randomBytes(32) hex，DB 只存 sha256
TTL 讀 `trial.verifyTokenTtlHours`（預設 24h）；重寄產新 token 覆蓋舊 hash（舊連結自動失效）；`verifySentCount`（上限 5）＋ `lastVerifySentAt`（冷卻 60s）節流。高熵 token 無枚舉風險故 verify 可用 GET（信件連結直接點）。

### D5. 排程用 in-process 每小時掃描，不用 BullMQ delayed job
天數/提醒天數是可變參數、平台可延長個別 `trialEndsAt`——delayed job 需跟著改期，狀態分裂在 Redis；DB 掃描每輪讀最新值，小時級精度對天級試用足夠。實作比照 `analytics.scheduler.ts`：單一 timer（啟動即跑一次＋每小時），逐租戶 try/catch。
- 提醒：`daysLeft = ceil((trialEndsAt−now)/86400000)`；`daysLeft ∈ reminderDaysBefore 且 ∉ trialRemindersSent` → 寄該租戶所有 active ADMIN agents → append 標記（**DB 冪等閘**）。
- 到期：`trialEndsAt < now AND isActive` → `isActive=false`＋到期信＋PlatformAuditLog；isActive=false 本身是冪等閘。

### D6. token 額度簡化硬擋放 generateReply 前置
呼叫 provider 前：租戶有效 `monthlyTokens` 非無上限時，查當月 `AiUsage` `SUM(totalTokens)`，≥ 上限 → throw `PLAN_LIMIT_EXCEEDED`（AI 停回，真人回覆不受影響）。sum 查詢帶 `(tenantId, createdAt)` 既有索引，試用流量下可接受；快取 60s 減壓。正式的 Redis 即時計數器屬後續 change，介面預留（檢查函式獨立於 llm.service）。

### D7. SMTP 為第三種 delivery mode，信件模板進程式碼
env：`EMAIL_DELIVERY_MODE` enum 加 `smtp`＋`SMTP_HOST/PORT(587)/SECURE/USER/PASS`（optional，mode=smtp 時 superRefine 必填），同步補 `.env.api.example`。`sendViaSmtp()` 用 nodemailer transporter lazy singleton。四封信（驗證/提醒/到期/開通完成）是平台級、不需租戶自訂 → MJML 常數放 `trial-emails.ts`，渲染複用 `core/templates/mjml-renderer.ts`，變數替換複用 `renderTemplateBody`（耦合過深則抽純 util）。寄信一律 fire-and-forget＋log，失敗不擋主流程（提醒信失敗下輪不補寄同一天數——標記已 append；接受偶發漏信換取簡單性，log 可察覺）。

### D8. 前端申請頁掛 playcaptcha（client gating）
與登入頁同機制；真正防濫用靠 email 驗證＋rate limit＋一 email 一次。密碼強度沿用 createAgent 規則（≥8 字元）。

## Risks / Trade-offs

- [trial 佔用 email 使正式租戶 createAgent 409] → 政策：到期停用不釋放 email；平台後台可見 TrialSignup 列表，保留期後 purge/釋放屬後續 change。
- [verify 時 email 恰被其他租戶建走（P2002）] → catch 後標 `failed`＋failureReason，回明確錯誤「此 email 已被使用」。
- [排程漏跑（API 重啟窗口）] → 啟動即跑一次＋每小時；到期判斷用絕對時間掃描，晚跑只延遲不遺漏。
- [提醒信 daysLeft 跳號（如停機超過一天）] → 判斷改為 `daysLeft ≤ 該提醒檔位 且 檔位 ∉ 已寄標記` 取最大未寄檔位，避免跳過。
- [SMTP 憑證錯誤造成驗證信全掛] → sendEmail 失敗 log error；/resend 可補救；UAT 用 log 模式驗流程。
- [時區] → trialEndsAt 存 UTC、毫秒差算天數（避開 DST）；信件顯示日期用租戶 TenantSettings.timezone（預設 Asia/Taipei）。

## Migration Plan

1. migration：`TrialSignup` 表＋`Tenant.trialEndsAt`/`trialRemindersSent`（一支）。
2. PlatformSetting 的 trial.* 不 seed——accessor 帶程式預設，DB 有值才覆蓋。
3. 程式與 migration 同 PR；`trial.enabled` 預設 false（部署後由平台後台打開），上線零風險。回滾 revert 程式即可。

## Open Questions

- 無阻塞。（試用轉正式與 email 釋放屬 plan-change-request / purge 後續 change。）
