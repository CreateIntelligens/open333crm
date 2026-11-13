## ADDED Requirements

### Requirement: Webhook 觸發依進站事件類型比對
`triggerType` 為 `webhook` 的流程，系統 SHALL 以進站事件的 `contentType` 推導事件類型後比對 `triggerConfig.eventType`：系統事件（`follow`、`join`、`leave`、`memberJoined`、`memberLeft`、`unsend`、`videoPlayComplete`、`accountLink`、`beacon`）用自己的類型，`postback` 用 `postback`，其他進站訊息用 `message`。`unfollow` 事件 SHALL NOT 觸發任何流程，包括沒有設定 `eventType` 的流程。

#### Scenario: 加好友觸發「加好友」流程
- **WHEN** 啟用中的流程 `triggerConfig.eventType` 為 `follow`，LINE 渠道收到 `follow` 事件
- **THEN** 系統為該聯絡人建立一筆該流程的 execution

#### Scenario: 加好友不觸發「收到訊息」流程
- **WHEN** 啟用中的流程 `triggerConfig.eventType` 為 `message`，LINE 渠道收到 `follow` 事件
- **THEN** 系統不建立該流程的 execution

#### Scenario: 封鎖不觸發流程
- **WHEN** 啟用中的流程沒有設定 `eventType`，已存在的渠道身分送來 `unfollow` 事件
- **THEN** 系統不建立該流程的 execution

#### Scenario: 文字訊息觸發「收到訊息」流程
- **WHEN** 啟用中的流程 `triggerConfig.eventType` 為 `message`，LINE 渠道收到一則文字訊息
- **THEN** 系統為該聯絡人建立一筆該流程的 execution
