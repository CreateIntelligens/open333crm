# 服務水準協議（SLA）

SLA 是租戶對工單回應速度的承諾：多久內要有第一次回覆，多久內要結案。系統依承諾計時，接近期限時預警，超過期限時升級優先級並通知人員。

- **資料來源**：`apps/api/src/modules/sla/*`、`apps/workers/src/handlers/sla.handler.ts`、`packages/shared/src/sla/*`、`apps/api/src/modules/case/case.service.ts`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-11-19

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| SLA 的程式碼在哪裡？為什麼不只在一個模組？ | [程式碼分佈在哪裡](#程式碼分佈在哪裡) |
| 某個路由或排程由哪個函式處理？ | [程式的入口](#程式的入口) |
| 一條政策能設定什麼？建立、修改、刪除有什麼限制？ | [政策的設定項](#政策的設定項)、[政策的建立、修改與刪除](#政策的建立修改與刪除) |
| 政策怎麼套到一張工單上？ | [政策如何套用到工單](#政策如何套用到工單) |
| 系統監控哪幾種時限？判定條件是什麼？ | [監控的時限](#監控的時限) |
| 逾時之後系統做什麼？ | [逾時之後系統做什麼](#逾時之後系統做什麼) |
| 租戶可以自訂逾時的處理方式嗎？ | [租戶自訂規則](#租戶自訂規則) |
| 營業時間會影響 SLA 計時嗎？ | [營業時間與 SLA](#營業時間與-sla) |
| 報表的 SLA 數字怎麼算？ | [報表的 SLA 數字](#報表的-sla-數字) |
| 畫面上的操作呼叫哪個 API？ | [畫面怎麼呼叫 API](#畫面怎麼呼叫-api) |
| 現在哪些部分不能用？ | [目前的限制](#目前的限制) |

## 程式碼分佈在哪裡

讀 `apps/api/src/modules/sla/` 只會看到政策的 CRUD。SLA 的判定與處置不在這個模組裡。

| 位置 | 負責 |
| --- | --- |
| `apps/api/src/modules/sla/` | 政策的建立、查詢、修改、刪除。對應後台 `/dashboard/settings/sla`，權限碼 `sla.manage` |
| `apps/workers/src/handlers/sla.handler.ts` | 掃描工單、判定逾時、升級優先級、發通知、觸發自動化規則 |
| `packages/shared/src/sla/` | 判定用的純函式與常數：`getSlaState()`、`bumpSlaPriority()`、`buildSlaFacts()`、`SLA_EVENT_NAMES` |

`apps/api/src/modules/sla/sla.worker.ts` 是刻意寫成的 no-op。它的註解說明用途：防止 API 行程意外啟動第二個 SLA 掃描器。掃描的責任屬於 `apps/workers` 的 `sla:poll`。

事件名稱、facts、`bumpSlaPriority()`、`getSlaState()` 只在 `packages/shared/src/sla/` 定義。web、API、workers 都引用這一份，不各自寫門檻。

改工單的優先級、狀態轉換、重新開啟、刪除，或改 `resolvedAt` 的寫法，都會改變 SLA 的判定與報表數字。

## 程式的入口

政策的路由在 `apps/api/src/modules/sla/sla.routes.ts`，前綴是 `/api/v1/sla-policies`。四個路由都要求 `sla.manage`。`sla.flow.ts` 的每個 flow 都是 `flowOf()` 包一個 service 函式。

| 操作 | flow → service 函式（`sla.service.ts`） |
| --- | --- |
| `GET /sla-policies` | `listSlaPoliciesFlow` → `listSlaPolicies()`，依 `priority` 排序 |
| `POST /sla-policies` | `createSlaPolicyFlow` → `createSlaPolicy()` |
| `PATCH /sla-policies/:id` | `updateSlaPolicyFlow` → `updateSlaPolicy()` |
| `DELETE /sla-policies/:id` | `deleteSlaPolicyFlow` → `deleteSlaPolicy()` |
| 建立工單時套用政策 | `case.service.ts` 的 `createCaseRecord()` |
| 寫入首次回應時間 | `conversation.service.ts` 的 `sendMessage()` 呼叫 `markCaseFirstResponse()`；`linkConversationToCase()` 呼叫 `syncFirstResponseFromConversation()` |
| 排程掃描 | `apps/workers/src/lib/repeating-jobs.ts` 每 300 秒排一次 `sla:poll` → `sla.handler.ts` 的 `handleSlaPoll()` → `getActiveCases()` → `getPolicy()` → `dispatchSlaOutcome()` |
| SLA 規則 | `sla.handler.ts` 的 `evaluateSlaAutomationRules()` → `evaluateRules()` → `executeWorkerAutomationActions()` |

## 政策的設定項

`SlaPolicy` 定義在 `packages/database/prisma/schema.prisma` 的 `model SlaPolicy`，每個租戶維護自己的一組。

| 欄位 | 意義 |
| --- | --- |
| `name` | 政策名稱。工單記錄的是這個名稱，不是 id，見[目前的限制](#目前的限制) |
| `priority` | 這條政策套用在哪個優先級：`LOW`、`MEDIUM`、`HIGH`、`URGENT` |
| `firstResponseMinutes` | 開單後幾分鐘內必須有第一次回覆 |
| `resolutionMinutes` | 開單後幾分鐘內必須結案 |
| `warningBeforeMinutes` | 期限前幾分鐘發出預警，預設 30 |
| `isDefault` | 標記為該優先級的預設政策 |

三個分鐘欄位由 `slaMinutesSchema`（`apps/api/src/shared/utils/numeric-bounds.ts`）驗證：正整數，上限 525600（365 天）。API 不做欄位之間的檢查：預警分鐘大於時限、解決時限小於首次回應都能存。預警分鐘大於時限時，工單建立後的第一輪掃描就發預警（HC-SLA-07）。

## 政策的建立、修改與刪除

建立、修改、刪除都先以 `lockTenantSlaPolicies()` 取得租戶層級的交易級 advisory lock，同一個租戶的這三種寫入依序執行。名稱查重與刪除前的工單計數都是「先查再寫」，資料庫也沒有 `(tenantId, name)` 唯一約束，所以靠這把鎖防止並行請求一起通過檢查。`apps/api/tests/feature/modules/sla/sla-policy-concurrency.test.ts` 檢查這個行為。

| 操作 | 行為 |
| --- | --- |
| 建立 | 名稱在租戶內已存在時回 409 `DUPLICATE`。勾 `isDefault` 時，同一個優先級的其他政策改成非預設 |
| 修改 | 改名時，在同一個交易把使用舊名稱的工單 `slaPolicy` 改成新名稱。改名撞名回 409 `DUPLICATE` |
| 刪除 | 有未結案（狀態不是 `RESOLVED`、`CLOSED`）的工單使用這條政策時，回 409 `SLA_POLICY_IN_USE`，`details.openCaseCount` 是工單數。可以刪除時是硬刪除，已結案的工單留下查不到的政策名稱（SLA-04） |

三種操作都不發事件，也不寫租戶稽核。

修改時限對既有工單的效果不一致（HC-SLA-03）：

- 首次回應期限：掃描時以目前政策現算，所以立刻跟著變。
- 解決期限：建單時已寫進 `slaDueAt`，所以不變。

## 政策如何套用到工單

`apps/api/src/modules/case/case.service.ts` 建立工單時挑一條政策：

1. 呼叫端有指定 `slaPolicyId` 時，用該 id 查政策。查不到就回 404。
2. 沒有指定時，查這個優先級的政策：勾了「設為此優先級預設」（`isDefault`）的優先；沒有預設時，取最早建立的一條。
3. 這個優先級沒有任何政策時，工單沒有 SLA：`slaPolicy` 與 `slaDueAt` 都是空值，掃描不處理這張工單。

挑到政策之後，`case.service.ts` 寫入兩個欄位：

- `Case.slaDueAt`：現在時間加上 `resolutionMinutes`。
- `Case.slaPolicy`：政策的**名稱字串**。

`Case` 與 `SlaPolicy` 之間沒有外鍵。工單後續要取得政策內容時，都用這個名稱回查。

工單建立之後，系統不再換政策（HC-SLA-02）。手動改優先級、升級工單、SLA 逾時自動升級、自動化的 `set_case_priority` 都只改 `priority`，`slaPolicy` 與 `slaDueAt` 維持建單時的值。逾時升級之後沒有新的解決期限，所以這張工單之後不再有解決的預警或逾時事件。

## 監控的時限

`apps/workers` 每 300 秒執行一次 `sla:poll`。每一輪取出狀態為 `OPEN`、`IN_PROGRESS`、`PENDING` 或 `ESCALATED`，而且 `slaPolicy` 不為空的工單，逐一檢查下表的時限。

`getActiveCases()` 的條件只有狀態與 `slaPolicy`：

- 每輪最多取 100 張（`take: 100`），沒有 `orderBy`。這 100 張是全系統共用，不是每個租戶各 100 張（SLA-02）。
- 不排除停用（`Tenant.isActive=false`）或已清除試用資料的租戶。停用租戶的未結案工單仍會被升級、寫事件、發通知、執行 SLA 規則（HC-SLA-04）。

`getPolicy()` 以工單的 `slaPolicy` 名稱回查政策。查不到時回 null，這張工單這一輪略過。

所有期限都是 UTC 時間戳記加減分鐘，不受時區影響。只有切日期的地方受時區影響，見[報表的 SLA 數字](#報表的-sla-數字)。

| 時限 | 預警條件 | 逾時條件 | 事件名稱 |
| --- | --- | --- | --- |
| 首次回應 | 距 `createdAt + firstResponseMinutes` 剩下 `warningBeforeMinutes` 以內，且 `firstResponseAt` 仍為空 | 已過該期限，且 `firstResponseAt` 仍為空 | `sla.first_response.warning` / `sla.first_response.breached` |
| 結案 | 距 `Case.slaDueAt` 剩下 `warningBeforeMinutes` 以內 | 已過 `slaDueAt` | `sla.resolution.warning` / `sla.resolution.breached` |
| 客戶枯等 | 無預警 | 最後一則客服回覆之後，客戶累積 3 則以上訊息 | `sla.customer_waiting.breached` |

首次回應與結案比對時間，客戶枯等比對對話內容。

`firstResponseAt` 在下列兩種情況寫入，只採計客服送出的訊息，AI 與系統自動回覆不算：

- 客服在工單關聯的對話送出訊息時（`case.service.ts` 的 `markCaseFirstResponse()`）。早於工單建立時間的訊息不算。
- 把對話掛到既有工單時，取該對話中工單建立後最早的客服訊息。

客戶枯等的計算步驟如下：

1. 取出該工單底下所有對話。
2. 在這些對話中找出最後一則客服訊息，條件是 `direction` 為 `OUTBOUND` 且 `senderType` 為 `AGENT` 或 `SYSTEM`。
3. 計算該則訊息之後的客戶訊息則數，最多取 20 則。

兩種時限對「客服回覆」的定義不同（HC-SLA-06）：首次回應只算 `senderType` 為 `AGENT` 的訊息，客戶枯等也把 `SYSTEM` 訊息當成客服回覆。所以非營業時間自動回覆、CSAT 問卷、關鍵字自動回覆、優惠券與綁定通知都會把客戶枯等的計數歸零。

## 逾時之後系統做什麼

`dispatchSlaOutcome()` 依序執行下列步驟。

1. **去重**。同一個期限只記一次：同一張工單、同一種事件，在去重起點之後已經有紀錄就直接返回。去重起點是期限（逾時）、預警時間點（預警），或上次客服回覆的時間（客戶等待）。掃描每 5 分鐘一輪，沒有這道檢查會重複發送。
2. **升級優先級**。只有結案逾時會做。`bumpSlaPriority()` 依 `LOW → MEDIUM → HIGH → URGENT` 推一級，已經是 `URGENT` 就不動。
3. **寫入 `CaseEvent`**。`actorType` 為 `system`，payload 內含事件名稱、升級前後的優先級，以及一整包 facts。`eventType` 是 `first_response_warning`、`first_response_breached`、`sla_warning`、`sla_breached` 或 `customer_waiting_breached`。
4. **推播**。升級了優先級時，對租戶房間推 `case.updated`（`source: 'sla_worker'`）。每次都對租戶房間推 `sla.event`。
5. **發通知並觸發自動化規則**。

步驟 1 到 3 在同一個交易內執行。交易先以「工單 + 事件類型」取得 advisory lock，再以 `hasCaseEventSince()` 查重，然後寫入。兩個行程同時掃到同一張工單時，只有一個寫入。`apps/workers/tests/unit/handlers/sla-outcome-once.test.ts` 檢查這個行為。

facts 由 `buildSlaFacts()` 組成，包含下列資料：

- 時間：剩餘分鐘數、逾時分鐘數、預警提前分鐘數。
- 工單：狀態、優先級、負責人、團隊、累計逾時次數。
- 聯繫人：是否為 VIP、標籤。
- 對話：最後一次客服回覆時間、最後一則客戶訊息時間、最近一次情緒判定、負面訊息則數。

通知一律送給工單負責人。逾時事件另外送給該租戶角色是 `ADMIN` 與 `SUPERVISOR` 的成員，預警事件則只送給負責人。`enqueueDefaultNotifications()` 把每位收件人的通知放進 workers 的 notification 佇列：

- 工單沒有負責人時，預警沒有人收到。
- 寫入通知前，系統檢查收件成員仍是啟用中。負責人已停用時，這則通知不寫入，也不改發給主管（CONV-06）。

API 行程的 `notification.worker.ts` 訂閱 `sla.warning`、`sla.breached`，但沒有程式發布這兩個事件（APP-05）。

## 租戶自訂規則

[逾時之後系統做什麼](#逾時之後系統做什麼)的「發通知並觸發自動化規則」含一個自動化接點，讓租戶決定預設通知以外的處置。

`evaluateSlaAutomationRules()` 取出該租戶 `eventType` 等於該 SLA 事件名稱、而且 `isActive` 是 `true` 的 `AutomationRule`，依 `priority` 由高到低排序，把 facts 交給 `@open333crm/automation` 的 `evaluateRules()` 比對，再執行命中規則的動作。

租戶因此可以寫出「結案逾時而且聯繫人是 VIP，就指派給特定團隊」這類規則。每種事件開放哪些 fact 由 `getSlaConditionFactsForEvent()` 決定，各事件開放的 fact 不同。

`evaluateSlaAutomationRules()` 傳給 `executeWorkerAutomationActions()` 的 context 只有 `tenantId`、`caseId`、`assigneeId`、`title`，沒有 `contactId`。所以：

- `notify`、`notify_supervisor`（通知類型 `sla_rule`）、`assign_agent`、`set_case_priority`、`escalate_case`、`update_case_status` 會執行。
- `add_tag`、`remove_tag` 一律略過。workers log 寫 `Worker action "add_tag" skipped: no contact in context`（HC-AUTOMATION-02）。

SLA 規則開放新的動作之前，要先確認這個 context 有該動作需要的欄位。

## 營業時間與 SLA

營業時間（`/dashboard/settings/office-hours`，`GET`、`PUT /settings/office-hours`，權限碼 `settings.manage`，`apps/api/src/modules/settings/office-hours.service.ts`）對 SLA 沒有效果（HC-SLA-01）。只有收訊時的非營業時間自動回覆（`apps/api/src/modules/webhook/inbound-side-effects.ts`）讀營業時間。

SLA 以日曆時間連續計算：下班時間、週末、假日都照算，工單在 `PENDING` 狀態也不暫停。系統在非營業時間照樣發逾時通知、升級優先級。系統沒有「SLA 暫停」「依營業時間計時」的設定。

## 報表的 SLA 數字

`/dashboard/analytics`（權限碼 `analytics.view`）的 SLA 數字都由 `apps/api/src/modules/analytics/analytics.service.ts` 計算，只看解決期限 `slaDueAt`。首次回應 SLA 沒有任何統計（HC-SLA-10）。

| 數字 | 算法 |
| --- | --- |
| 總覽的 SLA 達成率 | 報表期間內已解決、而且 `resolvedAt <= slaDueAt` 的工單比例。逾期未結案的工單不計 |
| 案件報表的 SLA 違規表 | 現在已過 `slaDueAt` 的未結案工單，不受報表期間影響 |
| 客服績效的 SLA% | 每位客服已解決的工單中，`resolvedAt <= slaDueAt` 的比例 |
| 我的績效的即將到期 | 寫死 30 分鐘，不讀政策的預警分鐘（HC-CASES-15） |

`resolvedAt` 的規則見[工單](./tenant/CASES.md#解決時間與關閉時間)：直接關閉的工單沒有 `resolvedAt`，重新開啟時清除。

報表依日期分組時以 UTC 切日（ANA-01）。工單統計卡的「今日已解決」以 API 行程的本地時區切日（HC-SLA-12）。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 設定頁「SLA 政策」分頁的列表（`apps/web/src/components/settings/SlaManagement.tsx`） | `GET /sla-policies` | 分頁沒有依權限隱藏。沒有 `sla.manage` 的成員（預設的客服角色沒有）看到「尚未建立 SLA 政策」，錯誤只寫在 console（HC-SLA-09） |
| 「建立 SLA 政策」對話框、列表的鉛筆 | `POST /sla-policies`、`PATCH /sla-policies/:id` | 按鈕沒有依權限隱藏，按儲存才回 403（HC-SLA-09） |
| 列表的垃圾桶 | `DELETE /sla-policies/:id` | 先以 `confirm` 確認。409 `SLA_POLICY_IN_USE` 時以 `alert` 顯示後端的訊息 |
| 建立工單對話框（`apps/web/src/components/case/CaseCreateModal.tsx`）的「SLA 政策」下拉，工單列表與收件匣共用 | 選項讀 `GET /sla-policies`；送出時 `POST /cases`、`POST /conversations/:id/case` 帶 `slaPolicyId` | 建單要求 `case.create`，但下拉要求 `sla.manage`。沒有 `sla.manage` 時，`GET` 回 403，下拉沒有提示地變成空的，成員無法指定政策（HC-SLA-09） |
| 工單列表的 SLA 欄與篩選、詳情頁、統計卡（`apps/web/src/components/shared/SlaCountdown.tsx`、`CaseDashboardStats.tsx`） | `GET /cases?slaStatus=`、`GET /cases/stats`、`GET /cases/:id`（回應含 `slaPolicyData`） | 要求 `case.view`。只看解決期限。「即將到期」的門檻：倒數元件寫死 120 分鐘，列表篩選與統計卡寫死 30 分鐘，都不讀政策的預警分鐘（HC-CASES-15） |
| 自動化規則編輯器選 `sla.*` 事件 | 自動化規則的 API | 要求 `automation.*` 權限碼。動作的限制見[租戶自訂規則](#租戶自訂規則) |

四個政策端點都有畫面入口。

前端送出的值：

- 優先級：`URGENT`、`HIGH`、`MEDIUM`、`LOW`。
- 三個分鐘欄位：以 `parseInt(...) || 預設值` 送出。填 0 或留空時，首次回應送 15、解決送 60、預警送 10，畫面沒有提示（HC-SLA-08）。後端「必須大於 0」的錯誤因此從畫面上碰不到。負數照原值送出；小數被 `parseInt` 截成整數。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **沒有關聯對話的工單，首次回應 SLA 必定逾時** | `Case.firstResponseAt` 只在客服於工單關聯的對話送出訊息時寫入。手動建立、沒有關聯對話的工單永遠沒有這個值。詳見 `../system/AUDIT.md` 的 SLA-05 |
| 計時不扣營業時間與假日 | 期限是工單的建立時間加上政策的分鐘數，半夜與假日照常計時。見健檢 HC-SLA-01 |
| 改優先級不重算期限 | `slaDueAt` 只在建立工單時計算。之後成員改優先級時，系統不換政策，也不改期限。見健檢 HC-SLA-02 |
| SLA 規則不能貼標 | workers 執行 SLA 事件的規則時沒有傳入聯絡人，「新增標籤」「移除標籤」動作一律略過。見健檢 HC-AUTOMATION-02 |
| 預警只通知負責人 | 工單沒有負責人，或負責人已停用時，預警沒有人收到 |
| 政策的增刪改不寫稽核 | `sla` 模組沒有寫租戶稽核 |
| 每輪最多掃 100 張工單 | `getActiveCases()` 的 `take: 100` 是全系統共用，不是每個租戶各 100 張。詳見 `../system/AUDIT.md` 的 SLA-02 |
| 工單以政策名稱連結政策 | 工單存的是政策名稱，不是外鍵。改名會同步更新工單、使用中的政策不能刪除、名稱不可重複（`sla.service.ts`），但資料庫沒有關聯與唯一約束。詳見 `../system/AUDIT.md` 的 SLA-04 |
