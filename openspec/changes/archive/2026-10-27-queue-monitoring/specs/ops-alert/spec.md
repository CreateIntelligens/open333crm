# Spec Delta

## Purpose

提供平台層的維運告警：系統以一個合併鍵發出告警，告警經佇列送到設定的管道（目前是 Slack）；沒有設定管道時只記錄 log。

## ADDED Requirements

### Requirement: 設定 Slack Webhook 時送到 Slack

設定環境變數 `OPS_ALERT_SLACK_WEBHOOK_URL` 時，系統 MUST 把每則告警以 HTTP POST 送到這個 Slack Incoming Webhook 網址。訊息含告警的標題、欄位與連結。

#### Scenario: 送出一則告警

- **WHEN** 設定了 `OPS_ALERT_SLACK_WEBHOOK_URL`，系統發出標題為「佇列 job 重試用完」的告警
- **THEN** 系統對這個網址送出一個 POST 請求，內容含這個標題、告警的欄位與連結

### Requirement: 沒有設定管道時只記錄 log

沒有設定 `OPS_ALERT_SLACK_WEBHOOK_URL` 或是空值時，系統 MUST 把每則告警寫成一筆 log，MUST NOT 對外送出請求。API 照常啟動。

#### Scenario: 沒有設定 Slack Webhook

- **WHEN** 沒有設定 `OPS_ALERT_SLACK_WEBHOOK_URL`，系統發出一則告警
- **THEN** 系統寫入一筆含告警標題的 log，不對外送出請求

### Requirement: 同一個合併鍵在 10 分鐘內只送一則

每則告警帶一個合併鍵。同一個合併鍵在 10 分鐘內 MUST 只送出一則告警。這段期間內的其他告警不送出，只計數；10 分鐘之後，同一個合併鍵的下一則告警 MUST 帶上前一段期間內沒有送出的次數。不同合併鍵的告警互不影響。

#### Scenario: 短時間內大量失敗

- **WHEN** 合併鍵 `queue-failed:event-webhook` 在 10 分鐘內發出 50 則告警
- **THEN** 系統只送出第一則

#### Scenario: 下一段期間的告警帶上次數

- **WHEN** 合併鍵 K 在 10 分鐘內有 1 則送出、49 則沒有送出，10 分鐘之後 K 又發出一則告警
- **THEN** 系統送出這則告警，內容寫明前一段期間另有 49 次

#### Scenario: 告警放不進佇列

- **WHEN** 合併鍵 K 的告警通過合併的檢查，但放進 `ops-alert` 佇列時失敗
- **THEN** 系統不保留 K 的合併期間；K 的下一則告警照常送出，並帶上之前沒有送出的次數

#### Scenario: 不同合併鍵

- **WHEN** 合併鍵 `queue-failed:event-webhook` 剛送出一則告警，合併鍵 `queue-failed:automation` 發出一則告警
- **THEN** 系統也送出 `queue-failed:automation` 的告警

### Requirement: 告警內容不含 job 資料

佇列告警 MUST 只含佇列名稱、job 名稱、job id、租戶 id、重試次數，以及佇列監控畫面的連結。告警 MUST NOT 含 job 資料或失敗原因：兩者都可能含客人的個資。

#### Scenario: 告警不含失敗原因

- **WHEN** `event-webhook` 佇列的 job 移到 failed set，失敗原因含對方伺服器回傳的內容
- **THEN** 送出的告警含佇列名稱、job id 與監控畫面的連結，不含失敗原因與 job 資料

### Requirement: 送出告警至少一次

送出告警是外部呼叫。系統 MUST 把告警放進 `ops-alert` 佇列，在發出告警的程式之外送出，失敗時重試 3 次。告警的保證是至少一次：Slack 收下訊息之後、job 完成之前中斷時，同一則告警會再送一次。重試用完時，系統只記錄 log。

#### Scenario: Slack 暫時無法連線

- **WHEN** 送出告警的 POST 第 1 次失敗，第 2 次成功
- **THEN** Slack 收到這則告警，`ops-alert` job 完成

#### Scenario: Slack 持續無法連線

- **WHEN** 送出告警的 POST 連續 3 次失敗
- **THEN** 系統寫入一筆 log，不發出新的告警
