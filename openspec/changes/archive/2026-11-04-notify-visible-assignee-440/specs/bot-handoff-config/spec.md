## MODIFIED Requirements

### Requirement: 轉接真人時通知客服

系統發出 `conversation.handoff` 時，SHALL 建立類型為 `conversation_handoff` 的站內通知：對話已指派、且負責客服仍啟用並看得到該對話渠道時，只通知負責的客服；沒有指派，或負責客服已停用或看不到該渠道時，通知看得到該對話渠道的啟用中主管與管理員（持有 `channel.view_all`，或被授權該渠道），看不到該渠道的人 SHALL NOT 收到。通知內容 SHALL 包含聯絡人名稱與轉接原因，點擊後開啟該對話。

#### Scenario: 未指派的對話轉接
- **WHEN** 沒有指派客服的對話發出 `conversation.handoff`，原因為「追問次數已達上限」
- **THEN** 每位看得到該渠道的啟用中主管與管理員各收到一則 `conversation_handoff` 通知，內容含聯絡人名稱與原因，連結為 `/dashboard/inbox?conv=<對話 id>`

#### Scenario: 已指派的對話轉接
- **WHEN** 指派給客服 X 的對話發出 `conversation.handoff`，X 啟用中且看得到該渠道
- **THEN** 只有客服 X 收到 `conversation_handoff` 通知

#### Scenario: 看不到渠道的主管不收轉接通知
- **WHEN** 渠道 C 上沒有指派客服的對話發出 `conversation.handoff`，主管 S 只被授權渠道 D、沒有 `channel.view_all`
- **THEN** 主管 S 沒有收到這則 `conversation_handoff` 通知

#### Scenario: 負責客服看不到渠道時改通知主管
- **WHEN** 指派給客服 X 的渠道 C 對話發出 `conversation.handoff`，X 已不再被授權渠道 C，總店管理員 H 持有 `channel.view_all`
- **THEN** X 沒有收到通知，H 收到 `conversation_handoff` 通知
