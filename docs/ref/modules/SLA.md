# 服務水準協議（SLA）

SLA 是租戶對工單回應速度的承諾：多久內要有第一次回覆，多久內要結案。系統依承諾計時，接近期限時預警，超過期限時升級優先級並通知人員。

- **資料來源**：`apps/api/src/modules/sla/*`、`apps/workers/src/handlers/sla.handler.ts`、`packages/shared/src/sla/*`、`apps/api/src/modules/case/case.service.ts`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-09-23

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| SLA 的程式碼在哪裡？為什麼不只在一個模組？ | [功能分佈在三個地方](#功能分佈在三個地方) |
| 一條政策能設定什麼？ | [政策的設定項](#政策的設定項) |
| 政策怎麼套到一張工單上？ | [政策如何套用到工單](#政策如何套用到工單) |
| 系統監控哪幾種時限？判定條件是什麼？ | [三種時限](#三種時限) |
| 逾時之後系統做什麼？ | [逾時之後的四個動作](#逾時之後的四個動作) |
| 租戶可以自訂逾時的處理方式嗎？ | [租戶自訂規則](#租戶自訂規則) |
| 現在哪些部分不能用？ | [目前的限制](#目前的限制) |

## 功能分佈在三個地方

讀 `apps/api/src/modules/sla/` 只會看到政策的 CRUD。SLA 的判定與處置不在這個模組裡。

| 位置 | 負責 |
| --- | --- |
| `apps/api/src/modules/sla/` | 政策的建立、查詢、修改、刪除。對應後台 `/dashboard/settings/sla`，權限碼 `sla.manage` |
| `apps/workers/src/handlers/sla.handler.ts` | 掃描工單、判定逾時、升級優先級、發通知、觸發自動化規則 |
| `packages/shared/src/sla/` | 判定用的純函式與常數：`getSlaState()`、`bumpSlaPriority()`、`buildSlaFacts()`、`SLA_EVENT_NAMES` |

`apps/api/src/modules/sla/sla.worker.ts` 是刻意寫成的 no-op。它的註解說明用途：防止 API 行程意外啟動第二個 SLA 掃描器。掃描的責任屬於 `apps/workers` 的 `sla:poll`。

## 政策的設定項

`SlaPolicy` 定義在 `packages/database/prisma/schema.prisma` 的第 823 行起，每個租戶維護自己的一組。

| 欄位 | 意義 |
| --- | --- |
| `name` | 政策名稱。工單記錄的是這個名稱，不是 id，見[目前的限制](#目前的限制) |
| `priority` | 這條政策套用在哪個優先級：`LOW`、`MEDIUM`、`HIGH`、`URGENT` |
| `firstResponseMinutes` | 開單後幾分鐘內必須有第一次回覆 |
| `resolutionMinutes` | 開單後幾分鐘內必須結案 |
| `warningBeforeMinutes` | 期限前幾分鐘發出預警，預設 30 |
| `isDefault` | 標記為該優先級的預設政策 |

## 政策如何套用到工單

`apps/api/src/modules/case/case.service.ts` 建立工單時挑一條政策：

1. 呼叫端有指定 `slaPolicyId` 時，用該 id 查政策。查不到就回 404。
2. 沒有指定時，依工單的 `priority` 查一條政策。

挑到政策之後，`case.service.ts` 寫入兩個欄位：

- `Case.slaDueAt`：現在時間加上 `resolutionMinutes`。
- `Case.slaPolicy`：政策的**名稱字串**。

`Case` 與 `SlaPolicy` 之間沒有外鍵。工單後續要取得政策內容時，都用這個名稱回查。

## 三種時限

`apps/workers` 每 300 秒執行一次 `sla:poll`。每一輪取出狀態為 `OPEN`、`IN_PROGRESS`、`PENDING` 或 `ESCALATED`，而且 `slaPolicy` 不為空的工單，逐一檢查三種時限。

| 時限 | 預警條件 | 逾時條件 | 事件名稱 |
| --- | --- | --- | --- |
| 首次回應 | 距 `createdAt + firstResponseMinutes` 剩下 `warningBeforeMinutes` 以內，且 `firstResponseAt` 仍為空 | 已過該期限，且 `firstResponseAt` 仍為空 | `sla.first_response.warning` / `sla.first_response.breached` |
| 結案 | 距 `Case.slaDueAt` 剩下 `warningBeforeMinutes` 以內 | 已過 `slaDueAt` | `sla.resolution.warning` / `sla.resolution.breached` |
| 客戶枯等 | 無預警 | 最後一則客服回覆之後，客戶累積 3 則以上訊息 | `sla.customer_waiting.breached` |

前兩種時限比對時間，第三種比對對話內容。第三種的計算分三步：

1. 取出該工單底下所有對話。
2. 在這些對話中找出最後一則客服訊息，條件是 `direction` 為 `OUTBOUND` 且 `senderType` 為 `AGENT` 或 `SYSTEM`。
3. 計算該則訊息之後的客戶訊息則數，最多取 20 則。

## 逾時之後的四個動作

`dispatchSlaOutcome()` 依序執行四件事。

1. **去重**。同一張工單、同一種事件，24 小時內已經發生過就直接返回。掃描每 5 分鐘一輪，沒有這道檢查會重複發送。
2. **升級優先級**。只有結案逾時會做。`bumpSlaPriority()` 依 `LOW → MEDIUM → HIGH → URGENT` 推一級，已經是 `URGENT` 就不動。
3. **寫入 `CaseEvent`**。`actorType` 為 `system`，payload 內含事件名稱、升級前後的優先級，以及一整包 facts。
4. **發通知並觸發自動化規則**。

facts 由 `buildSlaFacts()` 組成，包含四類資料：

- 時間：剩餘分鐘數、逾時分鐘數、預警提前分鐘數。
- 工單：狀態、優先級、負責人、團隊、累計逾時次數。
- 聯繫人：是否為 VIP、標籤。
- 對話：最後一次客服回覆時間、最後一則客戶訊息時間、最近一次情緒判定、負面訊息則數。

通知一律送給工單負責人。逾時事件另外送給該租戶的 `ADMIN` 與 `SUPERVISOR`，預警事件則只送給負責人。

## 租戶自訂規則

[逾時之後的四個動作](#逾時之後的四個動作)的第 4 步含一個自動化接點，讓租戶決定預設通知以外的處置。

`evaluateSlaAutomationRules()` 取出該租戶 `eventType` 等於該 SLA 事件名稱、而且 `isActive` 是 `true` 的 `AutomationRule`，依 `priority` 由高到低排序，把 facts 交給 `@open333crm/automation` 的 `evaluateRules()` 比對，再執行命中規則的動作。

租戶因此可以寫出「結案逾時而且聯繫人是 VIP，就指派給特定團隊」這類規則。每種事件開放哪些 fact 由 `getSlaConditionFactsForEvent()` 決定，各事件開放的 fact 不同。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **首次回應 SLA 必定逾時** | `Case.firstResponseAt` 沒有任何程式寫入。客服即使立刻回覆，工單仍會在 `firstResponseMinutes` 到期時判定逾時；分析報表的平均首次回應時間也永遠沒有數值。詳見 `../system/AUDIT.md` 的 SLA-01 |
| 每輪最多掃 100 張工單 | `getActiveCases()` 的 `take: 100` 是全系統共用，不是每個租戶各 100 張。詳見 `../system/AUDIT.md` 的 SLA-02 |
| `isDefault` 沒有讀取端 | 路由維護「同一優先級只有一條預設」，但 `case.service.ts` 挑政策時不看這個欄位。詳見 `../system/AUDIT.md` 的 SLA-03 |
| 改名或刪除政策會讓既有工單脫離監控 | 工單存的是政策名稱，不是外鍵。改名之後 `getPolicy()` 回查不到，`sla.handler.ts` 直接跳過該工單。詳見 `../system/AUDIT.md` 的 SLA-04 |
| 存在第二套掃描機制 | `packages/core/src/cases/case-service.ts` 在模組載入時建立 `sla-monitoring` consumer。任何匯入 `@open333crm/core` 的行程都會產生這個副作用。詳見 `../system/AUDIT.md` 的 APP-01 |
| 路由層沒有 service | `sla.routes.ts` 直接呼叫 `prisma`，是 `AGENTS.md` 模組結構規則 1 的已知例外。CRUD 也沒有測試覆蓋：`sla-contract.test.ts` 測的是 `packages/shared` 的純函式與規則驗證，沒有碰這四條路由 |
