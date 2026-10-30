# SLA 與營業時間 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e（本機 worktree，比 origin/main 落後 14 個 portal 相關 commit，與本領域無關）
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，workers 以 `tsx watch` 執行，每 300 秒一輪 `sla:poll`）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，以 `/auth/me` 確認，只讀）
- 規格：`docs/ref/features/feature-map.json` 的 `sla`；功能文件 `docs/ref/features/SLA.md`
- 範圍：SLA 政策 CRUD、工單套用政策、首次回應與解決期限的計時、客戶枯等、逾時處置與通知、SLA 事件觸發的自動化規則、`sla:poll` 排程、報表中的 SLA 數字、營業時間對 SLA 計時的效果。營業時間設定頁本身的儲存屬 settings 領域；工單倒數元件的顯示屬 cases 領域，這裡只引用

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 本領域相關 4 份 spec、41 個 scenario（`sla-policy-selection` 5；`standalone-worker-runtime` 的 SLA 相關 17；`automation-engine` 的 SLA 相關 14；`core-inbox` 的建單選政策 3；另有 `automation-contract-composer` 1、`office-hours-settings` 2 不計）。缺實作 0 個，但 2 個 scenario 的實作與規格要求不一致（「SLA rule action runs after match」、「Web displays SLA countdown」，見下方）。以 scenario 名稱找同名測試，`sla-policy-selection` 5／5 有、`standalone-worker-runtime` 3／17 有（其餘只有讀原始碼字串的測試）、`automation-engine` 0／14。缺前端入口 0 |
| 自動測試 | unit：api 3 檔 16 通過、workers 1 檔 5 通過、web 4 檔 9 通過。feature：`modules/sla` 1 檔 1 通過。無失敗、無 skip、無 `test.fail` |
| 實際操作 | 12 條流程。正常 5，異常 6，待真機驗 1 |

## 問題清單（依嚴重度）

