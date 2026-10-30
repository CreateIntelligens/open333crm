---
name: feature-platform-tenants
description: >
  open333CRM「平台後台：租戶管理」功能顧問：租戶列表、租戶詳細頁（資料量統計、基本資料、改方案）、
  手動開通租戶與開通信（loginUrl、信裡沒有密碼）、重寄開通信、改成員登入 Email、停用/啟用租戶
  （停用後擋登入、擋 refresh、丟棄進站訊息）、合約起訖日、試用資料清除（purgedAt）與復原、
  個資遮罩開關，以及這些操作寫的平台稽核 platform_audit_logs。當需求、bug 或新功能碰到
  /admin/tenants、/admin/tenants/[id]、platform-tenant.service、provisionTenant、setTenantActive、
  tenant.isActive、TENANT_DISABLED、開通租戶、停用租戶、租戶停用多久生效、改成員 email、重寄開通信、
  合約日期、復原已清除租戶時使用。也在改試用開通、方案指派、租戶登入、webhook 進站、群發排程前使用，
  確認停用租戶的行為沒被破壞。
---

# 平台後台：租戶管理

## 先讀
- 功能現況：`docs/ref/features/platform/TENANTS.md`，共通機制（稽核、快取連鎖、資料模型）在 `docs/ref/features/platform/README.md`
  - 注意：TENANTS.md「停用租戶多久生效」的表只列 REST、Socket、CLI，漏了 WebChat 進站（實測沒擋，HC-PLATFORM-TENANTS-01）、Partner API 金鑰（AUTH-02）與排程群發（HC-PLATFORM-TENANTS-04）。
  - 注意：README「目前的限制」寫「沒有任何測試」已過時，見下方回歸清單。
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-TENANTS.md`
- 規格：`openspec/specs/tenant-provisioning/spec.md`、`openspec/specs/tenant-contract-dates/spec.md`、`openspec/specs/trial-data-purge/spec.md`；停用租戶的行為在 `openspec/specs/auth-session/spec.md`（「停用租戶的成員不能登入或換發 token」「停用租戶的長效憑證與既有連線失效」）與 `openspec/specs/inbound-message-processing/spec.md`（「停用租戶的進站事件直接丟棄」）
- 影響分析：`node scripts/feature-impact.mjs --domain platform-tenants`

路由前綴 `/api/v1/platform`，全部在 `apps/api/src/modules/platform/platform.routes.ts`（個資遮罩在 `apps/api/src/modules/platform/ai-privacy.routes.ts`）。服務：`apps/api/src/modules/platform/platform-tenant.service.ts`；合約與復原的服務在 `apps/api/src/modules/platform/trial-admin.service.ts`。全程用 `fastify.prismaAdmin`（BYPASSRLS）。

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限。平台後台沒有權限分級（AUTH-04），所有路由只認平台帳號 token（`authenticatePlatformSuperuser`），租戶 token 一律 401。

| # | 流程 | 入口 | API → 後端 | 副作用 | 注意 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 租戶列表 | `/admin/tenants`（`apps/web/src/app/admin/tenants/page.tsx`） | `GET /tenants` → `listTenants` | 無 | 不分頁；只顯示啟用/停用，**不顯示試用中、已清除**；讀取失敗沒有錯誤訊息 |
| 2 | 手動開通 | 列表頁下方表單 | `POST /tenants` `{name, planSlug, adminEmail, adminName, adminPassword}` → `provisionTenantViaApi` → 交易內 `provisionTenant` | Tenant + 三個系統角色 + ADMIN；稽核 `tenant.provision`（payload 只有 name、planSlug）；開通信 fire-and-forget（`apps/api/src/modules/trial/trial-emails.ts` `sendManualProvisionedEmail`），回傳 `loginUrl` = `WEB_BASE_URL/login` | email 已存在 409；**方案下拉預設「免費試用」但不設 `trialEndsAt`**，租戶永遠在試用方案、不出現在 `/admin/trial`（HC-PLATFORM-TENANTS-05） |
| 3 | 列表停用/啟用 | 列表列的「停用」「啟用」 | `PATCH /tenants/:id/active {isActive}` → `setTenantActive` | 稽核 `tenant.disable` / `tenant.enable`（無 payload） | **沒有確認框**、失敗時畫面無訊息（HC-PLATFORM-TENANTS-02、03）；不處理 `trialEndsAt`、`purgedAt`（TRIAL-04） |
| 4 | 列表改合約 | 列表列「合約」→ 兩個 `type=date` → 儲存 | `PATCH /tenants/:id/contract` → `updateTenantContract` | 稽核 `tenant.contract.update`（記修改後兩個日期） | 前端先擋迄日早於起日；錯誤訊息用綠色成功樣式顯示（HC-PLATFORM-TENANTS-08） |
| 5 | 詳細頁 | 點列表租戶名 → `/admin/tenants/[id]` | `GET /tenants/:id` → `getTenantDetail`；`GET /plans` | 無 | 租戶不存在或 id 非 UUID 時永遠停在「載入中…」（HC-PLATFORM-TENANTS-09） |
| 6 | 改名稱、方案 | 詳細頁「基本資料」 | `PATCH /tenants/:id {name, planSlug?}` → `updateTenant` | 換了方案才失效權限天花板快取（Redis）與租戶方案快取（行程內 60 秒）；稽核 `tenant.update` | 不檢查方案停售（PLAN-01）、不回收超額（PLAN-03）、試用租戶改方案不脫離試用（頁面有提示） |
| 7 | 詳細頁停用/啟用 | 「停用租戶」「啟用租戶」 | 同 3 | 同 3 | 同樣沒有確認框 |
| 8 | 詳細頁改合約 | 「合約期間」 | 同 4 | 同 4 | 錯誤用紅色訊息，正常 |
| 9 | 改成員 Email | 成員表「改 Email」 | `PATCH /tenants/:id/agents/:agentId {email}` → `updateTenantAgentEmail` | 稽核 `tenant.agent.email.update`（payload 只有新 email，沒有舊值）；不通知原信箱 | 全域唯一 409；**區分大小寫**，`ADMIN@x` 與 `admin@x` 可並存（AUTH-10）；格式錯只顯示通用訊息 |
| 10 | 重寄開通信 | 成員表「重寄開通信」 | `POST /tenants/:id/agents/:agentId/resend-welcome` → `resendWelcomeEmail` | 寄信；稽核 `tenant.agent.resend_welcome` | 寄送失敗被 `safeSend` 吞掉，畫面仍顯示「已重寄」（HC-PLATFORM-TENANTS-06）；停用的成員/租戶也照寄 |
| 11 | 個資遮罩 | 詳細頁「個資遮罩」（`apps/web/src/app/admin/tenants/components/AiPrivacyControl.tsx`） | `GET/PATCH /tenants/:id/ai-privacy {enabled}` → `ai-privacy.service.ts` | `PlatformSetting` 的 `ai.privacy.<tenantId>`，與稽核 `tenant.ai_privacy.update` 同一交易 | 非 boolean、多餘欄位 400 |
| 12 | 復原已清除 | **不在本頁**：`/admin/trial` 試用租戶分頁「復原」 | `PATCH /tenants/:id/restore` → `restorePurgedTenant` | 只清 `purgedAt`，不動 `isActive`；稽核 `tenant.trial.restore` | 未標記 422 `NOT_PURGED`；詳細頁只顯示「（已清除 日期）」，沒有復原鈕 |
| 13 | 試用清除（系統） | `apps/api/src/modules/trial/trial.scheduler.ts` 每小時 | `purgeTrials`：停用、試用、`trialEndsAt` 超過保留天數 → 設 `purgedAt` | 稽核 `tenant.trial.purge`（`platformUserId` 為 null） | 只標記不刪資料（TRIAL-03） |

**有後端、沒有前端入口**：`GET /platform-users/:id/audit-logs` 以外沒有任何查平台稽核的介面（依租戶查不到）；沒有刪除租戶的路由。

**前端實際送出的值**：
- 開通：`planSlug` 寫死 `trial|light|standard|professional|enterprise`（列表頁不讀 `/plans`；詳細頁才讀）；`adminEmail` 為 `type=email`，不 trim。
- 合約：`YYYY-MM-DD` 或 `null`（空白轉 null），後端 `z.coerce.date()` 存成 UTC 午夜，前端以 `iso.slice(0,10)` 顯示。
- 基本資料：`name` 已 trim，`planSlug` 空字串時省略。
- 改 email：原值送出，不 trim、不轉小寫。

## 不可破壞的規則
- `provisionTenant(tx, …)` 必須收呼叫端的交易：試用自動開通（`apps/api/src/modules/trial/trial.service.ts`）把它和 token 消耗放同一交易。email 唯一檢查刻意放在交易外，讓衝突回 409 而不是 P2002。
- 手動開通**不設** `trialEndsAt`；試用開通才設。改這點會讓租戶被試用排程停用。
- 停用租戶的保護點：`login()` 驗完密碼才回 403 `TENANT_DISABLED`（順序防枚舉）、`POST /auth/refresh` 回查 `tenant.isActive`、`apps/api/src/modules/webhook/webhook.service.ts` 與 `apps/api/src/modules/webhook/webhook-account-routing.ts` 丟棄停用租戶的進站事件。新增任何進站入口或憑證類型，都要補 `tenant.isActive` 檢查（WebChat 的 `apps/api/src/modules/chatbox/chatbox.service.ts` 目前就漏了）。
- 稽核由路由寫，服務不寫（服務拿不到 `request.platformUser.id`）。新增異動路由要自己呼叫 `writePlatformAudit()`，沒有任何檢查會攔下漏寫；`apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts` 有「列出的寫入操作都寫入稽核」清單，新增路由要加進去。
- 開通稽核的 payload 不可含密碼（有測試保護）。
- 換方案要同時失效 `invalidatePlanPermissions` 與 `invalidateTenantPlan`。
- 合約日期只是紀錄，不能觸發任何自動行為（主規格 `tenant-contract-dates`）。
- 復原不動 `isActive`；延長與轉正式才會同時清 `purgedAt` 並啟用。
- `platform.routes.ts` 內註冊了整個 API 唯一的 rate-limit，拆檔前讀 AUDIT SEC-03。

## 跨功能牽連
執行 `node scripts/feature-impact.mjs --domain platform-tenants` 看最新版本。重點：
- **依賴**：平台認證（token、guard）、方案（planSlug、快取）、試用（共用 `provisionTenant`、合約與復原的服務、排程）、成員（系統角色、Agent.email 唯一）、通知（開通信）。
- **被依賴**：租戶登入（`TENANT_DISABLED`）、渠道 webhook 與收件匣（停用丟棄進站）、知識庫（個資遮罩政策）、試用管理（啟用不處理試用狀態）、用量、行銷（停用租戶的排程群發仍執行）。

## 回歸清單
改到本領域時，至少重走（用 `hc-` 前綴的自建租戶，**不要停用 Demo 或任何既有租戶**）：
1. 手動開通 → DB 有 Tenant、三個系統角色、ADMIN → 以該帳號租戶登入成功 → API log 有開通信（`EMAIL_DELIVERY_MODE=log` 只印主旨與 `loginUrl`）→ 稽核 `tenant.provision`。重複 email 409、密碼不足 8 字 400、方案不存在 404。
2. 停用 → 正確密碼登入 403 `TENANT_DISABLED`、錯誤密碼 401、refresh 401、既有 access token 仍可用到過期 → LINE/FB webhook 不建資料 → 啟用後恢復。
3. 合約：設起訖、只送一個、送 null 清除、迄日早於起日 422；列表與詳細頁讀回一致。
4. 詳細頁改成員 email（成功、409、格式錯）、重寄開通信、改名稱與方案。
5. `/admin/trial` 復原已清除租戶（422 `NOT_PURGED`、404）。
- 自動測試：`pnpm --filter @open333crm/api test -- platform tenant-plan`；`pnpm --filter @open333crm/web test -- admin`；feature（先搶鎖、**不要加 `--`**）：`pnpm --filter @open333crm/api test:feature modules/platform modules/trial modules/auth/tenant-disabled-access`。
- `tenant-provisioning` 的 4 個 scenario 沒有任何測試。
- E2E：`apps/web/tests/e2e-uat/cross-tenant-lifecycle.spec.ts`（會在目標環境開通並停用 `[E2E]` 租戶，**UAT 是正式環境，不要跑**；其中「✓ 已開通」斷言已過時）、`apps/web/tests/e2e-uat/platform-smoke.spec.ts`。

## 常見 bug 從哪裡查
- 「租戶停用了還在收訊息」：先看渠道類型。LINE/FB/IG 在 `webhook.service.ts` 有擋；WebChat 走 `/api/v1/chatbox/*`，`handleChatboxMessage` 直接呼叫 `processInboundMessage`，沒有檢查租戶。
- 「停用了成員還能操作」：REST 最長一個 access token 有效期；Socket、CLI token、Partner API 金鑰都不受影響（AUTH-02）。
- 「按了停用沒反應」：列表頁 `toggleActive` 沒有 try/catch，錯誤只在 console。
- 「開通的試用租戶沒有到期」：手動開通不設 `trialEndsAt`；要試用期請走試用申請，或之後用試用管理處理。
- 「改了方案權限沒變」：租戶方案快取是行程內 60 秒，多行程只清得掉自己的（`apps/api/src/services/tenant-plan.cache.ts`）。
- 「客戶說收不到開通信」：信件寄送失敗只寫 log（`[TrialEmail] send failed`），畫面仍顯示成功；查 API log。
- 「成員改了 email 登不進去」：email 區分大小寫（AUTH-10），確認輸入與資料庫的大小寫一致。
