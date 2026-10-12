# Spec Delta

## Purpose

讓顧客以 email 作為跨渠道的 One ID：顧客透過登記連結填入 email 後，系統把同租戶使用相同 email 的聯絡人自動歸戶，並讓客服在修改 email 時決定是否合併。

## ADDED Requirements

### Requirement: Email 登記須由租戶啟用
系統 SHALL 只在租戶設定 `identityBinding.emailEnabled` 為 true 時提供 email 登記。未啟用時，email 登記關鍵字不攔截，交給一般訊息處理；客服的傳送連結端點回 400（與傳送綁定連結相同）；已發出的登記連結回 410。

#### Scenario: 未啟用時關鍵字不攔截
- **WHEN** 租戶未啟用 email 登記，顧客傳送「登記email」
- **THEN** 系統不回覆登記連結，訊息照一般流程交給自動化與 AI

#### Scenario: 設定頁沒送 email 欄位
- **WHEN** 已啟用 email 登記的租戶，以只含綁定代碼欄位的內容儲存跨渠道綁定設定
- **THEN** email 登記維持啟用，關鍵字不變

#### Scenario: 未啟用時客服無法傳送連結
- **WHEN** 租戶未啟用 email 登記，客服呼叫傳送 email 登記連結端點
- **THEN** 系統回 400，錯誤碼為 `EMAIL_REGISTRATION_DISABLED`，不送出任何訊息

### Requirement: 顧客可在對話中取得 email 登記連結
租戶啟用 email 登記時，顧客傳送的文字去除頭尾空白後與 email 登記關鍵字整句相符（不分大小寫）時，系統 SHALL 在同一個對話回覆一則含登記連結的訊息，這則訊息不交給自動化與 AI。關鍵字預設為「登記email」，租戶可自訂。

#### Scenario: 顧客輸入關鍵字
- **WHEN** 已啟用的租戶的 LINE 顧客傳送「 登記EMAIL 」（關鍵字為「登記email」）
- **THEN** 系統在該對話回覆登記連結，該訊息不觸發自動化與 AI 回覆

#### Scenario: 一般對話提到關鍵字
- **WHEN** 顧客傳送「請問要怎麼登記email？」
- **THEN** 系統不攔截，訊息照一般流程處理

### Requirement: 客服可主動傳送 email 登記連結
具 `inbox.reply` 權限且對該對話的渠道有回覆權限的客服（與傳送綁定連結相同）SHALL 能在收件匣對指定對話傳送 email 登記連結。對話不屬於該聯絡人或客服看不到該渠道時，系統 SHALL 拒絕且不送出訊息。

#### Scenario: 客服傳送連結
- **WHEN** 具權限的客服對聯絡人 A 的 LINE 對話按「傳送 email 登記連結」
- **THEN** 該對話收到一則含登記連結的訊息，回應為成功

#### Scenario: 缺少權限
- **WHEN** 角色沒有 `inbox.reply` 的客服呼叫傳送端點
- **THEN** 系統回 403，不送出訊息

#### Scenario: 看不到的渠道
- **WHEN** 客服對其渠道可見性不包含的對話呼叫傳送端點
- **THEN** 系統回 404，不送出訊息

### Requirement: 登記連結為一次性且短效
登記連結 SHALL 綁定產生它的租戶、渠道身分與對話，30 分鐘內有效，成功送出一次 email 後失效。同一個渠道身分每小時最多取得 5 個連結，超過時系統回覆一則說明訊息，不再發新連結。

#### Scenario: 連結使用後失效
- **WHEN** 顧客以某個連結成功送出 email 後，再以同一個連結送出
- **THEN** 系統回 410，不更改任何資料

#### Scenario: 連結過期
- **WHEN** 顧客在取得連結 31 分鐘後開啟或送出
- **THEN** 系統回 410，登記頁顯示連結已失效、請回到對話重新取得

#### Scenario: 超過發連結次數
- **WHEN** 同一個渠道身分在一小時內第 6 次輸入登記關鍵字
- **THEN** 系統回覆次數過多的說明，不產生新連結

