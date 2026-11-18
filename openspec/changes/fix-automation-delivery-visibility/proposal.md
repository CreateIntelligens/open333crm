## Why

issue #362 的審查列出幾個「規則有觸發、使用者卻看不出發生什麼事」的問題：

- 自動化送出失敗時會在對話留下紅色的失敗紀錄，但不更新對話的 `lastMessageAt`；重新整理後對話仍排在舊位置，客服找不到這則失敗（#11）。
- 渠道已停用、或對話已不存在時，workers 送出層只寫 log、回 `recorded: false`。只有發券路徑會自己補寫紀錄；`send_message`、`send_material` 完全忽略回傳值，使用者只會覺得「沒反應」（#12）。
- 規則條件限定「對話渠道等於 X」時，`send_material` 的素材可以是別的渠道的素材。workers 執行時一定略過素材，規則看起來有效卻從不送出。只有關鍵字回覆頁在前端擋，API、CLI、MCP 都能存（D8）。
- 關鍵字回覆頁存檔時，第二個同類動作（例如規則編輯器加的第二個傳送素材）被刪掉（B1）；只發券的規則加上素材時，素材排在發券之後（B2）。

## What Changes

- workers 的送出失敗紀錄（`recordDeliveryFailure`、發券的 `recordFailureNotice`）寫入後，比照送出成功更新對話 `lastMessageAt`。前端收到 `message.new` 時已用訊息時間更新列表，不需要另外推送。
- 渠道已停用但對話還在時，`sendToChannelFromWorker` 自己寫失敗紀錄並回 `recorded: true`；發券路徑依 `recorded` 不再重複寫。
- `executeWorkerAutomationActions` 回傳每個動作的結果（`ok`、`failed`、`duplicate`）。`send_message`、`send_material` 依送出結果把動作標成失敗；有動作失敗時寫一筆規則執行紀錄 `automation_logs`（`success: false`、`errorMsg`、`actionsRan`）。對話不存在時這是唯一查得到原因的地方（`GET /automation/logs`）。
- API 建立或更新規則時，條件一定要成立的「對話渠道等於 X」（頂層 `all`，含巢狀 `all`）與 `send_material` 素材的 `channelType` 不分大小寫比對，不同時回 400 `VALIDATION_ERROR`，`details.issues[0].path` 為 `actions`。只改條件也檢查；只改名稱、停用、重新啟用不檢查。比對的是資料值，不寫死渠道（AGENTS.md 結構規則 5）。
- 關鍵字回覆頁存檔只更換第一個「傳送素材」「發送優惠券」，第二個以後的同類動作原樣保留；新加的素材插在第一個發券之前。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `automation-engine`：
  - 修改「Send Material Action References An Existing Material」（素材渠道要與規則的渠道條件相同）。
  - 修改「關鍵字回覆頁保留規則上的其他動作與條件」（保留第二個同類動作、新素材排在發券之前）。
  - 新增「自動化送出失敗的紀錄讓對話浮到收件匣上方」「渠道已停用時自動化送出留下看得到的紀錄」「自動化動作失敗寫進規則執行紀錄」。目前沒有需求涵蓋一般的自動化送出失敗（「素材渠道不符時留下看得到的紀錄」只涵蓋素材渠道不符）。

## Platform layer

不適用：這個 change 沒有新增權限碼、功能模組、方案上限、AI 呼叫、渠道類型、租戶設定、平台稽核動作、BullMQ 佇列或租戶與平台之間的請求，只修正既有自動化規則的驗證與失敗紀錄。

## Impact

- `apps/workers/src/lib/channel-delivery.ts`、`apps/workers/src/lib/rule-coupon-issue.ts`、`apps/workers/src/lib/automation-actions.ts`
- `apps/api/src/modules/automation/automation.service.ts`
- `apps/web/src/hooks/useKeywordReplies.ts`
- 文件：`docs/ref/features/tenant/AUTOMATION.md`、`docs/ref/system/AUDIT.md`（AUTO-02 部分修正）、`docs/ref/system/AUDIT-REVIEWS.md`
- 資料庫：不改 schema。`automation_logs` 是既有資料表（`GET /automation/logs` 已讀它）。
