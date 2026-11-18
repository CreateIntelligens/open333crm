## Context

- workers 的送出層 `sendToChannelFromWorker()` 送出成功時寫訊息、更新 `lastMessageAt`、推 `message.new`；送出失敗時由 `recordDeliveryFailure()` 寫一則 `metadata.deliveryFailed` 的系統訊息並推 `message.new`，但不更新 `lastMessageAt`。
- 找不到對話、渠道停用時原本只寫 log，回 `{ ok: false, recorded: false }`。
- 自動化規則的執行紀錄表有兩張：`automation_logs`（`GET /automation/logs` 讀它，自 `9255245` 起沒有程式寫入，AUDIT AUTO-02）與 `automation_executions`（從來沒有程式讀寫）。
- 素材的 `channelType` 是字串，大小寫不一（素材庫存 `line`、`fb`，測試資料有 `LINE`）；規則條件的值是 `LINE`、`FB`、`THREADS`。workers 以小寫比對兩者。

## Decisions

### D1 失敗紀錄只更新 `lastMessageAt`，不另外推 `conversation.updated`

收件匣 `useConversations` 收到 `message.new` 時已用訊息的 `createdAt` 更新列表的 `lastMessageAt` 與排序（與成功路徑相同）。只缺資料庫的值，重新整理後才會掉回舊位置。所以只補 `conversation.updateMany({ where: { id, tenantId } })`，workers 走 BYPASSRLS，條件帶 `tenantId`。

### D2 渠道停用由送出層寫紀錄

對話還在就有地方寫，送出層統一寫，呼叫端（send_message、send_material、發券）不必各自補。發券原本在 `recorded: false` 時自己寫 `recordFailureNotice`；送出層改寫之後回 `recorded: true`，發券不重複寫，紀錄內容仍是發券給的 `failureContent`、`failureMetadata`。渠道關聯不存在（資料不一致）時沒有渠道資訊可寫，仍回 `recorded: false`。

### D3 對話不存在時寫 `automation_logs`

| 選項 | 問題 |
| ---- | ---- |
| `automation_executions` | 從來沒有程式讀寫，也沒有查詢端點；要另做讀取 |
| 新欄位或新表 | 要改 schema |
| `automation_logs`（採用） | 已有 `GET /automation/logs` 與 `getRule` 的最近 10 筆；欄位 `success`、`errorMsg`、`actionsRan` 剛好夠用 |

只在有動作失敗時寫，`actionsRan` 存每個動作的結果。成功的執行仍不寫（AUTO-02 的其餘部分不在這個 change）。紀錄寫不進去時只記 log，不丟錯：動作已執行，丟錯會讓佇列重試；認領會擋下重複，但不需要多一次重試。沒有 `ruleId` 的呼叫（SLA 路徑目前不傳）不寫，`ruleId` 是必填欄位。

### D4 素材渠道比對規則

- 只看「一定要成立」的渠道條件：頂層 `all` 與巢狀 `all` 裡 `operator: equal` 的 `conversation.channelType`。放在 `any` 裡的條件不是必要條件，素材可能在另一個分支成立時送出，不擋。
- 比對 `material.channelType.toLowerCase() === 條件值.toLowerCase()`，與 workers 一致；不寫死任何渠道。
- 不看素材是否啟用：停用的素材由既有的 `assertSendMaterialReferences` 在更換動作時檢查。只改條件時要檢查渠道，但不可因為既有素材已停用而擋（管理員要能修改舊規則）。
- 只改名稱、停用、重新啟用不檢查：舊規則要能照常開關，與「Send Material Action References An Existing Material」的既有做法一致。

### D5 關鍵字回覆頁的動作合併

這一頁只顯示、只更換每類的第一個動作。第二個以後的同類動作不是這一頁設定的，原樣保留在原位。新加的素材插在合併後第一個 `issue_coupon` 之前；沒有發券時接在最後。新加的發券仍接在最後。
