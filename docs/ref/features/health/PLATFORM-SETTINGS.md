# 平台設定 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e（本機 worktree 比 origin/main 落後 14 個 commit，都是粉絲門戶相關，與本領域無關）
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT 只做未登入的 API 與頁面請求（不確定平台密碼，沒有登入平台後台）
- 範圍：`platform_settings`（`GET/PUT /api/v1/platform/settings/:key`、`/admin/trial`「政策設定」分頁、與它共用同一張表的 `ai.privacy.<tenantId>`）、`GET /platform/registry`、`model_pricings`、平台設定的稽核與儲存方式。功能文件 `docs/ref/features/platform/SETTINGS.md`。平台登入、租戶、方案見 `docs/ref/features/health/PLATFORM-AUTH.md`、`docs/ref/features/health/PLATFORM-TENANTS.md`

**範圍說明**：brief 提到的「AI key／模型、寄信設定、全域開關」在程式裡**不是平台設定**，都是環境變數（`apps/api/src/config/env.ts`），平台後台沒有任何頁面或 API 能看或改。`platform_settings` 目前只存兩類鍵：`trial.*` 與 `ai.privacy.<tenantId>`。`model_pricings` 沒有任何 API，只有 seed 會寫。

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 3 份 spec 中與本領域相關的 4 個 requirement、9 個 scenario。缺實作 0（「改價」scenario 的寫入途徑不存在，見 USAGE-02）。缺測試 4：「平台改試用天數即時生效」、「改價後新呼叫用新價」、「查無價目的模型」、「重複執行 seed」。缺前端入口 2：`trial.planSlug`、價目維護 |
| 自動測試 | unit：api 3 檔 11 通過、web 2 檔 2 通過、core 2 檔 25 通過。feature：`modules/trial/trial-scheduler-race`、`modules/platform/plan-change-trial-exit` 2 檔 16 通過（確認只跑了這 2 檔）。無失敗、無 skip、無 `test.fail` |
| 實際操作 | 6 條流程。正常 2，異常 4，待真機驗 0 |

## 問題清單（依嚴重度）

