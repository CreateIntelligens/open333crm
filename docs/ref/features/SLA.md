# 服務水準協議（SLA）

SLA 是租戶對工單回應速度的承諾：多久內要有第一次回覆，多久內要結案。系統依承諾計時，接近期限時預警，超過期限時升級優先級並通知人員。

- **資料來源**：`apps/api/src/modules/sla/*`、`apps/workers/src/handlers/sla.handler.ts`、`packages/shared/src/sla/*`、`apps/api/src/modules/case/case.service.ts`、`packages/database/prisma/schema.prisma`
- **核對日期**：2026-11-09

## 這份文件回答的問題

| 問題 | 章節 |
| --- | --- |
| SLA 的程式碼在哪裡？為什麼不只在一個模組？ | [程式碼分佈在哪裡](#程式碼分佈在哪裡) |
| 一條政策能設定什麼？ | [政策的設定項](#政策的設定項) |
| 政策怎麼套到一張工單上？ | [政策如何套用到工單](#政策如何套用到工單) |
| 系統監控哪幾種時限？判定條件是什麼？ | [監控的時限](#監控的時限) |
| 逾時之後系統做什麼？ | [逾時之後系統做什麼](#逾時之後系統做什麼) |
| 租戶可以自訂逾時的處理方式嗎？ | [租戶自訂規則](#租戶自訂規則) |
| 現在哪些部分不能用？ | [目前的限制](#目前的限制) |
| 時間軸與通知留著 #281 前每天重複的 SLA 事件，怎麼清？ | [清除 #281 前的重複事件](#清除-281-前的重複事件) |

## 程式碼分佈在哪裡

讀 `apps/api/src/modules/sla/` 只會看到政策的 CRUD。SLA 的判定與處置不在這個模組裡。

| 位置 | 負責 |
| --- | --- |
| `apps/api/src/modules/sla/` | 政策的建立、查詢、修改、刪除。對應後台 `/dashboard/settings/sla`，權限碼 `sla.manage` |
| `apps/workers/src/handlers/sla.handler.ts` | 掃描工單、判定逾時、升級優先級、發通知、觸發自動化規則 |
| `packages/shared/src/sla/` | 判定用的純函式與常數：`getSlaState()`、`bumpSlaPriority()`、`buildSlaFacts()`、`SLA_EVENT_NAMES` |

`apps/api/src/modules/sla/sla.worker.ts` 是刻意寫成的 no-op。它的註解說明用途：防止 API 行程意外啟動第二個 SLA 掃描器。掃描的責任屬於 `apps/workers` 的 `sla:poll`。

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

## 政策如何套用到工單

`apps/api/src/modules/case/case.service.ts` 建立工單時挑一條政策：

1. 呼叫端有指定 `slaPolicyId` 時，用該 id 查政策。查不到就回 404。
2. 沒有指定時，依工單的 `priority` 查一條政策。

挑到政策之後，`case.service.ts` 寫入兩個欄位：

- `Case.slaDueAt`：現在時間加上 `resolutionMinutes`。
- `Case.slaPolicy`：政策的**名稱字串**。

`Case` 與 `SlaPolicy` 之間沒有外鍵。工單後續要取得政策內容時，都用這個名稱回查。

## 監控的時限

`apps/workers` 每 300 秒執行一次 `sla:poll`。每一輪取出狀態為 `OPEN`、`IN_PROGRESS`、`PENDING` 或 `ESCALATED`，而且 `slaPolicy` 不為空的工單，逐一檢查下表的時限。

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

## 逾時之後系統做什麼

`dispatchSlaOutcome()` 依序執行下列步驟。

1. **去重**。同一個期限只記一次：同一張工單、同一種事件，在去重起點之後已經有紀錄就直接返回。去重起點是期限（逾時）、預警時間點（預警），或上次客服回覆的時間（客戶等待）。掃描每 5 分鐘一輪，沒有這道檢查會重複發送。2026-10-15（#281）之前是「24 小時內發生過就返回」，逾時的工單每天重寫一次時間軸、重發一次通知，舊資料用[一次性腳本](#清除-281-前的重複事件)清除。
2. **升級優先級**。只有結案逾時會做。`bumpSlaPriority()` 依 `LOW → MEDIUM → HIGH → URGENT` 推一級，已經是 `URGENT` 就不動。
3. **寫入 `CaseEvent`**。`actorType` 為 `system`，payload 內含事件名稱、升級前後的優先級，以及一整包 facts。
4. **發通知並觸發自動化規則**。

facts 由 `buildSlaFacts()` 組成，包含下列資料：

- 時間：剩餘分鐘數、逾時分鐘數、預警提前分鐘數。
- 工單：狀態、優先級、負責人、團隊、累計逾時次數。
- 聯繫人：是否為 VIP、標籤。
- 對話：最後一次客服回覆時間、最後一則客戶訊息時間、最近一次情緒判定、負面訊息則數。

通知一律送給工單負責人。逾時事件另外送給該租戶的 `ADMIN` 與 `SUPERVISOR`，預警事件則只送給負責人。

## 租戶自訂規則

[逾時之後系統做什麼](#逾時之後系統做什麼)的「發通知並觸發自動化規則」含一個自動化接點，讓租戶決定預設通知以外的處置。

`evaluateSlaAutomationRules()` 取出該租戶 `eventType` 等於該 SLA 事件名稱、而且 `isActive` 是 `true` 的 `AutomationRule`，依 `priority` 由高到低排序，把 facts 交給 `@open333crm/automation` 的 `evaluateRules()` 比對，再執行命中規則的動作。

租戶因此可以寫出「結案逾時而且聯繫人是 VIP，就指派給特定團隊」這類規則。每種事件開放哪些 fact 由 `getSlaConditionFactsForEvent()` 決定，各事件開放的 fact 不同。

## 清除 #281 前的重複事件

#281（2026-10-15）之前的去重以 24 小時為窗，逾時的工單每天多一筆時間軸事件，負責人與主管每天多收一則通知。新的事件不再重複，舊資料由 `scripts/dedupe-sla-events.mjs` 一次清除（issue #320）。SQL 在 `scripts/sql/dedupe-sla-events.sql`。

### 清除規則

| 對象 | 規則 |
| --- | --- |
| 時間軸（`case_events`） | `actorType` 為 `system` 的五種事件：`first_response_breached`、`first_response_warning`、`sla_breached`、`sla_warning`、`customer_waiting_breached`。同一張工單、同一種事件、同一個期限 key 只留最早一筆（依 `createdAt`、`id` 排序）。期限 key：逾時類用 `facts['sla.dueAt']`；預警類再加 `facts['sla.warningBeforeMinutes']`；客戶等待用 `facts['case.lastAgentReplyAt']`，沒有值（客服從未回覆）也算一組。期限改變或客服回覆後重新計算的那幾筆會留下 |
| 通知（`notifications`） | #281 前的英文標題預設通知：`First response SLA breached`、`First response SLA warning`、`Resolution SLA breached`、`Resolution SLA warning`、`Customer waiting SLA breached`。只刪對應到「要刪除的重複時間軸事件」的那幾則。舊程式寫完事件才把通知丟進佇列，所以依工單（從 `clickUrl` 取出）、類型（等於 `eventType`）與時間（事件前 1 分鐘到後 5 分鐘）配對到最近的事件；每筆被刪事件、每位成員最多刪一則。對應到保留事件的通知（不同期限週期、客服回覆後重算、重開工單）與配對不到事件的通知都不動。中文標題與自動化規則的通知不處理 |
| 不處理 | `--cutoff` 之後寫入的列；payload 沒有上述 facts key 的舊列（更早的版本沒有寫 facts） |

### 副作用

工單的 `sla.breachCount` 與 `sla.escalationLevel` 是逾時類事件的筆數。清除後，未結案工單的這兩個數字會變小，依它們判斷的自動化規則會比較晚觸發。這是正確的行為：數字回到「逾時過幾次」，而不是「逾時後過了幾天」。預覽會列出受影響的啟用中規則。

### 操作步驟

以下指令在 repo 根目錄執行；在 API 容器內，把 `scripts/` 整個資料夾（含 `sql/`）複製到 `/app/scripts/`，在 `/app` 執行。連線需要能略過 RLS 的身分：優先用 `MIGRATE_DATABASE_URL`（owner），否則用 `DATABASE_URL`。身分不能略過 RLS 時，腳本直接失敗，不會回報 0 筆。

1. **正式寫入前先備份資料庫。**
2. **找 cutoff**（唯讀）：

   ```bash
   node scripts/dedupe-sla-events.mjs --find-cutoff
   ```

   印出最早的中文 SLA 通知時間（#281 之後）與最晚的英文 SLA 通知時間。前者就是 cutoff。如果最晚的英文通知晚於最早的中文通知，改用部署紀錄的時間。也可以直接在資料庫執行 SQL 檔的 `-- @find-cutoff` 段落。

3. **預覽**（dry-run，預設模式；建立暫存表後交易改為唯讀，最後回滾）：

   ```bash
   node scripts/dedupe-sla-events.mjs --cutoff 2026-10-15T08:00:00Z
   node scripts/dedupe-sla-events.mjs --cutoff 2026-10-15T08:00:00Z --tenant <租戶 ID>
   ```

   `--cutoff` 必須寫時區（`Z` 或 `+08:00`）。`--tenant` 可以重複，不帶時處理所有租戶。輸出：

   - 各租戶、各事件類型要刪的時間軸筆數，與各租戶、各類型要刪的通知筆數。
   - 英文 SLA 通知總數，以及配對到保留事件、同一筆被刪事件同一位成員的第二則以後、配對不到事件的則數（這三類都不動）。
   - cutoff 之後的重複事件數與英文 SLA 通知數。都應為 0，不為 0 表示 cutoff 早於 #281 上線，`--apply` 會拒絕執行。
   - 沒有期限 key、不處理的時間軸事件數。
   - 重複最多的前 10 張工單。
   - 依 `sla.breachCount` 或 `sla.escalationLevel` 判斷的啟用中規則。
   - 建議的 `--expect-events`、`--expect-notifications` 值。

4. **執行**（單一交易）：

   ```bash
   node scripts/dedupe-sla-events.mjs --cutoff 2026-10-15T08:00:00Z --tenant <租戶 ID> --apply \
     --expect-events 1234 --expect-notifications 567 --out-dir /tmp
   ```

   - 要刪的 id 放進交易內的暫存表（`ON COMMIT DROP`），不在正式 schema 建備份表。
   - 刪除前把整列匯出成 CSV：`sla-dedupe-<時間>-case-events.csv`（含所屬租戶）與 `sla-dedupe-<時間>-notifications.csv`，放在 `--out-dir`（預設目前目錄）。檔案已存在時不覆蓋。
   - 這次預覽的筆數與 `--expect-*` 不同、cutoff 之後有重複、或 DELETE 的筆數與預覽不同時，整筆交易回滾，刪除先前寫出的 CSV，以非零結束。
   - `--notifications=skip` 只清時間軸，不動通知。

5. **抽查**：打開重複最多的幾張工單，時間軸每個期限只剩一筆逾時、一筆預警。

建議順序（issue #320 的決定）：本機用 `scripts/sync-uat-db.sh` 拉回的 UAT 資料演練 → UAT 只跑預覽、確認筆數 → 先清 Demo 租戶並抽查 → 再清真實租戶。

### 還原

CSV 的欄位名稱與資料表相同。有值的欄位一律加引號，NULL 是沒有引號的空欄位；`payload` 是 JSON 文字，時間是 UTC 的 ISO 8601。時間軸的 CSV 多一個 `tenantId` 欄位供核對，`case_events` 沒有這個欄位。

以 owner 身分用 `psql` 連到資料庫，在 CSV 所在目錄執行（把檔名換成實際的檔名）。工單或成員已經刪除的列寫不回去，會略過；已經存在的 id 也略過：

```sql
CREATE TEMP TABLE restore_case_events (id uuid, "tenantId" uuid, "caseId" uuid, "actorType" text, "actorId" uuid, "eventType" text, payload jsonb, "createdAt" timestamptz);
CREATE TEMP TABLE restore_notifications (id uuid, "tenantId" uuid, "agentId" uuid, type text, title text, body text, "clickUrl" text, "isRead" boolean, "readAt" timestamptz, "createdAt" timestamptz);
\copy restore_case_events FROM 'sla-dedupe-<時間>-case-events.csv' WITH (FORMAT csv, HEADER true)
\copy restore_notifications FROM 'sla-dedupe-<時間>-notifications.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO case_events (id, "caseId", "actorType", "actorId", "eventType", payload, "createdAt")
SELECT id, "caseId", "actorType", "actorId", "eventType", payload, "createdAt" AT TIME ZONE 'UTC'
FROM restore_case_events r
WHERE EXISTS (SELECT 1 FROM cases c WHERE c.id = r."caseId")
ON CONFLICT (id) DO NOTHING;
INSERT INTO notifications (id, "tenantId", "agentId", type, title, body, "clickUrl", "isRead", "readAt", "createdAt")
SELECT id, "tenantId", "agentId", type, title, body, "clickUrl", "isRead", "readAt" AT TIME ZONE 'UTC', "createdAt" AT TIME ZONE 'UTC'
FROM restore_notifications r
WHERE EXISTS (SELECT 1 FROM agents a WHERE a.id = r."agentId")
ON CONFLICT (id) DO NOTHING;
```

`tests/feature/scripts/dedupe-sla-events.test.ts` 依這段 SQL 還原，確認寫回的列與刪除前相同。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **沒有關聯對話的工單，首次回應 SLA 必定逾時** | `Case.firstResponseAt` 只在客服於工單關聯的對話送出訊息時寫入。手動建立、沒有關聯對話的工單永遠沒有這個值。詳見 `../system/AUDIT.md` 的 SLA-05 |
| 每輪最多掃 100 張工單 | `getActiveCases()` 的 `take: 100` 是全系統共用，不是每個租戶各 100 張。詳見 `../system/AUDIT.md` 的 SLA-02 |
| 工單以政策名稱連結政策 | 工單存的是政策名稱，不是外鍵。改名會同步更新工單、使用中的政策不能刪除、名稱不可重複（`sla.service.ts`），但資料庫沒有關聯與唯一約束。詳見 `../system/AUDIT.md` 的 SLA-04 |
