## MODIFIED Requirements

### Requirement: 推播的房間由系統決定

交易內登記推播時，呼叫端 MUST 只指定推播名稱與內容；給單一客服人員的推播，再指定該客服人員的 ID；渠道推播，再指定渠道 ID 與（有的話）對話 ID。呼叫端 MUST NOT 指定房間名稱。系統 MUST 依推播的種類決定房間：

- 全租戶推播：送到交易綁定租戶的房間 `tenant:<tenantId>`。內容不帶渠道的訊息或對話資料。
- 渠道推播（`message.new`、`conversation.updated`、`conversation.created`）：送到 `tenant:<tenantId>:channel:<channelId>` 與 `tenant:<tenantId>:channels:all`，有對話 ID 時也送到 `conversation:<conversationId>`；MUST NOT 送到 `tenant:<tenantId>`。
- 給客服人員的推播：送到帶交易綁定租戶 ID 的成員房間 `tenant:<tenantId>:agent:<agentId>`。

各種房間的租戶 ID 都由交易綁定的租戶組成，所以推播不會送到別的租戶的連線。

#### Scenario: 全租戶推播

- **WHEN** 綁定租戶 A 的交易內登記推播 `case.updated`，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>`，MUST NOT 送到其他房間

#### Scenario: 渠道推播

- **WHEN** 綁定租戶 A 的交易內登記渠道 C 的推播 `message.new`，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>:channel:<C 的 ID>` 與 `tenant:<A 的 ID>:channels:all`，MUST NOT 送到 `tenant:<A 的 ID>`

#### Scenario: 給客服人員的推播

- **WHEN** 綁定租戶 A 的交易內，登記給客服人員 X 的推播 `notification.new`，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>:agent:<X 的 ID>`，MUST NOT 送到其他房間

#### Scenario: 給客服人員的推播用了別的租戶的客服人員 ID

- **WHEN** 綁定租戶 A 的交易內，登記給客服人員 Y 的推播，Y 屬於租戶 B，之後交易 commit
- **THEN** 系統 MUST 把該推播送到 `tenant:<A 的 ID>:agent:<Y 的 ID>`；Y 的連線只加入 `tenant:<B 的 ID>:agent:<Y 的 ID>`，所以 MUST NOT 收到該推播
