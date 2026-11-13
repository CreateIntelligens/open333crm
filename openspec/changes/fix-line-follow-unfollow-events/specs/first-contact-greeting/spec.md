## MODIFIED Requirements

### Requirement: 首次進站時送出招呼語

當某渠道的聯絡人身分（channel + uid）為首次建立，且該渠道已設定招呼語時，系統 SHALL 送出一則招呼訊息，並使其寫入對話紀錄、推送至該渠道。

LINE 加好友（`follow`）事件帶 replyToken 時，系統 SHALL 以 reply 送出招呼語；超過 reply 的安全時間或 reply 失敗時，系統 SHALL 改以 push 送出一次。其他事件的招呼語 SHALL 以 push 送出，不使用該事件的 replyToken。

#### Scenario: 全新粉絲第一次傳訊息

- **GIVEN** 渠道已設定招呼語
- **AND** 該粉絲的渠道身分在系統中尚不存在
- **WHEN** 該粉絲傳送第一則訊息
- **THEN** 系統建立聯絡人與渠道身分
- **AND** 送出一則招呼訊息（`direction: OUTBOUND`）
- **AND** 該訊息寫入對話紀錄並推送至該渠道

#### Scenario: LINE 加好友當下即招呼

- **GIVEN** LINE 渠道已設定招呼語
- **WHEN** 粉絲加入該官方帳號為好友（`follow` 事件，帶 replyToken `R`）
- **THEN** 系統呼叫 LINE reply API，`replyToken` 為 `R`，訊息是招呼語；不呼叫 push API

#### Scenario: 加好友的 reply 失敗時改用 push

- **GIVEN** LINE 渠道已設定招呼語
- **WHEN** 粉絲加入好友，LINE reply API 回錯誤
- **THEN** 系統以 push API 送出同一則招呼語給該粉絲，一次

#### Scenario: 一般訊息的招呼語不用該訊息的 replyToken

- **GIVEN** LINE 渠道已設定招呼語
- **WHEN** 全新粉絲傳送第一則文字訊息（帶 replyToken）
- **THEN** 招呼語以 push API 送出

#### Scenario: 未設定招呼語的渠道維持現狀

- **GIVEN** 渠道未設定招呼語（未設定或為空字串）
- **WHEN** 全新粉絲首次來訊
- **THEN** 不送出任何招呼訊息
- **AND** inbound 訊息本身照常落地