P0、P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-SLA-01 | P2 | **SLA 以日曆時間連續計算，不扣營業時間、假日，也不在「待處理（PENDING）」時暫停。** 營業時間只影響收訊的非營業時間自動回覆。下班後、週末、假日建的工單照樣逾時，系統在非營業時間發逾時通知、自動升級優先級。手冊 ch17 已寫明（`<!-- KNOWN-ISSUE -->`），功能文件與 AUDIT 都沒有記錄 | **實測（本機）**：營業時間設成啟用、週一到五 09:00–10:00、`holidays: ["2026-10-30"]`（當天週五，台灣時間 13:39）→ 建 HIGH 工單（政策解決 240 分、首回 60 分）→ `slaDueAt` = 建立時間 + 240 分，與營業時間無關；把工單時間往前調後，下一輪掃描在台灣時間 13:45（假日、非營業時間）寫入逾時事件、升級為 URGENT、通知 admin 與 supervisor | `apps/api/src/modules/case/case.service.ts:289`；`apps/workers/src/handlers/sla.handler.ts:400`（`getSlaDeadlineFromCreatedAt`）；`apps/api/src/modules/settings/office-hours.service.ts` 只被 `apps/api/src/modules/webhook/inbound-side-effects.ts:172` 讀取 | 新 |
| HC-SLA-02 | P2 | **工單優先級改變後不重新套用 SLA 政策。** 手動改優先級、升級工單、SLA 逾時自動升級、自動化 `set_case_priority` 都只改 `priority`，`slaPolicy` 與 `slaDueAt` 維持建單時的值。升成緊急的工單仍以低／中優先的時限計時；逾時升級後也沒有新的期限，之後不會再有預警或逾時事件 | **實測（本機）**：建 MEDIUM 工單（套用 MEDIUM 政策，解決 60 分）→ `PATCH /cases/:id {priority:"HIGH"}` → `slaPolicy`、`slaDueAt` 不變。LOW 工單逾時被升為 MEDIUM 後，`slaPolicy` 仍是 LOW 政策。**實測（UAT Demo，只讀）**：10 張工單中 7 張 `priority=URGENT`、`slaPolicy="中優先"`、`slaDueAt` 為建單 + 1440 分；其中一張的時間軸顯示 10/07 MEDIUM→HIGH、10/08 HIGH→URGENT（2026-10-15 前每天重升，見下方「AUDIT 項目現況」） | `apps/api/src/modules/case/case.service.ts:861-866`（`updateCase` 只改欄位）、`escalateCase`；`apps/workers/src/handlers/sla.handler.ts:457`（`applyPriorityBump`）；`apps/workers/src/lib/automation-actions.ts` 的 `set_case_priority` | 新 |
| HC-AUTOMATION-02 | P2 | SLA 規則的動作沒有 `contactId`：契約允許的「新增標籤」「移除標籤」在 SLA 規則永遠被略過 | **實測（本機）**：建規則「`sla.resolution.breached` 且 `case.id` = 測試工單 → `add_tag` + `notify_supervisor`」→ 工單逾時後 workers log 出現 `Worker action "add_tag" skipped: no contact in context`，標籤沒有建立也沒有貼上；`notify_supervisor` 有寫出 2 筆 `sla_rule` 通知。facts 裡也沒有 `contact.id` | `apps/workers/src/handlers/sla.handler.ts:253-258`；`apps/workers/src/lib/automation-actions.ts:321` | HC-AUTOMATION-02（已由自動化領域記錄，本次實測確認） |
| HC-SLA-03 | P3 | 修改政策時限，對既有工單的效果不一致：首次回應期限每輪以目前政策現算，**立刻**跟著變；解決期限在建單時寫進 `slaDueAt`，**不會**變。畫面沒有說明 | 讀程式 | `apps/workers/src/handlers/sla.handler.ts:400`（現算）；`apps/api/src/modules/case/case.service.ts:289`（建單時固定） | 新 |
| HC-SLA-04 | P3 | 掃描不排除停用（`Tenant.isActive=false`）或已清除試用資料的租戶：停用租戶的未結案工單仍會被升級優先級、寫事件、發通知、跑 SLA 規則。登入、收訊已擋停用租戶 | 讀程式（停用 Demo 租戶會影響其他代理，沒有實測） | `apps/workers/src/handlers/sla.handler.ts:45-72`（`where` 只有 status 與 `slaPolicy`） | 新（與 SLA-02「不分租戶」同一處） |
| HC-SLA-05 | P3 | 同一輪掃描內，解決逾時先把優先級升一級，之後的「客戶枯等」事件仍用升級前的優先級組 facts 與 payload。以 `case.priority` 為條件的客戶枯等規則會用到舊值 | **實測（本機）**：LOW 工單同一輪寫出 `sla_breached`（LOW→MEDIUM，facts `case.priority=MEDIUM`）與 `customer_waiting_breached`（facts `case.priority=LOW`），此時工單已是 MEDIUM | `apps/workers/src/handlers/sla.handler.ts:485-505`（沿用迴圈開頭的 `c`） | 新 |
| HC-SLA-06 | P3 | 客戶枯等把 `SYSTEM` 訊息也當成「客服回覆」：非營業時間自動回覆、CSAT 問卷、關鍵字自動回覆、優惠券與綁定通知都會把計數歸零。首次回應則只算 `AGENT`，兩個定義不一致 | 讀程式（功能文件已照實寫出，但沒說明後果） | `apps/workers/src/handlers/sla.handler.ts:159`；`SYSTEM` 寫入點如 `apps/api/src/modules/webhook/inbound-side-effects.ts:194`、`apps/api/src/modules/csat/csat.service.ts:117` | 新 |
| HC-SLA-07 | P3 | 政策時限沒有交叉驗證：預警分鐘大於時限、解決時限小於首次回應都能存。預警大於時限時，建單當下就發「即將逾期」 | **實測（本機）**：`POST /sla-policies {firstResponseMinutes:10, resolutionMinutes:5, warningBeforeMinutes:600}` 回 201；用它建單，下一輪同時寫出 `first_response_warning` 與 `sla_warning` | `apps/api/src/modules/sla/sla.routes.ts:9-16` | 新 |
| HC-SLA-08 | P3 | 設定頁表單把 0 與空白靜默換成預設值：首次回應填 0 存成 15、解決留空存成 60、預警填 0 存成 10，沒有任何提示。後端「必須大於 0」的訊息從畫面上碰不到 | **實測（本機，Playwright）**：建立對話框填 0／空白／0 → 實際送出 `{"firstResponseMinutes":15,"resolutionMinutes":60,"warningBeforeMinutes":10}`，回 201 | `apps/web/src/components/settings/SlaManagement.tsx:119-121` | 新 |
| HC-SLA-09 | P3 | 沒有 `sla.manage` 的成員（seed agent 角色預設沒有）：設定頁仍有「SLA 政策」分頁與「建立 SLA 政策」按鈕；列表 403 時顯示「尚未建立 SLA 政策」，看起來像租戶沒有政策；按儲存才 403。建立工單對話框的「SLA 政策」下拉也因 403 靜默變空，agent 無法替工單指定政策 | **實測（本機，agent）**：分頁可見、`GET /sla-policies` 403、畫面「尚未建立 SLA 政策」、`POST` 403。建單下拉為讀程式 | `apps/web/src/app/dashboard/settings/page.tsx:29, 61`（分頁沒有 `perm`）；`SlaManagement.tsx:74`（只 `console.error`）；`apps/web/src/components/case/CaseCreateModal.tsx:120`（`.catch(() => [])`） | 新 |
| HC-SLA-10 | P3 | 報表的 SLA 只有解決時限：總覽「SLA 達成率」只算期間內已解決的工單，逾期未結案的不計；首次回應 SLA 沒有任何統計；案件報表「SLA 違規」與統計卡「逾期」只看 `slaDueAt`，首次回應逾期的工單不出現；違規表永遠是「現在逾期的未結案工單」，不受報表期間影響 | **實測（本機）**：有 1 張首次回應與解決都已逾期的未結案工單時，總覽 `slaAchievementRate: null`，`/cases/stats` 的 `breachedCount: 1` 只因解決期限 | `apps/api/src/modules/analytics/analytics.service.ts:76-93, 282-294` | 新（日期切分見 ANA-01；`resolvedAt` 維護見 HC-ANALYTICS-02） |
| HC-SLA-11 | P3 | `PATCH /sla-policies/abc`（非 UUID）回 400 `DATABASE_ERROR`「資料處理失敗」，不是欄位驗證錯誤。不存在的 UUID 正確回 404 | **實測（本機）** | `apps/api/src/modules/sla/sla.routes.ts:44`、`DELETE` 同 | 新（與 HC-CONTACTS-13 同型） |
| HC-SLA-12 | P3 | 工單統計卡「今日已解決」以 API 行程的本地時區切日（`new Date(y, m, d)`）。UAT 容器是 UTC，台灣時間早上 8 點才換日；本機 macOS 是台灣時間，所以本機看不出來 | 讀程式 | `apps/api/src/modules/case/case.service.ts:776` | 新（與 ANA-01 同一類） |
| SLA-05 | P2 | 沒有關聯對話的工單永遠沒有首次回應時間，必定判定首次回應逾時 | 讀程式，仍未修。工單列表「建立工單」建的都屬這種。本機實測：從對話建單、客服回覆後 `firstResponseAt` 正確寫入（SLA-01 的修正有效） | `case.service.ts` 的 `createCase` | SLA-05（已記錄） |
| SLA-02 | P2 | 掃描每輪全系統上限 100 張、沒有 `orderBy`、不分租戶 | 讀程式，仍未修 | `apps/workers/src/handlers/sla.handler.ts:71` | SLA-02（已記錄） |
| HC-CASES-15 | P3 | 「即將到期」門檻三處不同（倒數 120 分、篩選與統計卡 30 分），都不讀政策的預警分鐘。違反 automation-engine「Shared SLA Domain Semantics／Web displays SLA countdown」 | 讀程式，與 cases 領域結論一致；「我的績效」的即將到期也是寫死 30 分（`analytics.service.ts:595`） | `apps/web/src/components/shared/SlaCountdown.tsx:53` | HC-CASES-15（cases 領域） |
| HC-NOTIFICATIONS-02 | P2 | SLA 通知不檢查負責人是否停用 | 讀程式，與通知領域結論一致 | `apps/workers/src/handlers/sla.handler.ts:205` | HC-NOTIFICATIONS-02（通知領域） |
| APP-05 | P4 | API 行程訂閱 `sla.warning`、`sla.breached`，沒有發布端 | 讀程式，仍未修 | `apps/api/src/modules/notification/notification.worker.ts` | APP-05（已記錄） |

