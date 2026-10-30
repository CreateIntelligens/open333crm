# 租戶設定 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只讀）
- 範圍：`docs/ref/features/feature-map.json` 的 `settings`；功能文件 `docs/ref/features/tenant/SETTINGS.md`。設定頁殼與營業時間、追蹤設定、跨渠道綁定（設定面）、WebTalk、API 金鑰、CLI 連線與 MCP、A2A，以及 Chat／Embedding／自備金鑰的儲存路由。一般設定（改密碼）與 Passkey 的程式歸 members，本次一併實際操作。渠道、人員、角色、標籤、SLA、門市各歸其領域，不在此重複

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 6 份 spec、83 個 scenario。以 scenario 名稱比對測試名稱，45 個找不到同名測試（`a2a-agent-tenant-routing` 8、`a2a-standard-persistent-connection` 18、`open333-cli-auth` 17、`webtalk-collaboration` 2）。確定缺實作 2 個（A2A 租戶綁定，A2A-01）。營業時間只有「讀取失敗不可儲存」一條需求，時段、時區、自動回覆的行為沒有任何規格 |
| 自動測試 | unit：api 12 檔 78 通過、web 10 檔 37 通過；feature：5 檔 30 通過（`modules/settings`、`modules/webtalk`、`modules/mcp`、`shortlink-tracking-injection`）。無失敗、無 skip |
| 實際操作 | 11 條流程。正常 6，異常 4，待真機驗 1（Passkey 註冊與登入，本機未設定 WebAuthn） |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-SETTINGS-01 | P1 | 營業時間頁在 `officeHours` 為 `{}` 時，按「啟用」開關整頁崩潰（`Cannot read properties of undefined (reading 'mon')`），不按開關直接儲存則回 400。`TenantSettings` 由營業時間以外的路徑建立時（追蹤設定、跨渠道綁定、AI 設定、第一次收文字訊息時情緒分析呼叫的 `getChatSettings`），`officeHours` 是 schema 預設的 `{}`。`getOfficeHours` 只在**沒有這一列**時給預設值，`{}` 是 truthy，前端 `data.officeHours \|\| DEFAULT_CONFIG` 也不會換。結果是這類租戶無法從畫面啟用營業時間 | **實測（本機）**：本機 Demo 租戶 `officeHours` 是 `{}` → `GET /settings/office-hours` 回 `{"officeHours":{}}` → 開 `/dashboard/settings/office-hours` → 點開關 → 「Application error: a client-side exception」。UAT Demo 已有完整設定，不受影響；其他租戶依規定未讀取 | `apps/api/src/modules/settings/office-hours.service.ts:69`；`apps/web/src/components/settings/OfficeHoursSettings.tsx:64, 192-194` | HOURS-01 |
| HC-SETTINGS-02 | P2 | 側欄「營業時間」「追蹤設定」「API 金鑰」「CLI 連線」沒有 `perm`，`SETTINGS_TABS` 也沒有。沒有 `settings.manage` 的成員看得到，打開顯示「無法讀取…：權限不足」；API 金鑰與 CLI 頁仍顯示「建立金鑰」「產生 Token」，按下才 403。違反主規格 `permission-check`「前端依權限顯示選單」與 `dashboard-tree-navigation`「Permission-aware tree rendering」 | **實測（本機）**：自建 AGENT 帳號（無 `settings.manage`）→ 側欄列出上述四項 → 逐頁開啟，後端皆 403 `requiredPermission: settings.manage`。跨渠道綁定、WebTalk、A2A 正確隱藏 | `apps/web/src/components/layout/Sidebar.tsx:107-108, 112-113`；`apps/web/src/app/dashboard/settings/page.tsx:30-31, 35-36` | RBAC-11 |
| HC-SETTINGS-03 | P2 | 營業時間不驗證時段：結束早於開始（跨午夜）可以儲存，實際整天都判定為非營業，營業時間內也自動回覆；`99:99`、`24:61`、假日 `abc`、`2026-13-45` 也都接受。手冊已提醒「不支援跨過午夜」，但畫面與後端都不擋 | **實測（本機）**：週五 13:32 設 `fri: 13:00–02:00` → WebChat 傳訊息 → 收到 SYSTEM 自動回覆（`metadata.source: office_hours_auto_reply`）。`PUT` `{mon:{start:"99:99",end:"24:61"}}` 回 200 | `apps/api/src/modules/settings/settings.routes.ts:57-82`；`office-hours.service.ts:146-151` | HOURS-02 |
| HC-SETTINGS-04 | P2 | 營業時間的 `timezone` 收任意字串。存入不合法的時區後，每則進站訊息在 `Intl.DateTimeFormat` 拋 `RangeError`，`sendOutsideHoursAutoReply` 只寫 error log，自動回覆整個失效，後台沒有任何提示 | **實測（本機）**：`PUT /settings/office-hours {timezone:"Mars/Base", …}` 回 200 → WebChat 傳訊息 → 沒有自動回覆，API log：`[Webhook] Office hours auto-reply error: Invalid time zone specified: Mars/Base` | `settings.routes.ts:65`；`office-hours.service.ts:118`；`apps/api/src/modules/webhook/inbound-side-effects.ts:216-217` | HOURS-02 |
| HC-SETTINGS-05 | P2 | A2A 狀態頁的「目前狀態」只要設定了 `A2A_AGENT_ID` 就顯示 `connected`。橋接連線失敗時 worker 會把狀態設成 `not_reported`，但 `buildA2AStatus` 用 `\|\| Boolean(agentId)` 蓋掉，所以斷線也顯示已連線。單元測試把這個行為寫成預期 | **讀程式**。UAT Demo 顯示 `connected`，無法從頁面判斷實際是否連線 | `apps/api/src/modules/settings/a2a-status.service.ts:28-32`；`apps/api/tests/unit/modules/settings/a2a-status.test.ts:14` | A2A-02（與 A2A-01 同頁） |
| HC-SETTINGS-06 | P2 | CLI token 與 API 金鑰的 `expiresInDays` 沒有上限。CLI 頁寫「每個 Token 都有到期日」，但 API 接受 100000 天（到期 2300 年）；更大的值（3650000）讓日期溢位，回 500 `INTERNAL_ERROR` | **實測（本機）**：`POST /settings/cli-sessions {expiresInDays:100000}` 回 201、`expiresAt: 2300-08-15`；`{expiresInDays:3650000}` 回 500；`POST /settings/api-keys {expiresInDays:3650000}` 回 500。測試資料已撤銷 | `settings.routes.ts:397-399, 468-470, 533, 579` | SEC-07（scope 不受限的部分是 RBAC-02） |
| RBAC-02 | P1（依 AUDIT） | `POST /settings/cli-sessions` 的 `scopes` 收任何字串 | **實測**：`scopes: ["mcp:line:broadcast","anything:goes"]` 回 201，token 帶這兩個 scope（已撤銷） | `settings.routes.ts:575-580` | RBAC-02（仍存在） |
| AUD-01 | — | API 金鑰與 CLI token 的建立、撤銷沒有租戶稽核 | **實測**：建立與撤銷金鑰、token 後查 `tenant_audit_logs`，沒有對應紀錄；營業時間、追蹤、跨渠道綁定、WebTalk、Chat、Embedding 都有 `settings.update` | `settings.routes.ts:395-433, 466-509` | AUD-01（仍存在） |
| HC-SETTINGS-07 | P3 | 跨渠道綁定頁「啟用 email 登記」的說明寫「系統不寄驗證信，填入他人 email 也會合併」，手冊第 17 章第 6 節也寫「Email 和手機登記不會寄驗證信或簡訊」。程式已改為寄 6 位數驗證碼、驗證通過才寫入（與 HC-CONTACTS-01 同源）。手機登記不驗證的說明仍正確 | **讀程式**：`registration-routes.ts` 引用 `ownership-code.ts` 的 `requestOwnershipCode`、`verifyOwnershipCode` | `apps/web/src/components/settings/IdentityBindingSettings.tsx:171`；`apps/web/public/manual/ch17-settings.html:245` | 新（文案） |
| HC-SETTINGS-08 | P3 | 追蹤設定與營業時間儲存失敗時，只 alert 通用訊息「輸入內容有誤，請檢查後重新送出」，沒有顯示回應 `details.issues` 的欄位訊息（例如「GA4 ID 格式不正確…」、時間「格式不正確」）。程式註解與手冊都說會告訴使用者哪個 ID 填錯。跨渠道綁定頁有用 `getFieldErrors`，顯示正確 | **實測（本機）**：追蹤設定填 `g-abc123` 儲存；營業時間清空一個時間欄位儲存 | `apps/web/src/components/settings/TrackingSettings.tsx:51`；`OfficeHoursSettings.tsx:83` | 新 |
| HC-SETTINGS-09 | P3 | API 金鑰列表的「狀態」只看撤銷，已過期的金鑰顯示「啟用中」；CLI 列表的過期 token 也不標示（手冊已註明） | **實測（本機）**：把一把金鑰的 `expiresAt` 改成昨天 → 列表「啟用中」，呼叫回 401 `API key expired` | `apps/web/src/components/settings/ApiKeyManagement.tsx:138-145` | 新 |
| HC-SETTINGS-10 | P3 | 建立 API 金鑰後顯示的 curl 範例沒有 `cmd` 欄位，照抄呼叫回 400 `INVALID_CMD`。這個錯誤與金鑰驗證失敗的訊息是英文（`cmd must be CREATE, UPDATE or DELETE`、`API key expired`、`Invalid API key`），Passkey 未設定時的 503 也是英文 | **實測（本機）**：以新金鑰照範例送 `DocID`、`Ver` | `ApiKeyManagement.tsx:362-365`；`apps/api/src/modules/knowledge/partner-ingest.service.ts:66-70`；`apps/api/src/modules/auth/partner-api-key.service.ts` 的 `verifyPartnerApiKey` | 新 |
| HC-SETTINGS-11 | P3 | 撤銷 API 金鑰或 CLI token 時，非 UUID 的 id 回 400 `DATABASE_ERROR`「資料處理失敗」；撤銷不存在的 CLI token 回 200 `revoked: true`（撤銷不存在的 API 金鑰回 404） | **實測（本機）** | `settings.routes.ts:423-433, 499-509` | 新 |
| HC-SETTINGS-12 | P3 | `expiresInDays: 0` 回「不可小於 0」，訊息與條件不符；程式註解寫 `0` 代表永不過期，schema 卻用 `positive()` 擋掉 | **實測（本機）**：`POST /settings/api-keys {name:"x", expiresInDays:0}` | `settings.routes.ts:532-533` | 新（同 HC-CONTACTS-18 的全域訊息） |
| HC-SETTINGS-13 | P3 | 一般設定的新密碼欄位提示「至少 6 個字元」，實際驗證是 8 字 | **實測（本機）**；UAT E2E 的 `@fields-settings 04` 也記錄過 | `apps/web/src/components/settings/GeneralSettings.tsx:217`（檔案歸 members） | 新 |
| HC-SETTINGS-14 | P3 | Passkey 列表的時間用不帶語系的 `toLocaleString()`，UAT 顯示「8/21/2026, 1:20:34 PM」 | **實測（UAT，只讀）** | `apps/web/src/components/settings/PasskeyManagement.tsx:268, 270`（檔案歸 members） | 新 |
| HC-SETTINGS-15 | P3 | WebTalk 設定頁不顯示伺服器是否設定 WebTalk。伺服器沒設定密鑰或 SDK 網址時（本機 `GET /webtalk/session` 回 `NOT_CONFIGURED`），頁面照樣可以切換 AI 摘要與重新產生房間代號，看不出設定不會生效 | **實測（本機）** | `apps/web/src/components/settings/WebTalkSettings.tsx` | 新 |
| HC-SETTINGS-16 | P3 | 跨渠道綁定的同一欄關鍵字不檢查重複，`["a","A"]` 可以存入 | **實測（本機）**，已改回原值 | `settings.routes.ts:84-87` | 新 |
| HC-SETTINGS-17 | P3 | 追蹤設定頁寫「所有短連結的點擊數據會同步發送到 GA4 和 Meta」，但中轉頁不等追蹤事件送出就轉址，功能文件已說明不一定收到 | **讀程式**與 `docs/ref/features/tenant/SETTINGS.md` | `TrackingSettings.tsx:70-72` | 新（文案） |

