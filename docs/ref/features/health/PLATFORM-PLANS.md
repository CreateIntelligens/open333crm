# 方案與上限 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（web 3000 production build、API 3001、workers；資料庫 `open333crm_advisor`）／UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，以 `/auth/me` 確認，只讀 `/dashboard/plan`）
- 本機測試資料（全部自建，未改 seed 方案與 Demo 租戶的方案）：
  - 方案 `hc-platform-plans-a`（以 SQL 建立，因為沒有新增方案的 API）：`features` 依測試切換，`limits {maxAgents:2, maxChannels:1, maxTags:1, monthlyTokens:100}`、`allowedChannelTypes ["WEBCHAT"]`
  - 方案 `hc-platform-plans-b`：`features [inbox, marketing, core]`、`limits {maxAgents:5, maxTags:10, monthlyTokens:null}`
  - 租戶 `hc-platform-plans-T1`（`5bdbbb17-e740-413e-83df-c49f83d0a47c`，平台 API 開通），成員 hc-platform-plans-admin／-sup／-ag
- UAT 平台後台：未登入。無法確定 UAT 平台帳號的密碼，依規定不登入，因此 UAT 的方案內容沒有核對。

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 4 份規格、43 個 scenario：0 個缺實作、1 個部分實作（「trial 方案未含 marketing」的 API 403，見 PLAN-04）、12 個缺測試、0 個缺前端入口。另有：沒有新增或刪除方案的 API 與 UI；`name`、`priceMonthly`、`isActive` 只有 API；`limitOverrides` 沒有任何讀寫入口 |
| 自動測試 | unit：api 9 檔 86 案例、web 1 檔 1 案例、core 3 檔 26 案例，全部通過，0 skip。feature：`test:feature modules/trial/token-quota modules/platform/plan-change` 跑 2 檔 17 案例，全部通過（過濾有生效） |
| 實際操作 | 13 條流程：正常 7，異常 5，部分驗證 1，待真機驗 0 |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-PLANS-01 | P1 | seed 的 `trial`（免費試用）與 `light`（輕量版）方案的 `features` 不含 `channels`。`channel.view`、`channel.create` 都屬於 `channels` feature，因此這兩個方案的租戶連管理員都看不到、也建不了任何渠道，接不了 LINE／FB／IG／WebChat。渠道頁把 403 顯示成「沒有渠道」，旁邊的「新增渠道」按下才 403 | **實測（本機）**：把自建方案設成與 `light` 相同的 `["inbox","core"]`，租戶管理員 `GET /channels` → 403 `requiredPermission: channel.view`；`/dashboard/settings/channels` 顯示「沒有渠道／新增您的第一個渠道」，但租戶實際有 2 個啟用中的渠道。**未確認** UAT 的方案內容是否與 seed 相同（未登入 UAT 平台後台） | `packages/database/prisma/seed.ts:31,38`、`packages/shared/src/rbac/permissions.ts:76-83` | 新 |
| HC-PLATFORM-PLANS-02 | P2 | `/admin/plans` 同時編輯兩張方案卡片時，先儲存的那張會重載全部方案的狀態，另一張的數值輸入框（`defaultValue`，非受控）仍顯示新值。再儲存另一張時送出的是舊值，畫面卻顯示「已更新…該方案所有租戶即時生效」 | **實測（本機 Playwright）**：A 卡「客服人數」改成 7 不存 → 按 B 卡「儲存」→ A 卡輸入框仍顯示 7 → 按 A 卡「儲存」→ 綠色「已更新」，資料庫 `maxAgents` 仍是 1，重新整理顯示 1 | `apps/web/src/app/admin/plans/page.tsx:44-47,131-132,239` | 新 |
| HC-PLATFORM-PLANS-03 | P3 | 方案只能改不能增刪；`name`、`priceMonthly`、`isActive` 只有 API。AUDIT PLAN-01 寫「`/admin/plans` 也能切換」停售，與程式不符：頁面自 #145 起就沒有停售、名稱、月費的欄位 | **實測**：`/admin/plans` 卡片只有功能、上限、渠道類型與「儲存」；`PATCH /platform/plans/:id {"isActive":false}` 200。平台路由只有 `GET /plans`、`PATCH /plans/:id`；本次測試方案只能用 SQL 建立 | `apps/api/src/modules/platform/platform.routes.ts:249-261`、`apps/web/src/app/admin/plans/page.tsx:121-130` | PLAN-01（文字過時） |
| HC-PLATFORM-PLANS-04 | P3 | 數值上限輸入用 `parseInt`：`1.5` 存成 1、`abc` 不更新卻顯示「已更新」、`-3` 被後端擋下但只顯示「儲存失敗」，而且失敗訊息與成功訊息同樣是綠底 | **實測（本機 Playwright）**：依序輸入 `1.5`、`abc`、`-3` 儲存，資料庫分別為 1、不變、不變；`-3` 的訊息顏色 `rgb(23,147,91)` | `apps/web/src/app/admin/plans/page.tsx:103-119,133-134,168-171` | 新 |
| HC-PLATFORM-PLANS-05 | P3 | `updatePlanSchema` 驗證過寬：`name` 可為空字串、`priceMonthly` 接受負數且小數被截成整數、`features` 不驗 slug、`limits` 沒有 key 白名單（錯字 key 會把整份 `limits` 換掉，四項上限一起變無上限）、空主體 `{}` 回 200 並寫一筆空稽核；`:id` 不是 UUID 時回 400 `DATABASE_ERROR` | **實測（本機 API，對自建方案 B）**：`{"name":""}`、`{"priceMonthly":-100}`、`{"priceMonthly":1.5}`（存成 1）、`{"features":["nonexistent"]}`、`{"limits":{"bogusKey":5}}` 都回 200；`PATCH /plans/not-a-uuid` 回 400 `DATABASE_ERROR`。已改回原值 | `apps/api/src/modules/platform/platform.routes.ts:65-82` | PLAN-07（`{}` 的部分已記錄） |
| HC-PLATFORM-PLANS-06 | P3 | 租戶端 `/dashboard/plan`：沒有權限時 `GET /plan-change` 的 403 未處理（unhandled rejection），畫面仍顯示整張表單與「尚無申請記錄」；送出失敗訊息是綠底；記錄顯示英文 slug（`升級 → standard`）；目標方案清單寫死三個 slug，不讀實際方案，也看不出目前是哪個方案 | **實測（本機）**：Demo agent 直接開網址 → `GET /plan-change` 403、console `AxiosError`，畫面顯示表單；按送出 → 綠底「權限不足…」。租戶管理員送出 → 記錄顯示 `升級 → standard`。手冊 `ch14-plan.html` 已註明綠底與讀取失敗 | `apps/web/src/app/dashboard/plan/page.tsx:17-21,39-40,67,129` | PLAN-10（看不到目前方案） |
| HC-PLATFORM-PLANS-07 | P3 | AI 額度告警的站內通知與 email 都以 `/dashboard/plan` 作為「查看用量」的連結，但這一頁沒有用量；收件人用 legacy `role: 'ADMIN'` 決定，不看 `settings.manage`（能開這一頁的權限） | 讀程式 | `apps/api/src/modules/notification/notification.worker.ts:281,298,313` | 新 |
| HC-PLATFORM-PLANS-08 | P3 | `/admin/plans` 的「可用渠道類型」列出 Prisma `ChannelType` 的全部值，含 `TELEGRAM`（`createChannelSchema` 不接受）與 `WHATSAPP`（沒有 plugin），勾了也建不出來 | **實測**：卡片列出 LINE、FB、WEBCHAT、WHATSAPP、TELEGRAM、THREADS | `apps/api/src/modules/platform/platform.routes.ts:240-246`、`apps/api/src/modules/channel/channel.routes.ts:137` | 新 |
| PLAN-08 | P3 | 角色頁不套天花板。**實測確認**，另外補充：方案不含某 feature 時，渠道頁與行銷頁把 403 顯示成空狀態（「沒有渠道」「尚無行銷活動」），新增按鈕可按 | 本機自建租戶（方案不含 marketing、channels）：角色頁 Admin「62 項權限」，`role_permissions` 有 3 個 `marketing.*`；`/auth/me/permissions` 33 個、不含 `marketing.*`；`/dashboard/marketing/campaigns` 顯示「尚無行銷活動」 | `apps/web/src/components/settings/ChannelManagement.tsx`、`apps/web/src/app/dashboard/marketing/page.tsx` | PLAN-08、HC-MARKETING-06 |
| PLAN-07 | P3 | **實測確認**重新啟用渠道不檢查 `maxChannels` | `maxChannels=1`：停用 wc1 → 建 wc2（200）→ 啟用 wc1（200），兩個啟用中的渠道 | `apps/api/src/modules/channel/channel.service.ts:316-320` | PLAN-07 |
| PLAN-04 | P2 | **實測確認** `maxTags` 沒有強制點；方案不含 `knowledge` 時知識庫列表仍 200 | `maxTags=1` 建 3 個標籤都 201；`GET /knowledge?limit=1` 200 | `apps/api/src/modules/platform/plan-limits.service.ts:8` | PLAN-04、RBAC-01 |
| PLAN-01 | P3 | **實測確認**停售方案仍可指派 | 方案 B `isActive:false` → `PATCH /platform/tenants/:id {planSlug:"hc-platform-plans-b"}` 200 | `apps/api/src/modules/platform/platform-tenant.service.ts:71-78` | PLAN-01 |
| PLAN-03 | P3 | **實測確認**第三點的形狀：直接改資料庫的 `planId` 後，API 最多 60 秒仍用舊方案 | SQL 把租戶從 B 改到 A：之後 50 秒 `/marketing/campaigns` 仍 200，第 60 秒起 403。平台 API 改方案則立即生效（單一行程） | `apps/api/src/services/tenant-plan.cache.ts:7-25` | PLAN-03 |

