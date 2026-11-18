## MODIFIED Requirements

### Requirement: 新 UID 首次進站必須建立聯絡人並落地訊息

當 inbound webhook 通過驗簽並解析出訊息，且其 `contactUid` 在該租戶／渠道下尚無對應的身分綁定與 IdentityMap 記錄時，系統 SHALL 完成聯絡人建立、對話建立與訊息落地，使該訊息出現在前台收件匣。

建立聯絡人之前，系統 SHALL 先查該渠道的留言者對應（留言自動私訊）：有一筆的私訊 ID 或留言者 ID 等於 `contactUid`、且其聯絡人未封存時，SHALL 把渠道身分建在那位聯絡人，不建立新聯絡人。

#### Scenario: 全新使用者第一次傳訊息

- **GIVEN** 租戶啟用中、渠道啟用中、webhook 驗簽通過
- **AND** 該 `contactUid` 在系統中不存在任何身分綁定或 IdentityMap 記錄
- **WHEN** 該使用者傳送一則文字訊息
- **THEN** 系統建立對應的聯絡人
- **AND** 建立對話並將訊息落地
- **AND** 該訊息可於前台收件匣查得

#### Scenario: 已綁定身分的使用者傳訊息

- **GIVEN** 該 `contactUid` 已有身分綁定
- **WHEN** 該使用者傳送訊息
- **THEN** 訊息歸戶至既有聯絡人，不建立重複聯絡人

#### Scenario: 留言者自己傳第一則私訊

- **GIVEN** IG 留言者 `IGSID-1` 的留言命中規則，系統建立了聯絡人 A，私訊失敗，A 沒有渠道身分
- **WHEN** `IGSID-1` 傳第一則私訊給該 IG 帳號
- **THEN** 渠道身分建在 A，訊息落地在 A 的對話，租戶聯絡人總數不變