### AUDIT 項目現況

| 項目 | 現況 |
| --- | --- |
| SLA-01（首次回應沒有寫入端，已修） | **實測確認修正有效**：從對話建單後，客服在該對話回覆，`firstResponseAt` 立即寫入，下一輪不再判首次回應逾時 |
| SLA-03（`isDefault` 沒有讀取端，已修） | **實測確認**：同優先級有預設政策時，建單不指定政策會套用預設政策 |
| SLA-04（部分修正） | **實測確認部分修正**：同名 409 `DUPLICATE`；改名後未結案工單的 `slaPolicy` 跟著改；有未結案工單時刪除回 409 `SLA_POLICY_IN_USE`、`details.openCaseCount: 1`。資料庫仍無外鍵與唯一約束 |
| `fix-sla-outcome-repeat`（2026-10-15） | **本機與 UAT 都確認有效**。本機：逾時事件寫一次後，後續各輪不再重寫；客服回覆後客戶再連送 3 則，才再記一次客戶枯等。UAT Demo 一張 10/05 的工單，10/06–10/15 每天各一筆 `sla_breached` 與 `first_response_breached`（優先級從 MEDIUM 一路升到 URGENT），10/15 之後沒有新事件 |
| SLA-05 的敘述 | 「去重的區間是 24 小時，工單沒有結案前每 24 小時再發一次」已過時：現在同一個期限只記一次 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 政策列表 | 本機、UAT | 正常：本機建立後列表顯示、分鐘換算成「1 小時」「4 小時」；UAT Demo 顯示 4 條政策（中優先為預設），與 API 一致 | — | **異常**：agent 403 時顯示「尚未建立 SLA 政策」（HC-SLA-09） | |
| 2 建立政策 | 本機 | 正常：建立、勾預設 → 同優先級只剩一條預設 | 同名 409「已有名為…」；空白名稱、`priority:"CRITICAL"`、0、小數、字串、超過 525600 都回 400 並帶欄位訊息 | 後端 403 `requiredPermission: sla.manage` 正常；前端不隱藏（HC-SLA-09） | **異常**：預警大於時限可存（HC-SLA-07）；畫面填 0／空白被換成預設值（HC-SLA-08） |
| 3 編輯、改名 | 本機 | 正常：改名後用到它的未結案工單 `slaPolicy` 同步 | 非 UUID 400 `DATABASE_ERROR`（HC-SLA-11） | 同上 | 改時限對既有工單效果不一致（HC-SLA-03，讀程式） |
| 4 刪除 | 本機 | 正常：沒有工單使用時刪除成功 | 使用中 409 `SLA_POLICY_IN_USE`；不存在的 UUID 404 | 同上 | |
| 5 建單套用政策 | 本機 | 正常：HIGH 不指定 → 套用預設；`slaDueAt` = 建立 + 解決分鐘 | 該優先級沒有政策時沒有 SLA（URGENT） | agent 的建單下拉靜默變空（HC-SLA-09，讀程式） | **異常**：改優先級不重新套用（HC-SLA-02，本機與 UAT） |
| 6 倒數、篩選、統計卡 | 本機 | `/cases/stats` 的 `breachedCount` 正確計入逾期工單 | — | — | 顯示屬 cases 領域；門檻不一致見 HC-CASES-15；「今日已解決」時區見 HC-SLA-12 |
| 7 首次回應寫入 | 本機 | 正常：對話建單 → 客服回覆 → `firstResponseAt` 寫入；之後不再判首次回應逾時 | — | — | 沒有關聯對話的工單見 SLA-05 |
| 8 排程掃描 | 本機 | 正常：每 300 秒一輪；首次回應預警、首次回應逾時、解決預警、解決逾時、客戶枯等五種都實際寫出 | — | — | 不分租戶、上限 100（SLA-02）、不排除停用租戶（HC-SLA-04，讀程式） |
| 9 逾時處置與通知 | 本機、UAT（只讀） | 正常：解決逾時升一級；預警只通知負責人（測試工單無負責人，所以沒有通知）、逾時通知 admin 與 supervisor；中文標題；同一期限只記一次 | — | — | **異常**：同輪 facts 用舊優先級（HC-SLA-05）；營業時間外照樣通知（HC-SLA-01） |
| 10 SLA 規則 | 本機 | `notify_supervisor` 正常 | — | — | **異常**：`add_tag` 被略過（HC-AUTOMATION-02，實測） |
| 11 報表 | 本機 | 總覽、案件報表、統計卡可讀 | — | 報表權限與渠道範圍見 HC-ANALYTICS-03 | **異常**：只有解決時限、沒有首次回應統計（HC-SLA-10） |
| 12 營業時間對 SLA 的效果 | 本機 | — | — | — | **異常**：沒有效果（HC-SLA-01）。非營業時間自動回覆本身要真實渠道收訊才會觸發（模擬器不走這條），列待真機驗 |