另外引用、本次沒有新資訊的：PLAN-05、PLAN-09（實測稽核 `plan.update` 只記送出的欄位）、PLAN-10、PLAN-12、PLAN-13、RBAC-01（`billing.view` 沒有強制點）。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 看方案 | 本機 UI | 正常：自建方案卡片顯示功能、上限、渠道類型 | — | 無平台 token 回 401；租戶 token 打 `/platform/plans` 回 401「平台登入已過期」（訊息屬平台登入領域） | 沒有新增、刪除、改名、停售 UI（HC-03） |
| 2 勾選功能 | 本機 UI＋API | 正常：A 加 `channels` 後同一個租戶 token 立即 `GET /channels` 200；`core` 勾選框停用 | `features` 接受不存在的 slug（HC-05） | — | 稽核 `plan.update` 寫入 |
| 3 細分權限 deny | 本機 API＋UI | 正常：B deny `marketing.broadcast` 後 `/auth/me/permissions` 立即少該碼，`marketing.view`／`manage` 仍在；UI deny 與取消功能可存 | 未知權限碼 400「未知的權限碼」 | — | 取消功能後 deny 清單保留（設計，重開功能時仍生效） |
| 4 數值上限 | 本機 UI | 正常：客服人數 4 → 儲存 → 重新整理 4；清空 AI 額度存成 null | **異常**：1.5、abc、-3（HC-04）；跨卡片舊值（HC-02） | — | — |
| 5 可用渠道類型 | 本機 API | 正常：`["WEBCHAT"]` 時建 FB 回 403 `CHANNEL_TYPE_NOT_ALLOWED`（`details.allowed`），建 WEBCHAT 200 | `["SMS"]` 400 | — | TELEGRAM 可勾但建不出（HC-08） |
| 6 租戶看申請記錄 | 本機 UI、UAT UI（只讀） | 正常：admin、supervisor（有 `settings.manage`）可看；UAT Demo 顯示 2 筆（1 筆 2026-09-16 起的加購仍「處理中」，1 筆 E2E 駁回） | **異常**：agent 403 顯示成空記錄（HC-06） | 側欄依 `settings.manage` 隱藏；網址不擋 | 不顯示目前方案與用量（PLAN-10） |
| 7 租戶送出申請 | 本機 UI | 正常：自建租戶送「升級 standard」→「申請已送出」、表單換成處理中提示（已由平台駁回清除） | agent 送出 403，訊息綠底（HC-06） | 後端 `settings.manage` | API 也接受申請「目前所在的方案」（方案異動領域） |
| 8 功能天花板 | 本機 API | 正常：方案不含 `marketing` 時 `/marketing/campaigns` 403 `requiredPermission: marketing.view`，含時 200；降級不刪 `RolePermission` | 知識庫讀取不受天花板（PLAN-04） | — | 角色頁不套天花板（PLAN-08） |
| 9 `maxAgents` | 本機 API | 正常：上限 2 時建第 3 位 403 `PLAN_LIMIT_EXCEEDED {current:2,max:2}`；停用一位後可建新成員 | 重新啟用舊成員 403「無法重新啟用」；`limitOverrides.maxAgents=3` 後可重新啟用 | — | 前端對話框以 `resolveApiError` 顯示訊息（讀程式） |
| 10 `maxChannels` | 本機 API | 正常：上限 1 時建第 2 個 403 `PLAN_LIMIT_EXCEEDED` | **異常**：停用→新建→重新啟用可超過（PLAN-07） | — | — |
| 11 `monthlyTokens` | 本機 API | 正常：Redis 計數器設 100（＝上限）→ `POST /ai/rewrite` 403 `PLAN_LIMIT_EXCEEDED {limitKey:'monthlyTokens'}`，未呼叫 LLM | `limitOverrides.monthlyTokens=null` 後不再擋（回到 AI 設定錯誤 422，租戶沒有 AI 設定） | — | 計數器已刪除 |
| 12 `maxTags` | 本機 API | — | **異常**：上限 1 建 3 個都成功（PLAN-04） | — | — |
| 13 換方案與快取 | 本機 API | 正常：平台 `PATCH /platform/tenants/:id {planSlug}` 後下一個請求即套新天花板；稽核 `tenant.update` 帶 `planSlug` | 停售方案仍可指派（PLAN-01） | — | 部分：直接改資料庫延遲 ≤60 秒（PLAN-03）；多行程情境本機無法驗 |

