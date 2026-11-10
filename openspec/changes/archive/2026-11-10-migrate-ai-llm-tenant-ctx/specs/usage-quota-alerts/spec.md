# Spec Delta

## MODIFIED Requirements

### Requirement: 告警不影響 AI 回覆
告警的偵測與發送 MUST NOT 阻擋 AI 回覆：Redis 無法使用、告警事件寫入失敗、站內通知入列失敗或 email 寄送失敗時，系統只寫日誌，AI 回覆照常完成。Redis 沒有回應時，告警的處理最多讓 AI 回覆多等一個 Redis 指令的逾時（1 秒）。告警事件 `usage.quota.threshold` SHALL 在用量紀錄 commit 之後經 outbox 送出，至少送出一次；重送時不重複寄信，見「事件重送時不重複寄出告警信」。

#### Scenario: Redis 無法使用時跳過告警
- **GIVEN** 累加計數器時 Redis 無法連線
- **WHEN** 一次 AI 呼叫成功
- **THEN** 系統不發送告警，AI 回覆照常完成

#### Scenario: email 寄送失敗
- **WHEN** 一封告警 email 寄送失敗
- **THEN** 系統寫入錯誤日誌，其他管理員的通知與 email 照常發送

#### Scenario: 告警事件寫進 outbox
- **WHEN** 一次 AI 呼叫使租戶本月的用量跨越 80%
- **THEN** outbox 有一筆這個租戶的 `usage.quota.threshold` 事件，level 是 `warning`

#### Scenario: 告警事件寫入失敗
- **WHEN** 一次 AI 呼叫使用量跨越門檻，寫入告警事件的交易失敗
- **THEN** 系統寫入錯誤日誌，AI 回覆照常完成
- **AND** 這個門檻的 Redis key 已經寫入，所以本月不再發送這個門檻的告警