### 已知 AUDIT 項目的核對

| AUDIT | 本次結論 |
| --- | --- |
| RBAC-02 | 仍存在，`scopes` 收任何字串（實測）。另見 HC-SETTINGS-06 的期限問題 |
| AUD-01 | 仍存在（實測）。設定類修改都有稽核，`identity-binding` 與 `webtalk` 也有，功能文件的清單漏列 |
| CONV-01 | 仍存在：`settings.routes.ts` 沒有 `inactivityCloseHours` 的路由（讀程式） |
| A2A-01 | 仍存在：`tenantBinding` 是寫死的字串「Open333 CLI profile / Default Tenant」，UAT Demo 顯示同一值（讀程式＋UAT 只讀） |
| AUTH-02 | 未驗：需要停用租戶，不在可做範圍 |
| AI-01 | 未驗：需要換加密金鑰 |
| ARCH-01 | 部分改善：AUDIT 記 `settings.routes.ts` 5 處查詢，現在剩 2 處（`cli-sessions` 的 `findMany`、`identity-binding` 的 `upsert`） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 進入設定頁 | 本機、UAT | 正常：admin 各分頁都能開；UAT Demo 8 個分頁皆正常顯示、未發出任何寫入請求 | — | **異常**：無 `settings.manage` 仍看到 4 個分頁（HC-SETTINGS-02） | |
| 2 改密碼 | 本機 | 正常：自建帳號改密碼後，舊密碼登入 401、新密碼 200 | 太短、兩次不符、舊密碼錯都顯示正確訊息 | 只驗登入 | 提示文字 6 字（HC-SETTINGS-13） |
| 3 營業時間 | 本機、UAT（只讀） | 正常（設定列已有值時）：改時區 Tokyo、週一結束 17:30、加假日 2026-12-25、改訊息 → 重新整理一致；WebChat 在非營業時間收到自動回覆，30 分鐘內第二則不再回；寫 `settings.update` 稽核 | **異常**：`{}` 時崩潰（HC-SETTINGS-01）；跨午夜、`99:99`、不合法時區都存得進去（HC-SETTINGS-03、04）；清空時間只顯示通用訊息（HC-SETTINGS-08） | 後端 403 正常；側欄不隱藏 | 測完已以 SQL 還原，見下方「改動與還原」 |
| 4 追蹤設定 | 本機、UAT（只讀） | 正常：`  G-HCSET1234  ` 存成 `G-HCSET1234`、Pixel 存入，重新整理一致；清空後兩欄 `null`；稽核只記 `gaIdSet`、`metaPixelIdSet` | `g-abc123`、`12ab` 被拒、原值不變，但訊息是通用文字（HC-SETTINGS-08） | 後端 403 正常；側欄不隱藏 | |
| 5 跨渠道綁定 | 本機、UAT（只讀） | 正常：改綁定關鍵字為兩個、開 email 登記，重新整理一致；稽核記三個開關 | 綁定＝解除、用「確認綁定」、email 關鍵字＝綁定（大小寫不同）、6 個關鍵字、21 字、空白，都在欄位下顯示正確訊息 | 側欄與頁面隱藏；後端 403 | 同欄重複不擋（HC-SETTINGS-16）；說明文字過時（HC-SETTINGS-07） |
| 6 WebTalk | 本機、UAT（只讀） | 正常：開 AI 摘要存入；重新產生房間代號後 `webtalkRoomVersion` 加一；稽核 `section: webtalk` | `{enabled:"yes"}`、`{}` 回 400 | 隱藏、後端 403 | 頁面看不出伺服器未設定（HC-SETTINGS-15） |
| 7 API 金鑰 | 本機、UAT（只讀） | 正常：建立後明文只顯示一次、列表只顯示遮罩；以金鑰呼叫 `/settings/api-keys`、`/knowledge/articles` 都 401；撤銷後列表「已撤銷」、呼叫回 401 | 空名稱 400；過期金鑰 401；照範例呼叫 400 `INVALID_CMD`（HC-SETTINGS-10） | 後端 403 正常；**側欄與建立鈕不隱藏** | 過期仍顯示啟用中（HC-SETTINGS-09）；沒有稽核（AUD-01）；UAT Demo 有 24 把金鑰（多為先前 E2E 的已撤銷殘留） |
| 8 CLI 連線與 MCP | 本機、UAT（只讀） | 正常：勾 MCP 建立 → scopes 含 `mcp:read` → `POST /mcp` 列出 tools 成功、呼叫不存在的工具回 MCP 錯誤 → 撤銷後 `/auth/me` 回 401「CLI 權杖已被撤銷」 | 任意 scope 被接受（RBAC-02）；期限沒有上限、過大 500（HC-SETTINGS-06）；非 UUID 撤銷 400 `DATABASE_ERROR`（HC-SETTINGS-11） | 後端 403 正常；**側欄與產生鈕不隱藏** | 沒有稽核（AUD-01） |
| 9 Passkey | 本機、UAT（只讀） | 本機未設定 WebAuthn，頁面顯示「Passkey 尚未啟用」；UAT 列出 2 把（只讀） | 改名、刪除不存在的 id 404；非 UUID 400 | 只驗登入 | 註冊與登入待真機驗；時間格式（HC-SETTINGS-14） |
| 10 A2A | 本機、UAT（只讀） | 本機 `disabled`；UAT `enabled`、`connected` | — | 無 `settings.manage` 時側欄與頁面隱藏、後端 403 | 狀態判斷（HC-SETTINGS-05）、租戶綁定（A2A-01） |
| 11 AI 設定儲存 | 本機 | 正常：以相同值 `PUT /settings/chat {temperature:0.3}`、`/settings/embedding {topK:5}` 回 200，稽核只記欄位名 | `temperature:3`、`provider:"openai"`、`baseUrl:"ftp://x"`、8001 字 prompt、`topK:0`、`apiKey:""` 都回 400 並帶欄位訊息 | 後端 403 正常；側欄「AI 設定」隱藏 | 頁面行為歸 knowledge |

