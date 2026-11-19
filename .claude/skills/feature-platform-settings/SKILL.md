---
name: feature-platform-settings
description: >
  open333CRM「平台設定」功能顧問：platform_settings 全域設定、試用政策、權限註冊表、模型價目 model_pricings。改到 platform-setting.service、trial-policy.service、platform.routes.ts 的 /settings 與 /registry、pricing.service 之前使用。
---

# 平台設定（KV、權限註冊表、模型價目）

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。平台設定的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

平台全域 KV 設定 `platform_settings`（`GET`／`PUT /api/v1/platform/settings/:key`）、試用政策 `trial.*`、`/admin/trial` 的「政策設定」分頁、
同一張表裡的個資遮罩 `ai.privacy.<tenantId>`、權限註冊表 `GET /platform/registry`（`/admin/plans` 的功能清單與渠道白名單）、
模型價目 `model_pricings`（`ModelPricing`）、平台設定的稽核 `setting.update`、哪些「全域設定」其實是環境變數。
常見的說法：「改了試用天數沒生效」「政策設定存不進去」「提醒信不寄了」「方案頁怎麼有 WhatsApp」「新模型成本是 0」
「平台設定要加一個開關」「AI key／寄信設定在哪裡改」「某租戶突然所有訊息 503」。
改 `platform-setting.service`、`trial-policy.service`、`platform.routes.ts` 的 `/settings` 與 `/registry`、`pricing.service`、`seedModelPricing` 之前使用。

## 先讀

先讀功能文件 `docs/ref/features/platform/SETTINGS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `SETTINGS.md` 的章節 |
| --- | --- |
| 找路由對應的函式 | 程式的入口 |
| 新增設定鍵、寫入驗證、讀取端的預設值、稽核 | KV 設定、目前有哪些鍵 |
| `ai.privacy.<tenantId>`、503 `AI_PRIVACY_POLICY_UNAVAILABLE` | 個資遮罩 |
| `model_pricings`、seed、價目快取 | 模型價目；成本算法見 `docs/ref/features/platform/USAGE.md` |
| `/registry`、`ChannelType`、`features.ts` | 權限註冊表 |
| AI 金鑰、寄信、全域開關 | 不在平台設定裡的東西 |
| `/admin/trial` 政策設定分頁、`/admin/plans` | 畫面怎麼呼叫 API |

試用政策各鍵的作用見 `docs/ref/features/platform/TRIALS.md` 的「政策參數」。平台後台共通機制（稽核、快取、資料模型）見 `docs/ref/features/platform/README.md`。

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/platform/`、`apps/api/tests/feature/modules/platform/`、`apps/api/tests/feature/modules/trial/`、`apps/web/tests/unit/app/admin/`、`packages/core/tests/unit/rbac/`，寫法可以照著參考。`getTrialPolicy()` 與 `trial.*` 鍵的讀寫沒有測試；`PUT /settings/:key` 只有稽核（`platform-audit-routes.test.ts`）與 `commentReply.*` 鍵的驗證（`platform-comment-reply-settings.test.ts`）有測試。改這些行為之前先補測試。

`SETTINGS.md` 裡標 `HC-PLATFORM-SETTINGS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/PLATFORM-SETTINGS.md`
- 規格：`openspec/specs/trial-lifecycle/spec.md`（試用政策參數化）、`openspec/specs/model-pricing/spec.md`、`openspec/specs/platform-auth/spec.md`（「更新平台設定的稽核不含設定值」）
- 已知問題：`docs/ref/system/AUDIT.md` 的 TRIAL-02（無型別 KV 與修正方向「殼層」）、USAGE-02（價目沒有維護介面）、PLAN-09
- 影響分析：`node scripts/feature-impact.mjs --domain platform-settings`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `SETTINGS.md` 括號內的章節。

