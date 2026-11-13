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
渠道所屬的租戶停用（含試用到期自動停用）時，即使渠道本身仍啟用，系統 SHALL 丟棄該渠道收到的進站事件：不建立渠道身分、聯絡人、對話與訊息，只記錄 warn log。所有渠道共用的進站入口 `processInboundMessage` SHALL 做這個檢查；查不到租戶時視為停用。webhook 在驗簽之前也提早丟棄。

租戶停用是預期內的情況，不是錯誤。LINE 的 webhook 路由 SHALL 照常回 HTTP 200，平台不會因此重送事件。

#### Scenario: 停用租戶的渠道收到訊息
- **WHEN** 租戶已停用、渠道仍啟用，渠道收到一則簽章正確的訊息事件
- **THEN** 系統沒有建立渠道身分、聯絡人、對話與訊息；同時間啟用中租戶的渠道收到的訊息照常建立渠道身分

#### Scenario: LINE 的 webhook 路由照常回 200
- **WHEN** 租戶已停用，該租戶的 LINE 渠道收到一則簽章正確的 webhook 請求
- **THEN** 路由回 HTTP 200

#### Scenario: 共用入口 processInboundMessage 丟棄停用租戶的進站事件
- **WHEN** 租戶已停用，呼叫端直接以該租戶的渠道呼叫 `processInboundMessage` 處理一則文字訊息
- **THEN** `processInboundMessage` 回傳 `undefined`，沒有建立渠道身分與訊息

### Requirement: 沒有聯絡人 UID 的進站事件直接略過
解析後的進站事件沒有聯絡人 UID（`contactUid` 是空值）時，`processInboundMessage` SHALL 直接結束。系統 SHALL NOT 建立聯絡人、渠道身分、對話或訊息，也 SHALL NOT 推送 socket 事件或發布 EventBus 事件。

#### Scenario: 進站事件沒有聯絡人 UID
- **WHEN** 進站事件的 `contactUid` 是空字串
- **THEN** `processInboundMessage` 回傳 `undefined`，不查詢渠道身分，不推送 socket 事件，也不發布 EventBus 事件

### Requirement: 一般進站訊息的保存與通知
進站訊息不是重複的訊息，也沒有被攔截時，系統 SHALL 依序做下列事情：

1. 存入一則 `INBOUND` 訊息。
2. 對話的 `unreadCount` 加 1，並更新 `lastMessageAt`。
3. 推送 `message.new` 與 `conversation.updated`，對象是對話的房間 `conversation:<對話 ID>` 與渠道房間（`tenant:<租戶 ID>:channel:<渠道 ID>`、`tenant:<租戶 ID>:channels:all`），不送到租戶的房間 `tenant:<租戶 ID>`（issue #427）。
4. 發布 EventBus 事件 `message.received`，`payload.messageId` 是這則訊息的 ID。

`processInboundMessage` SHALL 回傳 `duplicate: false`。

#### Scenario: 一般進站訊息
- **WHEN** 訪客第一次從 WebChat 渠道送出文字訊息 `hello`
- **THEN** 對話有一則 `INBOUND` 訊息，`unreadCount` 是 1，`lastMessageAt` 有值；`message.new` 與 `conversation.updated` 都推送到對話與渠道房間；`message.received` 發布一次，`payload.messageId` 是這則訊息的 ID

### Requirement: CSAT 回覆的攔截
進站的文字或 postback 符合 `csat:<分數>:<工單 ID>`，而且分數是 1～5 時，系統 SHALL 攔截這則訊息，SHALL NOT 發布 `message.received`。

只有在下列條件都成立時，系統 SHALL 寫入評分，並在工單的對話送出後續訊息：

- 工單屬於收訊的租戶。
- 工單的聯絡人是傳訊的聯絡人。
- 工單還沒有評分。

條件不成立時，系統 SHALL NOT 修改任何工單，也 SHALL NOT 送出訊息。進站管線以略過 RLS 的連線執行，所以這些條件 SHALL 寫在查詢工單的條件裡；「還沒有評分」SHALL 寫在寫入分數的條件更新裡，同一份評分同時送達兩次時只有一次寫入（csat-survey「評分只處理一次」）。