## 完備度對照

| Spec | Scenario | 缺實作（含部分） | 缺測試 | 缺前端入口 | 主要缺口 |
| --- | --- | --- | --- | --- | --- |
| tenant-plan | 11 | 1（部分） | 1 | 0 | 「trial 方案未含 marketing」要求呼叫 marketing API 被擋，行銷仍有路由沒掛 `requirePermission`（PLAN-04）；「seed 重複執行」沒有測試（`seedPlans` 用 upsert）。其餘由 `tenant-plan.test.ts`、`plans-page.test.tsx`、`platform-audit-routes.test.ts` 覆蓋 |
| plan-limits-core | 7 | 0 | 2 | 0 | 「trial 租戶達人數上限」「停用的 agent 不計數」沒有 `createAgent` 的測試（只有 `agent-reactivate.test.ts` 測重新啟用）；本次實測兩者都通過 |
| granular-plan-entitlement | 15 | 0 | 9 | 0 | deny 三個 scenario、`allowedChannelTypes` 四個、registry 動態化兩個都沒有測試（實測 deny 與白名單正常）；「平台設定權限點 deny 與渠道限制」只有實測。`maxChannels` 五個由 `channel-plan-limits.test.ts` 覆蓋 |
| token-quota | 10 | 0 | 0 | 0 | `usage-quota.test.ts`、`agent-quota.test.ts` 齊全；實測 `rewriteText` 也會擋 |
| **合計** | **43** | **1** | **12** | **0** | |

