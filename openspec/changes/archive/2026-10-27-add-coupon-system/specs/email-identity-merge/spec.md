# email-identity-merge

## MODIFIED Requirements

### Requirement: 登記連結為一次性且短效
登記連結 SHALL 綁定產生它的租戶、渠道身分與對話，30 分鐘內有效，以驗證碼成功驗證 email 一次後失效。同一個渠道身分每小時最多取得 5 個連結，超過時系統回覆一則說明訊息，不再發新連結。

#### Scenario: 連結使用後失效
- **WHEN** 顧客以某個連結成功驗證 email 後，再以同一個連結送出
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

### Requirement: 送出 email 後寫入聯絡人
系統 SHALL 驗證 email 格式，去除頭尾空白並轉為小寫。格式正確時，系統 SHALL 先寄驗證碼到這個 email（見「Email 登記須驗證信箱擁有權」），驗證通過後才寫入連結對應的聯絡人，覆蓋原本的 email。同租戶沒有其他未封存聯絡人使用相同 email 時，系統 SHALL 只寫入 email，並在原對話回覆登記完成。格式不正確時回 400，連結仍有效。

#### Scenario: 沒有相同 email
- **WHEN** 顧客送出 ` Amy@Example.com ` 並輸入寄到 `amy@example.com` 的正確驗證碼，同租戶沒有其他聯絡人使用 `amy@example.com`
- **THEN** 聯絡人的 email 變成 `amy@example.com`，沒有發生合併，原對話收到登記完成訊息

#### Scenario: 格式錯誤
- **WHEN** 顧客送出 `amy@`
- **THEN** 系統回 400，不寄驗證碼，聯絡人不變，連結仍可再次送出

#### Scenario: 其他租戶有相同 email
- **WHEN** 只有另一個租戶的聯絡人使用相同 email，顧客通過驗證
- **THEN** 系統只寫入 email，不合併任何聯絡人

## ADDED Requirements

### Requirement: Email 登記須驗證信箱擁有權
顧客送出格式正確的 email 時，系統 SHALL 寄出 6 位數驗證碼到該 email，回應 `code_sent`，此時不寫入、不合併任何資料。驗證碼 SHALL 10 分鐘內有效，只能用於送出時的那個 email；系統只保存驗證碼的雜湊。同一組驗證碼最多可輸入錯 5 次，第 5 次錯誤後作廢。同一個登記連結最多寄出 3 次驗證碼。寄信失敗時回 502，連結仍有效。

#### Scenario: 送出 email 後寄出驗證碼
- **WHEN** 顧客以有效連結送出 `amy@example.com`
- **THEN** 系統回 `code_sent`，寄出一封含 6 位數驗證碼的信到 `amy@example.com`，聯絡人的 email 不變

#### Scenario: 驗證碼正確才寫入
- **WHEN** 顧客輸入寄到 `amy@example.com` 的正確驗證碼
- **THEN** 系統依「送出 email 後寫入聯絡人」與「相同 email 自動合併」處理，連結失效

#### Scenario: 驗證碼錯誤
- **WHEN** 顧客輸入錯誤的驗證碼
- **THEN** 系統回 400 `INVALID_VERIFICATION_CODE` 並告知剩餘次數，聯絡人不變，連結仍有效

#### Scenario: 錯 5 次後驗證碼作廢
- **WHEN** 顧客連續輸入錯誤的驗證碼 5 次後，再輸入正確的驗證碼
- **THEN** 系統回 429 `VERIFICATION_CODE_LOCKED`，聯絡人不變；顧客要重新送出 email 取得新的驗證碼

#### Scenario: 驗證碼過期
- **WHEN** 顧客在寄出驗證碼 11 分鐘後輸入正確的驗證碼
- **THEN** 系統回 410 `VERIFICATION_CODE_EXPIRED`，聯絡人不變，連結仍可重新送出 email

#### Scenario: 同一個連結最多寄 3 次
- **WHEN** 顧客以同一個連結第 4 次送出 email
- **THEN** 系統回 429 `TOO_MANY_VERIFICATION_EMAILS`，不寄信

#### Scenario: 寄信失敗
- **WHEN** 寄送驗證信失敗
- **THEN** 系統回 502 `VERIFICATION_EMAIL_FAILED`，連結仍可再次送出

#### Scenario: 驗證碼不能換成別的 email
- **WHEN** 顧客送出 `amy@example.com` 取得驗證碼後，以這組驗證碼搭配 `bob@example.com` 驗證
- **THEN** 系統只會寫入取得驗證碼時的 `amy@example.com`，驗證請求中的 email 欄位不被採用
