# 平台設定與權限註冊表

平台層的 KV 設定，以及提供給後台介面的功能與渠道類型清單。兩者都由 `platform.routes.ts` 直接提供。模型價目表 `model_pricings` 也是平台全域的資料，一併寫在本文件。

- **資料來源**：`apps/api/src/modules/platform/platform-setting.service.ts`、`platform.routes.ts`、`ai-privacy.service.ts`、`apps/api/src/modules/trial/trial-policy.service.ts`、`apps/api/src/modules/ai/pricing.service.ts`、`packages/core/src/rbac/`、`apps/web/src/app/admin/trial/page.tsx`
- **核對日期**：2026-11-19

## 程式的入口

平台設定的路由在 `platform.routes.ts`，個資遮罩的路由在 `ai-privacy.routes.ts`。兩者的前綴都是 `/api/v1/platform`，都掛平台 guard。平台帳號沒有角色分級，任何平台帳號都能改全域設定。`platform.routes.ts` 的 rate-limit 與 guard 在該檔的路由函式內註冊，見 `../../system/AUDIT.md` 的 SEC-03。

| 操作 | 路由 | 函式 |
| --- | --- | --- |
| 讀一個鍵 | `GET /settings/:key` | `platform-setting.service.ts` 的 `getPlatformSetting()` |
| 寫一個鍵 | `PUT /settings/:key` | `setPlatformSetting()`（upsert），之後寫 `setting.update` 稽核 |
| 讀寫租戶的個資遮罩 | `GET`、`PATCH /tenants/:id/ai-privacy`（`ai-privacy.routes.ts`） | `ai-privacy.service.ts` 的 `getTenantAiPrivacy()`、`setTenantAiPrivacy()` |
| 功能與渠道清單 | `GET /registry` | `buildPlatformRegistry()`（`packages/core/src/rbac/registry.ts`）與 Prisma 的 `ChannelType` |
| 讀試用政策 | 沒有路由 | `trial-policy.service.ts` 的 `getTrialPolicy()` |
| 讀個資遮罩 | 沒有路由 | `readAiPrivacyPolicy()` |
| 讀模型價目 | 沒有路由 | `pricing.service.ts` 的 `getPricing()` |

## KV 設定

`PlatformSetting` 以 `key` 為主鍵，`value` 是任意 JSON。這張表是全域的：沒有 `tenantId`，沒有 RLS。只有兩個端點：`GET /settings/:key` 讀一個鍵，`PUT /settings/:key` 寫一個鍵（upsert）。鍵沒有列時，`GET` 回 `data: null`。

要知道的事：

