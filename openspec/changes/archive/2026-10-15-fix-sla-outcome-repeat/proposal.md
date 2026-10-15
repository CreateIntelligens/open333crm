# Proposal

## Why

SLA 掃描每 5 分鐘跑一次，同一張工單的同一種 SLA 結果只用「24 小時內有沒有同類事件」去重。逾期的工單一天後又寫一次時間軸事件、又通知一次負責人與所有主管，逾期越久重複越多：示範租戶一位管理員累積了 1048 則 SLA 通知，工單時間軸被每天一筆的「SLA 逾期」洗版（操作手冊盤點 S01、S02）。

## What Changes

- 同一個期限的 SLA 結果只記錄與通知一次：首次回應與解決期限的警告、逾期，以期限（或警告時間點）之後是否已有同類事件判斷；客戶等待逾時以上次客服回覆之後是否已有同類事件判斷。
- 期限改變（例如重新開啟後重算）或客服回覆後客戶又連續傳訊，才會再記錄一次。
- SLA 預設通知的標題與內容改成中文（文案修正，不另立需求）。

## Capabilities

### New Capabilities
- 無。

### Modified Capabilities
- `standalone-worker-runtime`：新增「SLA 結果每個期限只記錄一次」需求。

## Impact

- `apps/workers/src/handlers/sla.handler.ts`
- 既有資料中已重複的事件與通知不會被清除。