#### Scenario: 不存在的連結
- **WHEN** 有人以不存在的 token 呼叫公開端點
- **THEN** 系統回 410，回應不透露任何租戶或聯絡人資料

### Requirement: 登記頁顯示登記的帳號
開啟有效連結時，登記頁 SHALL 顯示要登記的渠道與顧客在該渠道的公開名稱，讓顧客確認是自己的帳號。登記頁 SHALL NOT 顯示聯絡人目前的 email、電話或其他個資。

#### Scenario: 開啟登記頁
- **WHEN** 顧客開啟 LINE 對話收到的有效連結
- **THEN** 頁面顯示「LINE（@店家帳號）」與顧客的 LINE 名稱，以及 email 輸入欄

### Requirement: 送出 email 後寫入聯絡人
系統 SHALL 驗證 email 格式，去除頭尾空白並轉為小寫後寫入連結對應的聯絡人，覆蓋原本的 email。同租戶沒有其他未封存聯絡人使用相同 email 時，系統 SHALL 只寫入 email，並在原對話回覆登記完成。格式不正確時回 400，連結仍有效。

#### Scenario: 沒有相同 email
- **WHEN** 顧客送出 ` Amy@Example.com `，同租戶沒有其他聯絡人使用 `amy@example.com`
- **THEN** 聯絡人的 email 變成 `amy@example.com`，沒有發生合併，原對話收到登記完成訊息

#### Scenario: 格式錯誤
- **WHEN** 顧客送出 `amy@`
- **THEN** 系統回 400，聯絡人不變，連結仍可再次送出

#### Scenario: 其他租戶有相同 email
- **WHEN** 只有另一個租戶的聯絡人使用相同 email
- **THEN** 系統只寫入 email，不合併任何聯絡人

### Requirement: 相同 email 自動合併
送出的 email 與同租戶另一位未封存聯絡人的 email 相同（不分大小寫）時，系統 SHALL 不經人工確認，把連結對應的聯絡人併入使用該 email、建立時間最早的聯絡人，合併紀錄的來源為 `EMAIL`。最早的一位就是登記方自己時，不合併。合併後，渠道身分、對話、案件與其他關聯資料都屬於被併入的那位聯絡人。

#### Scenario: 不同渠道的同一個人
- **WHEN** FB 聯絡人 B 的 email 是 `amy@example.com`，LINE 聯絡人 A 透過登記連結送出 `AMY@example.com`
- **THEN** A 併入 B 並封存，A 的 LINE 身分與對話屬於 B，合併紀錄的來源為 `EMAIL`

#### Scenario: 多位聯絡人使用相同 email
- **WHEN** 聯絡人 B（較早建立）與 C 都使用 `amy@example.com`，A 送出這個 email
- **THEN** A 併入 B，C 不變

#### Scenario: 登記方本身就是最早使用該 email 的聯絡人
- **WHEN** 聯絡人 B（較早建立）與 C 都使用 `amy@example.com`，B 的渠道身分送出這個 email
- **THEN** 系統只寫入 email，B 與 C 都不合併

#### Scenario: 已封存的聯絡人不列入比對
- **WHEN** 唯一使用相同 email 的聯絡人已被封存
- **THEN** 系統只寫入 email，不合併

#### Scenario: 已經是同一位聯絡人
- **WHEN** A 已併入 B 之後，A 原本的 LINE 身分（現屬 B）再次送出 B 的 email
- **THEN** 系統不合併，回覆已登記

### Requirement: 同一渠道雙方都有身分時拒絕合併
相同 email 的兩位聯絡人在同一個渠道都有身分時，系統 SHALL NOT 合併、SHALL NOT 寫入 email，並在原對話回覆無法自動整合、請聯繫客服。

#### Scenario: 同一個 LINE OA 的兩個帳號
- **WHEN** 聯絡人 A 與 B 在同一個 LINE 渠道都有身分，A 送出 B 的 email
- **THEN** 不合併，A 的 email 不變，A 的對話收到無法自動整合的說明