攔截之後，不論分數是否寫入，系統 SHALL 把這則進站訊息的內容改寫成「我的評分：<分數> 分」（與 LINE 問卷按鈕的 `displayText` 相同），並把原始文字存在這則訊息的 `metadata.postbackData`，讓收件匣與其他讀取端不顯示 `csat:` 代碼。

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

#### Scenario: 評分的訊息在收件匣顯示文字
- **WHEN** 聯絡人回覆 `csat:2:<工單 ID>`（LINE 問卷按鈕的 postback，或同格式的文字）
- **THEN** 對話中這則客人訊息的 `content.text` 是「我的評分：2 分」，`metadata.postbackData` 是 `csat:2:<工單 ID>`，系統不發布 `message.received`

#### Scenario: 同一份評分同時送達兩次
- **WHEN** 聯絡人在 LINE 問卷上連點兩次，兩則 `csat:2:<工單 ID>` 同時進站
- **THEN** 工單的評分是 2，對話中只有一則感謝訊息

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

### Requirement: 停用租戶的網站聊天室入口回 404
租戶停用（含試用到期自動停用）時，網站聊天室建立工作階段、送訊息、bootstrap 與訪客 socket（`/visitor`）驗證工作階段 SHALL 比照渠道停用回 HTTP 404，`error.code` 是 `NOT_FOUND`。系統 SHALL NOT 建立聯絡人、對話或訊息。租戶啟用時行為不變。

#### Scenario: 啟用中的租戶：訪客送訊息照常寫入（對照組）
- **WHEN** 租戶啟用中，訪客以認領過的工作階段送一則文字訊息
- **THEN** 系統寫入一則進站訊息

#### Scenario: 既有的工作階段在租戶停用後送訊息
- **WHEN** 訪客在租戶啟用時開了工作階段，租戶停用之後訪客以同一個工作階段送一則文字訊息
- **THEN** 系統回 404 `NOT_FOUND`，沒有寫入訊息

#### Scenario: 租戶停用後新訪客建立工作階段
- **WHEN** 租戶已停用，新訪客以渠道公開金鑰建立工作階段
- **THEN** 系統回 404 `NOT_FOUND`，沒有建立聯絡人與對話

#### Scenario: 租戶停用後訪客 socket 驗證工作階段
- **WHEN** 租戶停用之後，訪客以既有的工作階段與認領憑證連線 `/visitor`
- **THEN** 驗證工作階段回 404 `NOT_FOUND`，連線被拒

### Requirement: 去識別化服務短暫故障時重試一次

租戶開啟 AI 個資遮罩時，系統呼叫去識別化服務遇到逾時、連線或 DNS 錯誤、HTTP 5xx，SHALL 等待約 300 毫秒後重試一次；每次嘗試的逾時 SHALL 是 6 秒。去識別化服務回 4xx、回應格式不符或回應過大時，系統 SHALL NOT 重試。

#### Scenario: 重試一次成功

- **WHEN** 租戶開啟遮罩，去識別化服務第一次回 503、第二次回正常結果，客人傳送「我的電話 0912345678」
- **THEN** 系統呼叫去識別化服務兩次，訊息照常存入，`metadata.privacy.mode` 是 `inbound`，`metadata.privacy.maskedContent` 是去識別化服務回傳的遮罩文字

#### Scenario: 去識別化服務回 400 不重試

- **WHEN** 租戶開啟遮罩，去識別化服務回 400
- **THEN** 系統只呼叫去識別化服務一次

### Requirement: 去識別化服務無法使用時進站訊息存原文並標記未遮罩

租戶開啟 AI 個資遮罩，進站訊息在重試之後仍無法遮罩時，系統 SHALL 照常存入訊息：`content` 是原文，`metadata.privacy` 是 `{ version: 1, mode: 'inbound_unmasked', reason }`，`reason` 是失敗原因代碼（`timeout`、`network`、`upstream_5xx`、`upstream_rejected`、`invalid_response`、`too_large`），沒有遮罩副本。系統 SHALL NOT 丟出例外，SHALL 照常推送 `message.new` 與 `conversation.updated`，並發布 `message.received`，`payload.privacyUnmasked` 是 `true`。