權限測試用的角色：admin、supervisor（預設有 `sla.manage`）、seed agent（沒有 `sla.manage`）。supervisor 與 admin 的 SLA 權限相同，只以 API 確認 `GET /sla-policies` 200。

## 完備度對照

| Spec / Requirement | Scenario 數 | 實作 | 同名測試 | 前端入口 |
| --- | --- | --- | --- | --- |
| sla-policy-selection／建立工單時優先套用預設政策 | 2 | 有（`case.service.ts` `createCaseRecord`） | 2（`case-sla-default.test.ts`） | 建單對話框 |
| sla-policy-selection／名稱不可重複 | 1 | 有 | 1（unit）＋並行 1（feature） | 設定頁 |
| sla-policy-selection／改名時工單繼續計時 | 1 | 有 | 1 | 設定頁 |
| sla-policy-selection／使用中的政策不能刪除 | 2 | 有 | 2 | 設定頁（alert 顯示原因） |
| standalone-worker-runtime／SLA Polling as Repeating BullMQ Job | 4 | 有（`apps/workers/src/lib/repeating-jobs.ts`、`apps/api/src/modules/sla/sla.worker.ts` no-op） | 1（`api startup does not register sla scanner`） | 系統 |
| standalone-worker-runtime／Worker-Originated SLA Notification Dispatch | 5 | 有 | 0（`worker sla notification paths are present` 只讀原始碼字串）；本次實測 4 種 | 系統 |
| standalone-worker-runtime／Worker SLA Event Distribution、Dispatch、Socket Path B | 5 | 有 | 0 | 系統 |
| standalone-worker-runtime／SLA Outcome Recorded Once Per Deadline | 3 | 有 | 3（`sla-outcome-once.test.ts`） | 系統 |
| automation-engine／SLA Event Catalog | 5 | 有 | 0（`sla contract metadata` 涵蓋） | 規則編輯器 |
| automation-engine／SLA Automation Facts | 5 | 有，但「SLA rule action runs after match」要求「same action semantics as other automation triggers」，SLA 路徑沒有 contactId（HC-AUTOMATION-02） | 0 | 規則編輯器 |
| automation-engine／Shared SLA Domain Semantics | 4 | 部分：「Web displays SLA countdown」要求網頁的預警狀態與後端一致，倒數元件寫死 120 分（HC-CASES-15） | 0 | 工單列表、詳情 |
| core-inbox／Inbox Case Creation SLA Policy Selection | 3 | 有 | 0 | 收件匣建單對話框（沒有 `sla.manage` 時下拉為空，HC-SLA-09） |