權限測試用的角色：admin、supervisor（預設有 `settings.manage`，與 admin 對設定的權限相同）、本機自建 AGENT 帳號 `hc-settings-agent`（無 `settings.manage`）。另建 `hc-settings-pw` 帳號測改密碼，未動 seed 帳號。

## 完備度對照

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| office-hours-settings | 1 | 2 | 0 | 0 | 有 |
| tracking-settings | 4 | 12 | 0 | 0 | 有 |
| webtalk-collaboration | 9 | 26 | 2（「Authenticated agent enters dashboard」「Dashboard navigation does not expose WebTalk page」） | 0 | 有 |
| open333-cli-auth | 7 | 17 | 17（行為有 `cli-session-auth.test.ts` 等測試，只是沒照 scenario 命名） | 未逐條核 | 設定頁「CLI 連線」與 `open333 login` |
| a2a-agent-tenant-routing | 4 | 8 | 8 | 2：「Explicit A2A Agent to tenant binding」的兩個 scenario（A2A-01） | 只有狀態頁 |
| a2a-standard-persistent-connection | 7 | 18 | 18 | 未逐條核 | 只有狀態頁 |

營業時間的自動回覆（時段判斷、時區、假日、30 分鐘去重、`offlineGreeting` 優先）、API 金鑰的建立與撤銷，都沒有主規格。營業時間的後端也沒有任何自動測試（`isWithinOfficeHours`、`PUT /settings/office-hours` 都沒有），只有前端「讀取失敗不可儲存」的單元測試。

