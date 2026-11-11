## REMOVED Requirements

### Requirement: Process inbound message facade remains compatible
**Reason**: 這是重構 `processInboundMessage` 時的介面約束，不是系統對外的行為。
**Migration**: 無。呼叫端照常使用 `processInboundMessage`。

### Requirement: Inbound message behavior remains unchanged
**Reason**: 這是重構時「行為不變」的要求。其中的長期行為改寫成獨立的需求或已由其他主規格涵蓋。
**Migration**: 沒有聯絡人 UID 的事件改寫成「沒有聯絡人 UID 的進站事件直接略過」；一般訊息改寫成「一般進站訊息的保存與通知」；新 UID 建立聯絡人見 `inbound-contact-resolution`；`clientMessageId` 去重見 `webchat-message-contract`。

### Requirement: Postback intercept behavior remains unchanged
**Reason**: 這是重構時「攔截行為不變」的要求。其中的長期行為改寫成獨立的需求或已由其他主規格涵蓋。
**Migration**: CSAT 改寫成「CSAT 回覆的攔截」；KB 回饋改寫成「KB 回饋的攔截」；轉真人見 `bot-handoff-config` 的「Webhook intercepts handoff_request postback」。

### Requirement: Processing reuses caller-provided Prisma and per-message objects
**Reason**: 這是重構時的實作細節。不自行建立 Prisma client 已是 `AGENTS.md` 的結構規則 2。
**Migration**: 無。

### Requirement: Refactor does not alter external contracts
**Reason**: 「不需要 migration」只在重構當時有意義；socket 與事件的內容改由「一般進站訊息的保存與通知」規定。
**Migration**: 無。

## ADDED Requirements

### Requirement: 沒有聯絡人 UID 的進站事件直接略過
解析後的進站事件沒有聯絡人 UID（`contactUid` 是空值）時，`processInboundMessage` SHALL 直接結束。系統 SHALL NOT 建立聯絡人、渠道身分、對話或訊息，也 SHALL NOT 推送 socket 事件或發布 EventBus 事件。

#### Scenario: 進站事件沒有聯絡人 UID
- **WHEN** 進站事件的 `contactUid` 是空字串
- **THEN** `processInboundMessage` 回傳 `undefined`，不查詢渠道身分，不推送 socket 事件，也不發布 EventBus 事件

### Requirement: 一般進站訊息的保存與通知
進站訊息不是重複的訊息，也沒有被攔截時，系統 SHALL 依序做下列事情：

1. 存入一則 `INBOUND` 訊息。
2. 對話的 `unreadCount` 加 1，並更新 `lastMessageAt`。
3. 推送 `message.new` 與 `conversation.updated`，對象是對話的房間 `conversation:<對話 ID>` 與租戶的房間 `tenant:<租戶 ID>`。
4. 發布 EventBus 事件 `message.received`，`payload.messageId` 是這則訊息的 ID。

`processInboundMessage` SHALL 回傳 `duplicate: false`。

#### Scenario: 一般進站訊息
- **WHEN** 訪客第一次從 WebChat 渠道送出文字訊息 `hello`
- **THEN** 對話有一則 `INBOUND` 訊息，`unreadCount` 是 1，`lastMessageAt` 有值；`message.new` 與 `conversation.updated` 都推送到對話與租戶的房間；`message.received` 發布一次，`payload.messageId` 是這則訊息的 ID

### Requirement: CSAT 回覆的攔截
進站的文字或 postback 符合 `csat:<分數>:<工單 ID>`，而且分數是 1～5 時，系統 SHALL 攔截這則訊息，SHALL NOT 發布 `message.received`。

只有在下列條件都成立時，系統 SHALL 寫入評分，並在工單的對話送出後續訊息：

- 工單屬於收訊的租戶。
- 工單的聯絡人是傳訊的聯絡人。
- 工單還沒有評分。

條件不成立時，系統 SHALL NOT 修改任何工單，也 SHALL NOT 送出訊息。進站管線以略過 RLS 的連線執行，所以這些條件 SHALL 寫在查詢工單的條件裡。

#### Scenario: 同租戶、同聯絡人的工單寫入評分
- **WHEN** 聯絡人回覆 `csat:5:<工單 ID>`，工單屬於收訊租戶與這位聯絡人，而且還沒有評分
- **THEN** 工單的評分是 5，系統不發布 `message.received`

#### Scenario: 其他租戶的工單
- **WHEN** 聯絡人回覆的工單 ID 屬於其他租戶
- **THEN** 該工單的評分不變，系統不在該工單的對話送出訊息，也不發布 `message.received`

#### Scenario: 同租戶其他聯絡人的工單
- **WHEN** 聯絡人回覆的工單屬於收訊租戶，但工單的聯絡人是另一位聯絡人
- **THEN** 該工單的評分不變，系統不發布 `message.received`

#### Scenario: 不存在的工單
- **WHEN** 聯絡人回覆的工單 ID 不存在
- **THEN** 系統不修改任何工單，也不發布 `message.received`

### Requirement: KB 回饋的攔截
進站的文字或 postback 符合 `kb_feedback:<good 或 bad>:<文章 ID 或 none>:<Bot 訊息 ID>` 時，系統 SHALL 攔截這則訊息，SHALL NOT 發布 `message.received`。

系統 SHALL 只在文章屬於收訊租戶時，寫入一筆 KB 回饋，記錄評價、文章、Bot 訊息與傳訊的聯絡人。文章 ID 是 `none` 或屬於其他租戶時，系統 SHALL NOT 寫入回饋。不論有沒有寫入，系統都 SHALL 在對話送出感謝訊息。

#### Scenario: KB 回饋寫入收訊租戶的文章
- **WHEN** 聯絡人回覆 `kb_feedback:good:<文章 ID>:<Bot 訊息 ID>`，文章屬於收訊租戶
- **THEN** 系統寫入一筆評價為 `good` 的回饋，聯絡人是傳訊者；對話收到感謝訊息；系統不發布 `message.received`

#### Scenario: KB 回饋引用其他租戶的文章
- **WHEN** 聯絡人回覆的文章 ID 屬於其他租戶
- **THEN** 系統不寫入回饋；對話收到感謝訊息；系統不發布 `message.received`

#### Scenario: KB 回饋沒有對應的文章
- **WHEN** 聯絡人回覆 `kb_feedback:bad:none:<Bot 訊息 ID>`
- **THEN** 系統不寫入回饋；對話收到感謝訊息；系統不發布 `message.received`
