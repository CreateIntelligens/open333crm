# 用量統計與 AI 成本 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e（本機 worktree 比 origin/main 落後 14 個 commit，都是粉絲門戶相關，與本領域無關）
- 環境：本機（獨立資料庫 `open333crm_advisor`，API 在主機以 tsx 執行，`EMAIL_DELIVERY_MODE=log`，本機 Ollama 不通）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認 tenantId；只讀，沒有登入平台後台）
- 範圍：`docs/ref/features/feature-map.json` 的 `platform-usage`；功能文件 `docs/ref/features/platform/USAGE.md`。告警通知的投遞歸通知領域（`docs/ref/features/health/NOTIFICATIONS.md`），本次只驗告警有沒有產生、內容是否正確
- 測試方法：自建租戶 `hc-platform-usage-A`（方案 `light`，月額度 1,500,000），把它的 AI 設定指到本機一支假的 Ollama（回固定的 `prompt_eval_count`／`eval_count`），再打 `POST /ai/rewrite` 等端點，讓真實的 `generateReply()` → `recordAiUsage()` → Redis 計數器 → 告警整條跑一遍。時區與成本另以 psql 直接寫入 5 筆合成的 `ai_usages`（測完已刪除）

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 5 份 spec、17 個 requirement、48 個 scenario。缺實作 0（`ai-usage-recording`「自動化規則觸發的 AI 動作」的規格本身註明目前沒有這種動作）。缺測試 9：`ai-usage-recording` 6 個（Gemini／Ollama 的用量解析 3 個、寫入失敗不影響回覆、provider 未回傳 usage、Gemini 429 留存失敗紀錄），`model-pricing` 3 個（改價後新呼叫用新價、查無價目、重複執行 seed）。缺前端入口 2 項：價目表沒有任何介面（USAGE-02）；租戶本月已用量與上限沒有任何介面（租戶端、平台端都沒有） |
| 自動測試 | unit：api 6 檔 58 通過（pricing、usage-quota、agent-quota、usage-quota-alert、plan-change、notification.worker）。feature：2 檔 11 通過（`platform-usage`、`token-quota-alert`，確認只跑了這兩個檔）。無失敗、無 skip、無 `test.fail` |
| 實際操作 | 9 條流程。正常 5，異常 4，待真機驗 1（Gemini 真實呼叫的用量與成本） |

## 問題清單（依嚴重度）