P0：無。P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-SETTINGS-01 | P2 | **通用 `PUT /settings/:key` 能寫壞某個租戶的個資遮罩設定，讓該租戶所有訊息寫入失敗**。`ai.privacy.<tenantId>` 與 `trial.*` 存在同一張表，通用端點不檢查鍵名也不檢查值。寫入不是嚴格 `{enabled:boolean}` 的值之後，`readAiPrivacyPolicy()` 對每一次讀取拋 503 `AI_PRIVACY_POLICY_UNAVAILABLE`：進站訊息、客服回覆、AI 回覆、自動化訊息、素材存檔都會失敗，平台的租戶詳細頁開關也讀不出來。這次寫入只留一筆不含值的 `setting.update` 稽核，繞過專用路由同交易寫的 `tenant.ai_privacy.update` | **實測（本機 API）**：開通測試租戶並建 WEBCHAT 渠道 → `POST /simulator/send-message` 201 → 平台 `PUT /platform/settings/ai.privacy.<tid> {"value":"on"}` 200 → 同一則模擬訊息 503、`GET /ai/privacy/status` 503、`GET /platform/tenants/<tid>/ai-privacy` 503 → `PATCH /platform/tenants/<tid>/ai-privacy {enabled:false}` 修回 → 送訊息 201。LINE/FB webhook 進站走同一個 `inbound-message-writer.ts`（讀程式） | `apps/api/src/modules/platform/platform.routes.ts:492-506`；`apps/api/src/modules/platform/ai-privacy.service.ts:10-17`；`apps/api/src/modules/webhook/inbound-message-writer.ts:53` | 新（TRIAL-02 的殼層方向「拿掉通用 PUT」可一併解決） |
| HC-PLATFORM-SETTINGS-02 | P2 | **租戶連線 `app_tenant` 對平台層資料表有完整的讀寫權限**。這些表沒有 RLS，`rls_roles_and_grants` migration 對整個 schema 授權 `SELECT, INSERT, UPDATE, DELETE`，包含 `platform_settings`、`model_pricings`、`platform_users`。租戶路徑只要有一處程式錯誤或注入，就能改其他租戶的個資遮罩、試用政策、全平台價目，或讀出平台帳號的密碼雜湊。目前的合法用途只有讀：`readAiPrivacyPolicy()`、`getPricing()` 用 `TenantDb` 讀這兩張表 | **實測（本機 psql，交易內最後 ROLLBACK）**：`SET LOCAL ROLE app_tenant` 並設 `app.current_tenant` 為測試租戶 → 看得到全部 6 列 `platform_settings`、`UPDATE` 另一個租戶的 `ai.privacy.*` 成功、`INSERT` 新鍵成功、`UPDATE model_pricings` 成功、`platform_users` 12 列的 `passwordHash` 可讀 | `packages/database/prisma/migrations/20260826160000_rls_roles_and_grants/migration.sql:21, 26` | 新 |
| HC-PLATFORM-SETTINGS-03 | P2 | 租戶可選的 Gemini 模型有 10 個，`model_pricings` 只有 3 個（2.5-flash、2.5-flash-lite、2.5-pro）。租戶選 `gemini-2.0-flash`、`gemini-flash-latest`、`gemini-3-pro-preview` 等 7 個模型、用平台金鑰時，每次呼叫的 `costUsd` 永久記 0、`usageMissing` 為 true，`/admin/usage` 的平台成本被低估。主規格只要求 seed「至少」涵蓋三個 2.5 模型，所以不違反規格 | 讀程式＋本機 DB 查詢（`model_pricings` 3 列）。沒有實際呼叫 Gemini | `apps/api/src/modules/ai/providers/gemini.provider.ts:21-35`；`packages/database/prisma/seed.ts:90-114` | USAGE-02 的具體範圍（新） |
| HC-PLATFORM-SETTINGS-04 | P3 | 「政策設定」的數字欄位只要聚焦再離開就送 `PUT`，沒改值也一樣。每次都多一筆稽核，而且把前端寫死的預設值寫成資料庫的列：之後改了後端 `DEFAULTS`，這些鍵仍維持舊值 | **實測（本機瀏覽器）**：點「驗證連結有效小時」再點「到期後資料保留天數」再點標題，沒有輸入任何字 → 送出 2 個 `PUT`（24、30），資料庫多 2 列、稽核多 2 筆（已刪除兩列還原） | `apps/web/src/app/admin/trial/page.tsx:272` | 新（TRIAL-02 相關） |
| HC-PLATFORM-SETTINGS-05 | P3 | 提醒天數欄輸入非數字（例如 `abc`）會送 `{value:[]}`，畫面顯示「已更新 trial.reminderDaysBefore」，重新整理後欄位變空白。`[]` 通過讀取端的 `Array.isArray` 檢查，之後**所有試用租戶都不再收到到期提醒信**，沒有任何警告 | **實測（本機瀏覽器）**：填 `abc` → 離開欄位 → DB 值 `[]`（已刪除該列還原） | `apps/web/src/app/admin/trial/page.tsx:274-277`；`apps/api/src/modules/trial/trial-policy.service.ts:42-44` | 新（TRIAL-02 的「靜默生效」又一例） |
| HC-PLATFORM-SETTINGS-06 | P3 | `/registry` 的 `channelTypes` 直接列 `ChannelType` enum 全部值：`LINE, FB, WEBCHAT, WHATSAPP, TELEGRAM, THREADS`。`WHATSAPP`、`TELEGRAM` 沒有註冊渠道外掛，方案頁仍可勾選；`THREADS` 其實是 Instagram 私訊，方案頁顯示原始 enum 值。功能文件說這個設計避免「程式已經支援、方案頁選不到」，但造成反方向的落差 | **實測（本機 API）**：`GET /platform/registry` 回 6 個值；`apps/api/src/index.ts:179-182` 只註冊 4 個外掛 | `apps/api/src/modules/platform/platform.routes.ts:240-246`；`apps/web/src/app/admin/plans/page.tsx:251-257` | 新 |
| HC-PLATFORM-SETTINGS-07 | P3 | `platform_settings` 的值是明文 JSON，`GET /settings/:key` 原樣回傳，加上 HC-PLATFORM-SETTINGS-02 租戶連線可讀。目前沒有存任何密鑰，但通用端點收任何鍵，單元測試還用 `PUT /settings/smtp {password}` 當範例，日後很容易有人把 SMTP 密碼、API key 放進來。平台的密鑰目前都在環境變數；租戶 BYOK 才有以 `CREDENTIAL_ENCRYPTION_KEY` 加密 | 讀程式＋本機 DB（目前只有 `trial.*` 與 `ai.privacy.*`） | `apps/api/src/modules/platform/platform-setting.service.ts:6-24`；`apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts:113` | 新 |
| TRIAL-02 | P3（AUDIT） | 無白名單、無型別、無範圍 | **實測（本機 API）**：任意鍵（含 `hc-platform-settings.中文 /` 這種有空白與斜線的鍵）200；`{value:null}` 200 存成 JSON null；多餘欄位被忽略 200；缺 `value` 400；非 JSON 400；`GET /settings/`（空鍵）200 `null`；沒有刪除端點 | `platform.routes.ts:492-506` | TRIAL-02（仍存在；其中一句描述不正確，見「文件過時之處」） |
| TRIAL-02 | P3（AUDIT） | 「政策設定」存檔失敗時畫面沒有任何訊息 | **實測（本機瀏覽器）**：Playwright 攔截 `PUT /settings/trial.durationDays` 回 500 → 畫面沒有「已更新」也沒有錯誤，只有 pageerror `Request failed with status code 500` | `apps/web/src/app/admin/trial/page.tsx:82-86` | TRIAL-02（仍存在） |
| USAGE-02 | P2（AUDIT） | 價目沒有維護介面 | 讀程式：仍只有 `seedModelPricing()` 寫入；補充：seed 用 `upsert(..., update: {})`，改 seed 裡**同一個 `effectiveFrom`** 的價格不會更新既有列，必須新增一個 `effectiveFrom` | `packages/database/prisma/seed.ts:107-111` | USAGE-02（仍存在） |

