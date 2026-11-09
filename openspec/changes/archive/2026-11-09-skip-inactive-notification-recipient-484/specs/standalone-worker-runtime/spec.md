## MODIFIED Requirements

### Requirement: Notification Job Handling
Each `notification` job payload SHALL include the notification type, recipient identifiers, and relevant entity context. The notification job handler SHALL first look up the recipient agent by `tenantId`. When the recipient exists and is active, the handler SHALL create a notification record in the database via the standalone `PrismaClient` and publish a `socket:emit` message to Redis pub/sub so the API can forward the event to the appropriate Socket.IO room. When the recipient no longer exists or is inactive, the handler SHALL skip the notification, write an info log, and complete the job without throwing.

#### Scenario: Notification job consumed by worker
- **WHEN** the `notificationWorker` in `apps/workers` dequeues a `notification:dispatch` job for an active recipient and both the DB write and the Redis publish succeed
- **THEN** it writes one `notification` record to the database, emits the `notification.new` socket event via Redis pub/sub, and the job completes

#### Scenario: Database write succeeds but Redis publish fails
- **WHEN** the notification DB write succeeds but Redis pub/sub publish throws
- **THEN** the error is logged; the job is still considered successful (notification is persisted; real-time delivery is best-effort)

#### Scenario: Database write fails
- **WHEN** the notification DB write throws
- **THEN** the job fails and BullMQ retries according to the queue's retry policy; no Redis publish is attempted

#### Scenario: 收件成員已被永久刪除
- **WHEN** worker 處理 `notification:dispatch` job，job 的 `agentId` 在該租戶已查不到成員
- **THEN** 不寫入通知、不推播 `notification.new`，寫一筆 info log，job 正常完成（不丟錯、不重試）

#### Scenario: 收件成員已停用
- **WHEN** worker 處理 `notification:dispatch` job，收件成員的 `isActive` 為 `false`
- **THEN** 不寫入通知、不推播 `notification.new`，寫一筆 info log，job 正常完成

## ADDED Requirements

### Requirement: 站內通知只寫給仍啟用的成員
API 行程直接寫入站內通知的路徑（`createAndDispatch`：CSAT 低分、權杖失效；序號明細背景匯出的完成與失敗通知）SHALL 在寫入前以 `tenantId` 查收件成員。成員已被永久刪除或已停用時，SHALL NOT 寫入通知或推播 `notification.new`，SHALL 寫 info log，且 SHALL NOT 丟錯。成員重新啟用後，系統 SHALL NOT 補送停用期間略過的通知。

#### Scenario: createAndDispatch 的收件成員已被永久刪除
- **WHEN** 以已被永久刪除的成員 ID 呼叫 `createAndDispatch`
- **THEN** 呼叫正常結束、回傳 `null`，資料庫沒有新的通知，`agent:<成員 ID>` 房間沒有推播

#### Scenario: createAndDispatch 的收件成員已停用
- **WHEN** 以 `isActive` 為 `false` 的成員 ID 呼叫 `createAndDispatch`
- **THEN** 呼叫正常結束、回傳 `null`，資料庫沒有寫給他的通知，也沒有推播

#### Scenario: createAndDispatch 的收件成員啟用中
- **WHEN** 以啟用中的成員 ID 呼叫 `createAndDispatch`
- **THEN** 資料庫寫入一則通知，`agent:<成員 ID>` 房間收到 `notification.new`

#### Scenario: 序號明細匯出者已停用
- **WHEN** 背景匯出完成時，匯出者已停用
- **THEN** 不寫入 `coupon_export_ready` 通知、不推播，呼叫正常結束

#### Scenario: 序號明細匯出者已被永久刪除
- **WHEN** 背景匯出完成時，匯出者已被永久刪除
- **THEN** 不寫入通知、不推播，呼叫正常結束

#### Scenario: 重新啟用後不補送
- **WHEN** 成員停用期間有一則通知被略過，之後成員重新啟用
- **THEN** 那則通知不會出現在他的通知列表
