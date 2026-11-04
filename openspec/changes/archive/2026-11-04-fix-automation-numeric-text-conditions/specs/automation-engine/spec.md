## ADDED Requirements

### Requirement: 條件值依欄位型別儲存

規則編輯器儲存條件時，SHALL 依欄位在自動化契約的型別轉換比較值：`number` 欄位的數字字串 SHALL 存成數字，`boolean` 欄位的「true」「false」SHALL 存成布林值，其他欄位（`string`、`string_array`、`datetime`，以及契約沒有定義的欄位）SHALL 保留字串，即使字串全是數字。載入既有規則時，比較值 SHALL 以字串顯示，再次儲存時依同一規則轉換。

#### Scenario: 文字欄位的純數字保留字串
- **WHEN** 管理員建立條件「訊息內容 包含 8888」並儲存
- **THEN** 送出的條件是 `{ "fact": "message.text", "operator": "contains", "value": "8888" }`，`value` 是字串

#### Scenario: 數字欄位轉成數字
- **WHEN** 管理員建立條件「開啟案件數 等於 3」並儲存
- **THEN** 送出的條件 `value` 是數字 3

#### Scenario: 是／否欄位轉成布林
- **WHEN** 管理員建立條件「聯絡人是 VIP 等於 是」並儲存
- **THEN** 送出的條件 `value` 是布林值 true

#### Scenario: 重存舊規則修正型別
- **WHEN** 既有規則的條件是 `message.text` contains 數字 8888，管理員開啟編輯器後直接儲存
- **THEN** 送出的條件 `value` 是字串「8888」

### Requirement: 文字欄位比對數字比較值

規則引擎評估條件時，欄位值是字串（或字串清單的元素）而比較值是有限的數字時，`equal`、`notEqual`、`in`、`notIn`、`contains`、`notContains`、`containsAny`、`containsAll`、`startsWith`、`textContains`、`matchesRegex` SHALL 把比較值轉成字串後比對。欄位值是數字時，比對方式 SHALL 不變。workers 實際觸發與「試試看」（`POST /api/v1/automation/rules/:id/test`）SHALL 用同一套運算子，對同一組資料得出相同結果。

#### Scenario: 訊息內容包含數字比較值
- **WHEN** 已啟用的 `message.received` 規則條件是 `message.text` contains 數字 8888，客人傳來「我的單號 8888」
- **THEN** 規則觸發

#### Scenario: 試試看與實際觸發一致
- **WHEN** 管理員對條件是 `message.text` contains 數字 8888 的規則試跑，填入訊息內容「單號 8888」
- **THEN** 試跑結果 `matched` 為 true

#### Scenario: 文字欄位等於數字比較值
- **WHEN** 規則條件是 `contact.name` equal 數字 1，聯絡人名稱是「1」
- **THEN** 條件成立；聯絡人名稱是「12」時不成立

#### Scenario: 標籤包含數字比較值
- **WHEN** 規則條件是 `contact.tags` contains 數字 8888，聯絡人的標籤是「8888」「VIP」
- **THEN** 條件成立

#### Scenario: 不包含數字比較值
- **WHEN** 規則條件是 `message.text` notContains 數字 8888，訊息是「單號 8888」
- **THEN** 條件不成立

#### Scenario: 數字欄位比對不變
- **WHEN** 規則條件是 `case.open.count` equal 數字 0，開啟案件數是 0
- **THEN** 條件成立；開啟案件數是 1 時不成立