**有後端、沒有前端入口**（與 Skill 一致）：`inactivityCloseHours`（連路由都沒有，CONV-01）；CLI token 的 `scopes`；`/webtalk/session` 的 `reason`；營業時間的任意時區、API 金鑰與 CLI 的任意天數。

**前端送出的值與後端 Zod**：營業時間 7 個時區、`HH:mm`、`YYYY-MM-DD` 都被接受；`type=time` 清空送 `""` 被拒（訊息見 HC-SETTINGS-08）。`officeHours` 為 `{}` 時前端原樣送 `{}`，後端回 400（HC-SETTINGS-01）。其餘分頁沒有發現前端送出、後端拒絕的值。

## 待真機驗

- Passkey 註冊、登入、改名、刪除：本機未設定 `WEBAUTHN_RP_ID`、`WEBAUTHN_ORIGIN`。UAT 已啟用，但註冊需要實體裝置，且屬帳號變更。
- 非營業時間自動回覆在 LINE、FB、IG 的實際送達（本機只以 WebChat 驗證）。
- A2A 橋接實際連線與斷線時頁面顯示（HC-SETTINGS-05），需要能控制 Hub 的環境。
- 停用租戶後 CLI token 與 API 金鑰是否失效（AUTH-02）。

## 改動與還原