**有後端、沒有前端入口**：無。**前端呼叫、後端不存在**：無。

**前端送出的值與後端 Zod**：priority 四個值後端都接受；分鐘欄位前端以 `parseInt || 預設` 送出，0 與空白不會送到後端（HC-SLA-08），負數與超過上限會送出並被後端 400 擋下，錯誤訊息顯示在對話框內。

## 待真機驗

- 非營業時間自動回覆在真實 LINE／FB 收訊時的行為，以及它對「客戶枯等」計數的影響（HC-SLA-06）。模擬器不走 `sendOutsideHoursAutoReply`。
- SLA 通知在瀏覽器的即時呈現（socket `sla.event`、通知鈴鐺），本次只查資料庫的 `notifications`。

## 給其他領域的觀察

- **settings**：`PUT /settings/office-hours` 接受不存在的時區（`"Mars/Base"`）、結束早於開始的班表（`18:00–09:00`）、格式錯誤的假日（`"2026/10/30"`、`"abc"`），都回 200（本機實測，已還原）。不存在的時區會讓 `isWithinOfficeHours` 的 `Intl.DateTimeFormat` 丟 `RangeError`，收訊端有 try/catch，結果是非營業時間自動回覆默默停止；跨夜班表永遠判為非營業；格式錯的假日永遠比對不到。另外 `TenantSettings.officeHours` 的 schema 預設是 `{}`，`getOfficeHours` 對已存在的列直接回 `{}`，前端拿到的是沒有 `schedule` 的物件（本機 Demo 租戶原值就是 `{}`）。

