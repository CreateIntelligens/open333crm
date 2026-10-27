## MODIFIED Requirements

### Requirement: 關鍵字回覆頁保留規則上的其他動作與條件

「關鍵字回覆」頁儲存時 SHALL 只更換規則中的「傳送素材」「發送優惠券」動作與關鍵字設定，並確保有條件「對話渠道等於規則的渠道」；規則上的其他動作（例如加標籤）與其他條件 SHALL 保留原樣（add-coupon-system design D25）。規則傳送的素材不是規則渠道的啟用中素材（其他渠道、已刪除或已停用）且沒有改選時，這一頁 SHALL 擋下儲存並顯示原因，列表也 SHALL 標示原因；不可加上渠道條件讓規則靜默失效。

#### Scenario: 編輯含其他動作的關鍵字回覆

- **GIVEN** 關鍵字規則的動作為傳送 LINE 素材與加標籤「詢價」，另有條件「聯絡人標籤包含 VIP」
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則仍有加標籤「詢價」動作與「聯絡人標籤包含 VIP」條件，並多了條件「對話渠道等於 LINE」

#### Scenario: 傳送 Facebook 素材的規則不能在這頁存檔

- **GIVEN** 在一般自動化規則建立的關鍵字規則，條件為「對話渠道等於 LINE」，傳送的是 Facebook 素材
- **WHEN** 管理員在關鍵字回覆頁只改了關鍵字就儲存
- **THEN** 系統不儲存，顯示「這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯」，規則沒有被修改
- **AND** 列表的回覆素材欄標示「Facebook 素材，與規則渠道不符」並連到自動化規則編輯

#### Scenario: 素材已刪除或已停用的規則要改選素材才能存檔

- **GIVEN** 關鍵字規則傳送的素材已刪除或已停用
- **WHEN** 管理員沒有改選素材就儲存
- **THEN** 系統不儲存並說明原因；改選規則渠道的素材或拿掉素材只發券後可以儲存

#### Scenario: 編輯含發券動作的關鍵字回覆

- **GIVEN** 關鍵字規則的動作為傳送素材與發送優惠券
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則仍有發送優惠券動作，`couponId` 不變

#### Scenario: 編輯 Facebook 的關鍵字回覆

- **GIVEN** 關鍵字規則有條件「對話渠道等於 FB」，傳送 Facebook 素材
- **WHEN** 管理員在關鍵字回覆頁改了關鍵字並儲存
- **THEN** 規則的條件仍只有一個「對話渠道等於 FB」，沒有被加上 LINE 條件

## ADDED Requirements

### Requirement: 關鍵字回覆依所選渠道觸發

建立關鍵字回覆時 SHALL 選渠道（LINE、Facebook、Instagram），預設為列表目前篩選的渠道，「全部」時為 LINE。已有渠道條件的規則，編輯時 SHALL 顯示渠道且不能更改。沒有渠道條件的規則，編輯時預設為素材的渠道，沒有素材時為 LINE，可以改選，並說明儲存後只在所選渠道觸發。規則的渠道條件不是單一的 LINE、FB 或 THREADS 時，這頁 SHALL 擋下儲存並引導到自動化規則編輯。素材選單 SHALL 只列所選渠道的素材。

#### Scenario: 建立時選 Facebook

- **WHEN** 管理員建立關鍵字回覆，選渠道 Facebook
- **THEN** 素材選單只列 Facebook 素材；儲存後規則有條件「對話渠道等於 FB」

#### Scenario: 已有渠道的規則不能改渠道

- **GIVEN** 關鍵字規則有條件「對話渠道等於 LINE」
- **WHEN** 管理員開啟編輯
- **THEN** 表單顯示渠道 LINE，沒有可以更改渠道的選單

#### Scenario: 沒有渠道條件的舊規則

- **GIVEN** 在一般自動化規則建立的關鍵字規則沒有渠道條件，傳送 LINE 素材
- **WHEN** 管理員在關鍵字回覆頁開啟編輯
- **THEN** 渠道預設為 LINE，表單說明「這條規則原本沒有限定渠道，儲存後只在所選渠道的對話觸發」
- **WHEN** 管理員儲存
- **THEN** 規則多了條件「對話渠道等於 LINE」，素材與其他動作不變

#### Scenario: 沒有渠道條件、傳送 Facebook 素材的舊規則

- **GIVEN** 關鍵字規則沒有渠道條件，傳送 Facebook 素材
- **WHEN** 管理員在關鍵字回覆頁只改了關鍵字就儲存
- **THEN** 規則儲存成功，多了條件「對話渠道等於 FB」

#### Scenario: 渠道條件這頁無法辨識

- **GIVEN** 關鍵字規則有條件「對話渠道等於 WEBCHAT」
- **WHEN** 管理員在關鍵字回覆頁儲存
- **THEN** 系統不儲存，顯示「這條規則的渠道條件這頁不能編輯，請到自動化規則編輯」，規則沒有被修改

### Requirement: 對話渠道條件列出 Instagram

自動化規則編輯器的條件「對話渠道」SHALL 列出 LINE、Facebook、Instagram 與 WebChat；Instagram 的值為 `THREADS`，畫面顯示「Instagram」。

#### Scenario: 條件選單有 Instagram

- **WHEN** 管理員在自動化規則編輯器新增條件「對話渠道」
- **THEN** 值的選項有「Instagram」，選它存成 `THREADS`
