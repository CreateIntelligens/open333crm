## Why

通知 worker 寫入站內通知前不檢查收件成員是否還在（issue #484）。通知是非同步的：排進佇列時收件成員還在，worker 處理時他已被永久刪除，`notifications.agentId` 的外鍵讓寫入失敗，佇列重試三次後進入 failed set，佇列監控多出失敗紀錄。已停用（`isActive: false`）但還沒刪除的成員，也仍然收到新通知。

API 行程直接寫入通知的兩處（`createAndDispatch`：CSAT 低分、權杖失效；序號明細背景匯出的完成通知）有同樣的問題。

## What Changes

- 站內通知只寫給同租戶、仍啟用的成員。收件成員已被永久刪除或已停用時，略過這則通知並寫 info log，不丟錯、不重試。
- 三個寫入點共用同一個檢查：`packages/core` 新增 `isNotifiableAgent()`。PR #483 的 `requesterExists()` 改用同一個查詢（只檢查存在，不檢查啟用），兩份規則不會分歧。
- 重新啟用成員後，不補送停用期間的通知（使用者 2026-11-09 決定）。
- 收件人計算（`notification.worker.ts` 的主管、負責客服判斷，#440）不變。這些地方已排除停用成員，寫入前的檢查不改變它們的結果。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `standalone-worker-runtime`：「Notification Job Handling」加上收件成員的檢查；新增「站內通知只寫給仍啟用的成員」，涵蓋 API 行程直接寫入的通知與重新啟用不補送。

## Impact

- `apps/workers/src/handlers/notification.handler.ts`
- `apps/api/src/modules/notification/notification.service.ts`（`createAndDispatch`）
- `apps/api/src/modules/coupon/coupon-export.service.ts`、`coupon-export.flow.ts`
- `packages/core/src/agent/notifiable-agent.ts`（新）、`apps/workers/src/lib/requester.ts`
- 工單指派、SLA 通知的負責人已停用時，通知被略過，沒有人收到（原本只寫給停用的人）。改發主管不在本 change 範圍（CONV-06）。
