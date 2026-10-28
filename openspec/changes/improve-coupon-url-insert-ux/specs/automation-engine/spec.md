## ADDED Requirements

### Requirement: 傳送素材動作不可使用含顧客專屬券連結的素材

自動化規則（含關鍵字回覆與加好友禮）建立時、或更新時送了 `actions`，`send_material` 動作的素材含 `{{coupon.url}}` 時，系統 SHALL 回 400（`VALIDATION_ERROR`），訊息說明規則不會發券、顧客拿不到券連結，且 SHALL NOT 儲存規則。只改名稱、優先序或啟用狀態時 SHALL NOT 檢查。關鍵字回覆對話框選到這種素材時 SHALL 顯示看得到的提醒（`role="alert"`）並擋下存檔；自動化規則編輯器選到時 SHALL 顯示提醒。

#### Scenario: 建立關鍵字回覆時選了含券連結的素材
- **WHEN** 使用者建立關鍵字回覆，`send_material` 動作的素材文字為「領券：{{coupon.url}}」
- **THEN** 系統回 400，訊息含「顧客專屬券連結」，不建立規則

#### Scenario: 更新動作時同樣檢查
- **WHEN** 使用者更新規則的 `actions`，改用含 `{{coupon.url}}` 的素材
- **THEN** 系統回 400，不更新規則

#### Scenario: 只改啟用狀態不檢查
- **GIVEN** 既有規則的素材含 `{{coupon.url}}`
- **WHEN** 使用者只把規則停用或改名
- **THEN** 系統更新成功

#### Scenario: 關鍵字回覆對話框提醒並擋下存檔
- **WHEN** 使用者在關鍵字回覆對話框選了含 `{{coupon.url}}` 的素材
- **THEN** 畫面顯示含「顧客專屬券連結」的提醒
- **AND** 按儲存時不送出請求，顯示同樣原因