### 已確認正常（與文件一致）

- 平台設定沒有快取：寫入後下一個 `GET` 立即讀到新值（實測）。
- 租戶 token 或沒有 token 打 `GET/PUT /settings/:key`、`GET /registry` 一律 401（本機實測；UAT 未登入請求同樣 401，不是 503）。
- `setting.update` 稽核：`targetType=setting`、`targetId` 是鍵名、payload 空白，符合主規格 `platform-auth`「稽核不含設定值」（實測 8 筆）。
- 專用路由 `PATCH /tenants/:id/ai-privacy` 在同一交易寫設定與 `tenant.ai_privacy.update` 稽核，payload 含新值（實測）。
- `/registry` 的 features 8 個，`core` 只有一個且方案頁停用其勾選框（單元測試＋API 實測）。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 看試用政策 | 本機（瀏覽器）、UAT（只開頁面） | 正常：5 個欄位顯示，沒有列的鍵顯示前端預設值 | — | 租戶 token 401 | UAT `/admin/trial` 回 200（未登入，只確認頁面存在） |
| 2 開放試用申請開關 | 本機（只讀） | 未操作：同時有其他代理在改 `trial.enabled`，為避免干擾只讀取 | — | — | 讀取值與 DB 一致 |
| 3 數字欄位 | 本機（瀏覽器） | 正常：改成 14 → 重新整理讀回 14，DB 為 number | **異常**：清空送 `null`，200 並顯示「已更新」，重新整理顯示 14（讀取端退回預設）；沒改值也存（HC-04）；API 500 時沒有訊息（TRIAL-02） | — | 每次測試後刪除測試寫入的列 |
| 4 提醒天數 | 本機（瀏覽器） | 正常：`7, 1` 讀回 | **異常**：`abc` 存成 `[]`（HC-05） | — | |
| 5 權限註冊表 | 本機（API、瀏覽器） | 正常：8 個 feature、渠道 6 個 | **異常**：列出沒有外掛的渠道類型（HC-06） | 租戶 token 401 | |
| 6 通用 `PUT /settings/:key` | 本機（API） | 正常：任意鍵往返 | **異常**：可寫壞 `ai.privacy.<tenantId>`，該租戶訊息全部 503（HC-01） | 租戶 token 401 | 只在自建測試租戶上做 |

