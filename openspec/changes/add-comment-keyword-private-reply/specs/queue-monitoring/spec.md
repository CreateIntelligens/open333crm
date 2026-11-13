## MODIFIED Requirements

### Requirement: 列出所有佇列

佇列監控畫面 MUST 列出 API 與 workers 兩個行程使用中的每個 BullMQ 佇列，包括各佇列 waiting、active、delayed、completed、failed 的 job，以及 failed job 的失敗原因與 stack。

#### Scenario: 列出 workers 行程的佇列

- **WHEN** 平台管理員以有效的監控 cookie 從允許的網段開啟佇列清單
- **THEN** 清單包含 `notification`、`automation`、`event-automation` 與 `api-scheduler`

#### Scenario: 顯示失敗原因

- **WHEN** `event-webhook` 佇列有一個 failed job，失敗原因是 `HTTP 500`
- **THEN** 這個 job 的細節顯示失敗原因 `HTTP 500`

#### Scenario: 列出留言自動私訊佇列

- **WHEN** 平台管理員以有效的監控 cookie 從允許的網段開啟佇列清單
- **THEN** 清單包含 API 行程的 `comment-reply`；它有 failed job 時顯示失敗原因
