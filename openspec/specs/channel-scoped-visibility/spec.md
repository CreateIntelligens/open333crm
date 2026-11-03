# channel-scoped-visibility Specification

## Purpose
定義租戶內的渠道可見範圍怎麼套用：對話與工單的列表、單筆讀取與操作、存取層級、團隊對話，以及 socket 推播。可見渠道怎麼解析、新渠道與新成員的預設綁定見 `channel-visibility-defaults`；跨租戶隔離見 `tenant-isolation-rls`。

## Requirements

### Requirement: 列表查詢套用渠道過濾

對話列表、工單列表、聯絡人列表與群發列表 SHALL 只回傳成員可見的資料：對話、工單與群發看它們的渠道是否在可見渠道集合內；聯絡人依「聯絡人依渠道身份判斷可見」判斷。

#### Scenario: 對話列表只含可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，租戶有 CH-A 與 CH-B 的對話
- **THEN** 該成員的對話列表只含 CH-A 的對話

#### Scenario: 工單列表只含可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，租戶有關聯 CH-A 與 CH-B 的工單
- **THEN** 該成員的工單列表只含關聯 CH-A 的工單

#### Scenario: 聯絡人列表只含看得到的聯絡人
- **WHEN** 成員的可見渠道集合為 {CH-A}，租戶有只在 CH-B 有身份的聯絡人 P、在 CH-A 與 CH-B 都有身份的聯絡人 Q、沒有任何渠道身份的聯絡人 R
- **THEN** 該成員的聯絡人列表含 Q 與 R，不含 P，`total` 也不計入 P

#### Scenario: 群發列表只含可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，租戶有 CH-A 與 CH-B 的群發
- **THEN** 該成員的群發列表只含 CH-A 的群發

### Requirement: 單筆讀取與操作的存取檢查

成員以 ID 讀取或操作單一對話、工單、聯絡人或群發，而成員看不到該筆資料時，系統 SHALL 回 HTTP 404，與資源不存在時相同。系統 MUST NOT 回傳資源內容，也 MUST NOT 執行操作。聯絡人的操作包括修改、貼標、移除標籤、合併、解除合併，以及讀取它的對話、訊息、工單、時間軸與合併紀錄；群發的操作包括讀取收件人、送出與取消。

#### Scenario: 讀取不可見渠道的對話被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 ID 讀取 CH-B 的對話
- **THEN** 系統回 HTTP 404，不回傳對話內容

#### Scenario: 讀取不可見渠道的工單被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 ID 讀取關聯 CH-B 的工單
- **THEN** 系統回 HTTP 404，不回傳工單內容

#### Scenario: 操作不可見渠道的對話被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，對 CH-B 的對話送出回覆或關閉
- **THEN** 系統回 HTTP 404，不送出訊息，對話狀態不變

#### Scenario: 讀取看不到的聯絡人被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 ID 讀取只在 CH-B 有身份的聯絡人
- **THEN** 系統回 HTTP 404，不回傳聯絡人的姓名、電話與 email

#### Scenario: 修改看不到的聯絡人被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，修改只在 CH-B 有身份的聯絡人，或為他貼標
- **THEN** 系統回 HTTP 404，聯絡人的資料與標籤不變

#### Scenario: 解除看不到的聯絡人的合併被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，有 `contact.merge`，解除一筆保留方只在 CH-B 有身份的合併紀錄
- **THEN** 系統回 HTTP 404，合併紀錄維持未解除

#### Scenario: 送出不可見渠道的群發被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，有 `marketing.broadcast`，送出或取消 CH-B 的群發
- **THEN** 系統回 HTTP 404，群發的狀態不變，沒有送出任何訊息

### Requirement: 存取層級

成員對可見渠道的存取層級由低到高是 `read_only`、`reply_only`、`full`。同一個渠道有多個來源時，系統 SHALL 取最高的層級。對話與工單的操作 SHALL 要求下列層級：

- 讀取：`read_only`。
- 回覆、送出媒體、貼標與加註：`reply_only`。
- 修改、關閉與轉接對話；修改、刪除、指派、解決、關閉、重啟、升級工單，連結對話到工單，記錄滿意度：`full`。

