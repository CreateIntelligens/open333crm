## ADDED Requirements

### Requirement: 綁定功能須由租戶啟用
系統 SHALL 僅在租戶設定 `identityBinding.enabled` 為 true 時處理綁定關鍵字、綁定代碼與解除指令；預設為關閉。

#### Scenario: 未啟用時不攔截
- **WHEN** 租戶未啟用綁定功能，顧客傳送「綁定帳號」或含 `BIND-` 代碼的訊息
- **THEN** 系統 SHALL 視為一般訊息處理（照常觸發打招呼、AI、關鍵字與自動化）

### Requirement: 顧客可在對話中取得綁定代碼
租戶啟用後，顧客在任一渠道對話中傳送綁定關鍵字（預設「綁定帳號」），系統 SHALL 產生一組綁定該顧客目前渠道身分的一次性代碼，並回覆列出其他可綁定渠道的導流連結。

#### Scenario: 從 FB 取得 LINE 與 IG 的導流連結
- **WHEN** 租戶有啟用中的 LINE、FB、IG 渠道且皆已設定導流識別，顧客在 FB 傳送「綁定帳號」
- **THEN** 系統 SHALL 回覆含 LINE `https://line.me/R/oaMessage/{basicId}/?{預填文字}` 與 IG `https://ig.me/m/{username}?ref={代碼}` 兩個連結的訊息，且不列出 FB 本身

#### Scenario: 未設定導流識別的渠道不列出
- **WHEN** 租戶的 IG 渠道尚未設定 username
- **THEN** 回覆的連結清單 SHALL 不包含該 IG 渠道

#### Scenario: 沒有任何可綁定渠道
- **WHEN** 除了顧客所在渠道外沒有其他可綁定渠道
- **THEN** 系統 SHALL 回覆目前沒有其他可綁定的渠道，且不產生代碼

### Requirement: 客服可主動傳送綁定連結
具 `contact.update` 權限的客服 SHALL 能在聯絡人對話中觸發傳送綁定連結，行為與顧客自行請求相同。

#### Scenario: 客服代發
- **WHEN** 客服在某聯絡人的 LINE 對話按下「傳送綁定連結」
- **THEN** 系統 SHALL 以該 LINE 身分產生代碼，並在該對話送出其他渠道的導流連結

#### Scenario: 無權限
- **WHEN** 沒有 `contact.update` 權限的使用者呼叫發送綁定連結 API
- **THEN** 系統 SHALL 回傳 403

### Requirement: 綁定代碼為一次性且短效
代碼 SHALL 為 `BIND-` 加 10 碼 Crockford base32，有效期 30 分鐘，成功兌換一次後立即失效。

#### Scenario: 重複兌換
- **WHEN** 同一代碼第二次被送出
- **THEN** 系統 SHALL 回覆代碼無效或已過期，且不進行任何合併

#### Scenario: 過期
- **WHEN** 代碼在發出 30 分鐘後才被送出
- **THEN** 系統 SHALL 回覆代碼無效或已過期

#### Scenario: 並發兌換
- **WHEN** 同一代碼幾乎同時從兩個渠道送出並確認
- **THEN** 系統 SHALL 只讓其中一次合併成功

### Requirement: 在其他渠道兌換代碼並經確認後合併聯絡人
系統 SHALL 在文字訊息中搜尋綁定代碼（不要求整句相符、不分大小寫），並接受 FB/IG referral 的 `ref` 作為代碼。代碼有效時系統 SHALL **先不合併**，而是回覆一則確認訊息（顯示要綁定的對方渠道與帳號名稱），並保留待確認狀態 10 分鐘；兌換方回覆「確認綁定」且重新檢查通過後，系統 SHALL 將兌換方聯絡人合併進發碼方聯絡人（發碼方為 survivor），並在 `IdentityMap` 以來源 `BINDING_CODE`、信心值 1.0 記錄兌換方身分。此確認步驟用於防止連結被轉傳時，點擊者在不知情下被併入他人。

