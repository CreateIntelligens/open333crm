## MODIFIED Requirements

### Requirement: Notification Job Consumer
The `apps/workers` notification worker SHALL be the sole processor that persists notification records and delivers socket events for notifications that domain events trigger. The `apps/api` event-bus worker (`notification.worker.ts`) SHALL only enqueue BullMQ jobs onto the `notification` queue and SHALL NOT directly write to the database or emit socket events. Requirement「API 行程直接寫入的站內通知」lists the only exceptions.

#### Scenario: Notification enqueued from API event bus
- **WHEN** a domain event (e.g., `case.assigned`, `message.received`) is received by the API event-bus worker
- **THEN** a BullMQ job is added to the `notification` queue with the full notification payload, and no direct DB write or socket emit occurs in the API process

#### Scenario: Redis unavailable at enqueue time
- **WHEN** the API notification subscriber attempts to enqueue a notification job and the Redis connection is unavailable
- **THEN** the `notificationQueue.add` call throws, the subscriber job for the event fails, and BullMQ retries that subscriber job; the error is not caught only to be logged

### Requirement: 站內通知只寫給仍啟用的成員
API 行程直接寫入站內通知的路徑（`createAndDispatch`：CSAT 低分、權杖失效、留言私訊健康告警、序號明細背景匯出的完成與失敗通知）SHALL 在寫入時以 `tenantId` 檢查收件成員。成員已被永久刪除或已停用時，SHALL NOT 寫入通知或推播 `notification.new`，SHALL 寫 info log，且 SHALL NOT 丟錯。成員重新啟用後，系統 SHALL NOT 補送停用期間略過的通知。

#### Scenario: createAndDispatch 的收件成員已被永久刪除
- **WHEN** 以已被永久刪除的成員 ID 呼叫 `createAndDispatch`
- **THEN** 呼叫正常結束、回傳 `null`，資料庫沒有新的通知，`tenant:<租戶 ID>:agent:<成員 ID>` 房間沒有推播

#### Scenario: createAndDispatch 的收件成員已停用
- **WHEN** 以 `isActive` 為 `false` 的成員 ID 呼叫 `createAndDispatch`
- **THEN** 呼叫正常結束、回傳 `null`，資料庫沒有寫給他的通知，也沒有推播

#### Scenario: createAndDispatch 的收件成員啟用中
- **WHEN** 以啟用中的成員 ID 呼叫 `createAndDispatch`
- **THEN** 資料庫寫入一則通知，`tenant:<租戶 ID>:agent:<成員 ID>` 房間收到 `notification.new`

#### Scenario: 序號明細匯出者已停用
- **WHEN** 背景匯出完成時，匯出者已停用
- **THEN** 不寫入 `coupon_export_ready` 通知、不推播，呼叫正常結束

#### Scenario: 序號明細匯出者已被永久刪除
- **WHEN** 背景匯出完成時，匯出者已被永久刪除
- **THEN** 不寫入通知、不推播，呼叫正常結束

#### Scenario: 重新啟用後不補送
- **WHEN** 成員停用期間有一則通知被略過，之後成員重新啟用
- **THEN** 那則通知不會出現在他的通知列表

## ADDED Requirements

### Requirement: API 行程寫入的站內通知在 commit 之後才推播
API 行程以 `createAndDispatch` 寫入站內通知時，SHALL 在綁定該租戶的交易內寫入。系統 SHALL 在交易 commit 之後，才把 `notification.new` 推播到 `tenant:<租戶 ID>:agent:<成員 ID>`，推播內容是寫入的通知。交易 rollback 時，系統 SHALL NOT 留下這則通知，也 SHALL NOT 推播。

#### Scenario: 交易 rollback 時，通知與推播都作廢
- **WHEN** 在租戶交易內呼叫 `createAndDispatch`，之後同一個交易的另一個步驟丟出錯誤
- **THEN** 資料庫沒有這則通知，`tenant:<租戶 ID>:agent:<成員 ID>` 房間也沒有收到 `notification.new`

#### Scenario: 推播送到帶租戶 ID 的成員房間，內容是寫入的通知
- **WHEN** 在租戶交易內以啟用中的成員 ID 呼叫 `createAndDispatch`，之後交易 commit
- **THEN** `tenant:<租戶 ID>:agent:<成員 ID>` 房間收到一則 `notification.new`，內容的 `id` 等於寫入的通知的 `id`

### Requirement: API 行程直接寫入的站內通知
API 行程 SHALL 只直接寫入這 4 種站內通知，其他通知都經過 `notification` 佇列：CSAT 低分、FB／IG 權杖失效、留言私訊健康告警、序號明細背景匯出的完成與失敗。這 4 種通知 SHALL 經過 `createAndDispatch`。新增的通知類型 SHALL 經過 `notification` 佇列。

#### Scenario: 留言私訊健康告警只通知該租戶啟用中的管理員
- **WHEN** 留言私訊健康檢查對租戶 A 發出告警，租戶 A 有一位啟用中的管理員、一位停用的管理員、一位一般成員，租戶 B 有一位管理員
- **THEN** 只有租戶 A 啟用中的管理員收到一則 `comment_reply_alert` 通知，推播送到 `tenant:<A 的 ID>:agent:<該管理員 ID>`