層級不足時，系統 SHALL 回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，MUST NOT 執行操作。群發不受渠道存取層級限制，由權限碼 `marketing.broadcast` 控管，但群發的渠道 MUST 是可見渠道。

#### Scenario: 多個來源取最高層級
- **WHEN** 成員直接綁定渠道 CH-A 的層級是 `read_only`，所屬團隊對 CH-A 的層級是 `full`
- **THEN** 該成員對 CH-A 的層級是 `full`

#### Scenario: 唯讀成員不能回覆
- **WHEN** 成員對 CH-A 的層級是 `read_only`，對 CH-A 的對話送出回覆
- **THEN** 系統回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，不送出訊息

#### Scenario: 回覆層級不能關閉對話
- **WHEN** 成員對 CH-A 的層級是 `reply_only`，關閉 CH-A 的對話
- **THEN** 系統回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，對話狀態不變

#### Scenario: 群發不檢查渠道層級
- **WHEN** 成員有 `marketing.broadcast`，對 CH-A 的層級是 `read_only`，透過 CH-A 送出群發
- **THEN** 系統不因渠道層級拒絕這次群發

### Requirement: 團隊對話只限團隊成員操作

對話設定了所屬團隊（`teamId`）時，沒有 `channel.view_all` 的成員 MUST 是該團隊的成員或對話的被指派人，才能操作該對話或訂閱該對話的 socket 房間。不符合時，REST 操作 SHALL 回 HTTP 403，socket 訂閱 SHALL 被拒，即使該成員可見對話的渠道。

#### Scenario: 非團隊成員操作團隊對話被拒
- **WHEN** 對話屬於團隊「分店A」，成員可見對話的渠道，但不是「分店A」的成員，也不是被指派人，對該對話送出回覆
- **THEN** 系統回 HTTP 403，不送出訊息

#### Scenario: 被指派人可以操作
- **WHEN** 對話屬於團隊「分店A」，成員不是「分店A」的成員，但是對話的被指派人，且可見對話的渠道
- **THEN** 該成員可以回覆這段對話

### Requirement: 與即時推播一致

REST 查詢與 socket 推播 SHALL 使用同一個可見渠道的判斷。成員訂閱不可見渠道的渠道房間或對話房間時，系統 SHALL 拒絕訂閱。不可見渠道的訊息事件（`message.new`、`conversation.updated`、`conversation.created`）MUST NOT 送達該成員，包括送到租戶房間的事件。看得到該渠道的成員與有 `channel.view_all` 的成員 SHALL 照常收到這些事件。

#### Scenario: socket 與列表一致
- **WHEN** 成員不可見 CH-B，CH-B 收到一則新訊息
- **THEN** 該成員的對話列表看不到這則訊息，也收不到這則訊息的 `message.new` 與 `conversation.updated`

#### Scenario: 看得到的成員與總店照常收到
- **WHEN** CH-B 收到一則新訊息，成員 A1 的可用渠道有 CH-B，成員 HQ 有 `channel.view_all`
- **THEN** A1 與 HQ 都收到這則訊息的 `message.new`（含訊息內容）與 `conversation.updated`

#### Scenario: 客服操作的對話更新也依渠道送出
- **WHEN** 客服把 CH-B 的一段對話標為已讀
- **THEN** 不可見 CH-B 的成員收不到這段對話的 `conversation.updated`，看得到 CH-B 的成員與總店收得到

#### Scenario: 訂閱不可見渠道的對話房間被拒
- **WHEN** 成員不可見 CH-B，訂閱 CH-B 某段對話的 socket 房間
- **THEN** 系統拒絕訂閱，ack 回傳 `{ ok: false, code: 'FORBIDDEN' }`

### Requirement: 進站訊息分派不受成員可見範圍限制

渠道收到的訊息 SHALL 依渠道本身的設定建立對話與訊息。系統 MUST NOT 因為沒有成員可見該渠道而丟棄訊息。可見範圍只作用於讀取、列表、操作與推播。

#### Scenario: 進站訊息正常建立
- **WHEN** CH-B 收到外部訊息，當下沒有任何成員可見 CH-B
- **THEN** 系統照常寫入訊息並建立對話；之後可見 CH-B 的成員可以讀取