### Requirement: Email 歸戶須在雙邊通知
自動合併後，系統 SHALL 在登記的對話回覆已整合，說明對方帳號的渠道與名稱及 7 天內可回覆解除關鍵字；並在被併入聯絡人最近一次對話的渠道送出同樣的通知。被併入的聯絡人沒有任何對話時，只通知登記方。通知送不出去時，合併結果不變，並在對話中留下客服看得到的失敗紀錄。

#### Scenario: 雙邊收到通知
- **WHEN** LINE 聯絡人 A 以 email 併入 FB 聯絡人 B
- **THEN** A 的 LINE 對話與 B 的 FB 對話各收到一則整合通知，內容包含解除關鍵字

#### Scenario: 對方沒有對話
- **WHEN** 被併入的聯絡人是客服手動建立、沒有任何對話
- **THEN** 只有登記方收到通知，合併照常完成

### Requirement: 顧客可自助解除 email 歸戶
合併後 7 天內，顧客在登記方的渠道身分，或在收到通知的對方渠道身分，傳送解除關鍵字時，系統 SHALL 解除該次 email 歸戶，與解除綁定代碼合併的結果相同。超過 7 天時，系統回覆請聯繫客服，不解除。

#### Scenario: 登記方解除
- **WHEN** A 以 email 併入 B 三天後，A 的 LINE 身分傳送「解除綁定」
- **THEN** 該次合併被解除，A 恢復為獨立聯絡人並保有 LINE 身分與對話

#### Scenario: 對方解除
- **WHEN** B 的 FB 身分收到整合通知後傳送「解除綁定」
- **THEN** 該次合併被解除

#### Scenario: 超過 7 天
- **WHEN** 合併 8 天後顧客傳送「解除綁定」
- **THEN** 系統回覆請聯繫客服，合併不變

### Requirement: 公開登記端點須限制頻率
公開登記端點 SHALL 依來源 IP 限制每分鐘的請求次數，超過時回 429，不更改任何資料。

#### Scenario: 短時間大量送出
- **WHEN** 同一個 IP 在一分鐘內呼叫登記端點超過上限
- **THEN** 超過的請求回 429

### Requirement: 客服修改 email 與他人重複時須確認
客服以 `PATCH /api/v1/contacts/:id` 把 email 改成同租戶另一位未封存聯絡人已使用的 email 時，系統 SHALL 回 409，回應包含該聯絡人的 id 與名稱（該聯絡人只在客服看不到的渠道有身分時不包含），不更改資料。email 沒有改變時不檢查。客服 SHALL 能選擇合併（需 `contact.merge`，合併紀錄的來源為 `MANUAL`），或帶上確認旗標仍要儲存而不合併。

#### Scenario: 改成他人的 email
- **WHEN** 客服把聯絡人 A 的 email 改成聯絡人 B 使用的 `amy@example.com`
- **THEN** 系統回 409，回應含 B 的 id 與名稱，A 的 email 不變

#### Scenario: 對方在看不到的渠道
- **WHEN** 只能看 LINE 渠道的客服把 email 改成只在 FB 有身分的聯絡人 B 使用的 email
- **THEN** 系統回 409，回應不含 B 的 id 與名稱；介面只提供「仍要儲存」與「取消」

#### Scenario: 重存已確認共用的 email
- **WHEN** A 已以確認旗標儲存與 B 相同的 email，客服再次儲存 A 而 email 沒有改變
- **THEN** 系統直接儲存，不回 409

#### Scenario: 確認後仍要儲存
- **WHEN** 客服帶上確認旗標再次送出同一個修改
- **THEN** A 的 email 變成 `amy@example.com`，A 與 B 都不合併

#### Scenario: 選擇合併
- **WHEN** 具 `contact.merge` 權限的客服在 409 後選擇合併
- **THEN** 系統顯示合併預覽，確認後以來源 `MANUAL` 合併，結果與手動合併相同

#### Scenario: 沒有合併權限
- **WHEN** 沒有 `contact.merge` 權限的客服收到 409
- **THEN** 介面只提供「仍要儲存」與「取消」，不顯示合併
