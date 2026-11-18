## MODIFIED Requirements

### Requirement: 匿名化聯絡人

`anonymize` 模式 SHALL 在同一個交易內，對目標聯絡人與併入他的封存聯絡人（沿 `mergedIntoId` 逐層往下找到的 `isArchived` 聯絡人）套用相同的規則：

- 把聯絡人的 `displayName` 改成 `[已刪除]`，`avatarUrl`、`phone`、`email` 清成 `null`。
- 刪除這些聯絡人的屬性、渠道身分、`IdentityMap` 與長期記憶。
- 在改寫進站訊息之前，讀出這些進站訊息 `content.storageKey` 指向的媒體檔。
- 把這些聯絡人對話裡所有進站訊息的 `content` 改成 `{ redacted: true }`。
- 把這些聯絡人的留言者對應清除名稱、帳號名稱與私訊 ID，留言者 ID 改成不可識別的值；這些留言者的觸發紀錄清除留言者 ID、名稱、帳號名稱、留言內容、私訊 ID、去重鍵與送出內容快照，保留留言 ID、狀態與時間。

封存聯絡人的筆數 SHALL 記在 `affected.mergedContacts`。交易成功後，系統 SHALL 依「刪除訊息媒體檔的範圍」刪除進站訊息的媒體檔，並依「刪除頭像檔的範圍」刪除這些聯絡人的 `avatarUrl` 與渠道身分的 `profilePic` 在物件儲存的頭像檔。刪除失敗依「物件儲存的檔案刪除失敗時記錄筆數」處理。

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

#### Scenario: 匿名化一併清除併入的封存聯絡人
- **WHEN** 聯絡人 A 併入 B、C 先前併入 A（`C.mergedIntoId` 是 A，兩層），A 與 C 有名稱、電話、email、本租戶 `avatars` 目錄的頭像與屬性，worker 以 `anonymize` 處理 B
- **THEN** A 與 C 的名稱是 `[已刪除]`，電話、email、頭像是 `null`，屬性已刪除，頭像檔已從物件儲存刪除，A 與 C 仍封存，`affected.mergedContacts` 是 2

#### Scenario: 匿名化不處理未封存的聯絡人
- **WHEN** 另一位沒有封存的聯絡人與 B 無關，worker 以 `anonymize` 處理 B
- **THEN** 那位聯絡人的名稱、電話與 email 不變

#### Scenario: 匿名化清除留言自動私訊的個資
- **WHEN** worker 以 `anonymize` 處理一位有留言者對應與 2 筆觸發紀錄的聯絡人
- **THEN** 留言者對應的名稱與私訊 ID 是 null；2 筆紀錄的留言者名稱、留言內容與私訊 ID 是 null，`commentId` 不變
- **AND** 之後 Meta 重投同一則留言時，不產生新紀錄、不呼叫 Meta

### Requirement: 硬刪除聯絡人

`hard_delete` 模式 SHALL 在同一個交易內刪除目標聯絡人與併入他的封存聯絡人（沿 `mergedIntoId` 逐層往下找到的 `isArchived` 聯絡人）的對話與訊息、工單、活動提交、積分紀錄、留言自動私訊的觸發紀錄與留言者對應，以及這些聯絡人本身。觸發紀錄的筆數 SHALL 記在 `affected.commentReplyLogs`。聯絡人的屬性、渠道身分、`IdentityMap`、長期記憶、標籤與聯絡人關係隨聯絡人一起刪除。封存聯絡人的筆數 SHALL 記在 `affected.mergedContacts`，`affected.contacts` 是目標加封存聯絡人的筆數。交易成功後，系統 SHALL 依「刪除訊息媒體檔的範圍」刪除這些訊息在物件儲存的媒體檔，並依「刪除頭像檔的範圍」刪除這些聯絡人與渠道身分的頭像檔。刪除失敗依「物件儲存的檔案刪除失敗時記錄筆數」處理。

硬刪除 SHALL 只刪除目標聯絡人與併入他的封存聯絡人的資料。他們與其他聯絡人之間的關係只刪除關係本身，其他聯絡人與他們的資料保留。

#### Scenario: 硬刪除連帶刪除對話與工單
- **WHEN** worker 以 `hard_delete` 處理一位有對話、訊息（含媒體檔）、工單、活動提交與積分紀錄的聯絡人
- **THEN** 聯絡人、他的對話、訊息、工單、活動提交、積分紀錄、屬性、渠道身分、`IdentityMap`、長期記憶與標籤都已從資料庫刪除，訊息的媒體檔已從物件儲存刪除

#### Scenario: 硬刪除刪除頭像檔
- **WHEN** worker 以 `hard_delete` 處理一位聯絡人，聯絡人與他的渠道身分的頭像存在本租戶的 `avatars` 目錄
- **THEN** 這些頭像檔已從物件儲存刪除

#### Scenario: 硬刪除不影響其他聯絡人
- **WHEN** 被硬刪除的聯絡人與另一位聯絡人之間有聯絡人關係
- **THEN** 關係已刪除，另一位聯絡人與他的對話仍在

#### Scenario: 硬刪除一併刪除併入的封存聯絡人
- **WHEN** 聯絡人 A 併入 B、C 先前併入 A（兩層），A 有合併時轉出點數的積分紀錄與本租戶 `avatars` 目錄的頭像，worker 以 `hard_delete` 處理 B
- **THEN** A、C 與他們的積分紀錄已從資料庫刪除，A 的頭像檔已從物件儲存刪除，`affected.mergedContacts` 是 2，`affected.contacts` 是 3

#### Scenario: 硬刪除刪除留言自動私訊紀錄
- **WHEN** worker 以 `hard_delete` 處理一位有留言者對應與 2 筆觸發紀錄的聯絡人
- **THEN** 留言者對應與 2 筆紀錄都已從資料庫刪除，`affected.commentReplyLogs` 是 2，刪除交易成功