### Requirement: 聯絡人依渠道身份判斷可見

沒有 `channel.view_all` 的成員，在聯絡人有任一渠道身份屬於可見渠道，或聯絡人沒有任何渠道身份且沒有被合併（例如客服手動建立）時，SHALL 看得到該聯絡人。已被合併的聯絡人依它直接併入的保留方判斷，保留方本身也已被合併時看不到。聯絡人的渠道身份都在不可見渠道時，成員 MUST NOT 看到該聯絡人。回傳的渠道身份 SHALL 只含可見渠道的身份；依渠道類型篩選聯絡人時，SHALL 只比對可見渠道的身份。合併、合併預覽與解除合併時，任一位聯絡人在不可見渠道還有身份、對話或工單，系統 SHALL 回 HTTP 403，錯誤碼為 `CONTACT_HAS_OTHER_CHANNELS`。

#### Scenario: 跨渠道聯絡人只列出可見渠道的身份
- **WHEN** 成員的可見渠道集合為 {CH-A}，讀取在 CH-A 與 CH-B 都有身份的聯絡人
- **THEN** 系統回傳該聯絡人，`channelIdentities` 只含 CH-A 的身份

#### Scenario: 沒有渠道身份的聯絡人
- **WHEN** 成員的可見渠道集合為 {CH-A}，讀取沒有任何渠道身份、也沒有被合併的聯絡人
- **THEN** 系統回傳該聯絡人

#### Scenario: 被合併的聯絡人依保留方判斷
- **WHEN** 成員的可見渠道集合為 {CH-A}，聯絡人 S 已併入只在 CH-B 有身份的聯絡人 P，S 的身份都已移到 P，成員以 ID 讀取 S
- **THEN** 系統回 HTTP 404

#### Scenario: 依渠道類型篩選只比對可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}（WEBCHAT），聯絡人在 CH-A 有身份、在不可見的 LINE 渠道也有身份，成員以渠道類型 LINE 篩選聯絡人列表
- **THEN** 列表不含這位聯絡人

#### Scenario: 修改的回應只含可見渠道的身份
- **WHEN** 成員的可見渠道集合為 {CH-A}，修改一位在 CH-A 與 CH-B 都有身份的聯絡人
- **THEN** 回應的 `channelIdentities` 只含 CH-A 的身份

#### Scenario: 合併有其他渠道資料的聯絡人須由總店處理
- **WHEN** 成員的可見渠道集合為 {CH-A}，預覽合併或合併兩位看得到的聯絡人，其中一位在 CH-B 也有身份、對話或工單
- **THEN** 系統回 HTTP 403，錯誤碼為 `CONTACT_HAS_OTHER_CHANNELS`，不合併，回應不含 CH-B 身份的資料

### Requirement: 單筆對話與工單只回傳可見渠道的身份

成員讀取單筆對話或工單時，回傳的 `contact.channelIdentities` SHALL 只含可見渠道的身份；工單回傳的 `conversations` SHALL 只含可見渠道的對話。對話與工單本身的渠道一定可見，其他渠道的身份 MUST NOT 出現。

#### Scenario: 對話的聯絡人身份
- **WHEN** 成員的可見渠道集合為 {CH-A}，讀取 CH-A 的對話，對話的聯絡人在 CH-B 也有身份
- **THEN** 回傳的 `contact.channelIdentities` 只含 CH-A 的身份，不含 CH-B 身份的 uid 與暱稱

#### Scenario: 工單的聯絡人身份
- **WHEN** 成員的可見渠道集合為 {CH-A}，讀取關聯 CH-A 的工單，工單的聯絡人在 CH-B 也有身份
- **THEN** 回傳的 `contact.channelIdentities` 只含 CH-A 的身份

#### Scenario: 工單連結的對話
- **WHEN** 成員的可見渠道集合為 {CH-A}，讀取關聯 CH-A 的工單，工單連結了 CH-A 與 CH-B 的對話各一段
- **THEN** 回傳的 `conversations` 只含 CH-A 的對話

### Requirement: 群發只能使用可見渠道

