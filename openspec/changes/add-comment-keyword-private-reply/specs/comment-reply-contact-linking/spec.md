## ADDED Requirements

### Requirement: 留言命中規則時建立或沿用聯絡人
建立觸發紀錄的同一個交易內，系統 SHALL 為留言者找到或建立聯絡人，不論私訊之後是否成功：先找該渠道的留言者對應；再找該渠道 `uid` 等於留言者 ID 的渠道身分與 IdentityMap；都沒有時建立聯絡人（名稱用 FB 名稱或 IG `@帳號`），並記錄留言者對應。這時 SHALL NOT 建立渠道身分。同一渠道的同一位留言者 SHALL 只對應一位聯絡人。

#### Scenario: 新留言者
- **WHEN** 系統中沒有任何資料的 FB 留言者 `from: { id: 'U1', name: '王小明' }` 命中規則
- **THEN** 建立 1 位名稱「王小明」的聯絡人，沒有渠道身分；紀錄詳情顯示這位聯絡人

#### Scenario: 私訊失敗仍保留聯絡人
- **WHEN** 新留言者的私訊 Meta 回 551
- **THEN** 那位聯絡人仍存在，紀錄是 `FAILED`

#### Scenario: 舊顧客留言
- **WHEN** IG 留言者的 IGSID 已是本渠道某位聯絡人的渠道身分
- **THEN** 不建立新聯絡人，紀錄對應到那位聯絡人

#### Scenario: 同一人兩則留言並行
- **WHEN** 同一位新留言者的兩則留言同時進來，都命中規則
- **THEN** 只有 1 位聯絡人、1 筆留言者對應

#### Scenario: 不送招呼語也不發建立事件
- **WHEN** 留言收件建立了新聯絡人
- **THEN** 沒有發布 `contact.created`，Meta 沒有收到招呼語

### Requirement: 私訊成功後以 recipient_id 接上渠道身分
私訊 `SENT` 的同一個交易內，系統 SHALL 以 Meta 回傳的 `recipient_id` 接上同一個人：該渠道沒有這個 `uid` 的身分時，建在留言者的聯絡人下；已存在且屬於另一位聯絡人時，若留言者的聯絡人是留言收件建立的，SHALL 以聯絡人合併引擎把它併入那位聯絡人（來源 `COMMENT_REPLY`），不留下重複聯絡人。

#### Scenario: 新留言者私訊成功
- **WHEN** 新留言者私訊成功，`recipient_id` 是 `PSID-1`
- **THEN** 留言者的聯絡人有一個 `uid` 為 `PSID-1` 的渠道身分

#### Scenario: 留言者 ID 與 PSID 不同
- **WHEN** FB 留言的 `from.id` 是 `U1`，私訊回應的 `recipient_id` 是 `PSID-1`
- **THEN** 渠道身分的 `uid` 是 `PSID-1`，聯絡人名稱仍是留言者名稱

#### Scenario: PSID 已屬於舊顧客
- **WHEN** 留言收件為 `U1` 建了聯絡人 A，私訊回應的 `PSID-1` 已是聯絡人 B 的渠道身分
- **THEN** A 被併入 B（封存、`mergedIntoId` 是 B），合併紀錄來源是 `COMMENT_REPLY`；有效聯絡人只有 B

#### Scenario: 顧客回覆比寫結果先到
- **WHEN** 顧客回覆私訊的 webhook 在系統寫入 `SENT` 之前到達，進站流程先建了聯絡人 C
- **THEN** 最後有效聯絡人只有 1 位，訊息與紀錄都對應到同一位

### Requirement: 顧客第一次回覆時對話標記來源並補入私訊
顧客第一次回覆留言私訊時，系統 SHALL 找到該渠道 `recipientUid` 等於發送者、30 天內 `SENT`、尚未關聯對話的最新紀錄，在對話補入一則系統訊息（來源說明）與私訊快照，順序為系統訊息、私訊、顧客訊息，並把紀錄關聯到對話。每筆紀錄 SHALL 只關聯一次；關聯失敗 SHALL NOT 影響顧客訊息落地。

#### Scenario: 顧客第一次回覆
- **WHEN** 私訊成功後顧客回覆「我要」
- **THEN** 對話依時間排序是系統訊息、私訊快照、「我要」三則；紀錄的 `conversationId` 與 `customerRepliedAt` 有值；聯絡人總數不變

#### Scenario: 顧客再傳第二則
- **WHEN** 顧客接著再傳一則訊息
- **THEN** 不再補系統訊息與私訊快照

#### Scenario: 兩則回覆並行
- **WHEN** 顧客的兩則回覆 webhook 同時進來
- **THEN** 系統訊息與私訊快照各只有 1 則

#### Scenario: echo 不重複
- **WHEN** Meta 送回這則私訊的 `message_echoes`
- **THEN** 對話中沒有重複的私訊

#### Scenario: 一般私訊不受影響
- **WHEN** 沒有任何留言紀錄的顧客傳私訊
- **THEN** 對話沒有任何補入的系統訊息

#### Scenario: 關聯步驟丟錯
- **WHEN** 關聯步驟丟錯
- **THEN** 顧客訊息仍落地並推播

### Requirement: 收件匣標示來自留言的對話
對話的第一個來源是留言私訊時，系統 SHALL 記錄該紀錄為對話來源（之後的留言私訊不覆蓋），對話列表 API SHALL 回傳 `origin.type = 'comment_private_reply'`。系統訊息中的「查看留言紀錄」連結 SHALL 只對有 `comment_reply.view` 的成員顯示。

#### Scenario: 對話列表帶來源
- **WHEN** 顧客第一次回覆留言私訊後，客服讀對話列表
- **THEN** 該對話的 `origin.type` 是 `comment_private_reply`

#### Scenario: 已有對話的顧客再次留言
- **WHEN** 已有進行中對話的顧客再留言、收到私訊並回覆
- **THEN** 現有對話補入新的系統訊息與私訊快照，對話來源仍是第一筆紀錄

### Requirement: 合併與解除合併後紀錄顯示目前的聯絡人
紀錄 SHALL 經留言者對應連到聯絡人。聯絡人合併時留言者對應 SHALL 隨之搬到存活者，解除合併時搬回，紀錄詳情與列表顯示的聯絡人跟著改變。

#### Scenario: 合併後顯示存活者
- **WHEN** 有留言紀錄的聯絡人 A 被併入 B
- **THEN** 那些紀錄的詳情顯示聯絡人 B

#### Scenario: 解除合併後顯示原本的人
- **WHEN** 上述合併被解除
- **THEN** 那些紀錄的詳情顯示聯絡人 A
