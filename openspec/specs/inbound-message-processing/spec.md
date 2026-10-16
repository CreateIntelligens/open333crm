## Purpose
定義進站管線（`processInboundMessage`）處理 webhook、WebChat 與 chatbox 訊息的行為：略過或丟棄的事件、去重、一般訊息的保存與通知，以及跨渠道綁定、CSAT 與 KB 回饋的攔截。新 UID 建立聯絡人見 `inbound-contact-resolution`，轉真人的攔截見 `bot-handoff-config`。

## Requirements

### Requirement: Identity binding intercept precedes greeting and automation
When the tenant has identity binding enabled, inbound processing SHALL check each inbound event for a binding keyword, a binding code (in text, or in a FB/IG referral `ref`), or an unbind keyword **before** the first-contact greeting runs. When one matches, the system SHALL handle it and SHALL NOT send the first-contact greeting.

#### Scenario: New LINE friend sends a binding code
- **WHEN** a first-time LINE user sends a message containing a valid binding code
- **THEN** the system SHALL merge the contacts, SHALL NOT send the first-contact greeting, SHALL NOT trigger AI reply or keyword rules, and the message SHALL appear in the inbox

#### Scenario: Binding disabled
- **WHEN** identity binding is disabled for the tenant
- **THEN** inbound processing SHALL behave exactly as before this change

### Requirement: Intercepted binding events skip automation but reach the inbox
When the identity binding intercept handles an inbound event, the system SHALL NOT run the other postback interceptors and SHALL NOT publish `message.received`. It SHALL still emit the inbound socket events so agents see the message in the inbox.

#### Scenario: Binding code skips AI and keyword rules
- **WHEN** a customer sends a message containing a valid binding code
- **THEN** the system SHALL NOT trigger AI reply or keyword rules, and the message SHALL appear in the inbox

### Requirement: FB and Instagram referral events are parsed
The FB and Instagram channel plugins SHALL parse referral events (FB `messaging_referrals`, standalone `referral`, and `referral` nested in `message` or `postback`; Instagram `messaging_referral` for existing threads, and `referral` nested in the first `messages` or `messaging_postback` event of a new thread) and expose the `ref` value on the parsed event as `referralRef`. A referral-only event whose `ref` is not a binding code SHALL be logged and SHALL NOT create an inbox message.

#### Scenario: m.me link with ref
- **WHEN** FB delivers a `referral` event with `ref = BIND-7K2M9QH4TX` and source `SHORTLINK`
- **THEN** the parsed event SHALL have `referralRef = "BIND-7K2M9QH4TX"` and be processed by the identity binding intercept

#### Scenario: Unrelated referral
- **WHEN** FB delivers a referral event from an ad with `ref = spring_sale`
- **THEN** the system SHALL log it and SHALL NOT create a message in the inbox

### Requirement: 以平台訊息 ID 去重
進站訊息帶 `channelMsgId`（平台的訊息 ID）時，系統 SHALL 以 `(conversationId, channelMsgId)` 去重。同一段對話已有相同 `channelMsgId` 的訊息時，`processInboundMessage` SHALL 回傳既有的訊息與 `duplicate: true`，SHALL NOT 建立新訊息、更新對話、發出 socket 事件或發布 `message.received`。

兩個相同的請求同時通過查重、寫入時撞到資料庫的唯一限制，後寫入的一方 SHALL 以同樣的方式視為重複。

#### Scenario: 平台重送同一則訊息
- **WHEN** 同一段對話已有 `channelMsgId` 為 `m-1` 的訊息，平台再送一次 `channelMsgId` 為 `m-1` 的訊息
- **THEN** `processInboundMessage` 回傳既有的訊息與 `duplicate: true`，沒有建立訊息，沒有發出 socket 事件，也沒有發布 `message.received`

#### Scenario: 兩個相同的請求同時寫入
- **WHEN** 查重時沒有 `channelMsgId` 為 `m-1` 的訊息，建立訊息時資料庫回傳唯一限制錯誤（P2002），再查詢時找到另一個請求剛建立的訊息
- **THEN** `processInboundMessage` 回傳那則訊息與 `duplicate: true`，沒有更新對話，也沒有發布 `message.received`

### Requirement: 停用租戶的進站事件直接丟棄
渠道所屬的租戶停用時，即使渠道本身仍啟用，系統 SHALL 丟棄該渠道收到的進站事件：不建立渠道身分、聯絡人、對話與訊息，只記錄 warn log。

租戶停用是預期內的情況，不是錯誤。LINE 的 webhook 路由 SHALL 照常回 HTTP 200，平台不會因此重送事件。

#### Scenario: 停用租戶的渠道收到訊息
- **WHEN** 租戶已停用、渠道仍啟用，渠道收到一則簽章正確的訊息事件
- **THEN** 系統沒有建立渠道身分、聯絡人、對話與訊息；同時間啟用中租戶的渠道收到的訊息照常建立渠道身分

#### Scenario: LINE 的 webhook 路由照常回 200
- **WHEN** 租戶已停用，該租戶的 LINE 渠道收到一則簽章正確的 webhook 請求
- **THEN** 路由回 HTTP 200

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