成員建立群發或預估群發受眾時，指定的渠道 MUST 是可見渠道，否則系統 SHALL 回 HTTP 404，MUST NOT 建立群發，也 MUST NOT 回傳人數。分眾的人數（預覽、列表與單筆）SHALL 只計入成員看得到的聯絡人。行銷活動依「行銷活動的可見範圍」判斷。

#### Scenario: 用不可見渠道建立群發被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 CH-B 建立群發
- **THEN** 系統回 HTTP 404，不建立群發

#### Scenario: 預估不可見渠道的受眾被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，以 CH-B 預估群發受眾
- **THEN** 系統回 HTTP 404，不回傳人數

#### Scenario: 分眾預覽只算看得到的聯絡人
- **WHEN** 成員的可見渠道集合為 {CH-A}，分眾條件符合 CH-A 的聯絡人 2 位、只在 CH-B 的聯絡人 3 位
- **THEN** 預覽人數是 2，分眾列表與單筆的 `contactCount` 也是 2

### Requirement: 行銷活動的可見範圍

沒有 `channel.view_all` 的成員 SHALL 看得到自己建立的、還沒有任何群發的（例如總店規劃、讓各分店加入群發的活動），以及至少有一則可見渠道群發的行銷活動；其他活動 MUST NOT 出現在列表，以 ID 讀取、修改、刪除回 HTTP 404。活動的群發數、群發清單與成效 SHALL 只計入可見渠道的群發。修改、刪除活動，或建立群發時指定活動，活動的群發 MUST 都在可見渠道，否則系統 SHALL 回 HTTP 403，錯誤碼為 `CAMPAIGN_HAS_OTHER_CHANNELS`，MUST NOT 修改。

#### Scenario: 行銷活動只含可見渠道的群發
- **WHEN** 成員的可見渠道集合為 {CH-A}，行銷活動有 CH-A 與 CH-B 的群發各一則
- **THEN** 活動列表的群發數是 1，活動詳情的群發清單只含 CH-A 的群發

#### Scenario: 只有其他分店群發的行銷活動
- **WHEN** 成員的可見渠道集合為 {CH-A}，行銷活動只有 CH-B 的群發
- **THEN** 活動列表不含這個活動，以 ID 讀取、修改或刪除都回 HTTP 404

#### Scenario: 總店規劃的空活動
- **WHEN** 成員的可見渠道集合為 {CH-A}，總店建立的活動還沒有任何群發，成員以 CH-A 建立群發並指定這個活動
- **THEN** 活動列表含這個活動，群發建立成功

#### Scenario: 修改含其他分店群發的活動被拒
- **WHEN** 成員的可見渠道集合為 {CH-A}，修改或刪除一個有 CH-A 與 CH-B 群發的活動，或建立群發時指定這個活動
- **THEN** 系統回 HTTP 403，錯誤碼為 `CAMPAIGN_HAS_OTHER_CHANNELS`，活動不變，不建立群發

### Requirement: 報表只統計可見渠道

沒有 `channel.view_all` 的成員讀取或匯出報表時，系統 SHALL 只統計可見渠道的資料：訊息與對話依對話的渠道，工單依工單的渠道，聯絡人與標籤依「聯絡人依渠道身份判斷可見」，客服績效只列出被授權任一可見渠道、或在可見渠道有工單的客服，也只計入可見渠道的工單。REST、CLI 與 MCP 的報表 SHALL 使用同一個判斷。優惠券成效不依渠道過濾，因為優惠券不屬於任何渠道；個人數據只含成員自己的工單，也不另外過濾。

#### Scenario: 總覽只算可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，期間內 CH-A 有 3 則訊息、2 張新工單，CH-B 有 5 則訊息、4 張新工單
- **THEN** 總覽的訊息數是 3，新工單數是 2

#### Scenario: 渠道報表不列出不可見渠道
- **WHEN** 成員的可見渠道集合為 {CH-A}，CH-A 是 LINE、CH-B 是 FB，兩者期間內都有訊息
- **THEN** 渠道報表的訊息分布不含 FB

#### Scenario: 客服績效不列出其他分店的客服
- **WHEN** 成員的可見渠道集合為 {CH-A}，客服 X 只被授權 CH-B，期間內只處理 CH-B 的工單
- **THEN** 客服績效與匯出不含客服 X