- **沒有鍵的白名單，也沒有值的 schema。** `PUT` 的 Zod 只寫 `z.object({ value: z.unknown() })`。缺 `value` 回 400；其他任何值（含 `null`、字串、多餘欄位）都回 200 並寫入。打錯鍵名不會報錯，只是永遠沒有人讀它。例外是 `contract.reminderDaysBefore`：路由以 `parseContractReminderDays()`（`contract-policy.service.ts`）驗證，必須是 1 到 365 的整數組成的非空陣列，去重、由大到小後存入，不合法回 400 `VALIDATION_ERROR`。留言自動私訊的 5 個 `commentReply.*` 鍵也有型別與範圍檢查，見下一節。
- **讀取端各自做型別檢查。** 讀取端有兩種作法，新增設定鍵時要決定用哪一種，並在寫入端驗證：
  - 靜默退回預設值：`getTrialPolicy()` 逐個欄位檢查型別。例如 `trial.durationDays` 被寫成字串 `"30"` 時，型別檢查不過，改用程式預設的 14，而且不會有任何錯誤訊息。設定看起來存進去了，行為卻沒變。
  - 拋錯：`readAiPrivacyPolicy()` 讀到不合法的值時拋 503，見[個資遮罩](#個資遮罩)。
- **只檢查型別，不檢查範圍。** `0` 或負數會通過檢查並照用，例如試用天數設成 `0`，新開通的租戶會在下一輪排程就被停用。
- **沒有刪除端點。** 寫錯的鍵刪不掉，要恢復預設只能手動寫回預設值。
- **沒有快取。** 每次讀都直接查資料庫，寫入之後下一個請求就生效。這一點與方案相關的快取不同，見[平台後台](./README.md#方案異動的連鎖效果)。例外是 `commentReply.*`：讀取端在每個 API 實例快取 60 秒。
- **值是明文 JSON。** `GET` 原樣回傳。租戶連線 `app_tenant` 對這張表只能讀、不能寫（migration `20261103110000_revoke_app_tenant_platform_tables`），但讀得到所有鍵，包含其他租戶的 `ai.privacy.*`（HC-PLATFORM-SETTINGS-02）。通用端點收任何鍵，日後容易有人把密碼或 API key 放進來（HC-PLATFORM-SETTINGS-07）。平台的密鑰放在環境變數；租戶自備的金鑰以 `CREDENTIAL_ENCRYPTION_KEY` 加密後存在租戶設定。

`PUT` 會寫一筆 `setting.update` 稽核，但**只記鍵名，不記新舊值**（呼叫時沒有傳 `payload`）。稽核紀錄能回答「誰在什麼時候改過哪個設定」，不能回答「改成什麼」。主規格 `platform-auth` 規定這筆稽核不含設定值。`../../system/AUDIT.md` 的 TRIAL-02 的修正方向寫「稽核 `{before, after}`」，與主規格衝突，改稽核之前先決定採用哪一個，並同步規格。

錯誤的值造成的具體結果與修正方向，見 `../../system/AUDIT.md` 的 TRIAL-02。

## 目前有哪些鍵

| 鍵 | 誰寫 | 誰讀 |
| --- | --- | --- |
| `trial.enabled`、`trial.durationDays`、`trial.reminderDaysBefore`、`trial.verifyTokenTtlHours`、`trial.dataRetentionDays`、`trial.planSlug` | `/admin/trial` 的「政策設定」分頁。`trial.planSlug` 不在分頁上，只能打 API | `getTrialPolicy()`，型別不符時用 `DEFAULTS` |
| `contract.reminderDaysBefore` | `/admin/tenants` 的「合約到期提醒」設定卡 | 合約到期提醒排程 |
| `ai.privacy.<tenantId>` | 專用路由 `PATCH /tenants/:id/ai-privacy`。通用 `PUT /settings/:key` 也寫得進去（HC-PLATFORM-SETTINGS-01） | `readAiPrivacyPolicy()` |
| `commentReply.*` 的 5 個鍵 | `/admin/comment-reply` | 留言自動私訊 |

試用政策的鍵是 `trial.*` 開頭，預設值在 `apps/api/src/modules/trial/trial-policy.service.ts` 的 `DEFAULTS`，各鍵的作用見[試用管理](./TRIALS.md#政策參數)。改 `trial.*` 影響之後新開通的試用租戶與每小時的試用排程，不影響已經開通的租戶的到期日。

合約到期提醒天數是 `contract.reminderDaysBefore`，預設 `[30, 7, 1]`（`apps/api/src/modules/platform/contract-policy.service.ts`）。維護介面是 `/admin/tenants` 的「合約到期提醒」設定卡，按「儲存」才送出，不是失焦即存。

留言自動私訊的 5 個鍵是 `commentReply.capabilities`、`commentReply.testPhase`、`commentReply.emergencyStop`、`commentReply.rateLimits`、`commentReply.logRetentionDays`，維護介面是 `/admin/comment-reply`。路由以 `parseCommentReplySettingValue()`（`apps/api/src/modules/comment-reply/comment-reply-platform-settings.ts`）驗證型別與範圍，不合法回 400、不寫入；值、預設與生效方式見[留言自動私訊的平台控制](./COMMENT-REPLY.md#5-個平台設定鍵)。

### 個資遮罩

個資遮罩的開關是 `ai.privacy.<tenantId>`，每個租戶一個鍵，值是 `{ enabled }`（`apps/api/src/modules/platform/ai-privacy.service.ts`）。維護介面是租戶詳細頁的個資遮罩開關 `AiPrivacyControl`，走 `PATCH /tenants/:id/ai-privacy`。這個路由在同一個交易寫入設定與平台稽核 `tenant.ai_privacy.update`，稽核的 payload 含新值。

`readAiPrivacyPolicy()` 以 `.strict()` 的 `{ enabled: boolean }` 解析值。沒有這個鍵時視為 `{ enabled: false }`。值不合法，或讀取失敗時，拋 503 `AI_PRIVACY_POLICY_UNAVAILABLE`。下列路徑都先讀這個鍵：進站訊息的寫入（`apps/api/src/modules/webhook/inbound-message-writer.ts` 等）、客服回覆與系統訊息的存檔、AI 呼叫（`llm.service.ts`）、素材存檔（`material.service.ts`）、embedding、滿意度問卷。所以這個鍵的值寫壞之後，該租戶的訊息寫入、AI 回覆、素材存檔都回 503，租戶詳細頁的開關也讀不出來。

通用 `PUT /settings/:key` 不檢查 `ai.` 開頭的鍵，寫入不合法的值就會造成上面的結果，而且只留一筆不含值的 `setting.update` 稽核（HC-PLATFORM-SETTINGS-01）。修回的方法是以 `PATCH /tenants/:id/ai-privacy` 寫入合法的值。

## 模型價目

`model_pricings`（`ModelPricing`）存每個模型的單價，以 `(model, effectiveFrom)` 版本化。成本的算法見[用量統計](./USAGE.md)。

- **只有 seed 會寫。** 唯一的寫入者是 `packages/database/prisma/seed.ts` 的 `seedModelPricing()`。沒有任何路由，也沒有維護介面（`../../system/AUDIT.md` 的 USAGE-02）。
- **改價只能新增一列。** seed 以 `upsert` 搭配 `update: {}` 寫入。改 seed 裡同一個 `effectiveFrom` 的價格，不會更新既有的列。要改價，新增一列較新的 `effectiveFrom`，不要修改既有的列（主規格 `model-pricing`）。
- **成本在寫入用量紀錄時算定。** 成本寫進 `AiUsage` 之後不會重算。補上價目之前的呼叫，成本永久是 0。
- **讀取端有快取。** `getPricing()` 在每個行程快取 10 分鐘，查不到價目（null）的結果也快取。`clearPricingCache()` 只有測試呼叫。補上價目之後，最多 10 分鐘才生效，或重啟 API。
- **缺價的模型。** 租戶可選的 Gemini 模型（`apps/api/src/modules/ai/providers/gemini.provider.ts` 的 `CURATED_CHAT_MODELS`）比 seed 的價目多。用平台金鑰呼叫缺價的模型時，成本記 0（HC-PLATFORM-SETTINGS-03）。

## 權限註冊表

`GET /registry` 是方案設定頁 `/admin/plans`（`apps/web/src/app/admin/plans/page.tsx`）的資料來源，讓前端不必寫死功能清單。它不讀資料庫，回傳兩份清單：

| 欄位 | 來源 | 內容 |
| --- | --- | --- |
| `features` | `buildPlatformRegistry()`，`packages/core/src/rbac/` | 每個 feature 的 slug、中文標籤、說明、是否為 `core`，以及它涵蓋的權限碼與標籤 |
| `channelTypes` | Prisma 的 `ChannelType` enum | 所有渠道類型的值 |

兩份清單都是算出來的，不是另一份設定：

- 在 `packages/core/src/rbac/features.ts` 加一個 feature，或在 `permissions.ts` 加一個權限碼，方案設定頁就會多出對應的選項。
- 在 schema 加一個 `ChannelType`，渠道白名單的選項就會自己出現，不論有沒有註冊渠道外掛。

這是「單一真實來源」的作法：權限與渠道類型只定義一次，平台後台跟著長出來。前端因此不會出現「程式已經支援、但方案頁選不到」的落差。反方向的落差仍然存在：渠道類型直接列出 `ChannelType` 列舉的全部值，沒有對照已註冊的渠道外掛。方案頁因此選得到 `WHATSAPP` 與 `TELEGRAM`，但這兩種類型沒有外掛，租戶建不出來。代表 Instagram 私訊的 `THREADS` 在方案頁顯示原始的列舉值（HC-PLATFORM-SETTINGS-06）。

方案頁把 `core` 的 feature 的勾選框設成停用。

## 不在平台設定裡的東西

下列設定是 API 的環境變數（`apps/api/src/config/env.ts`），不存在 `platform_settings`。平台後台沒有頁面能看或改。部署時改 `.env.api`，重啟 API 後生效。

- AI 平台金鑰與模型預設：`GEMINI_API_KEY`、`OLLAMA_*`
- 寄信：`EMAIL_DELIVERY_MODE`、`RESEND_API_KEY`、`SMTP_*`
- 全域開關：`KB_AUTO_REPLY_ENABLED`、`AGENTIC_LLM_ENABLED`、`USAGE_QUOTA_ALERTS_ENABLED`
- 加密金鑰：`CREDENTIAL_ENCRYPTION_KEY`

租戶自備的 AI 金鑰與模型選擇是租戶設定（`tenant_settings`），見[租戶設定](../tenant/SETTINGS.md)與[知識庫](../tenant/KNOWLEDGE.md)。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| `/admin/trial` 的「政策設定」分頁：載入 | 對 `trial.enabled`、`trial.durationDays`、`trial.verifyTokenTtlHours`、`trial.dataRetentionDays`、`trial.reminderDaysBefore` 各打一次 `GET /settings/:key` | 沒有列的鍵，畫面顯示前端寫死的 `def`。`def` 與後端的 `DEFAULTS` 是兩份 |
| 勾選框「開放試用申請」 | `PUT /settings/trial.enabled`，`{ value: boolean }` | 勾選框一改就送出。公開的試用申請跟著這個開關 |
| 數字欄位：試用天數、驗證連結有效小時、到期後資料保留天數 | `PUT /settings/<key>`，值是 `parseInt()` 的結果 | 欄位失焦就送出，沒有改值也送（HC-PLATFORM-SETTINGS-04）。每次都多一筆稽核，並把前端的 `def` 寫成資料庫的列。清空欄位時 `parseInt('')` 是 `NaN`，JSON 序列化成 `null`，API 回 200，畫面顯示「已更新」；之後 `getTrialPolicy()` 改用程式預設（14、24、30），不是清空前的值（TRIAL-02） |
| 文字欄位「到期前提醒天數（逗號分隔）」 | `PUT /settings/trial.reminderDaysBefore`，`{ value: number[] }` | 前端以逗號分割、`parseInt()`、濾掉 `NaN`。輸入 `abc` 送出 `[]`，畫面顯示「已更新」，之後不再寄任何到期提醒信（HC-PLATFORM-SETTINGS-05） |
| 上面任何一次儲存失敗 | — | `saveSetting()` 沒有 `catch`。API 失敗時畫面不顯示任何訊息，只有 console 的 unhandled rejection（TRIAL-02） |
| `/admin/plans` 的功能清單與渠道白名單 | `GET /registry` | 見[權限註冊表](#權限註冊表) |
| `/admin/tenants/[id]` 的個資遮罩開關 `AiPrivacyControl` | `GET`、`PATCH /tenants/:id/ai-privacy` | 見[個資遮罩](#個資遮罩) |

下列 API 或操作沒有畫面入口：

- `PUT /settings/:key` 寫任意鍵，包含 `trial.planSlug` 與 `ai.privacy.<tenantId>`。API 不檢查 `trial.planSlug` 的方案是否存在。
- 刪除一個鍵：沒有端點。
- 維護 `model_pricings`：沒有路由。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
