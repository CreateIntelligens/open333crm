## ADDED Requirements

### Requirement: 沒附券的廣播不可使用含顧客專屬券連結的素材

建立廣播時，素材含 `{{coupon.url}}` 而沒有附券，系統 SHALL 回 400（`MATERIAL_NEEDS_COUPON`），訊息說明要附上一張券，否則顧客會看到 `{{coupon.url}}`，且 SHALL NOT 建立廣播。建立廣播對話框 SHALL 在這種情況顯示提醒「這個素材有顧客專屬券連結，請在『附上優惠券』選一張券，否則顧客會看到 {{coupon.url}}」，建立按鈕停用並說明原因。已建立的廣播在發送時 SHALL NOT 因此被擋下。

#### Scenario: 不附券的廣播選了含券連結的素材
- **WHEN** 管理者建立 LINE 廣播，素材文字為「秋季優惠：{{coupon.url}}」，沒有附券
- **THEN** 系統回 400，`error.code` 為 `MATERIAL_NEEDS_COUPON`，不建立廣播

#### Scenario: 附券廣播可用含券連結的素材
- **WHEN** 管理者建立附上進行中行銷券的廣播，素材文字為「秋季優惠：{{coupon.url}}」
- **THEN** 系統建立廣播

#### Scenario: 不含券連結的素材不受影響
- **WHEN** 管理者建立沒附券的廣播，素材文字為「秋季優惠開跑」
- **THEN** 系統建立廣播

#### Scenario: 建立對話框提醒並停用建立按鈕
- **WHEN** 管理者在建立廣播對話框選了含 `{{coupon.url}}` 的素材，「附上優惠券」選「不附券」
- **THEN** 對話框顯示含「顧客專屬券連結」與「附上優惠券」的提醒，建立按鈕停用
- **AND** 附上一張券後提醒消失

### Requirement: 列出租戶全部可用的領券連結

具 `coupon.view` 或 `marketing.manage` 任一權限的使用者 SHALL 能以 `GET /api/v1/coupons/claim-links` 列出同租戶可用的領券連結：連結為啟用、券為進行中、連結沒有結束（沒有結束時間或結束時間晚於現在）；固定效期的券到期日已過時 SHALL NOT 列出（狀態仍可能是進行中）。可選的 `channelType`（`LINE`、`FB`、`THREADS`）SHALL 只列出該渠道類型的連結；其他值回 400。每筆 SHALL 含連結名稱、代碼、公開網址（`{WEB_BASE_URL}/coupon/claim/{代碼}`）、券 id 與券名、渠道（類型與名稱）。其他租戶的連結 SHALL NOT 出現。

#### Scenario: 只列出可用的連結
- **GIVEN** 租戶有啟用的連結甲（券進行中）、停用的連結乙、券已暫停的連結丙、已過結束時間的連結丁
- **WHEN** 使用者呼叫 `GET /api/v1/coupons/claim-links`
- **THEN** 回應只有連結甲，含券名與公開網址

#### Scenario: 不列出固定效期已到期的券
- **GIVEN** 連結甲的券是固定效期、到期日已過但狀態仍是進行中；連結乙的券是固定效期、還沒到期；連結丙的券是領取後計時
- **WHEN** 使用者呼叫 `GET /api/v1/coupons/claim-links`
- **THEN** 回應有連結乙與丙，沒有連結甲

#### Scenario: 只列出同租戶的連結
- **WHEN** 使用者列出領券連結
- **THEN** 查詢條件含使用者的租戶，其他租戶的連結不在回應中

#### Scenario: 依渠道篩選
- **GIVEN** 租戶有 LINE 渠道的可用連結甲與 Facebook 渠道的可用連結戊
- **WHEN** 使用者呼叫 `GET /api/v1/coupons/claim-links?channelType=FB`
- **THEN** 回應只有連結戊
- **AND** `channelType=WEBCHAT` 時系統回 400

