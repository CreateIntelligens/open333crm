## MODIFIED Requirements

### Requirement: 關鍵字回覆可以同時發券

「關鍵字回覆」頁的表單 SHALL 有「同時發送優惠券」下拉選單，列出同租戶進行中的券（行銷與客服補償），選項顯示券名、CP 券號與用途；素材改為選填，素材與優惠券至少選一個。儲存時規則含 `issue_coupon`，並帶條件「對話渠道等於所選渠道」（LINE、Facebook 或 Instagram，已有就不重複），規則只在所選渠道的對話觸發。列表 SHALL 列出含傳送素材或發送優惠券的關鍵字規則，並顯示券名。規則已存的券不再是進行中時，SHALL 保留原值並標示「已暫停、已結束或找不到的券」。

#### Scenario: 從清單選券

- **WHEN** 管理員在關鍵字回覆表單選渠道 LINE，「同時發送優惠券」選「秋季九折（CP-24A7）· 行銷」並儲存
- **THEN** 規則有 `issue_coupon` 動作，`couponId` 是這張券的 ID，規則有條件「對話渠道等於 LINE」

#### Scenario: 草稿或已結束的券不在清單

- **GIVEN** 租戶有一張草稿券、一張已結束的券與一張進行中的券
- **WHEN** 管理員開啟「同時發送優惠券」的下拉選單
- **THEN** 清單只有進行中的券

#### Scenario: 已存的券被暫停

- **GIVEN** 關鍵字規則的 `couponId` 指向一張之後被暫停的券
- **WHEN** 管理員開啟這條關鍵字回覆
- **THEN** 下拉選單顯示「已暫停、已結束或找不到的券」並保留原值

#### Scenario: 只發券的關鍵字規則

- **WHEN** 管理員建立只有優惠券、沒有素材的關鍵字回覆
- **THEN** 規則只有 `issue_coupon` 動作，列表顯示這條規則與它的券名

#### Scenario: 素材與優惠券都沒選

- **WHEN** 管理員沒有選素材也沒有選優惠券就儲存
- **THEN** 表單提示至少選一個，不送出

#### Scenario: Facebook 對話傳送同樣的關鍵字

- **GIVEN** 渠道為 LINE 的關鍵字回覆「領券」設定了優惠券
- **WHEN** Facebook 對話的顧客傳送「領券」
- **THEN** 規則條件不成立，不發券

#### Scenario: Facebook 的關鍵字回覆發券

- **GIVEN** 管理員建立渠道為 Facebook 的關鍵字回覆「領券」，選了進行中的券
- **WHEN** Facebook 對話的顧客傳送「領券」
- **THEN** 規則有條件「對話渠道等於 FB」，顧客在 Messenger 收到發券訊息與票券連結，券的發放方式為「關鍵字」
- **WHEN** LINE 對話的顧客傳送「領券」
- **THEN** 這條規則條件不成立，不發券

#### Scenario: Instagram 的關鍵字回覆只發券

- **WHEN** 管理員建立渠道為 Instagram 的關鍵字回覆
- **THEN** 素材選單停用並說明 Instagram 目前沒有素材、只能發券；選券後儲存，規則只有 `issue_coupon`，條件為「對話渠道等於 THREADS」
- **WHEN** Instagram 對話的顧客傳送關鍵字
- **THEN** 顧客在 Instagram 私訊收到發券訊息

### Requirement: 自動化發券沒有發出時可回覆顧客

`issue_coupon` 動作 SHALL 有選填參數「發不出時回覆顧客」（文字），在關鍵字回覆頁與加好友禮頁設定。有填寫時，因每人上限、發行總量、序號用完或券不是進行中而沒有發券，系統 SHALL 把這段文字送給顧客（LINE 在期限內用回覆方式，Facebook 與 Instagram 用一般傳送）；渠道拒收、找不到渠道身分或不支援的渠道時 SHALL NOT 回覆。沒有填寫時不回覆顧客。

#### Scenario: 已達上限時回覆設定的文字

- **GIVEN** 關鍵字回覆的「發不出時回覆顧客」為「您已經領過這張券囉」
- **WHEN** 已達每人上限的顧客傳送領券關鍵字
- **THEN** 顧客收到「您已經領過這張券囉」，對話也留下沒有發券的系統訊息

#### Scenario: 沒有設定回覆文字

- **GIVEN** 規則沒有填「發不出時回覆顧客」
- **WHEN** 發行總量已發完時顧客傳送領券關鍵字
- **THEN** 顧客沒有收到任何自動化訊息，對話留下沒有發券的系統訊息

#### Scenario: Facebook 顧客已達上限時回覆設定的文字

- **GIVEN** 渠道為 Facebook 的關鍵字回覆，「發不出時回覆顧客」為「您已經領過這張券囉」
- **WHEN** 已達每人上限的 Facebook 顧客傳送領券關鍵字
- **THEN** 顧客在 Messenger 收到「您已經領過這張券囉」，對話留下原因代碼為 PER_CONTACT_LIMIT_REACHED 的系統訊息

