# Spec Delta

## ADDED Requirements

### Requirement: 事件重送時不重複寄出告警信

一個告警事件的每位收件管理員，系統 MUST 只寄出一封告警信。寄信的 job id MUST 由事件 id 與管理員的 id 組成。

#### Scenario: 告警事件處理兩次

- **WHEN** `usage.quota.threshold` 事件 E 的通知訂閱者 job 執行兩次，租戶有一位管理員
- **THEN** 管理員 MUST 只收到一封 E 的告警信