本機（`open333crm_advisor`，Demo 租戶的 `tenant_settings`）：

| 欄位 | 原值 | 測試中改成 | 還原方式 | 還原結果 |
| --- | --- | --- | --- | --- |
| `timezone`、`officeHours` | `Asia/Taipei`、`{}` | 多組（含 `Mars/Base`、Tokyo） | SQL 直接寫回原值（API 不接受 `{}`） | 05:33 已還原為 `Asia/Taipei`、`{}`。**之後 SLA 健檢（`hc-sla`）又改成啟用、週一到週五 09:00–10:00，那是對方的改動，未動** |
| `gaId`、`metaPixelId` | `null`、`null` | `G-HCSET1234`、`123456789012` | 頁面清空儲存 | 已還原 |
| `identityBinding` | 全部關閉，關鍵字 `綁定帳號`／`解除綁定`／`登記email`／`登記手機` | 多組 | `PUT /settings/identity-binding` 送原值 | 已還原 |
| `webtalkAiEnabled`、`webtalkRoomVersion` | `false`、`0` | `true`、`1` | API 改回 `false`；版本以 SQL 改回 `0` | 已還原 |
| `chatTemperature`、`embeddingTopK` | `0.3`、`5` | 以相同值寫入 | — | 未改變 |

本機另建立（名稱都帶 `hc-settings-`）：成員 `hc-settings-agent`、`hc-settings-pw`（AGENT）；WebChat 渠道 `hc-settings-WC` 與其測試對話；API 金鑰 2 把（皆已撤銷）；CLI token 3 個（皆已撤銷）。