### Requirement: 廣播可以附上優惠券

建立廣播時 SHALL 可以選一張進行中的行銷券。訊息內容：素材含 `{{coupon.url}}` 變數時代入收件人自己的票券連結，只送這一則；素材沒有這個變數時，先送素材，再送一則預設的發券文字（含連結）；沒有選素材時只送預設的發券文字。券不是進行中、是客服補償券或屬於其他租戶時回 400。沒有選素材也沒有附券時 SHALL 不能建立：建立按鈕停用並說明原因（與後端建立廣播的檢查一致）。選到 Instagram 渠道時，素材欄位 SHALL 改為說明 Instagram 沒有可用的素材、只能附上優惠券送出預設的發券文字，且只會送給 24 小時內傳過訊息給 IG 帳號的人。

#### Scenario: 素材含票券連結變數

- **GIVEN** 附券廣播的素材文字為「秋季優惠：{{coupon.url}}」
- **WHEN** 廣播送給收件人甲
- **THEN** 甲只收到一則訊息，內容的連結是甲自己的票券連結

#### Scenario: 素材沒有票券連結變數

- **GIVEN** 附券廣播的素材沒有 `{{coupon.url}}`
- **WHEN** 廣播送給收件人甲
- **THEN** 甲先收到素材，再收到一則帶甲自己票券連結的發券文字

#### Scenario: 沒有選素材

- **WHEN** 附券廣播沒有選素材，送給收件人甲
- **THEN** 甲只收到預設的發券文字，帶甲自己的票券連結

#### Scenario: 附上客服補償券

- **WHEN** 管理者建立廣播時選了一張客服補償券
- **THEN** 系統回 400，不建立廣播

#### Scenario: 附上草稿券

- **WHEN** 管理者建立廣播時選了一張草稿券
- **THEN** 系統回 400，不建立廣播

#### Scenario: 沒有素材也沒有附券

- **WHEN** 管理者建立 LINE 廣播，填了名稱，沒有選素材也沒有附券
- **THEN** 建立按鈕停用，表單說明「請選擇素材或附上優惠券」，不送出建立請求

#### Scenario: Instagram 廣播只能附券

- **WHEN** 管理者建立廣播，選了 Instagram 渠道
- **THEN** 素材欄位不顯示空白的素材選單，改為說明「Instagram 沒有可用的素材，只能附上優惠券、送出預設的發券文字；只會送給 24 小時內傳過訊息給 IG 帳號的人」
- **AND** 沒有附券時建立按鈕停用，並說明「Instagram 廣播要附上優惠券才能建立」；附上進行中的行銷券後可以建立，送出的資料沒有 `materialId`

## ADDED Requirements

### Requirement: 關鍵字回覆列表標示渠道

關鍵字回覆列表 SHALL 有「渠道」欄，依規則的條件「對話渠道等於 X」顯示 LINE、Facebook 或 Instagram；沒有渠道條件時顯示「未限定渠道」；渠道條件這頁無法辨識時顯示「渠道條件請到自動化規則編輯」。列表上方 SHALL 可依渠道篩選（全部、LINE、Facebook、Instagram）。畫面 SHALL NOT 顯示 THREADS。

#### Scenario: 列表顯示每條規則的渠道

- **GIVEN** 租戶有渠道為 LINE、Facebook、Instagram 的關鍵字回覆各一條，另有一條沒有渠道條件
- **WHEN** 管理員開啟關鍵字回覆頁
- **THEN** 渠道欄分別顯示「LINE」「Facebook」「Instagram」「未限定渠道」，頁面沒有出現「THREADS」

#### Scenario: 依渠道篩選

- **WHEN** 管理員點選篩選「Facebook」
- **THEN** 列表只剩渠道為 Facebook 的規則

### Requirement: 關鍵字回覆列表在切換或存檔後立即更新

關鍵字回覆列表的啟用開關按下、或編輯存檔成功後，列表 SHALL 立即顯示後端的新狀態與新內容，不需要重新整理頁面。

#### Scenario: 停用後列表顯示停用

- **GIVEN** 列表上一條啟用中的關鍵字回覆
- **WHEN** 管理員按下它的啟用開關，後端把規則改為停用
- **THEN** 列表這條規則顯示「停用」

#### Scenario: 存檔後列表顯示新的關鍵字

- **WHEN** 管理員把關鍵字回覆的關鍵字從「價格」改為「價格」「多少錢」並儲存
- **THEN** 列表這條規則顯示兩個關鍵字

### Requirement: 廣播與批次發券的渠道選單顯示 Instagram

建立廣播與券詳情頁「發送給…」的渠道選單 SHALL 以渠道名稱加上 LINE、Facebook 或 Instagram 顯示，SHALL NOT 顯示 THREADS 或 FB 等內部代碼。

#### Scenario: 渠道選單的 Instagram

- **GIVEN** 租戶有名為「IG」的 Instagram 渠道
- **WHEN** 管理者開啟建立廣播或「發送給…」的渠道選單
- **THEN** 選項顯示「IG（Instagram）」，不出現 THREADS