P0：無。P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-USAGE-01 | P2 | AI 設定的 Gemini 模型下拉清單有 10 個模型，`model_pricings` 只有 `gemini-2.5-flash`、`gemini-2.5-flash-lite`、`gemini-2.5-pro` 三筆價目。選了其餘 7 個（`gemini-2.0-flash`、`gemini-2.0-flash-lite`、`gemini-flash-latest`、`gemini-flash-lite-latest`、`gemini-pro-latest`、兩個 `gemini-3-*-preview`）的租戶，只要走平台金鑰，每一筆成本都永久記 0 並標 `usageMissing`，`/admin/usage` 的成本因此偏低且沒有提示。UAT 的 Demo 租戶目前就是用 `gemini-flash-latest`（BYOK，所以現在記 0 是對的；BYOK 金鑰一旦解密失敗退回平台金鑰，見 AI-01，成本就會記 0 而不是實算） | **實測（UAT，唯讀交易查資料庫）**：`model_pricings` 只有上述 3 筆；Demo 租戶的 `ai_usages` 有 412 筆 `gemini-flash-latest`、`keySource=byok`。下拉清單讀程式 | `apps/api/src/modules/ai/providers/gemini.provider.ts:21-35`；`packages/database/prisma/seed.ts:93-110` | 新（USAGE-02 的具體成因） |
| HC-PLATFORM-USAGE-02 | P2 | 租戶看不到自己本月用了多少 AI token、上限是多少。告警信的按鈕寫「查看用量與方案」、站內通知也連到 `/dashboard/plan`，但那一頁只有申請表與申請紀錄。平台端也沒有：`/admin/usage` 只有用量，沒有對照上限；租戶詳細頁沒有額度欄位。整個系統沒有任何 API 回傳「本月已用／有效上限」，要知道只能查 Redis `aiquota:*` 或 psql | **實測（本機瀏覽器）**：自建租戶用量達 100% 後，以其管理員開 `/dashboard/plan`，畫面只有「升級方案／加購 Token」表單與「尚無申請記錄」。操作手冊 ch14 也寫「這頁不會顯示目前的方案和用量」 | `apps/web/src/app/dashboard/plan/page.tsx`；`apps/api/src/modules/notification/notification.worker.ts:296-310`；`apps/api/src/modules/trial/usage-alert-emails.ts`（按鈕文字） | 新（PLAN-10 提到租戶端看不到已用額度，但沒有列成項目，也沒提到告警連結） |
| HC-PLATFORM-USAGE-03 | P2 | `/admin/usage` 的 API 失敗時，頁面不顯示任何錯誤：總覽卡整塊消失，排行顯示「此區間尚無用量資料」，平台方會以為真的沒有用量。點租戶鑽取失敗時列會變色、但不出現趨勢，也沒有訊息。四個 `platformApi.get` 都沒有 `catch` | **實測（本機瀏覽器，Playwright 攔截回 500）**：overview 與 tenants 回 500 → 畫面只剩標題與「此區間尚無用量資料」；`/usage/tenants/:id` 回 500 → 點列後沒有趨勢、沒有錯誤 | `apps/web/src/app/admin/usage/page.tsx:46-58` | 新 |
| HC-PLATFORM-USAGE-04 | P2 | 摘要在 LLM 呼叫失敗時（含**月額度用完**的 403）回傳一段固定範本文字當成摘要：「客戶主要詢問了產品相關問題，Bot 提供了初步回覆但客戶可能需要更詳細的人工協助…」，內容與對話無關，回應是 200。自動轉接人工時，這段文字會以「Bot 對話摘要」寫進對話的系統訊息，永久留存，客服會以為是 AI 讀過對話的結論 | **實測（本機 API）**：Demo 租戶（本機 Ollama 不通）`POST /ai/summarize` 回 200，`summary` 為上述範本。額度用完走同一個 `catch`（讀程式）；自動轉接寫入系統訊息（讀程式） | `apps/api/src/modules/ai/ai.service.ts:113-128`；`apps/api/src/modules/automation/automation.worker.ts:136-147` | 新（檔案歸收件匣／自動化） |
| HC-PLATFORM-USAGE-05 | P3 | 時區：月額度與每日趨勢都以 UTC 切。月額度依主規格 `token-quota` 就是 UTC，台灣時間每月 1 日 08:00 才換月，1 日 00:00–08:00 的用量算上個月，告警信的「本月（2026-10）」也是 UTC 月份。每日趨勢的規格沒有規定時區，實作用 `date_trunc('day', "createdAt")`，台灣 00:00–08:00 的呼叫算到前一天 | **實測（本機）**：計數器 PTTL 151,248,752 ms，到 2026-11-01 00:00 UTC；寫入 `2026-09-30 20:00 UTC`（台灣 10/1 04:00）的用量，鑽取顯示在「2026-09-30」，刪掉計數器重建時也不計入 10 月；`2026-10-29 17:30 UTC`（台灣 10/30 01:30）顯示在「2026-10-29」 | `apps/api/src/modules/trial/token-quota.service.ts:25-38`；`apps/api/src/modules/platform/platform-usage.service.ts:98-107` | 新（產品決策：要不要改成台灣時間） |
| HC-PLATFORM-USAGE-06 | P3 | A2A 路徑以 `withTenant` 的 `tx` 呼叫 `runAgentReply()`。`recordAiUsage()` 本身有 await，但它裡面的 `incrMonthlyTokens()`、`checkQuotaThresholdCrossing()` 是 fire-and-forget，用的是同一個 `tx`；交易結束後才執行的查詢（計數器補建、`getEffectiveLimit`）會失敗，只留一則 error log，告警因此不發 | 讀程式（本機沒有 A2A 環境） | `apps/api/src/modules/settings/a2a-bridge.worker.ts:125-131`；`apps/api/src/modules/ai/llm.service.ts:112-132` | 新 |
| HC-PLATFORM-USAGE-07 | P3 | 平台看不到失敗的呼叫。三個查詢都只算 `success=true`（符合規格），但平台也沒有其他地方看得到失敗率：一個租戶的 AI 全部失敗時，它在用量頁完全不出現 | **實測（本機）**：Demo 租戶 2 天內 88 筆呼叫全部失敗（`fetch failed`），`/admin/usage` 的排行沒有 Demo 租戶 | `apps/api/src/modules/platform/platform-usage.service.ts:23,61` | 新（USAGE-01 只談母體標示） |
| HC-PLATFORM-USAGE-08 | P3 | 告警收件人依角色列舉 `role=ADMIN`，`/dashboard/plan` 依權限 `settings.manage`。seed 的 supervisor 有 `settings.manage`，可以開方案頁申請加購，但收不到用量告警；自訂角色同理 | **實測（本機 API）**：supervisor `GET /plan-change` 200、agent 403。收件人條件讀程式 | `apps/api/src/modules/notification/notification.worker.ts:279-282` | 新 |
| HC-PLATFORM-USAGE-09 | P3 | 每日趨勢只列有資料的日子，不補 0。30 天內只有 3 天有用量時，3 根長條平均排開，看不出中間的空白期，首尾日期標籤是有資料的第一天與最後一天，不是查詢區間 | **實測（本機瀏覽器）**：鑽取自建租戶，長條 title 只有 `2026-09-30`、`2026-10-29`、`2026-10-30` 三根 | `apps/web/src/app/admin/usage/page.tsx` 的 `TrendChart` | 新 |
| HC-PLATFORM-USAGE-10 | P3 | 查詢參數沒驗證：`/usage/tenants/not-a-uuid` 回 400 `DATABASE_ERROR`（`$queryRaw` 的 `::uuid` 轉型失敗）；`from` 晚於 `to` 不擋，回全 0。前端不會送出這些值，只影響直接呼叫 API 的人 | **實測（本機 API）** | `apps/api/src/modules/platform/platform.routes.ts:443-462` | 新 |
| HC-PLATFORM-USAGE-11 | P3 | 快速切換「近 7／30／90 天」或連點不同租戶時，舊請求沒有取消，較慢回來的舊結果會蓋掉新結果 | 讀程式 | `apps/web/src/app/admin/usage/page.tsx:46-58` | 新 |
| PLAN-13 | P2（AUDIT） | 換方案提高額度後，當月告警不再發 | **實測（本機）**：自建租戶在 `light` 發過 warning 與 critical → 平台把它換成 `standard`（3,000,000）→ 用量累加到 2,403,400（跨 80%）→ 沒有新通知，旗標仍在 | `apps/api/src/modules/platform/platform-tenant.service.ts` 的 `updateTenant()` | PLAN-13（仍存在） |
| USAGE-01 | P3（AUDIT） | 母體標示與排行上限 | **實測（本機瀏覽器）**：卡片文字與 AUDIT 描述相同；服務開頭的錯誤註解仍在（`platform-usage.service.ts:4`） | | USAGE-01（仍存在） |
| USAGE-02 | P2（AUDIT） | 價目表沒有維護介面 | 讀程式：`modelPricing` 的寫入仍只有 seed；`clearPricingCache()` 仍沒有呼叫端；UAT 仍只有 3 筆價目（實測唯讀） | `apps/api/src/modules/ai/pricing.service.ts` | USAGE-02（仍存在，具體影響見 HC-PLATFORM-USAGE-01） |
| USAGE-03 | P2（AUDIT） | 計數器少算後不校正 | 讀程式：`incrMonthlyTokens()` 仍是 `exists()` 後 `incrby()`。計數器不存在時的補建路徑**實測正常**：刪掉自建租戶的計數器再呼叫，重建值 1,503,400，等於本月（UTC）成功、`keySource=platform` 的加總，BYOK、失敗與 9 月的列都沒算進去 | `apps/api/src/modules/trial/token-quota.service.ts:80-114` | USAGE-03（仍存在） |
| AI-01 | P2（AUDIT） | BYOK 解密失敗靜默退回平台金鑰 | 讀程式：`resolveGeminiKey()` 的空 `catch` 仍在；解密出空字串也一樣退回 | `apps/api/src/modules/ai/ai-key.service.ts:36-42` | AI-01（仍存在） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 平台用量總覽 | 本機（API、瀏覽器） | 正常：台灣 10/1–10/30 區間，API 回 tokens 1,515,400、cost 0.002746、calls 7、活躍租戶 1，與 psql 加總完全一致；頁面卡片顯示 2.42M／$0.0027／9（近 30 天） | **異常**：API 500 時顯示「此區間尚無用量資料」（HC-PLATFORM-USAGE-03）；`from=abc` 400 有欄位訊息；`from>to` 回 0（HC-PLATFORM-USAGE-10） | 租戶 token、無 token 都 401；seed 的 supervisor、agent 401 | 失敗、BYOK 與查無價目的計入方式與 USAGE.md 相同 |
| 2 租戶排行 | 本機（API、瀏覽器） | 正常：租戶名、方案名（換方案後顯示「標準版」）、token、成本、次數與 psql 一致 | 全部失敗的租戶不出現（HC-PLATFORM-USAGE-07） | 同上 | 50 筆上限未驗（本機租戶不足 50 個） |
| 3 單一租戶鑽取 | 本機（API、瀏覽器） | 正常：依 feature 分佈與 psql 一致；切換天數會收起鑽取 | **異常**：每日分桶是 UTC 日（HC-PLATFORM-USAGE-05）；不補 0（HC-PLATFORM-USAGE-09）；500 時無訊息；亂碼 tenantId 400 `DATABASE_ERROR` | 同上 | 趨勢的成本字串是 `0.00150000`，總覽是 `0.0015`，格式不同但前端都經 `fmtUsd` |
| 4 AI 呼叫記帳 | 本機（假 Ollama） | 正常：`ai-rewrite` 一筆，prompt 1000、candidates 234、total 1234、`keySource=platform`、Ollama 成本 0、`usageMissing=false`；provider 不回用量時 total 0、`usageMissing=true` | — | — | Gemini 的用量解析與實算成本待真機驗；成本公式以 unit 測試與合成列對照（flash：(1000−200)×0.30＋200×0.03＋400×2.5 ÷ 1e6 = 0.001246） |
| 5 月額度硬擋 | 本機 | 正常：計數器 1,500,000 後，`/ai/rewrite`、`/ai/agent/run` 回 403 `PLAN_LIMIT_EXCEEDED`、`limitKey=monthlyTokens`，假 Ollama 沒收到請求、沒有新的 `ai_usages` | **異常**：`/ai/classify`、`/ai/analyze-sentiment` 回 200 關鍵字結果；`/ai/summarize` 回固定範本（HC-PLATFORM-USAGE-04），使用者不知道是額度用完 | — | |
| 6 用量告警 | 本機 | 正常：累加到 1,200,000 寫 warning 旗標、一則 `usage_quota_warning`、一封「AI 用量提醒（80%）」；到 1,500,000 寫 critical 旗標、一則 `usage_quota_critical`、一封「AI 用量已達上限」。通知內文的數字正確 | **異常**：換方案後跨新上限 80% 不再告警（PLAN-13，實測） | 只發給 `role=ADMIN`（HC-PLATFORM-USAGE-08） | `USAGE_QUOTA_ALERTS_ENABLED=0` 未驗（不能改共用 API 的環境變數，unit 測試有涵蓋） |
| 7 計數器補建與月份 | 本機 | 正常：TTL 到下個月 1 日 00:00 UTC；刪掉計數器後重建為 1,503,400，排除 BYOK、失敗與 UTC 9 月的列 | — | — | UTC 月份切點見 HC-PLATFORM-USAGE-05 |
| 8 租戶查看用量 | 本機（瀏覽器）、UAT（只讀 API） | 通知中心列出兩則告警，點擊目標 `/dashboard/plan` | **異常**：方案頁不顯示用量與上限（HC-PLATFORM-USAGE-02） | agent `GET /plan-change` 403、supervisor 200 | UAT Demo `GET /plan-change` 正常（2 筆歷史申請），最近 100 則通知沒有用量告警（Demo 無方案、用 BYOK，符合預期） |
| 9 Gemini 真實呼叫 | — | 待真機驗 | — | — | 本機沒有 Gemini 金鑰；UAT 禁止為測試觸發外部呼叫 |

