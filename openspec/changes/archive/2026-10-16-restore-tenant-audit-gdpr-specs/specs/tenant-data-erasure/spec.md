## ADDED Requirements

### Requirement: 發起聯絡人資料刪除

`POST /api/v1/tenant/data-erasure` SHALL 接受 `contactId`、`mode`（`anonymize` 或 `hard_delete`，預設 `anonymize`）與選填的 `reason`。`reason` SHALL 存在請求的 `reason` 欄位，SHALL NOT 寫進稽核的 `payload` 或佇列的工作內容。聯絡人 SHALL 屬於目前的租戶，否則系統回 HTTP 404 `CONTACT_NOT_FOUND`，不建立請求。

聯絡人屬於目前的租戶時，系統 SHALL 建立一筆 `status` 是 `pending` 的 `DataErasureRequest`，寫一筆 `data.erasure.request` 稽核，再把刪除工作放進 `data-erasure` 佇列。稽核 SHALL 記錄發起請求的來源 IP。呼叫的成員 SHALL 有 `data.erase`，沒有時系統回 HTTP 403。

#### Scenario: 發起匿名化
- **WHEN** 有 `data.erase` 的成員對本租戶的聯絡人發起刪除，帶 `reason`、沒有指定 `mode`
- **THEN** 系統建立 `mode` 是 `anonymize`、`status` 是 `pending` 的請求，`reason` 存在請求上，寫一筆 `data.erasure.request` 稽核，`payload` 只有 `contactId` 與 `mode`，佇列的工作內容不含 `reason`

#### Scenario: 發起刪除的稽核記錄來源 IP
- **WHEN** 有 `data.erase` 的成員從某個 IP 發起刪除
- **THEN** `data.erasure.request` 稽核的 `ip` 是該請求的來源 IP

#### Scenario: 其他租戶的聯絡人被拒
- **WHEN** 成員對其他租戶的聯絡人發起刪除
- **THEN** 系統回 HTTP 404，`error.code` 是 `CONTACT_NOT_FOUND`，不建立請求

#### Scenario: 沒有 data.erase 不能發起
- **WHEN** 沒有 `data.erase` 的成員送出 `POST /api/v1/tenant/data-erasure`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `data.erase`，不建立請求

### Requirement: 匿名化聯絡人

`anonymize` 模式 SHALL 在同一個交易內：

- 把聯絡人的 `displayName` 改成 `[已刪除]`，`avatarUrl`、`phone`、`email` 清成 `null`。
- 刪除該聯絡人的屬性、渠道身分、`IdentityMap` 與長期記憶。
- 把該聯絡人對話裡所有進站訊息的 `content` 改成 `{ redacted: true }`。

對話、工單、出站訊息與聯絡人本身 SHALL 保留，報表的數字因此不變。這個模式不處理的資料列在 `docs/ref/system/AUDIT.md` 的 ERASE-01。

#### Scenario: 匿名化後無法從聯絡人與進站訊息識別客人
- **WHEN** worker 以 `anonymize` 處理一位有渠道身分、屬性、對話與工單的聯絡人
- **THEN** 聯絡人的名稱是 `[已刪除]`，電話、email、頭像是 `null`，屬性、渠道身分、`IdentityMap` 與長期記憶已刪除，進站訊息的內容是 `{ redacted: true }`，對話、工單與出站訊息仍在

### Requirement: 硬刪除聯絡人

`hard_delete` 模式 SHALL 在同一個交易內刪除該聯絡人的對話與訊息、工單、活動提交、積分紀錄，以及聯絡人本身。聯絡人的屬性、渠道身分、`IdentityMap`、長期記憶、標籤與聯絡人關係隨聯絡人一起刪除。交易成功後，系統 SHALL 刪除這些訊息在物件儲存的媒體檔；單一檔案刪除失敗時只記錄 log。

硬刪除 SHALL 只刪除目標聯絡人的資料。目標與其他聯絡人之間的關係只刪除關係本身，其他聯絡人與他們的資料保留。

#### Scenario: 硬刪除連帶刪除對話與工單
- **WHEN** worker 以 `hard_delete` 處理一位有對話、訊息（含媒體檔）、工單、活動提交與積分紀錄的聯絡人
- **THEN** 聯絡人、他的對話、訊息、工單、活動提交、積分紀錄、屬性、渠道身分、`IdentityMap`、長期記憶與標籤都已從資料庫刪除，訊息的媒體檔已從物件儲存刪除

#### Scenario: 硬刪除不影響其他聯絡人
- **WHEN** 被硬刪除的聯絡人與另一位聯絡人之間有聯絡人關係
- **THEN** 關係已刪除，另一位聯絡人與他的對話仍在

### Requirement: 刪除完成時記錄結果

刪除成功後，系統 SHALL 把請求改為 `completed`，`affected` 記錄各類資料的筆數，並寫一筆 `data.erasure.complete` 稽核，`actorId` 是發起的成員。稽核的 `payload` SHALL 只有 `contactId`、`mode` 與 `affected`，SHALL NOT 包含被刪除的個人資料。成功時系統 SHALL 通知發起的成員。

處理失敗時，請求 SHALL 改為 `failed` 並記錄 `error`。

#### Scenario: 完成稽核不含個人資料
- **WHEN** worker 完成一位聯絡人的刪除
- **THEN** 請求是 `completed`，稽核的 `payload` 只有 `contactId`、`mode` 與 `affected`，不含聯絡人的名稱、電話與 email

#### Scenario: 聯絡人已不存在時記錄失敗
- **WHEN** worker 開始處理時，請求指定的聯絡人已經不存在
- **THEN** 請求改為 `failed`，`error` 記錄原因