#### Scenario: 只有管理行銷權限的素材編輯者可以讀
- **GIVEN** 使用者有 `marketing.manage`，沒有 `coupon.view`
- **WHEN** 呼叫 `GET /api/v1/coupons/claim-links`
- **THEN** 系統回 200

#### Scenario: 缺少檢視權限
- **GIVEN** 使用者沒有 `coupon.view`，也沒有 `marketing.manage`
- **WHEN** 呼叫 `GET /api/v1/coupons/claim-links`
- **THEN** 系統回 403，`error.details.requiredAnyOf` 為 `["coupon.view", "marketing.manage"]`

### Requirement: 固定效期已過到期日的券不發放

固定效期（`validityMode` 為 `FIXED`）的券到期日已過（`endAt` 早於或等於現在）時，即使狀態仍是進行中，系統 SHALL NOT 發出新券：對話發券、批次發券、附券廣播、公開領券連結、關鍵字回覆與加好友禮都一樣。系統 SHALL NOT 因到期而把券的狀態改成已結束（顧客券夾的「已過期」與「活動已提前結束」不同）。各入口 SHALL 說明原因；共用的發券核心 SHALL 對每位對象回報略過原因 `COUPON_EXPIRED`，作為最後一道防線。

#### Scenario: 發券核心略過已到期的券
- **GIVEN** 一張固定效期、到期日已過、狀態仍是進行中的券
- **WHEN** 任何入口呼叫發券核心發給兩位顧客
- **THEN** 不建立任何券，兩位都回報略過原因 `COUPON_EXPIRED`

#### Scenario: 到期當下就不再發
- **GIVEN** 券的到期日等於現在
- **WHEN** 判斷券能不能發
- **THEN** 視為已到期

#### Scenario: 不是固定效期的券不看到期日
- **GIVEN** 一張領取後計時的券，`endAt` 欄位有過去的值
- **WHEN** 判斷券能不能發
- **THEN** 視為可以發

#### Scenario: 發券服務回報清楚的錯誤
- **WHEN** 對一張已到期的固定效期券發券
- **THEN** 系統拋出「券已過到期日，無法發放」，不建立券

#### Scenario: 附券廣播建立時擋下
- **WHEN** 建立廣播並附上一張已到期的固定效期券
- **THEN** 系統回 400 `INVALID_COUPON`，訊息為「這張優惠券已過到期日，不能附上」

#### Scenario: 已建立的附券廣播在發送時擋下
- **GIVEN** 附券廣播建立後，券才過了到期日
- **WHEN** 廣播開始發送
- **THEN** 不送任何訊息、不建立券，廣播標為失敗，`failureCode` 為 `COUPON_EXPIRED`，原因寫出到期日

#### Scenario: 發送途中券過了到期日
- **GIVEN** 附券廣播開始發送後，券才過了到期日
- **WHEN** 系統為下一位收件人保留券
- **THEN** 不建立券並停止發送，`failureCode` 為 `COUPON_EXPIRED`，原因說明要改附其他券（不是「恢復發放」）

#### Scenario: 公開領券連結不能領
- **GIVEN** 領券連結啟用中，券已過固定效期的到期日
- **WHEN** 顧客開啟連結或傳送領券訊息
- **THEN** 連結視為不可領

#### Scenario: 關鍵字回覆與加好友禮不發券
- **GIVEN** 規則的券已過固定效期的到期日
- **WHEN** 規則觸發
- **THEN** 不建立券，對話留下「券不是進行中（已暫停、已結束或已過到期日）」的系統訊息，原因代碼為 `COUPON_INACTIVE`

#### Scenario: 已到期的券不擋 AI 回覆
- **GIVEN** 關鍵字規則只發一張已過到期日的券
- **WHEN** 顧客傳送符合的關鍵字
- **THEN** 系統不把這條規則當成會回覆，AI 照常回覆

#### Scenario: 選券清單不列已到期的券
- **WHEN** 管理者在廣播「附上優惠券」、關鍵字回覆或加好友禮選券
- **THEN** 清單不列出已過固定效期到期日的券；規則上已選的券過了到期日時，提醒規則觸發時不會發券