## 操作紀錄

**UAT**：只讀（登入、`/auth/me` 確認 Demo 租戶、`GET /sla-policies`、`GET /settings/office-hours`、`GET /cases`、`GET /cases/stats`、一張工單的時間軸、開設定頁兩個分頁截圖）。建立 0 筆、刪除 0 筆，沒有改任何設定。

**本機**（資料名稱前綴 `hc-sla-`）：
- SLA 政策 4 條：已全部刪除。Demo 租戶原本沒有政策，現在也沒有。
- 工單 3 張：已刪除。其中 1 張以 psql 調整 `createdAt`、`slaDueAt` 以觸發逾時。
- 自動化規則 1 條「hc-sla-逾時貼標」（條件限定測試工單 id）：已刪除（API 為軟刪除，資料列 `isActive=false` 保留）。
- 站內通知：測試產生的 26 筆（標題或內容含 `hc-sla`）已以 psql 刪除。
- 營業時間：測試時改成啟用＋假日，之後以 psql 還原為原值 `officeHours = {}`、`timezone = Asia/Taipei`（API 無法寫回 `{}`）。過程留下 3 筆 `settings.update` 租戶稽核紀錄。
- 保留：模擬器建立的 WebChat 聯絡人「hc-sla-枯等客」與其對話（7 則客戶訊息、1 則客服回覆），系統沒有刪除聯絡人的 API。

## 建議新增到 AUDIT.md 的項目

- HC-SLA-01：SLA 不扣營業時間、假日、PENDING（產品決策或功能缺口；手冊已寫，AUDIT 與功能文件沒有）。
- HC-SLA-02：優先級改變不重新套用 SLA 政策；UAT 已有 7 張「緊急」工單掛「中優先」期限。
- HC-SLA-04：SLA 掃描不排除停用租戶（可併入 SLA-02 一起改 `getActiveCases`）。
- HC-SLA-10：報表沒有首次回應 SLA、達成率不計逾期未結案工單、違規表不受期間影響。
- HC-SLA-03、HC-SLA-05、HC-SLA-06、HC-SLA-07：計時語意的小問題，可合成一項「SLA 計時語意不一致」。
- SLA-05 的敘述更新：去重已改成同一期限一次（`fix-sla-outcome-repeat`）。

## 文件過時之處

- `docs/ref/features/SLA.md`
  - 「逾時之後系統做什麼」第 1 步寫「同一張工單、同一種事件，24 小時內已經發生過就直接返回」：已改成以期限、預警時間點或上次客服回覆為起點，同一期限只記一次，並以 advisory lock 防並行重寫。
  - 「政策如何套用到工單」第 2 步寫「依工單的 priority 查一條政策」：程式是該優先級勾了預設的優先，沒有預設取最早建立的（主規格 `sla-policy-selection`）。
  - 「目前的限制」沒有：不扣營業時間與假日（HC-SLA-01）、優先級改變不重算（HC-SLA-02）、SLA 規則不能貼標（HC-AUTOMATION-02）、預警只通知負責人（沒有負責人時無人收到）。
  - 沒提政策 CRUD 不寫租戶稽核。
- `docs/ref/system/AUDIT.md` SLA-05：「去重的區間是 24 小時，工單沒有結案前每 24 小時再發一次」已過時。
- `apps/web/tests/e2e-uat/tenant-settings-ops.spec.ts` 開頭註解寫 `DELETE /sla-policies/:id` 直接硬刪、在 `sla.routes.ts` 處理：刪除已移到 `sla.service.ts`，使用中的政策會回 409。
