## MODIFIED Requirements

### Requirement: 顧客可在對話中取得綁定代碼
租戶啟用後，顧客在任一渠道對話中傳送綁定關鍵字（預設「綁定帳號」），系統 SHALL 產生一組綁定該顧客目前渠道身分的一次性代碼，並回覆列出其他可綁定渠道的導流連結。LINE 連結的預填文字 SHALL 是「綁定 {代碼}」這個短句，不加其他說明文字：中文在網址裡會被編碼成 `%E7%B6%81…` 的長串，預填越長，顧客看到的網址越長。

#### Scenario: 從 FB 取得 LINE 與 IG 的導流連結
- **WHEN** 租戶有啟用中的 LINE、FB、IG 渠道且皆已設定導流識別，顧客在 FB 傳送「綁定帳號」
- **THEN** 系統 SHALL 回覆含 LINE `https://line.me/R/oaMessage/{basicId}/?{預填文字}` 與 IG `https://ig.me/m/{username}?ref={代碼}` 兩個連結的訊息，且不列出 FB 本身

#### Scenario: LINE 預填文字是短句
- **WHEN** 系統為代碼 `BIND-7K2M9QH4TX` 產生 LINE 的送出代碼連結
- **THEN** 連結 `?` 之後解碼的預填文字 SHALL 等於「綁定 BIND-7K2M9QH4TX」

#### Scenario: 未設定導流識別的渠道不列出
- **WHEN** 租戶的 IG 渠道尚未設定 username
- **THEN** 回覆的連結清單 SHALL 不包含該 IG 渠道

#### Scenario: 沒有任何可綁定渠道
- **WHEN** 除了顧客所在渠道外沒有其他可綁定渠道
- **THEN** 系統 SHALL 回覆目前沒有其他可綁定的渠道，且不產生代碼

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
- **WHEN** 顧客從 FB 取得的連結開啟 LINE，送出預填的「綁定 BIND-7K2M9QH4TX」並回覆「確認綁定」
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