#### Scenario: 券詳情頁不能批次發送已到期的券
- **GIVEN** 有發券權限的使用者開啟一張已過到期日的固定效期券
- **WHEN** 頁面載入
- **THEN** 不顯示「發送給…」，並說明「已過到期日，不能再發送」

#### Scenario: 優惠券列表標示已到期的券
- **GIVEN** 一張進行中、固定效期、到期日已過的券，與一張進行中、還沒到期的券
- **WHEN** 使用者開啟優惠券列表
- **THEN** 已到期的券在狀態旁標示「已過到期日」，還沒到期的券沒有這個標示，兩張的狀態都仍顯示「進行中」

## MODIFIED Requirements

### Requirement: 發券面板列出可發的補償券

發券面板 SHALL 只列出用途為「客服補償」、發布中且沒有過固定效期到期日的券，並附此顧客的領取狀況，讓座席判斷能否發送。

#### Scenario: 只列出發布中的客服補償券

- **GIVEN** 租戶有發布中的客服補償券、發布中的行銷券、已暫停的客服補償券、固定效期已過到期日的客服補償券
- **WHEN** 座席開啟發券面板
- **THEN** 只列出發布中、沒有到期的客服補償券

#### Scenario: 有消費門檻的券排在前面

- **GIVEN** 兩張客服補償券，一張有最低消費、一張沒有
- **WHEN** 座席開啟發券面板
- **THEN** 有最低消費的券排在前面，並標示可帶動消費

#### Scenario: 已達每人上限的券

- **GIVEN** 券的每人領取上限為 1，此顧客已領取並使用過
- **WHEN** 座席開啟發券面板
- **THEN** 此券標示已達上限，附此顧客最近一次的領取日期與使用日期

#### Scenario: 即將到期的券

- **GIVEN** 固定效期的客服補償券將在 2 天後結束
- **WHEN** 座席開啟發券面板
- **THEN** 此券標示即將到期，附到期日

#### Scenario: 沒有可發的補償券

- **GIVEN** 租戶沒有發布中的客服補償券
- **WHEN** 座席開啟發券面板
- **THEN** 券清單為空

#### Scenario: 已到期的券在發送時擋下

- **GIVEN** 座席開啟發券面板後，券才過了固定效期的到期日
- **WHEN** 座席發送這張券
- **THEN** 回報 `COUPON_NOT_ISSUABLE`，不建立券

### Requirement: 發券規則的優惠券須為進行中

建立或修改自動化規則（含關鍵字回覆與加好友禮）時，新增的 `issue_coupon` 動作或更換過的 `couponId` SHALL 是同租戶、進行中且沒有過固定效期到期日的券，否則回 400 且不儲存規則。規則原本就指向的券沒有更換時，系統 SHALL NOT 因券已暫停、結束或過了到期日而擋下存檔（後台仍標示這張券已暫停、已結束、已過到期日或找不到）。

#### Scenario: 存檔時券不存在或屬於其他租戶

- **WHEN** 管理員新增 `issue_coupon` 動作，`couponId` 不是 UUID、不存在、屬於其他租戶、不是進行中，或固定效期已過到期日
- **THEN** 系統回 400，訊息說明找不到可發放的優惠券，不儲存規則

#### Scenario: 規則上的券已暫停，只修改關鍵字可以存檔

- **GIVEN** 關鍵字規則的 `couponId` 指向一張之後被暫停的券
- **WHEN** 管理員只修改關鍵字並儲存，`couponId` 不變
- **THEN** 規則儲存成功，關鍵字回覆頁仍標示這張券已暫停

#### Scenario: 更換成暫停的券會被擋

- **GIVEN** 關鍵字規則的 `couponId` 指向一張進行中的券
- **WHEN** 管理員把券換成一張已暫停的券並儲存
- **THEN** 系統回 400，不儲存規則
