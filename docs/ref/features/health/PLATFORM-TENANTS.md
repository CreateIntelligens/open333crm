# 平台後台：租戶管理 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，`EMAIL_DELIVERY_MODE=log`）。UAT 未操作，原因見[UAT 操作紀錄](#uat-操作紀錄)
- 規格：`docs/ref/features/feature-map.json` 的 `platform-tenants`；功能文件 `docs/ref/features/platform/TENANTS.md`、`docs/ref/features/platform/README.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 3 份 spec、21 個 scenario。缺實作 0；缺同名測試 4（`tenant-provisioning` 全部 4 個）；缺前端入口 0（復原在 `/admin/trial`）。另外，`inbound-message-processing` 的「停用租戶的進站事件直接丟棄」在 WebChat 入口沒有實作（HC-PLATFORM-TENANTS-01） |
| 自動測試 | unit：api 7 檔 54 通過、web 4 檔 9 通過。feature：8 檔 52 通過（`modules/platform`、`modules/trial`、`modules/auth/tenant-disabled-access`）。無失敗、無 skip |
| 實際操作 | 13 條流程。正常 6，異常 6，只讀程式 1（試用排程清除，以 feature 測試為準） |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-PLATFORM-TENANTS-01 | P1 | **停用的租戶仍收得到 WebChat 訊息**。LINE/FB/IG 的 webhook 會檢查 `tenant.isActive`，WebChat（Chatbox）不檢查：停用後既有的訪客工作階段可以繼續送訊息，新訪客也能建立工作階段，系統照常建立聯絡人、對話與訊息，後續的自動化與 AI 回覆流程也照常進入。違反主規格 `inbound-message-processing`「停用租戶的進站事件直接丟棄」 | **實測**（本機）：開通 `hc-platform-tenants-A` → 建 WEBCHAT 渠道 → 訪客送一則 → `PATCH /platform/tenants/:id/active {isActive:false}` → 同一工作階段再送一則、另開新工作階段送一則 → 三則都回 200，DB 該租戶有 3 則 INBOUND 訊息、2 位聯絡人。AI 回覆是否被觸發未實測（測試租戶沒有設定模型），依程式判斷會進入 | `apps/api/src/modules/chatbox/chatbox.service.ts:354-366`（`resolveChatboxChannel` 只看渠道 `isActive`）、`:598-640`（`handleChatboxMessage` 直接呼叫 `processInboundMessage`）；對照 `apps/api/src/modules/webhook/webhook.service.ts:86` | 新（AUTH-02 未涵蓋） |
| HC-PLATFORM-TENANTS-02 | P2 | 停用租戶沒有確認步驟。列表每列「合約」旁就是「停用」，按一下立即停用（客戶全員登不進去、LINE/FB 訊息被丟棄）；詳細頁「停用租戶」與「儲存」並排，也沒有確認。UAT 即正式環境，列表上有真實客戶 | **實測**：列表與詳細頁各按一次「停用」，`dialog` 事件 0 次，租戶立即變「停用」 | `apps/web/src/app/admin/tenants/page.tsx:37-40, 152-154`；`apps/web/src/app/admin/tenants/[id]/page.tsx:152-166, 251-257` | 新 |
| HC-PLATFORM-TENANTS-03 | P2 | 列表頁停用/啟用失敗時畫面沒有任何訊息，`toggleActive` 沒有 try/catch，錯誤成為未處理的 rejection。操作者會以為按了沒反應 | **實測**：Playwright 攔截 `PATCH /tenants/*/active` 回 500 → 按「啟用」→ 畫面無訊息、狀態不變，console 只有 `Request failed with status code 500` | `apps/web/src/app/admin/tenants/page.tsx:37-40`；`load()` 同樣沒有錯誤處理（`:29-32`） | 新 |
| HC-PLATFORM-TENANTS-04 | P2 | 停用租戶的排程群發仍會執行。`broadcast.scheduler` 只依 `status='scheduled'`、`scheduledAt` 撈全部租戶的群發，不看 `tenant.isActive`；停用（含試用到期自動停用）的租戶預約的群發照樣送給顧客 | **只讀程式**。實測需要能投遞的渠道 | `apps/api/src/modules/marketing/broadcast.scheduler.ts:25-31` | 新 |
| HC-PLATFORM-TENANTS-05 | P2 | 手動開通表單的方案預設「免費試用」，但手動開通不設 `trialEndsAt`。用預設值開通的租戶永遠停在試用方案（功能受限），不會到期、不出現在 `/admin/trial`，也無法用「轉正式」處理，只能從詳細頁改方案 | **實測**：預設方案開通 `hc-platform-tenants-B試用` → `GET /trial-tenants` 不含它；DB `trialEndsAt` 為 null、`planId` 為 trial | `apps/web/src/app/admin/tenants/page.tsx:26, 80, 168-174`；`apps/api/src/modules/platform/platform-tenant.service.ts:178-206`（文件已說明手動開通不設 `trialEndsAt`，問題在預設值） | 新 |
| HC-PLATFORM-TENANTS-06 | P2 | 重寄開通信寄送失敗時仍回 `{ok:true}`，畫面顯示「開通信已重寄至 …」。`resendWelcomeEmail` 雖然 `await`，但 `sendManualProvisionedEmail` 內的 `safeSend` 把錯誤吞掉只寫 log；稽核也照寫 | **只讀程式**（本機 log 模式不會失敗）。成功路徑實測正常 | `apps/api/src/modules/platform/platform-tenant.service.ts:113-129`；`apps/api/src/modules/trial/trial-emails.ts:145-151, 175-181` | 新 |
| AUTH-10 | P3 | 改成員 email 與開通都以原字串查重：已有 `admin@open333crm.dev` 時，可把另一位成員改成 `ADMIN@open333crm.dev` | **實測**：`PATCH /tenants/A/agents/:id {email:"ADMIN@open333crm.dev"}` 回 200（已改回） | `platform-tenant.service.ts:106, 186` | AUTH-10（已記錄，本次再確認） |
| TRIAL-04 | P3 | 租戶頁「啟用」已清除的試用租戶：`isActive` 變 true、`purgedAt` 保留，試用清單仍顯示 `purged` | **實測**：B 設 `purgedAt` → `PATCH /active {isActive:true}` → `GET /trial-tenants` 狀態 `purged`、`isActive:true` | `platform-tenant.service.ts:131-135` | TRIAL-04（已記錄，仍存在） |
| HC-PLATFORM-TENANTS-07 | P3 | 開通與改名接受只有空白的值：站台名稱 `"   "`、管理員姓名 `"  "`、8 個空白的密碼都能開通，且該密碼可以登入；`PATCH /tenants/:id {name:"   "}` 也回 200。前端詳細頁有 trim，列表頁開通表單沒有 | **實測**：`POST /tenants` 三個欄位都是空白 → 200，以 8 個空白登入成功（測試租戶已改名為 `hc-platform-tenants-blank`） | `apps/api/src/modules/platform/platform.routes.ts:82-88, 269-274`（`min(1)` 未 trim；開通的 `name` 也沒有上限，改名有 `max(100)`） | 新 |
| HC-PLATFORM-TENANTS-08 | P3 | 列表頁所有錯誤（409 email 已使用、合約迄日早於起日、開通失敗）都用綠色成功樣式顯示。詳細頁有分紅綠 | **實測**：409 與合約錯誤的訊息框背景 `rgb(228,245,236)`、文字 `rgb(23,147,91)` | `apps/web/src/app/admin/tenants/page.tsx:96-100` | 新 |
| HC-PLATFORM-TENANTS-09 | P3 | 租戶不存在或 id 非 UUID 時，詳細頁永遠停在「載入中…」。API 對非 UUID 的 `:id`、`:agentId` 回 400 `DATABASE_ERROR`「資料處理失敗」，不是欄位驗證錯誤 | **實測**：開 `/admin/tenants/00000000-0000-0000-0000-000000000000` 等 1.5 秒仍是「載入中…」；`GET /tenants/abc`、`PATCH /tenants/abc/active`、`POST /tenants/:id/agents/abc/resend-welcome` 都回 400 `DATABASE_ERROR` | `apps/web/src/app/admin/tenants/[id]/page.tsx:52-63, 168-170`；`platform.routes.ts:265-333`（params 沒有 Zod） | 新 |
| HC-PLATFORM-TENANTS-10 | P3 | 列表頁開通表單的方案寫死 5 個 slug，不讀 `/plans`；平台新增的方案選不到，改了 slug 會開通失敗 404。詳細頁的方案下拉才讀 `/plans` | 讀程式；實測詳細頁下拉有 7 個方案（含其他代理建的測試方案），列表頁固定 5 個 | `apps/web/src/app/admin/tenants/page.tsx:168-174` | 新（與 PLAN-01 相關：兩處都不排除停售方案） |
| HC-PLATFORM-TENANTS-11 | P3 | 合約 API 送 `{}` 不改任何欄位仍回 200 並寫一筆 `tenant.contract.update` 稽核；送數字 `0` 被 `z.coerce.date()` 接受成 1970-01-01。前端不會送這兩種值 | **實測**：兩個請求都回 200，`platform_audit_logs` 多兩筆 | `platform.routes.ts:392-411` | 新 |
| HC-PLATFORM-TENANTS-12 | P3 | 列表只顯示啟用/停用，看不出試用中、試用到期、已清除；已清除的租戶在列表上只是「停用」，旁邊的「啟用」按鈕會觸發 TRIAL-04 的情況 | 實測列表：`hc-platform-tenants-B試用`（已清除）顯示「停用／啟用」 | `apps/web/src/app/admin/tenants/page.tsx:137-141`；`listTenants` 不回 `trialEndsAt`、`purgedAt`（`platform-tenant.service.ts:16-30`） | 新 |
| HC-PLATFORM-TENANTS-13 | P3 | 重寄開通信不檢查成員或租戶是否停用，停用的成員也會收到「站台已開通完成、前往登入」 | 讀程式 | `platform-tenant.service.ts:113-121` | 新 |
| HC-PLATFORM-TENANTS-14 | P3 | 詳細頁改成員 email 格式錯時只顯示「輸入內容有誤，請檢查後重新送出」，沒有用 `details.issues` 的「電子郵件格式不正確」；輸入框是 `type=email` 但不在 form 裡，瀏覽器不會先驗證 | **實測**：改成 `not-an-email` 按儲存 | `apps/web/src/app/admin/tenants/[id]/page.tsx:65-70, 120-135` | 新 |
| HC-PLATFORM-TENANTS-15 | P3 | 稽核在異動完成之後另外寫，不在同一交易：稽核寫入失敗時異動已生效、API 回 500。改成員 email 的 payload 只記新 email，查不到原本的登入帳號；改名稱只記新值。個資遮罩是唯一在同一交易寫入的 | 讀程式 | `platform.routes.ts:268-345`；對照 `apps/api/src/modules/platform/ai-privacy.service.ts` | 新 |
| HC-PLATFORM-TENANTS-16 | P3 | E2E `cross-tenant-lifecycle.spec.ts` 斷言「✓ 已開通」，目前訊息沒有 ✓，這支測試會失敗。這支測試會在目標環境開通並停用租戶，對 UAT（正式環境）是破壞性操作 | 讀程式 | `apps/web/tests/e2e-uat/cross-tenant-lifecycle.spec.ts:42`；訊息在 `apps/web/src/app/admin/tenants/page.tsx:75-79` | 新 |
| AUTH-02 | P2 | 停用租戶不中斷 Socket、CLI token、Partner API 金鑰 | 讀程式：`socket-room-authorization.ts`、CLI 服務都沒有 `tenant.isActive` 檢查，與 AUDIT 描述一致 | 見 AUDIT | AUTH-02（已記錄，仍存在） |

### 已確認正常（與文件一致）

- 停用後：正確密碼登入 403 `TENANT_DISABLED`、錯誤密碼 401 `INVALID_CREDENTIALS`（不洩漏停用）、refresh 401、停用前的 access token 仍可呼叫 `/auth/me`（主規格允許一個有效期）。
- 開通交易內建出 Tenant、三個 `isSystem` 角色（admin/supervisor/agent）、ADMIN 成員；新管理員可立即登入；開通信寄到管理員信箱（API log 只印主旨與 `loginUrl`，本文不印），稽核 payload 只有 `name`、`planSlug`。
- 租戶 token 呼叫任何 `/platform/*` 一律 401。
- 合約：設起訖、只送一個、送 null 清除、迄日早於起日 422 `CONTRACT_DATE_INVALID`、只送一個時與現值比較 422、`"abc"` 與 `""` 400「日期格式不正確」。
- 復原：已清除 → 200，`isActive` 不變；再復原 422 `NOT_PURGED`；不存在 404。
- 個資遮罩：開關往返正常、非 boolean 與多餘欄位 400、每次寫一筆稽核。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 租戶列表 | 本機 | 正常：8 個租戶、合約期間、狀態都正確 | 讀取失敗沒有訊息（程式） | 租戶 token 401 | 看不出試用/已清除（HC-12） |
| 2 手動開通 | 本機（API、UI） | 正常：UI 開通 `hc-platform-tenants-C`，訊息含 `loginUrl`，列表出現；API 開通 A、B | 重複 email 409（UI 綠色框，HC-08）；密碼 7 字 400；方案不存在 404；空白欄位被接受（HC-07） | — | 預設方案問題（HC-05）；tenant-provisioning 無測試 |
| 3 列表停用/啟用 | 本機 | 正常：狀態切換、稽核 `tenant.disable`/`enable` | **異常**：失敗無訊息（HC-03） | — | **異常**：無確認（HC-02） |
| 4 列表合約 | 本機 | 正常：存 2026-10-01～2027-09-30，重新整理讀回一致 | 迄日早於起日前端擋，但綠色樣式（HC-08） | — | |
| 5 詳細頁 | 本機 | 正常：5 個統計數字、成員表 | **異常**：不存在的 id 停在載入中（HC-09） | — | Demo 詳細頁只讀開啟，未操作 |
| 6 改名稱、方案 | 本機（API） | 正常：改名 200、稽核 `tenant.update` | 空 body 400「至少提供一個欄位」；方案不存在 404；名稱全空白被接受（HC-07，前端按鈕會 disabled） | — | 改方案快取失效以 unit `tenant-plan.test.ts` 為準 |
| 7 詳細頁停用/啟用 | 本機 | 正常：紅綠狀態、訊息「已停用租戶」 | — | — | **異常**：無確認（HC-02） |
| 8 詳細頁合約 | 本機 | 正常：清空兩個日期儲存成功 | 迄日早於起日：紅色訊息，正確 | — | |
| 9 改成員 Email | 本機（UI、API） | 正常：改為 `hc-platform-tenants-a3@example.test`，重新整理讀回 | 重複 409 訊息正確；格式錯只顯示通用訊息（HC-14）；其他租戶的成員 404；大小寫不同可並存（AUTH-10） | — | 不通知原信箱 |
| 10 重寄開通信 | 本機 | 正常：畫面訊息、API log 有信、稽核 | 成員不屬於該租戶 404；非 UUID 400 `DATABASE_ERROR`（HC-09） | — | 失敗被吞（HC-06，讀程式） |
| 11 個資遮罩 | 本機（API） | 正常：開→關往返，兩筆稽核 | `"yes"` 400、多餘欄位 400 | — | UI 元件以 unit 測試為準 |
| 12 復原已清除 | 本機（API） | 正常 | 422 `NOT_PURGED`、404 | — | UI 在 `/admin/trial`（屬試用管理領域） |
| 13 試用清除排程 | — | 未實測 | — | — | 以 feature `trial-data-purge.test.ts` 為準（通過）；`purgedAt` 以 SQL 模擬 |
| 停用的效果 | 本機 | 登入、refresh、REST 的行為符合主規格 | **異常**：WebChat 照收（HC-01） | — | LINE/FB 丟棄以 feature `tenant-disabled-access.test.ts` 為準 |

權限：平台後台沒有角色分級，只測「租戶 token / 沒有 token 打平台 API」→ 401。沒有 token 時訊息是「平台登入已過期，請重新登入」，屬平台認證領域。

## 完備度對照

| Spec / Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| tenant-provisioning／開通成功 | `platform-tenant.service.ts:141-175` | **無** | 列表頁開通表單 |
| tenant-provisioning／中途失敗全回滾 | 同上（`$transaction`） | **無** | — |
| tenant-provisioning／superuser 手動開通 | `platform.routes.ts:333-345` | **無**（稽核 payload 有 unit） | 有 |
| tenant-provisioning／email 已被使用 | `platform-tenant.service.ts:185-187` | **無** | 有（訊息綠色，HC-08） |
| tenant-contract-dates（7 個 scenario） | `trial-admin.service.ts:97-123`、`platform.routes.ts:392-411` | 7/7 同名（`tenant-contract-dates.test.ts`） | 列表頁與詳細頁 |
| trial-data-purge（10 個 scenario） | `trial.scheduler.ts:120-131`、`trial-admin.service.ts:78-89`、`/admin/trial` | 10/10 同名（feature `trial-data-purge.test.ts`、web `trial-page.test.tsx`、unit `platform-audit-routes.test.ts`） | `/admin/trial` |
| inbound-message-processing／停用租戶的渠道收到訊息（參考） | LINE/FB/IG 有；**WebChat 無**（HC-01） | 只測 FB | — |
| auth-session／停用租戶的長效憑證與既有連線失效（參考） | **無**（AUTH-02） | 無 | — |

**有後端、沒有前端入口**：平台稽核只能依平台帳號查（`GET /platform-users/:id/audit-logs`），沒有依租戶查的介面；詳細頁沒有復原鈕（在 `/admin/trial`）。

**前端送出的值與後端 Zod**：開通 `planSlug` 寫死 5 個（後端只查存在，不查停售）；合約 `YYYY-MM-DD` 或 `null`，後端接受；改名 trim 後送出；改 email 不 trim，前後有空白時 400。沒有發現前端送出、後端拒絕的合法值。

## 待真機驗

- HC-PLATFORM-TENANTS-04：停用租戶的排程群發是否真的送到 LINE/FB（需要能投遞的渠道）。
- HC-PLATFORM-TENANTS-01：停用租戶的 WebChat 訊息是否觸發 AI 自動回覆與用量計費（需要設定模型的租戶）。
- 開通信與重寄開通信的實際內容與寄送失敗時的行為（需要 SMTP/Resend，且不能寄到真實地址）。
- UAT 唯讀檢查：列表頁能載入、Demo 租戶詳細頁統計正確。

## UAT 操作紀錄

未登入 UAT 平台後台。本機與工作目錄都沒有 UAT 平台帳號的 auth-state，記憶中的密碼可能已被 seed 重設（見專案記憶「UAT seed 會重設 Demo/平台密碼」），依指示「不確定平台帳號密碼就不要登入」。UAT 建立 0 筆、刪除 0 筆。

本機建立的資料（都在 `open333crm_advisor`，沒有刪除租戶的 API，全部保留）：

| 類型 | 名稱 | ID | 狀態 |
| --- | --- | --- | --- |
| 租戶 | hc-platform-tenants-A | 44af2245-00ee-45a2-bc13-47cc696c5427 | 啟用；ADMIN email 改為 `hc-platform-tenants-a3@example.test`；合約已清空；個資遮罩已改回關閉；含 1 個 WebChat 渠道、2 位訪客聯絡人 |
| 租戶 | hc-platform-tenants-blank（原名為空白） | bdd7c95b-6038-45bf-a4a5-925ba0379643 | 啟用 |
| 租戶 | hc-platform-tenants-B試用 | 50002ec3-cb65-47bc-aa18-bc916a37961b | 停用、`purgedAt` 有值、`trialEndsAt` 以 SQL 設為 40 天前 |
| 租戶 | hc-platform-tenants-C | 9271e5d3-f3e1-4abf-b38a-437a241d6317 | 啟用（UI 開通，曾停用再啟用） |

Demo 租戶與其他代理的租戶沒有任何寫入。

## 建議新增到 AUDIT.md 的項目

- HC-PLATFORM-TENANTS-01：WebChat 進站不檢查租戶停用（違反 `inbound-message-processing` 主規格，建議 P1，可併入 AUTH-02 的「停用租戶」一節）。
- HC-PLATFORM-TENANTS-04：停用租戶的排程群發仍執行（建議一併盤點其他排程：SLA、CSAT、優惠券、自動化排程是否都該跳過停用租戶）。
- HC-PLATFORM-TENANTS-02、03：停用沒有確認、列表頁失敗無訊息。
- HC-PLATFORM-TENANTS-05：手動開通預設試用方案卻不設試用期。
- HC-PLATFORM-TENANTS-06：重寄開通信失敗仍顯示成功。
- HC-PLATFORM-TENANTS-15：平台稽核不在異動的交易內、改 email 不記舊值。

## 文件過時之處

- `docs/ref/features/platform/TENANTS.md`「停用租戶多久生效」的表只有 REST、Socket.IO、CLI 三列；AUDIT AUTH-02 已多列 Partner API 金鑰，且漏了 WebChat 進站（HC-01）與排程群發（HC-04）。
- `docs/ref/features/platform/TENANTS.md`「平台能對租戶做什麼」的表沒有 `PATCH /tenants/:id/contract` 與 `PATCH /tenants/:id/restore`（只在 README 的限制表提到），也沒寫兩個前端入口（列表「合約」、`/admin/trial`「復原」）。
- `docs/ref/features/platform/README.md`「目前的限制」寫「沒有任何測試，`apps/api/tests/` 沒有檔案涵蓋這個模組」已過時：現有 `tests/feature/modules/platform/` 3 檔、`tests/unit/modules/platform/` 7 檔，以及 trial 與 tenant-disabled-access 的 feature 測試。
- `docs/ref/features/platform/README.md`「稽核」一節可補：開通稽核 payload 只有 name 與 planSlug（不含 email），改成員 email 只記新值。
