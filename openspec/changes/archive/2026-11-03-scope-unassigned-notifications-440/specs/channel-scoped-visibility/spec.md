## ADDED Requirements

### Requirement: 未指派對話的通知只發給看得到渠道的人

未指派對話的站內通知（收到新訊息 `new_message`、轉接真人 `conversation_handoff`）SHALL 只發給看得到該對話渠道的啟用中主管與管理員：持有 `channel.view_all`，或被授權該渠道。看不到該渠道的人 SHALL NOT 收到，因為通知內容有聯絡人名稱。可見範圍 SHALL 與列表、即時推播使用同一個判斷。

#### Scenario: 分店主管不收其他渠道的新訊息通知
- **WHEN** 渠道 C 上沒有指派客服的對話收到新訊息，總店管理員 H 持有 `channel.view_all`，分店主管 S 只被授權渠道 D
- **THEN** H 收到 `new_message` 通知，S 沒有收到

#### Scenario: 分店主管收自己渠道的新訊息通知
- **WHEN** 渠道 D 上沒有指派客服的對話收到新訊息，分店主管 S 被授權渠道 D
- **THEN** S 收到 `new_message` 通知