#### Scenario: 去識別化服務回 503

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人從 WebChat 傳送「我的電話 0912345678」
- **THEN** 系統呼叫去識別化服務兩次，對話有一則 `INBOUND` 訊息，`content.text` 是原文，`metadata.privacy.mode` 是 `inbound_unmasked`，`metadata.privacy.reason` 是 `upstream_5xx`，`message.received` 發布一次且 `payload.privacyUnmasked` 是 `true`

#### Scenario: 去識別化服務逾時

- **WHEN** 租戶開啟遮罩，兩次呼叫去識別化服務都逾時
- **THEN** 訊息照常存入，`metadata.privacy.reason` 是 `timeout`

#### Scenario: 去識別化服務的網址解析失敗

- **WHEN** 租戶開啟遮罩，兩次呼叫去識別化服務都因 DNS 解析失敗丟出連線錯誤
- **THEN** 訊息照常存入，`metadata.privacy.reason` 是 `network`

#### Scenario: 去識別化服務正常

- **WHEN** 租戶開啟遮罩，去識別化服務正常，客人傳送文字
- **THEN** 系統呼叫去識別化服務一次，`metadata.privacy.mode` 是 `inbound` 並帶遮罩副本，`message.received` 的 payload 沒有 `privacyUnmasked`，系統沒有發出維運告警

### Requirement: 進站訊息未遮罩時發出維運告警

進站訊息因去識別化服務無法使用而存成未遮罩時，系統 SHALL 在訊息存入之後、不在任何交易內，以合併鍵 `deidentification-unavailable` 發出維運告警（ops-alert「同一個合併鍵在 10 分鐘內只送一則」）。告警欄位 SHALL 只有租戶 ID、渠道類型與失敗原因代碼，SHALL NOT 包含訊息內容。發出告警失敗 SHALL 只記錄，SHALL NOT 影響訊息的保存與後續處理。

#### Scenario: 未遮罩的進站訊息發出告警

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人傳送「我的電話 0912345678」
- **THEN** 系統以合併鍵 `deidentification-unavailable` 發出一則告警，欄位有租戶 ID 與原因 `upstream_5xx`，告警內容不含「0912345678」

#### Scenario: 發出告警失敗

- **WHEN** 去識別化服務一直回 503，發出告警時 Redis 丟出錯誤
- **THEN** 訊息照常存入並標記未遮罩，`message.received` 照常發布

### Requirement: 系統事件不觸發非營業時間的自動回覆
進站事件的 `contentType` 是系統事件（`follow`、`unfollow`、`join`、`leave`、`memberJoined`、`memberLeft`、`unsend`、`videoPlayComplete`、`accountLink`、`beacon`）時，系統 SHALL NOT 送出非營業時間的自動回覆，也 SHALL NOT 寫入自動回覆訊息。判斷依外掛解析後的 `contentType`，不依渠道類型。

#### Scenario: 非營業時間有人加好友
- **WHEN** 租戶開啟營業時間且現在是非營業時間，LINE 渠道收到 `follow` 事件
- **THEN** 對話裡沒有 `metadata.source` 為 `office_hours_auto_reply` 的訊息，系統沒有送出非營業時間訊息

#### Scenario: 非營業時間有人封鎖
- **WHEN** 租戶開啟營業時間且現在是非營業時間，已存在的渠道身分送來 `unfollow` 事件
- **THEN** 對話裡沒有 `metadata.source` 為 `office_hours_auto_reply` 的訊息

#### Scenario: 非營業時間的一般訊息照舊自動回覆
- **WHEN** 租戶開啟營業時間且現在是非營業時間，LINE 渠道收到一則文字訊息
- **THEN** 對話裡有一則 `metadata.source` 為 `office_hours_auto_reply` 的訊息，系統送出非營業時間訊息