#### Scenario: 送出代碼只進入待確認
- **WHEN** 顧客在 LINE 送出有效代碼
- **THEN** 系統 SHALL 回覆顯示對方帳號名稱的確認訊息，且此時 SHALL NOT 合併任何聯絡人

#### Scenario: 別人點開連結不會讓本人的代碼失效
- **WHEN** 他人點開轉傳的連結、進入待確認但未確認
- **THEN** 代碼 SHALL 仍在原效期內有效，本人於其他渠道兌換並確認 SHALL 成功（代碼只在確認成功時才用掉）

#### Scenario: 多人同時待確認同一代碼
- **WHEN** 兩個身分都兌換了同一代碼並進入待確認
- **THEN** 先回覆確認者 SHALL 成功，後確認者 SHALL 收到代碼無效

#### Scenario: 被轉傳連結的人不確認
- **WHEN** 他人點開轉傳的綁定連結但未在 10 分鐘內回覆「確認綁定」
- **THEN** 系統 SHALL NOT 合併，之後回覆「確認綁定」時 SHALL 提示沒有待確認的綁定

#### Scenario: 確認時重新檢查
- **WHEN** 待確認期間發碼方已在兌換方的渠道有另一個身分
- **THEN** 顧客回覆「確認綁定」時系統 SHALL 拒絕合併

#### Scenario: LINE 預填訊息兌換
- **WHEN** 顧客從 FB 取得的連結開啟 LINE，送出預填的「我要綁定帳號，代碼 BIND-7K2M9QH4TX（請直接送出）」並回覆「確認綁定」
- **THEN** 系統 SHALL 將該 LINE 身分所屬聯絡人併入 FB 端聯絡人，兩個渠道身分都掛在同一聯絡人下

#### Scenario: 顧客改動預填文字
- **WHEN** 顧客把預填文字改成「bind-7k2m9qh4tx 謝謝」後送出
- **THEN** 系統 SHALL 仍正確兌換代碼

#### Scenario: FB referral 兌換
- **WHEN** 顧客點 `https://m.me/{粉專}?ref=BIND-7K2M9QH4TX`，FB 送來帶該 ref 的 referral 事件，顧客再回覆「確認綁定」
- **THEN** 系統 SHALL 以該 ref 兌換並在確認後合併

#### Scenario: 在同一身分兌換
- **WHEN** 代碼從發碼的同一個渠道身分送回
- **THEN** 系統 SHALL 回覆請到其他渠道送出，且代碼 SHALL 仍可在 30 分鐘內於其他渠道使用

#### Scenario: 已是同一聯絡人
- **WHEN** 兌換方身分已屬於發碼方聯絡人
- **THEN** 系統 SHALL 回覆已完成綁定，不重複合併

#### Scenario: 跨租戶代碼
- **WHEN** A 租戶發出的代碼被送到 B 租戶的渠道
- **THEN** 系統 SHALL 回覆代碼無效，且不得透露代碼屬於其他租戶

#### Scenario: 同一渠道的另一個人兌換
- **WHEN** 代碼被轉給同一個 LINE 官方帳號的另一位使用者並由他送出
- **THEN** 系統 SHALL 拒絕合併並回覆同一渠道只能綁定一個帳號，且代碼 SHALL 仍可在剩餘時效內由本人於其他渠道使用

#### Scenario: 合併後同一渠道會有兩個帳號
- **WHEN** 發碼方聯絡人已在兌換方所在的渠道有另一個身分
- **THEN** 系統 SHALL 拒絕合併

#### Scenario: 平台重送同一 referral 事件
- **WHEN** FB 或 IG 在短時間內重送同一則帶綁定代碼的 referral 事件
- **THEN** 系統 SHALL 只處理一次，不得在綁定成功後再回覆代碼無效