- `platform_settings` 是全域的：沒有 `tenantId`、沒有 RLS、沒有快取。寫入之後下一個請求就生效。（KV 設定）
- `ai.privacy.<tenantId>` 的值必須是嚴格的 `{enabled:boolean}`，否則該租戶的訊息寫入回 503。只透過專用路由 `PATCH /tenants/:id/ai-privacy` 寫。在 TRIAL-02 的「殼層」做出來之前，不要用通用 `PUT /settings/:key` 寫 `ai.` 開頭的鍵。（個資遮罩）
- 新增設定鍵時，決定讀取端是靜默退回預設值（`getTrialPolicy()`），還是拋錯（`readAiPrivacyPolicy()`），並在寫入端驗證。（KV 設定）
- `setting.update` 稽核的 payload 不可含設定值（主規格 `platform-auth`，`platform-audit-routes.test.ts` 有測）。TRIAL-02 的修正方向與它衝突，改之前先決定，並同步規格。（KV 設定）
- 不要把密碼、API key 放進 `platform_settings`。需要密鑰就用環境變數，或比照租戶自備金鑰以 `CREDENTIAL_ENCRYPTION_KEY` 加密。（KV 設定）
- 價目改動只能新增一列新的 `effectiveFrom`，不可修改既有的列。成本寫入 `AiUsage` 之後不會重算。（模型價目）
- `/registry` 是功能與渠道選項的單一來源。在 `ChannelType` enum 加值，方案頁立刻出現該值。（權限註冊表）
- 平台路由的 rate-limit 與 guard 都在 `platform.routes.ts` 的函式內註冊。把 `/settings` 拆到新檔時要一起帶走（SEC-03）。（程式的入口）

## 回歸清單

改到本領域時，至少重走下列項目。在本機做；UAT 的平台後台只能唯讀。

1. `/admin/trial`「政策設定」：
   - 先記下每個欄位的原值。其他人可能同時在改。
   - 每個欄位改成一個與預設相同的值，重新整理，讀回的值一致。
   - 以 psql 核對 `platform_settings`。
   - 刪掉測試寫入的列，還原成原本的狀態。
2. 錯誤案例：清空數字欄、提醒天數輸入 `abc`、以 Playwright 攔截 `PUT` 回 500。確認畫面有沒有錯誤訊息。
3. API：
   - `PUT /settings/hc-<名稱>` 寫任意鍵、寫 `{value:null}`、缺 `value`（400）。
   - 租戶 token（401）、沒有 token（401）。
   - `platform_audit_logs` 有 `setting.update`，payload 是空的。
4. 個資遮罩，只在自己建的測試租戶上做：
   - 用通用 PUT 寫壞 `ai.privacy.<tenantId>`。
   - `GET /ai/privacy/status` 與 `POST /simulator/send-message` 應回 503。
   - 用 `PATCH /platform/tenants/:id/ai-privacy {enabled:false}` 修回。送訊息回 201。
5. `GET /registry`：features 數量與 `packages/core/src/rbac/features.ts` 一致。`/admin/plans` 每個方案的 core 勾選框停用。
6. 價目：`select model, "effectiveFrom" from model_pricings`，對照 `apps/api/src/modules/ai/providers/gemini.provider.ts` 的 `CURATED_CHAT_MODELS`，列出缺價的模型。

自動測試：

- `pnpm --filter @open333crm/api test -- platform-audit-routes ai-privacy pricing`
- `pnpm --filter @open333crm/web test -- trial-page plans-page`
- `pnpm --filter @open333crm/core test -- rbac-registry registry-validation`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/trial/trial-scheduler-race modules/platform/platform-comment-reply-settings`
- E2E：`apps/web/tests/e2e-uat/platform-smoke.spec.ts`（只開頁面）。

## 常見 bug 從哪裡查

- 「改了試用天數沒生效」：
  - 以 psql 看 `platform_settings` 的 `jsonb_typeof(value)`。字串或 `null` 會讓 `getTrialPolicy()` 靜默改用預設（TRIAL-02）。
  - 試用政策只影響之後新開通的租戶。
- 「政策設定存了沒反應」：`saveSetting()` 沒有 `catch`。API 失敗時畫面不顯示任何訊息，只有 console 的 unhandled rejection。
- 「試用到期提醒信不寄了」：看 `trial.reminderDaysBefore` 是不是 `[]`。提醒天數欄打了非數字會存成 `[]`（HC-PLATFORM-SETTINGS-05）。
- 「某租戶突然所有訊息 503 `AI_PRIVACY_POLICY_UNAVAILABLE`」：
  - 查 `select value from platform_settings where key='ai.privacy.<tenantId>'`。
  - 值不是 `{"enabled":true|false}`，就是被通用 PUT 寫壞（HC-PLATFORM-SETTINGS-01）。用專用 PATCH 修回。
- 「新模型成本都是 0」：
  - `model_pricings` 沒有那個 model（USAGE-02、HC-PLATFORM-SETTINGS-03）。
  - 補列之後，要等最多 10 分鐘的行程內快取過期，或重啟 API。
- 「方案頁有 WhatsApp、Telegram」：`/registry` 直接列 `ChannelType` enum，沒有對照已註冊的渠道外掛（HC-PLATFORM-SETTINGS-06）。
- 「AI key、寄信方式要在平台後台哪裡改」：平台後台沒有。這些都是環境變數（`apps/api/src/config/env.ts`），改 `.env.api` 之後重啟。