平台後台沒有角色分級，「非 admin 角色」只能測租戶 token 與無 token，兩者都 401。

## 完備度對照

| Spec / Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| platform-auth／更新平台設定的稽核不含設定值 | `platform.routes.ts:496-505` | `platform-audit-routes.test.ts:111` | 政策設定分頁 |
| platform-auth／列出的寫入操作都寫入稽核（平台設定部分） | 同上 | `platform-audit-routes.test.ts:143`（含 `PUT /settings/trial.planSlug`） | 同上 |
| trial-lifecycle／試用政策參數化：平台改試用天數即時生效 | `trial-policy.service.ts:28-51`（沒有快取） | **無**（feature 測試只以 `platformSetting.upsert` 準備資料） | 政策設定分頁（`trial.planSlug` 沒有入口） |
| model-pricing／改價後新呼叫用新價、歷史帳不變 | 讀取端 `pricing.service.ts:18-31` 有；**沒有寫入途徑**（USAGE-02） | **無** | **無** |
| model-pricing／查無價目的模型 | `llm.service.ts:84-88` | **無** | — |
| model-pricing／含快取與 thinking 的成本 | `pricing.service.ts:45` 起 | `pricing.test.ts:26` | — |
| model-pricing／超過分級門檻整筆用高檔價 | 同上 | `pricing.test.ts:34` | — |
| model-pricing／Ollama 本機模型成本為零 | `llm.service.ts` | `usage-quota.test.ts:311` | — |
| model-pricing／自備金鑰的呼叫成本為零 | `llm.service.ts:82-85` | `usage-quota.test.ts:321` | — |
| model-pricing／重複執行 seed | `seed.ts:107-111`（upsert） | **無** | — |

**有後端、沒有前端入口**：`PUT /settings/:key` 對 `trial.planSlug` 與任意鍵；價目沒有任何 API。**前端送出的值與後端 Zod**：後端只要求有 `value` 欄位，前端送出的每種值（含 `null`、`[]`）都被接受，問題在於接受了不該接受的值，而不是擋下合法值。

## 待真機驗

- 沒有。本領域不牽涉 LINE/FB/IG 真機收發。HC-01 在 LINE/FB webhook 進站時的實際結果（訊息是否遺失、平台是否重送）只讀了程式，需在 UAT 以外的環境驗。

## 設定變更紀錄（本機）

每次改動前先以 psql 記下原值，改完立即還原並以 psql 確認。測試期間有其他代理同時寫 `trial.enabled` 與 `trial.durationDays`（稽核同一個 `platform@open333crm.dev`），本次沒有動 `trial.enabled`。