#### Scenario: 發碼方中途已被合併
- **WHEN** 發碼方聯絡人在兌換前已被併入另一聯絡人
- **THEN** 系統 SHALL 沿 `mergedIntoId` 找到現存聯絡人作為 survivor 進行合併

### Requirement: 綁定成功須在雙邊通知
合併成功後，系統 SHALL 在發碼方與兌換方兩邊的對話各送出確認訊息，內容 SHALL 包含「若非本人操作請回覆『解除綁定』」；送出失敗時 SHALL 在該對話寫入客服可見的系統訊息，不得只寫 log。

#### Scenario: 雙邊確認
- **WHEN** 顧客在 LINE 兌換 FB 發出的代碼並確認成功
- **THEN** LINE 與 FB 兩邊對話 SHALL 各收到一則綁定成功訊息

#### Scenario: 一邊送出失敗
- **WHEN** FB 端確認訊息因平台錯誤送出失敗
- **THEN** 系統 SHALL 在 FB 對話中寫入「綁定確認訊息送出失敗」系統訊息，合併結果不回滾

### Requirement: 顧客可自助解除綁定
綁定後 7 天內，顧客在任一邊對話傳送解除關鍵字（預設「解除綁定」），系統 SHALL 撤銷最近一筆涉及「顧客目前所在渠道身分」（當次被併入的身分或當次的發碼身分）、來源為 `BINDING_CODE` 且未撤銷的合併，並在雙邊送出已解除訊息；超過 7 天 SHALL 回覆請聯繫客服。

#### Scenario: 7 天內解除
- **WHEN** 顧客綁定 2 天後在 FB 傳送「解除綁定」
- **THEN** 系統 SHALL 將兌換方聯絡人恢復為獨立聯絡人，並將綁定時搬移的渠道身分、對話、案件搬回

#### Scenario: 綁了多個渠道只拆目前這個
- **WHEN** 顧客 FB 帳號先綁了 LINE、後綁了 IG，之後在 LINE 傳送「解除綁定」
- **THEN** 系統 SHALL 只拆開 LINE 那筆綁定，IG 維持綁定

#### Scenario: 超過 7 天
- **WHEN** 顧客綁定 10 天後傳送「解除綁定」
- **THEN** 系統 SHALL 回覆請聯繫客服協助解除，且不撤銷合併

#### Scenario: 沒有可解除的綁定
- **WHEN** 從未綁定的顧客傳送「解除綁定」
- **THEN** 系統 SHALL 視為一般訊息處理

### Requirement: 綁定操作須限制頻率
系統 SHALL 限制每個渠道身分每小時最多產生 5 組代碼；每個渠道身分每小時兌換失敗超過 10 次後，SHALL 不再回覆失敗訊息但持續記錄。

#### Scenario: 發碼超過上限
- **WHEN** 同一 FB 身分一小時內第 6 次傳送「綁定帳號」
- **THEN** 系統 SHALL 回覆請稍後再試，且不產生新代碼

#### Scenario: 猜碼
- **WHEN** 同一身分一小時內第 11 次送出無效代碼
- **THEN** 系統 SHALL 不回覆任何訊息

### Requirement: 渠道須提供導流識別
系統 SHALL 為 LINE 渠道儲存 Basic ID、為 IG 渠道儲存 username（皆於渠道驗證時自動取得），FB 渠道使用 page username 或 pageId；管理員 SHALL 能在渠道設定中檢視與手動覆寫。

#### Scenario: LINE 驗證自動寫入
- **WHEN** 管理員驗證 LINE 渠道，`/v2/bot/info` 回傳 basicId `@abc1234`
- **THEN** 系統 SHALL 將 `@abc1234` 存為該渠道的導流識別

#### Scenario: FB 沒有 username
- **WHEN** FB 渠道未設定 page username 但有 pageId
- **THEN** 產生的連結 SHALL 使用 `https://m.me/{pageId}?ref={代碼}`
