## MODIFIED Requirements

### Requirement: 匿名化聯絡人

`anonymize` 模式 SHALL 在同一個交易內：

- 把聯絡人的 `displayName` 改成 `[已刪除]`，`avatarUrl`、`phone`、`email` 清成 `null`。
- 刪除該聯絡人的屬性、渠道身分、`IdentityMap` 與長期記憶。
- 在改寫進站訊息之前，讀出這些進站訊息 `content.storageKey` 指向的媒體檔。
- 把該聯絡人對話裡所有進站訊息的 `content` 改成 `{ redacted: true }`。

交易成功後，系統 SHALL 依「刪除訊息媒體檔的範圍」刪除進站訊息的媒體檔，並依「刪除頭像檔的範圍」刪除聯絡人的 `avatarUrl` 與渠道身分的 `profilePic` 在物件儲存的頭像檔。刪除失敗依「物件儲存的檔案刪除失敗時記錄筆數」處理。

對話、工單、出站訊息、出站訊息的媒體檔與聯絡人本身 SHALL 保留，報表的數字因此不變。這個模式不處理的資料列在 `docs/ref/system/AUDIT.md` 的 ERASE-01。

#### Scenario: 匿名化後無法從聯絡人與進站訊息識別客人
- **WHEN** worker 以 `anonymize` 處理一位有渠道身分、屬性、對話與工單的聯絡人
- **THEN** 聯絡人的名稱是 `[已刪除]`，電話、email、頭像是 `null`，屬性、渠道身分、`IdentityMap` 與長期記憶已刪除，進站訊息的內容是 `{ redacted: true }`，對話、工單與出站訊息仍在

#### Scenario: 匿名化刪除頭像檔
- **WHEN** worker 以 `anonymize` 處理一位聯絡人，聯絡人與他的渠道身分的頭像存在本租戶的 `avatars` 目錄
- **THEN** 這些頭像檔已從物件儲存刪除

#### Scenario: 匿名化刪除進站訊息的媒體檔
- **WHEN** worker 以 `anonymize` 處理一位聯絡人，他的進站訊息帶有 `{tenantId}/media/{對話 ID}/{uuid}.jpg` 的 `storageKey`
- **THEN** 這個媒體檔已從物件儲存刪除，`affected.mediaObjects` 是 1

#### Scenario: 匿名化保留出站訊息的媒體檔
- **WHEN** worker 以 `anonymize` 處理一位聯絡人，客服在他的對話傳過一張圖片（出站訊息帶 `storageKey`）
- **THEN** 這個媒體檔不刪，出站訊息的內容不變

### Requirement: 硬刪除聯絡人

`hard_delete` 模式 SHALL 在同一個交易內刪除該聯絡人的對話與訊息、工單、活動提交、積分紀錄，以及聯絡人本身。聯絡人的屬性、渠道身分、`IdentityMap`、長期記憶、標籤與聯絡人關係隨聯絡人一起刪除。交易成功後，系統 SHALL 依「刪除訊息媒體檔的範圍」刪除這些訊息在物件儲存的媒體檔，並依「刪除頭像檔的範圍」刪除聯絡人與渠道身分的頭像檔。刪除失敗依「物件儲存的檔案刪除失敗時記錄筆數」處理。

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

## ADDED Requirements

### Requirement: 刪除訊息媒體檔的範圍

兩種模式刪除訊息的媒體檔時，系統 SHALL 只刪除格式是 `{tenantId}/media/{conversationId}/{uuid}` 或 `{tenantId}/media/{conversationId}/{uuid}.{副檔名}` 的 `storageKey`，其中 `tenantId` 是請求的租戶，`conversationId` 是這次刪除處理的對話之一。格式不符的 key SHALL NOT 刪除，筆數記在 `affected.mediaObjectsSkipped`。

`anonymize` 時，同一批對話裡保留下來的訊息（出站訊息）仍引用的 key SHALL NOT 刪除，筆數記在 `affected.mediaObjectsShared`。要刪除的筆數記在 `affected.mediaObjects`。

#### Scenario: 不刪本租戶媒體目錄以外的檔案
- **WHEN** 被刪除聯絡人的進站訊息帶有其他租戶的 key、本租戶其他對話的 key、`media` 以外目錄的 key，或檔名不是 `{uuid}` 格式的 key
- **THEN** 系統不刪除這些檔案，`affected.mediaObjectsSkipped` 記錄筆數

#### Scenario: 仍被保留訊息引用的媒體檔保留
- **WHEN** worker 以 `anonymize` 處理一位聯絡人，他的進站訊息與同一對話的出站訊息帶有同一個 `storageKey`
- **THEN** 系統不刪除這個檔案，`affected.mediaObjectsShared` 是 1

### Requirement: 物件儲存的檔案刪除失敗時記錄筆數

交易 commit 之後，系統 SHALL 對每個要刪除的媒體檔與頭像檔各呼叫一次物件儲存的刪除，最多一次，不重試。刪除失敗時，請求 SHALL 仍是 `completed`，失敗筆數 SHALL 記在 `affected.mediaObjectsFailed`（訊息媒體檔）與 `affected.avatarObjectsFailed`（頭像檔），沒有失敗時是 0；失敗的 key 寫進 log。完成稽核的 `affected` 與請求的 `affected` SHALL 相同。

#### Scenario: 物件刪除失敗時請求仍然完成
- **WHEN** worker 以 `anonymize` 處理一位有進站媒體檔的聯絡人，物件儲存刪除這個檔案時回錯誤
- **THEN** 請求是 `completed`，`affected.mediaObjectsFailed` 是 1，`data.erasure.complete` 稽核的 `affected` 也是 1
