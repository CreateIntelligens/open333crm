---
name: feature-platform-settings
description: >
  open333CRM「平台設定」功能顧問：平台全域 KV 設定 platform_settings（GET/PUT /api/v1/platform/settings/:key、
  試用政策 trial.*、個資遮罩 ai.privacy.<tenantId> 也存在同一張表）、/admin/trial「政策設定」分頁、
  權限註冊表 GET /platform/registry（/admin/plans 的功能清單與渠道白名單）、模型價目 model_pricings（ModelPricing，
  只有 seed 會寫）、設定變更對所有租戶的影響、平台設定的稽核 setting.update、哪些「全域設定」其實是環境變數。
  當有人說「改了試用天數沒生效」「政策設定存不進去／沒反應」「提醒信不寄了」「方案頁怎麼有 WhatsApp」
  「新模型成本是 0」「平台設定要加一個開關」「AI key／寄信設定在哪裡改」「某租戶突然所有訊息 503」，
  或要改 platform-setting.service、trial-policy.service、platform.routes.ts 的 /settings、/registry、
  pricing.service、seedModelPricing 時使用。
---

# 平台設定（KV、權限註冊表、模型價目）

## 先讀
- 功能文件：`docs/ref/features/platform/SETTINGS.md`；平台後台共通機制（稽核、快取、資料模型）：`docs/ref/features/platform/README.md`
- 試用政策各鍵的作用：`docs/ref/features/platform/TRIALS.md`；價目與成本：`docs/ref/features/platform/USAGE.md`
- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-SETTINGS.md`
- 規格：`openspec/specs/trial-lifecycle/spec.md`（試用政策參數化）、`openspec/specs/model-pricing/spec.md`、`openspec/specs/platform-auth/spec.md`（「更新平台設定的稽核不含設定值」）
- 已知問題：`docs/ref/system/AUDIT.md` 的 TRIAL-02（無型別 KV 與修正方向「殼層」）、USAGE-02（價目沒有維護介面）、PLAN-09
- 平台登入、帳號、租戶、方案另見 `.claude/skills/feature-platform-auth/SKILL.md`、`.claude/skills/feature-platform-tenants/SKILL.md`、`docs/ref/features/health/PLATFORM-AUTH.md`、`docs/ref/features/health/PLATFORM-TENANTS.md`
- 影響分析：`node scripts/feature-impact.mjs --domain platform-settings`

## 這個領域實際有什麼

| 東西 | 存在哪裡 | 誰寫 | 誰讀 |
| --- | --- | --- | --- |
| 試用政策 `trial.enabled`、`trial.durationDays`、`trial.reminderDaysBefore`、`trial.verifyTokenTtlHours`、`trial.dataRetentionDays`、`trial.planSlug` | `platform_settings`，一鍵一列 | `/admin/trial`「政策設定」分頁（`trial.planSlug` 除外，只能打 API） | `apps/api/src/modules/trial/trial-policy.service.ts` 的 `getTrialPolicy()`，型別不符就靜默用 `DEFAULTS` |
| 個資遮罩 `ai.privacy.<tenantId>` = `{enabled:boolean}` | `platform_settings` | 專用路由 `PATCH /platform/tenants/:id/ai-privacy`（`apps/api/src/modules/platform/ai-privacy.service.ts`，同交易寫稽核）。**通用 `PUT /settings/:key` 也寫得進去** | `readAiPrivacyPolicy()`：每則訊息、素材存檔、AI 呼叫前都讀；值不合法時拋 503 |
| 功能與渠道清單 | 不存資料庫，`GET /platform/registry` 即時由 `packages/core/src/rbac/registry.ts` 與 Prisma `ChannelType` 推導 | — | `apps/web/src/app/admin/plans/page.tsx` |
| 模型價目 | `model_pricings`，`(model, effectiveFrom)` 版本化 | **只有** `packages/database/prisma/seed.ts` 的 `seedModelPricing()`（`update: {}`，同一個 `effectiveFrom` 改價不會覆寫） | `apps/api/src/modules/ai/pricing.service.ts`（行程內快取 10 分鐘，連 null 一起快取） |
| AI 平台金鑰、模型預設、寄信、全域開關 | **環境變數**（`apps/api/src/config/env.ts`：`GEMINI_API_KEY`、`OLLAMA_*`、`EMAIL_DELIVERY_MODE`、`RESEND_API_KEY`、`SMTP_*`、`KB_AUTO_REPLY_ENABLED`、`AGENTIC_LLM_ENABLED`、`USAGE_QUOTA_ALERTS_ENABLED`、`CREDENTIAL_ENCRYPTION_KEY` 等） | 部署時改 `.env.api`，重啟生效 | 平台後台**沒有**任何頁面能看或改 |

租戶自己的 AI 金鑰（BYOK）與模型選擇是租戶設定（`tenant_settings`），屬「設定」與「知識庫」領域，不在這裡。

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 看試用政策 | `/admin/trial` →「政策設定」分頁（`apps/web/src/app/admin/trial/page.tsx`） | 頁面載入時對 5 個鍵各打一次 `GET /settings/:key` → `getPlatformSetting()` | 沒有列的鍵回 `data: null`，畫面以前端寫死的 `def` 顯示（與後端 `DEFAULTS` 是兩份） | 平台 JWT；平台帳號沒有角色分級 |
| 2 | 改開關「開放試用申請」 | 勾選框 `onChange` 立即存 | `PUT /settings/trial.enabled {value:boolean}` → `setPlatformSetting()` upsert | 寫 `setting.update` 稽核（只有鍵名）；立即生效（沒有快取），公開試用申請頁跟著開關 | 同上 |
| 3 | 改數字（試用天數、驗證連結小時、保留天數） | 數字欄 `onBlur` 就存，**沒有改值也會存** | `PUT /settings/<key> {value: parseInt(...)}` | 清空欄位會送 `{value:null}`，後端 200 存成 JSON null，讀取端退回預設；只影響之後新開通或下一輪排程 | 同上 |
| 4 | 改提醒天數 | 文字欄「到期前提醒天數（逗號分隔）」`onBlur` | `PUT /settings/trial.reminderDaysBefore {value:number[]}` | 非數字會被濾掉：輸入 `abc` 送出 `[]`，畫面顯示「已更新」，之後**不再寄任何提醒信** | 同上 |
| 5 | 看方案的功能清單與渠道白名單 | `/admin/plans` | `GET /registry` | 不讀資料庫；`channelTypes` 是 enum 全部值（含沒有外掛的 `WHATSAPP`、`TELEGRAM`，以及代表 IG 私訊的 `THREADS`） | 同上 |
| 6 | 個資遮罩開關 | `/admin/tenants/[id]` 的 `AiPrivacyControl` | `GET/PATCH /tenants/:id/ai-privacy` | 寫 `ai.privacy.<tenantId>` 與 `tenant.ai_privacy.update` 稽核（同交易） | 屬租戶管理領域，見其 Skill |

**有後端、沒有前端入口**：`PUT /settings/:key` 對任意鍵（含 `trial.planSlug`、`ai.privacy.<tenantId>`）；沒有刪除端點；`model_pricings` 沒有任何路由；`clearPricingCache()` 沒有呼叫端。

**前端實際送出的值**：布林 `true/false`；數字 `parseInt` 結果（清空時是 `NaN` → JSON `null`）；提醒天數 `string.split(',').map(parseInt).filter(!isNaN)`（可能是 `[]`）。後端 Zod 只有 `z.object({ value: z.unknown() })`：缺 `value` 400，其他任何值（含 `null`、字串、多餘欄位）都 200。

## 不可破壞的規則
- `platform_settings` 是**全域**的：沒有 `tenantId`、沒有 RLS、沒有快取，寫入下一個請求就生效。改 `trial.*` 影響之後所有新試用與每小時排程；改 `ai.privacy.<tenantId>` 影響該租戶每一則訊息。
- `ai.privacy.<tenantId>` 的值必須是嚴格的 `{enabled:boolean}`（`.strict()`），否則該租戶所有訊息寫入回 503 `AI_PRIVACY_POLICY_UNAVAILABLE`。只能透過專用路由寫；在 TRIAL-02 的「殼層」做出來之前，不要用通用 `PUT /settings/:key` 碰 `ai.` 開頭的鍵。
- 讀取端各自做型別檢查，不符就靜默退回預設值（`getTrialPolicy()`），或直接拋錯（`readAiPrivacyPolicy()`）。新增設定鍵時要決定是哪一種，並在寫入端驗證。
- 稽核：主規格 `platform-auth` 規定 `setting.update` 的 payload **不可**含設定值（`platform-audit-routes.test.ts` 有測）。TRIAL-02 的修正方向寫「稽核 `{before, after}`」，兩者衝突，改之前先決定並同步規格。
- 這張表存的是明文 JSON，`GET` 原樣回傳，`app_tenant` 連線也能讀寫（HC-PLATFORM-SETTINGS-02）。**不要把密碼、API key 放進 `platform_settings`**；需要密鑰就用環境變數，或比照 BYOK 以 `CREDENTIAL_ENCRYPTION_KEY` 加密。
- 價目改動只能新增一列新的 `effectiveFrom`，不可修改既有列（主規格 `model-pricing`）。成本在寫入 `AiUsage` 當下算定，不會重算；補價目之前用掉的呼叫成本永久是 0。
- `/registry` 是功能與渠道選項的單一來源；在 `ChannelType` enum 加值會立刻出現在方案頁，不論有沒有註冊渠道外掛。
- 平台路由的 rate-limit 與 guard 都在 `platform.routes.ts` 的函式內註冊，把 `/settings` 拆到新檔要一起帶走（SEC-03）。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain platform-settings` 看最新版本。重點：
- **被依賴**：試用管理（全部政策參數）、方案（`/registry`）、用量（`ModelPricing` 算平台成本）、租戶管理與收件匣、行銷（每則訊息與素材存檔都讀 `ai.privacy.<tenantId>`）。
- **依賴**：平台認證（guard）、租戶管理（路由與稽核在 `platform.routes.ts`、`platform-audit.service.ts`）、人員與權限（`FEATURES`、`PERMISSIONS`）、知識庫（`pricing.service.ts`、`llm.service.ts`、`gemini.provider.ts` 的模型白名單）。

