## MODIFIED Requirements

### Requirement: 首次進站時送出招呼語

當某渠道的聯絡人身分（channel + uid）為首次建立，且該渠道已設定招呼語時，系統 SHALL 送出一則招呼訊息，並使其寫入對話紀錄、推送至該渠道。

LINE 加好友（`follow`）事件帶 replyToken 時，系統 SHALL 以 reply 送出招呼語；超過 reply 的安全時間或 reply 失敗時，系統 SHALL 改以 push 送出一次。其他事件的招呼語 SHALL 以 push 送出，不使用該事件的 replyToken。

聯絡人由留言自動私訊建立（留言收件時建立的聯絡人）時，該聯絡人第一次進站 SHALL NOT 送出招呼語，不論渠道身分是在私訊成功時建立、或在第一次進站時才建立。

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

#### Scenario: 留言私訊後顧客第一次回覆

- **GIVEN** FB 渠道已設定招呼語
- **AND** 顧客的留言命中規則，系統建立聯絡人並私訊成功
- **WHEN** 顧客第一次回覆私訊
- **THEN** 不送出招呼訊息，顧客訊息照常落地

#### Scenario: 留言建立的聯絡人自己傳私訊

- **GIVEN** FB 渠道已設定招呼語
- **AND** 顧客的留言命中規則、私訊失敗，聯絡人只有留言者對應、沒有渠道身分
- **WHEN** 顧客自己傳第一則私訊，系統把渠道身分建在那位聯絡人
- **THEN** 不送出招呼訊息

### Requirement: 聯絡人建立時發布 contact.created 事件

當系統建立新聯絡人時，SHALL 發布 `contact.created` 事件，使既有自動化引擎可以此為觸發條件。

由留言收件建立的聯絡人，建立當下 SHALL NOT 發布；該聯絡人第一次在任一渠道有進站訊息時 SHALL 發布一次，之後 SHALL NOT 再發布。

#### Scenario: 新聯絡人建立

- **GIVEN** 全新粉絲首次來訊
- **WHEN** 系統建立該聯絡人
- **THEN** 發布 `contact.created` 事件，並帶有該聯絡人與租戶資訊

#### Scenario: 事件發布失敗不影響主流程

- **GIVEN** 事件發布過程發生錯誤
- **WHEN** 系統處理該筆 inbound 訊息
- **THEN** 聯絡人、對話與訊息仍正常建立

#### Scenario: 留言收件建立聯絡人時不發布

- **WHEN** 留言命中規則，系統建立新聯絡人
- **THEN** 沒有發布 `contact.created`

#### Scenario: 留言建立的聯絡人第一次進站時發布一次

- **GIVEN** 留言收件建立的聯絡人
- **WHEN** 該聯絡人第一次回覆私訊，之後再傳第二則
- **THEN** 第一次回覆時發布 1 次 `contact.created`，第二則沒有再發布