前端送出值與後端 Zod：

- `/admin/plans` 送 `features`、`limits`、`allowedChannelTypes`、`permissionOverrides`；`limits` 值經 `parseInt`（HC-04），後端只接受非負整數或 null。
- `allowedChannelTypes` 的選項來自 Prisma enum，後端接受，但 `TELEGRAM` 無法建立（HC-08）。
- `/dashboard/plan` 送 `{type:'upgrade', targetPlanSlug}` 或 `{type:'token_topup', topupTokens}`，值都在後端接受範圍；`note` 上限 500 字，前端不提示。

## 待真機驗

- 多個 API 行程時，平台換方案後其他行程最多 60 秒仍用舊方案（PLAN-03 第三點）。本機只有一個 API 行程。
- UAT 的五個方案內容是否與 seed 相同，尤其 `trial`、`light` 是否含 `channels`（HC-PLATFORM-PLANS-01）。需要能登入 UAT 平台後台的人唯讀確認 `/admin/plans`。
- 實際 LLM 呼叫累加計數器、跨越 80%／100% 告警（需要平台 AI 金鑰與真實用量）。

## 環境與測試資料

- 本機留下：方案 `hc-platform-plans-a`、`hc-platform-plans-b`（會出現在 `/admin/plans` 列表最後），租戶 `hc-platform-plans-T1`（方案 A），成員 3 位、渠道 2 個（WebChat）、標籤 3 個、已駁回的升級申請 2 筆。
- 測試中改過的值都已還原：方案 A／B 的 `limits`、`features`、`permissionOverrides`、`isActive`；租戶 `limitOverrides` 改回 `{}`；Redis `aiquota:5bdbbb17…:2026-10` 已刪除。
- 沒有改 seed 方案、Demo 租戶的方案或 seed 帳號。
- UAT：只讀，未建立任何資料。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-PLANS-01：`trial`、`light` 方案不含 `channels`，租戶無法建立或查看渠道。先確認 UAT 方案內容；如果是刻意設計，平台與手冊要說明這兩個方案怎麼接渠道。
- HC-PLATFORM-PLANS-02：方案頁跨卡片儲存送出舊值、卻顯示已更新（改成受控輸入，或儲存後只更新該卡）。
- HC-PLATFORM-PLANS-05：`updatePlanSchema` 補 `limits` key 白名單、`name` 最小長度、`priceMonthly` 非負整數、`features` 驗 slug。
- HC-PLATFORM-PLANS-07：額度告警的連結與收件人。

## 文件過時之處

- `docs/ref/system/AUDIT.md` PLAN-01：「`/admin/plans` 也能切換它」不正確，頁面沒有停售開關，只能打 API。
- `docs/ref/system/AUDIT.md` PLAN-07：「`/admin/plans` 兩個欄位都編輯得到，補上值就會生效」正確，但沒提到渠道類型選項含建不出的 `TELEGRAM`（HC-08）。
- `docs/ref/features/platform/PLANS.md` 未提到：沒有新增、刪除方案的途徑；`/admin/plans` 只編輯四個欄位；`trial`、`light` 不含 `channels` 的後果。
- `packages/core/src/rbac/features.ts` 的 `core` 說明寫「方案用量」，`billing.view` 說明寫「租戶站內方案/用量頁」，但沒有任何頁面顯示用量（RBAC-01、PLAN-10）。
