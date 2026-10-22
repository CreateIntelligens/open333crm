# Spec Delta

## ADDED Requirements

### Requirement: 同一個事件不重複建立站內通知

通知訂閱者為一個事件送出 `notification:dispatch` job 時，job 的 id MUST 由事件 id 與收件客服人員的 id 組成。同一個事件處理兩次時，同一位客服人員 MUST 只收到一則站內通知。

#### Scenario: 同一個事件處理兩次

- **WHEN** `case.assigned` 事件 E 的通知訂閱者 job 執行兩次，收件人是客服人員 X
- **THEN** X MUST 只有一則 E 產生的站內通知

#### Scenario: 同一個事件通知多位客服人員

- **WHEN** 未指派對話的 `message.received` 事件 E 要通知主管 A 與管理員 B
- **THEN** A 與 B MUST 各收到一則站內通知