UAT 只做了：Demo admin 登入、`/auth/me`、`GET /plan-change`、`GET /notifications`、`GET /settings/chat`、未登入打 `/platform/usage/overview`（401），以及一次 `BEGIN TRANSACTION READ ONLY` 的資料庫查詢（`model_pricings` 全表、Demo 租戶 `ai_usages` 的彙總與方案）。沒有登入平台後台，沒有建立任何資料。

## 完備度對照

以 scenario 名稱與內容比對 `apps/api/tests`。

| Spec | Requirement 數 | Scenario 數 | 缺測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| ai-usage-recording | 5 | 10 | 6：Gemini 回應帶 usageMetadata、缺 thoughtsTokenCount、Ollama eval 計數、AiUsage 寫入失敗不影響回覆、provider 未回傳 usage、Gemini 回 429。金鑰來源 3 個有同名測試（`usage-quota.test.ts`） | 0（「自動化規則觸發的 AI 動作」規格註明目前沒有這種動作） | 無（系統行為）；`usageMissing`、失敗筆數沒有任何讀取端 |
| model-pricing | 3 | 6 | 3：改價後新呼叫用新價、查無價目、重複執行 seed。成本公式、分級、Ollama、BYOK 有測試 | 0 | **沒有**（USAGE-02） |
| platform-usage | 1 | 4 | 0（`platform-usage.test.ts` 4 個同名測試） | 0 | 有（`/admin/usage`） |
| token-quota | 2 | 10 | 0（`usage-quota.test.ts`、`agent-quota.test.ts`） | 0 | 租戶端、平台端都看不到用量與上限（HC-PLATFORM-USAGE-02） |
| usage-quota-alerts | 6 | 18 | 0（`usage-quota.test.ts`、`usage-quota-alert.test.ts`、`notification.worker.test.ts`、`plan-change.test.ts`、feature `token-quota-alert.test.ts`） | 0 | 站內通知有；落地頁沒有用量 |

