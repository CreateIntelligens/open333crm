# Spec Delta

## ADDED Requirements

### Requirement: 事件重送時不重複寄出告警信

告警信的保證是至少一次。一個告警事件的每位收件管理員，系統 MUST 只建立一個寄信的 job，job id MUST 由事件 id 與管理員的 id 組成。寄送失敗時，系統 MUST 重試這個 job。寄信服務已經收下信、job 還沒完成時中斷，重試會多寄一封；系統接受這個情況，不為此少寄。

#### Scenario: 告警事件處理兩次

- **WHEN** `usage.quota.threshold` 事件 E 的通知訂閱者 job 執行兩次，租戶有一位管理員
- **THEN** 管理員 MUST 只收到一封 E 的告警信

#### Scenario: Email provider fails

- **WHEN** 寄出事件 E 的告警信時，寄信服務回傳錯誤
- **THEN** 寄信的 job MUST 失敗，由佇列重試