UAT：只讀，未建立、未修改任何資料。

## 建議新增到 AUDIT.md 的項目

- HC-SETTINGS-01：`officeHours` 為 `{}` 的租戶無法從畫面啟用營業時間（前端崩潰、儲存 400）。修正方向：`getOfficeHours` 以欄位是否齊全判斷，缺的補預設值；前端也做同樣的保護。
- HC-SETTINGS-02：設定頁四個分頁的側欄與頁面不依 `settings.manage` 隱藏，違反 `permission-check` 主規格。
- HC-SETTINGS-03、04：營業時間不驗證時段、日期與時區；時區不合法時自動回覆靜默失效。
- HC-SETTINGS-05：A2A 狀態頁把「有 agent ID」當成「已連線」。
- HC-SETTINGS-06：長效憑證的有效天數沒有上限，過大時 500（可併入 RBAC-02 的修正一起處理）。

## 文件過時之處

- `docs/ref/features/tenant/SETTINGS.md`：
  - 分頁表缺「跨渠道綁定」（`settings` 模組，需要 `settings.manage`）與「門市與核銷帳號」（`store.view`），也沒有說明跨渠道綁定設定。
  - 「稽核」一節的 `payload.section` 清單只有 `office-hours`、`tracking`、`chat`、`embedding`、`gemini-key`，缺 `identity-binding` 與 `webtalk`。
  - 營業時間一節沒寫 `officeHours` 為 `{}` 時的狀況、時段與時區不驗證、跨午夜不支援。
  - 核對日期 2026-09-30。
- `apps/web/public/manual/ch17-settings.html` 第 6 節：「Email 和手機登記不會寄驗證信或簡訊」，email 部分已過時（HC-SETTINGS-07）。
- `apps/web/public/manual/ch17-settings.html` 第 5 節：「格式不對時會跳出提醒，告訴你是哪一個 ID 填錯」，實際只顯示通用訊息（HC-SETTINGS-08）。