## 回歸清單
改到本領域時，至少重走（本機；**UAT 平台後台只能唯讀**）：
1. `/admin/trial`「政策設定」：每個欄位改一個**與預設相同**的值 → 重新整理讀回一致 → psql 核對 `platform_settings` → 刪掉測試寫入的列，還原成原本的狀態（先記下原值；其他人可能同時在改）。
2. 錯誤案例：清空數字欄、提醒天數輸入 `abc`、以 Playwright 攔截 `PUT` 回 500，確認畫面有沒有錯誤訊息。
3. `PUT /settings/hc-<名稱>` 任意鍵、`{value:null}`、缺 `value`（400）、租戶 token（401）、沒有 token（401）；確認 `platform_audit_logs` 有 `setting.update`、payload 是空的。
4. 個資遮罩：只在**自己建的測試租戶**上用通用 PUT 寫壞 `ai.privacy.<tenantId>` → `GET /ai/privacy/status` 與 `POST /simulator/send-message` 應回 503 → 用 `PATCH /platform/tenants/:id/ai-privacy {enabled:false}` 修回 → 送訊息 201。
5. `GET /registry`：features 數量與 `packages/core/src/rbac/features.ts` 一致，`/admin/plans` 每個方案的 core 勾選框停用。
6. 價目：`select model, "effectiveFrom" from model_pricings`，對照 `apps/api/src/modules/ai/providers/gemini.provider.ts` 的 `CURATED_CHAT_MODELS`，缺價的模型要列出來。
- 自動測試：`pnpm --filter @open333crm/api test -- platform-audit-routes ai-privacy pricing`；`pnpm --filter @open333crm/web test -- trial-page plans-page`；`pnpm --filter @open333crm/core test -- rbac-registry registry-validation`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/trial/trial-scheduler-race`。
- `platform-setting.service.ts`、`getTrialPolicy()`、`GET/PUT /settings/:key` 的行為本身（白名單、值的型別、讀取端退回預設）**沒有任何測試**；現有測試只驗稽核。改它要先補。
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`（只開頁面）。

