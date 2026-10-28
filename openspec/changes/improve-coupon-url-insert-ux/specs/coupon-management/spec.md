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

具 `coupon.view` 的使用者 SHALL 能以 `GET /api/v1/coupons/claim-links` 列出同租戶可用的領券連結：連結為啟用、券為進行中、連結沒有結束（沒有結束時間或結束時間晚於現在）。每筆 SHALL 含連結名稱、代碼、公開網址（`{WEB_BASE_URL}/coupon/claim/{代碼}`）、券 id 與券名、渠道（類型與名稱）。其他租戶的連結 SHALL NOT 出現。

#### Scenario: 只列出可用的連結
- **GIVEN** 租戶有啟用的連結甲（券進行中）、停用的連結乙、券已暫停的連結丙、已過結束時間的連結丁
- **WHEN** 使用者呼叫 `GET /api/v1/coupons/claim-links`
- **THEN** 回應只有連結甲，含券名與公開網址

#### Scenario: 只列出同租戶的連結
- **WHEN** 使用者列出領券連結
- **THEN** 查詢條件含使用者的租戶，其他租戶的連結不在回應中

#### Scenario: 缺少檢視權限
- **GIVEN** 使用者沒有 `coupon.view`
- **WHEN** 呼叫 `GET /api/v1/coupons/claim-links`
- **THEN** 系統回 403
