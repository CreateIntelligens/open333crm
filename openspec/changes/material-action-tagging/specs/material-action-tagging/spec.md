## ADDED Requirements

### Requirement: 可點擊 action 設定點擊後貼標
系統 SHALL 讓 LINE 素材的每個可點擊 action（carousel action1/action2、carousel endPage CTA、flex button、quick reply、imagemap 區域、video endCard）都能設定「點擊後對聯絡人貼標籤」。標籤來源 MUST 為租戶既有標籤中 `scope==='CONTACT'` 者，選單資料取自 `GET /tags`。未設標籤時 action 行為 MUST 不變。

#### Scenario: 為 postback action 選擇貼標籤
- **WHEN** 使用者在編輯器對某個 postback 型 action 選擇一個 CONTACT-scope 標籤
- **THEN** 該 action 的 `data` 被設為 `tag:<tagId>`，且編輯器重新開啟時能從 data 反解還原選中的標籤

#### Scenario: 為 uri action 選擇貼標籤
- **WHEN** 使用者對某個 uri 型 action 選擇一個標籤
- **THEN** 該 action 記錄 `tagOnClick=<tagId>`（不改動 uri 本身），送出時該 uri 對應的素材短連結帶上此 tagId

#### Scenario: 標籤下拉只列 CONTACT-scope 標籤
- **WHEN** 編輯器載入貼標下拉
- **THEN** 只顯示 `scope==='CONTACT'` 的標籤，不顯示 CONVERSATION/CASE scope 的標籤

#### Scenario: imagemap message 區域不提供 postback 貼標
- **WHEN** imagemap 的某區域是 message 型（imagemap 官方不支援 postback）
- **THEN** 該區域的貼標僅能透過 uri 類型達成，UI 不提供 postback 貼標選項或提示改用網址類型

### Requirement: postback 點擊觸發貼標
當 LINE 傳來 postback event 且 data 為 `tag:<tagId>` 格式時，系統 SHALL 對點擊者（contact）貼上該標籤。貼標 MUST 為冪等、tenant-scoped，並 MUST 發出 `contact.tagged` 事件（供既有自動化訂閱）。貼標失敗（標籤不存在/已刪/scope 不符）時 SHALL 靜默略過，MUST 不中斷該 postback 的其他處理。

#### Scenario: 收到 tag: postback 貼標成功
- **WHEN** webhook 收到 postback event，data 為 `tag:<有效的 CONTACT-scope tagId>`，且能解析出點擊者 contactId
- **THEN** 對該 contact 貼上該標籤（冪等，重複點擊不重複貼），並發出 `contact.tagged` 事件

#### Scenario: tag postback 不短路後續處理
- **WHEN** tag: postback 被貼標攔截器處理
- **THEN** 該 postback 仍照常存入對話並繼續後續流程（貼標為附加語意，不吃掉訊息）

#### Scenario: 標籤不存在時靜默略過
- **WHEN** postback 的 tagId 對應的標籤不存在、已刪除、或 scope 非 CONTACT
- **THEN** 不貼標、不拋錯、不影響該 postback 的其他處理與後續訊息流程

#### Scenario: 貼標自動可觸發分眾自動化
- **WHEN** 點擊 tag: postback 成功貼標並發出 `contact.tagged`
- **THEN** 既有訂閱 `contact.tagged` 的自動化規則會被觸發（無需新增 trigger）

### Requirement: uri 點擊透過素材短連結貼標
uri 型 action 選了標籤後，該 action 對應的素材短連結（廣播送出時產生）SHALL 帶上 `tagOnClick=<tagId>`。點擊短連結時系統 MUST 沿用既有 `trackClick` 貼標路徑。

#### Scenario: 帶 tagId 的素材短連結點擊貼標
- **WHEN** 廣播送出含「已設貼標的 uri action」的素材，使用者點擊該 uri 對應的短連結
- **THEN** 既有 `trackClick` 對點擊者貼上該短連結的 `tagOnClick` 標籤（沿用現行機制）

#### Scenario: 同素材同 uri 短連結複用時帶正確 tagId
- **WHEN** 同一素材的同一 uri 被複用既有短連結
- **THEN** 該短連結的 `tagOnClick` 反映該 action 設定的 tagId