## 常見 bug 從哪裡查
- 「改了試用天數沒生效」：psql 看 `platform_settings` 的 `jsonb_typeof(value)`；字串或 `null` 會被 `getTrialPolicy()` 靜默改用預設（TRIAL-02）。而且只影響之後新開通的租戶。
- 「政策設定存了沒反應」：`saveSetting()` 沒有 `catch`，API 失敗時畫面不顯示任何訊息，只有 console 的 unhandled rejection。
- 「試用到期提醒信不寄了」：`trial.reminderDaysBefore` 是不是 `[]`（提醒天數欄打了非數字，HC-PLATFORM-SETTINGS-05）。
- 「某租戶突然所有訊息 503 `AI_PRIVACY_POLICY_UNAVAILABLE`」：查 `select value from platform_settings where key='ai.privacy.<tenantId>'`，不是 `{"enabled":true|false}` 就是被通用 PUT 寫壞（HC-PLATFORM-SETTINGS-01）；用專用 PATCH 修回。
- 「新模型成本都是 0」：`model_pricings` 沒有那個 model（USAGE-02、HC-PLATFORM-SETTINGS-03）；補列後還要等最多 10 分鐘的行程內快取，或重啟 API。
- 「方案頁有 WhatsApp、Telegram」：`/registry` 直接列 `ChannelType` enum，沒有對照已註冊的渠道外掛（HC-PLATFORM-SETTINGS-06）。
- 「AI key、寄信方式要在平台後台哪裡改」：沒有，都是環境變數（`apps/api/src/config/env.ts`），改 `.env.api` 後重啟。