## 待真機驗
- Gemini 平台金鑰的真實呼叫：`usageMetadata` 解析、`cachedTokens`／`thoughtsTokens`、成本實算與 `gemini-2.5-pro` 分級價。
- BYOK 呼叫成本記 0、不計額度（unit 測試有涵蓋，沒有真金鑰實測）。
- 租戶數超過 50 時排行與總覽的差額（USAGE-01）。

## 本機留下的資料
- 租戶 `hc-platform-usage-A`（`e55f7815-1282-45aa-b1fd-2c5daf59c53a`）與管理員 `hc-platform-usage-admin@example.test`。方案由 `light` 換成 `standard`（測 PLAN-13）。AI 設定指向已關閉的 `http://127.0.0.1:18434`，只影響這個租戶。
- 這個租戶的 `ai_usages` 7 筆真實呼叫（約 2.4M token，`ai-rewrite`），會出現在 `/admin/usage`；5 筆合成列已刪除。
- Redis：這個租戶的 `aiquota:*:2026-10` 計數器與兩個告警旗標，11/1 00:00 UTC 自動過期。Demo 租戶的計數器與方案沒有動。

## 建議新增到 AUDIT.md 的項目
- HC-PLATFORM-USAGE-01（P2）：AI 模型下拉清單與價目表沒有對齊，7 個可選模型沒有價目。可併入 USAGE-02，修正方向加一條「啟動時或 CI 比對 `CURATED_CHAT_MODELS` 與 `model_pricings`」。
- HC-PLATFORM-USAGE-02（P2）：租戶與平台都看不到本月已用量與上限，告警連結的落地頁沒有用量。
- HC-PLATFORM-USAGE-03（P2）：`/admin/usage` 的 API 失敗顯示成「尚無用量資料」。
- HC-PLATFORM-USAGE-04（P2）：摘要失敗時回固定範本文字，自動轉接把它寫進系統訊息。
- HC-PLATFORM-USAGE-05（P3）：月額度與每日趨勢以 UTC 切，台灣早上 8 點前的用量算到前一天或上個月（需產品決定）。
- HC-PLATFORM-USAGE-07（P3）：平台看不到失敗的 AI 呼叫。

## 文件過時之處
- `docs/ref/features/platform/USAGE.md`「哪些呼叫不算」：寫 `resolveGeminiKey()`「依序找租戶自填的金鑰、平台代設的金鑰、全域 `GEMINI_API_KEY`」。程式只有兩層（租戶自填、全域 env），原始碼註解寫「目前兩者同源」。
- `docs/ref/features/platform/USAGE.md` 沒寫額度用完時各功能的表現：潤稿與 Agent 回 403，分類、情緒、建議回覆、摘要靜默降級回 200。
- `docs/ref/features/platform/USAGE.md` 沒寫每日趨勢的分桶時區（UTC）；「AI 月額度」表格寫「UTC 月初起算」是對的。
- `docs/ref/features/platform/USAGE.md` 核對日期是 2026-09-23，內容與程式其餘部分一致。
