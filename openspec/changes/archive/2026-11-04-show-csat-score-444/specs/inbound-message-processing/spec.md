## MODIFIED Requirements

### Requirement: CSAT 回覆的攔截
進站的文字或 postback 符合 `csat:<分數>:<工單 ID>`，而且分數是 1～5 時，系統 SHALL 攔截這則訊息，SHALL NOT 發布 `message.received`。

只有在下列條件都成立時，系統 SHALL 寫入評分，並在工單的對話送出後續訊息：

- 工單屬於收訊的租戶。
- 工單的聯絡人是傳訊的聯絡人。
- 工單還沒有評分。

條件不成立時，系統 SHALL NOT 修改任何工單，也 SHALL NOT 送出訊息。進站管線以略過 RLS 的連線執行，所以這些條件 SHALL 寫在查詢工單的條件裡。

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