#### Scenario: 同分店沒有工單的客服照常列出
- **WHEN** 成員的可見渠道集合為 {CH-A}，客服 Y 被授權 CH-A，期間內沒有工單
- **THEN** 客服績效列出客服 Y，處理數是 0

#### Scenario: 總店看全部
- **WHEN** 成員有 `channel.view_all`，讀取總覽
- **THEN** 訊息數與工單數包含所有渠道

### Requirement: 單筆渠道路由的可見範圍

成員以渠道 ID 讀取或管理渠道，而成員看不到該渠道（含不存在與已停用）時，系統 SHALL 回 HTTP 404，MUST NOT 回傳渠道內容，也 MUST NOT 執行操作。讀取渠道、狀態、嵌入碼與導流識別 SHALL 要求 `read_only`；修改、刪除、測試連線、LIFF 測試、設定 webhook、WebChat 連結與外觀、修改導流識別 SHALL 要求 `full`，不足時回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`。持有 `channel.view_all` 的成員不受限制。

#### Scenario: 讀取看不到的渠道被拒
- **WHEN** 成員沒有 `channel.view_all`，只綁定 CH-A，以 ID 讀取 CH-B，或讀取 CH-B 的嵌入碼或導流識別
- **THEN** 系統回 HTTP 404，不回傳渠道設定、憑證與驗證權杖

#### Scenario: 修改看不到的渠道被拒
- **WHEN** 成員有 `channel.update` 與 `channel.delete`，沒有 `channel.view_all`，只綁定 CH-A，對 CH-B 改名、停用、換權杖、刪除、測試連線、產生 LIFF 測試、設定 webhook、產生 WebChat 連結、改外觀或改導流識別
- **THEN** 系統回 HTTP 404，CH-B 的名稱、狀態、憑證、設定與 webhook 網址不變，渠道沒有被刪除

#### Scenario: 唯讀層級可以讀取渠道
- **WHEN** 成員對 CH-A 的層級是 `read_only`，以 ID 讀取 CH-A
- **THEN** 系統回 HTTP 200 與 CH-A 的資料

#### Scenario: 唯讀層級不能管理渠道
- **WHEN** 成員有 `channel.update` 與 `channel.delete`，對 CH-A 的層級是 `read_only`，修改、刪除 CH-A 或改它的 WebChat 外觀
- **THEN** 系統回 HTTP 403，錯誤碼為 `CHANNEL_ACCESS_LEVEL_INSUFFICIENT`，CH-A 不變

#### Scenario: 完整層級可以管理渠道
- **WHEN** 成員有 `channel.update`，對 CH-A 的層級是 `full`，修改 CH-A 的名稱
- **THEN** 系統回 HTTP 200，CH-A 的名稱已更新

#### Scenario: 總店不受可見範圍限制
- **WHEN** 成員有 `channel.view` 與 `channel.view_all`，沒有綁定 CH-B，以 ID 讀取 CH-B
- **THEN** 系統回 HTTP 200 與 CH-B 的資料

### Requirement: 嵌入碼需要檢視渠道權限

`GET /api/v1/channels/:id/embed-code` SHALL 要求 `channel.view`。成員沒有這個權限時，系統 SHALL 回 HTTP 403，`error.details.requiredPermission` 為 `channel.view`。

#### Scenario: 嵌入碼需要 channel.view
- **WHEN** 成員沒有 `channel.view`，綁定 WebChat 渠道 CH-A，讀取 CH-A 的嵌入碼
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 為 `channel.view`

### Requirement: 團隊指派由指派權限控管

渠道與團隊的指派路由（列出、指派、撤銷）SHALL 只要求 `channel.assign_team`，不檢查操作者自己的渠道可見範圍：`channel.assign_team` 是全租戶的渠道指派權，與指派用渠道清單、建立成員時的指派範圍一致。

#### Scenario: 團隊指派由 channel.assign_team 控管
- **WHEN** 成員有 `channel.assign_team`，沒有 `channel.view_all`，沒有綁定 CH-B，把 CH-B 指派給團隊、列出 CH-B 的團隊、再撤銷
- **THEN** 指派回 HTTP 201，列出含該團隊，撤銷回 HTTP 204
