## ADDED Requirements

### Requirement: 已指派對話的通知只發給看得到渠道的負責客服

已指派對話的站內通知（收到新訊息 `new_message`、轉接真人 `conversation_handoff`）SHALL 只在負責客服仍啟用、且看得到該對話渠道（持有 `channel.view_all`，或被授權該渠道）時發給他。負責客服已停用或看不到該渠道時，系統 SHALL NOT 發給他，SHALL 改發給看得到該渠道的啟用中主管與管理員，與未指派對話相同。可見範圍 SHALL 與未指派對話的通知使用同一個判斷。

#### Scenario: 負責客服看得到渠道
- **WHEN** 指派給客服 X 的渠道 C 對話收到新訊息，X 啟用中且被授權渠道 C
- **THEN** 只有 X 收到 `new_message` 通知

#### Scenario: 負責客服失去渠道權限
- **WHEN** 指派給客服 X 的渠道 C 對話收到新訊息，X 已不再被授權渠道 C，總店管理員 H 持有 `channel.view_all`
- **THEN** X 沒有收到通知，H 收到 `new_message` 通知

#### Scenario: 負責客服已停用
- **WHEN** 指派給客服 X 的對話發出 `conversation.handoff`，X 已停用，總店管理員 H 持有 `channel.view_all`
- **THEN** X 沒有收到通知，H 收到 `conversation_handoff` 通知