| 鍵 | 原值 | 測試寫入 | 還原結果 |
| --- | --- | --- | --- |
| `trial.verifyTokenTtlHours` | 沒有列 | 24（聚焦離開觸發） | 刪除該列，確認不存在 |
| `trial.dataRetentionDays` | 沒有列 | 30（同上） | 刪除該列，確認不存在 |
| `trial.durationDays` | 測試前一刻為 `14`（其他代理寫入） | `null`、`14` | 測試後誤刪為「沒有列」，隨即補回 `14`；最終核對為 `14` |
| `trial.reminderDaysBefore` | 沒有列 | `[]` | 刪除該列，確認不存在 |
| `ai.privacy.<自建測試租戶>` | 沒有列 | `"on"`、`{enabled:false}` | 刪除該列 |
| `hc-platform-settings.probe`、`.probe2`、`.中文 /` | 沒有列 | 測試值 | 刪除，確認不存在 |
| `model_pricings` | 3 列 | 只在 ROLLBACK 的交易內改過 | 未變 |

最終 `platform_settings`：`ai.privacy.44af2245-…`（`{"enabled": false}`，非本次建立，未動）、`trial.durationDays`（`14`）。`trial.enabled` 在本次結束時沒有列，是其他代理的操作（稽核 06:07:22），不是本次造成。

本機另建：租戶 `hc-platform-settings-租戶`（`cbc69f37-…`，已停用）、其 ADMIN 成員、WEBCHAT 渠道 `hc-platform-settings-webchat`（已停用）、模擬訊息 2 則。seed 平台帳號沒有改密碼或狀態。

## UAT 操作紀錄

沒有登入、沒有建立任何資料、沒有連 UAT 主機或資料庫。只發了 3 個未登入的請求：`GET /api/v1/platform/settings/trial.enabled` 401、`GET /api/v1/platform/registry` 401、`GET /admin/trial` 200。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-SETTINGS-01：通用 `PUT /settings/:key` 能寫壞 `ai.privacy.<tenantId>`，讓單一租戶的訊息全部 503。可併入 TRIAL-02 的殼層方向，但在殼層完成前至少擋下 `ai.` 開頭的鍵。
- HC-PLATFORM-SETTINGS-02：`app_tenant` 對平台層資料表有完整 DML（含 `platform_users.passwordHash` 可讀）。修正方向：對 `platform_users`、`platform_audit_logs`、`plans`、`trial_signups`、`tenants` 等 REVOKE；`platform_settings`、`model_pricings` 只留 `SELECT`；並調整 `ALTER DEFAULT PRIVILEGES`，以免新的平台表又自動授權。歸「租戶隔離與權限」一節。
- HC-PLATFORM-SETTINGS-03：模型白名單 10 個、價目 3 個，併入 USAGE-02。
- HC-PLATFORM-SETTINGS-05：提醒天數存成 `[]` 停掉所有提醒，併入 TRIAL-02 的表格。

## 文件過時之處

- `docs/ref/system/AUDIT.md` TRIAL-02 寫「清空數字欄位…JSON 序列化成 `null`；`PlatformSetting.value` 是必填的 `Json`，這筆寫入會失敗，而 `saveSetting()` 沒有 `catch`，頁面既不顯示成功也不顯示失敗」。實測寫入**成功**（200，存成 JSON `null`），畫面顯示「已更新」，讀取端靜默退回預設值。「失敗時沒有訊息」本身仍成立，但不是由清空欄位觸發。
- `docs/ref/features/platform/SETTINGS.md`「目前有哪些鍵」寫「只有試用政策在用這張表」，已過時：個資遮罩 `ai.privacy.<tenantId>` 也存在這裡，而且有讀取端在每則訊息路徑上。
- 同一份文件說 `/registry`「前端因此不會出現『程式已經支援、但方案頁選不到』的落差」，沒有提到反方向（方案頁可選、程式沒有外掛），見 HC-06。
- `docs/ref/system/AUDIT.md` USAGE-02 寫「改 seed 的價目、合併到 `main`，部署後就會寫入」，要補「必須用新的 `effectiveFrom`；同一個 `effectiveFrom` 的 upsert 是 `update: {}`，不會覆寫」。
- 主規格 `platform-auth` 規定 `setting.update` 不可含設定值；TRIAL-02 的修正方向寫「稽核 `{before, after}`」。兩者衝突，需要決定以哪個為準。
