## MODIFIED Requirements

### Requirement: 匿名化聯絡人

`anonymize` 模式 SHALL 在同一個交易內：

- 把聯絡人的 `displayName` 改成 `[已刪除]`，`avatarUrl`、`phone`、`email` 清成 `null`。
- 刪除該聯絡人的屬性、渠道身分、`IdentityMap` 與長期記憶。
- 把該聯絡人對話裡所有進站訊息的 `content` 改成 `{ redacted: true }`。

交易成功後，系統 SHALL 刪除聯絡人的 `avatarUrl` 與渠道身分的 `profilePic` 在物件儲存的頭像檔，只刪本租戶 `avatars` 目錄下的檔案；單一檔案刪除失敗時只記錄 log。

對話、工單、出站訊息與聯絡人本身 SHALL 保留，報表的數字因此不變。這個模式不處理的資料列在 `docs/ref/system/AUDIT.md` 的 ERASE-01。

#### Scenario: 匿名化後無法從聯絡人與進站訊息識別客人
- **WHEN** worker 以 `anonymize` 處理一位有渠道身分、屬性、對話與工單的聯絡人
- **THEN** 聯絡人的名稱是 `[已刪除]`，電話、email、頭像是 `null`，屬性、渠道身分、`IdentityMap` 與長期記憶已刪除，進站訊息的內容是 `{ redacted: true }`，對話、工單與出站訊息仍在

#### Scenario: 匿名化刪除頭像檔
- **WHEN** worker 以 `anonymize` 處理一位聯絡人，聯絡人與他的渠道身分的頭像存在本租戶的 `avatars` 目錄
- **THEN** 這些頭像檔已從物件儲存刪除

#### Scenario: 不刪物件儲存以外或其他租戶的檔案
- **WHEN** 聯絡人的頭像是平台的網址，或指向其他租戶的檔案
- **THEN** 系統不刪除這個檔案

### Requirement: 硬刪除聯絡人

`hard_delete` 模式 SHALL 在同一個交易內刪除該聯絡人的對話與訊息、工單、活動提交、積分紀錄，以及聯絡人本身。聯絡人的屬性、渠道身分、`IdentityMap`、長期記憶、標籤與聯絡人關係隨聯絡人一起刪除。交易成功後，系統 SHALL 刪除這些訊息在物件儲存的媒體檔，以及聯絡人與渠道身分在本租戶 `avatars` 目錄的頭像檔；單一檔案刪除失敗時只記錄 log。

硬刪除 SHALL 只刪除目標聯絡人的資料。目標與其他聯絡人之間的關係只刪除關係本身，其他聯絡人與他們的資料保留。

#### Scenario: 硬刪除連帶刪除對話與工單
- **WHEN** worker 以 `hard_delete` 處理一位有對話、訊息（含媒體檔）、工單、活動提交與積分紀錄的聯絡人
- **THEN** 聯絡人、他的對話、訊息、工單、活動提交、積分紀錄、屬性、渠道身分、`IdentityMap`、長期記憶與標籤都已從資料庫刪除，訊息的媒體檔已從物件儲存刪除

#### Scenario: 硬刪除刪除頭像檔
- **WHEN** worker 以 `hard_delete` 處理一位聯絡人，聯絡人與他的渠道身分的頭像存在本租戶的 `avatars` 目錄
- **THEN** 這些頭像檔已從物件儲存刪除

#### Scenario: 硬刪除不影響其他聯絡人
- **WHEN** 被硬刪除的聯絡人與另一位聯絡人之間有聯絡人關係
- **THEN** 關係已刪除，另一位聯絡人與他的對話仍在
