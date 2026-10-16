## ADDED Requirements

### Requirement: 發起資料匯出

`POST /api/v1/tenant/data-export` SHALL 建立一筆 `DataExportRequest`（`status` 是 `pending`，記錄 `tenantId` 與發起的成員），寫一筆 `data.export.request` 稽核，再把產生檔案的工作放進 `data-export` 佇列，然後立即回傳請求的 ID 與狀態。呼叫的成員 SHALL 有 `data.export`，沒有時系統回 HTTP 403，不建立請求。

#### Scenario: 發起匯出
- **WHEN** 有 `data.export` 的成員發起匯出
- **THEN** 系統建立 `status` 是 `pending` 的請求，寫一筆 `action` 是 `data.export.request`、`targetId` 是請求 ID 的稽核，並回傳該請求

#### Scenario: 沒有 data.export 不能發起
- **WHEN** 沒有 `data.export` 的成員送出 `POST /api/v1/tenant/data-export`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `data.export`，不建立請求

### Requirement: 產生匯出檔

workers 處理匯出工作時 SHALL 讀取該租戶的聯絡人（含渠道身分、屬性、標籤）、對話（含標籤）、訊息與工單（含備註、事件、標籤），打包成 zip：`manifest.json` 記錄各類的筆數，`json/` 存完整資料，`csv/` 存四個主表的扁平欄位。worker SHALL 只讀取該租戶的資料。

zip 上傳物件儲存後，請求 SHALL 改為 `completed`，記錄 `fileKey`、`fileSizeBytes`，`expiresAt` 是 7 天後。處理失敗時，請求 SHALL 改為 `failed` 並記錄 `error`。成功與失敗都 SHALL 通知發起的成員。

#### Scenario: 匯出只含本租戶的資料
- **WHEN** worker 處理租戶 A 的匯出工作，租戶 B 也有聯絡人
- **THEN** 請求改為 `completed`，zip 裡的聯絡人只有租戶 A 的聯絡人，`manifest.json` 的筆數與 zip 內容相符，發起的成員收到完成通知
- **AND** JSON 裡的聯絡人含渠道身分、屬性與標籤，對話含標籤，工單含備註、事件與標籤

#### Scenario: 上傳失敗時記錄原因
- **WHEN** worker 上傳 zip 時物件儲存回傳錯誤
- **THEN** 請求改為 `failed`，`error` 記錄錯誤訊息，發起的成員收到失敗通知

### Requirement: 下載匯出檔與保留期

`GET /api/v1/tenant/data-export/:id/download` SHALL 只回應同租戶、有 `data.export` 的成員：

- 請求是 `completed` 且還沒到 `expiresAt` 時，回傳 15 分鐘有效的下載連結，並把 `downloadCount` 加 1。保留期內可以重複下載。
- 請求不是 `completed` 時，回 HTTP 400 `EXPORT_NOT_READY`。清理後改為 `expired` 的請求也是這個結果。
- 請求仍是 `completed`、但已到 `expiresAt`（還沒清理）時，回 HTTP 410 `EXPORT_EXPIRED`。
- 請求屬於其他租戶時，回 HTTP 404，不透露請求是否存在。

workers SHALL 每小時清理一次：已到 `expiresAt` 的 `completed` 請求，刪除物件儲存的檔案，狀態改為 `expired`，`fileKey` 清成 `null`。

#### Scenario: 保留期內下載
- **WHEN** 成員下載自己租戶、已完成且未過期的匯出
- **THEN** 系統回 HTTP 200 與下載連結，`downloadCount` 加 1

#### Scenario: 過期的匯出不能下載
- **WHEN** 成員下載狀態仍是 `completed`、但已到 `expiresAt` 的匯出
- **THEN** 系統回 HTTP 410，`error.code` 是 `EXPORT_EXPIRED`

#### Scenario: 清理後的匯出不能下載
- **WHEN** 成員下載已被清理、狀態是 `expired` 的匯出
- **THEN** 系統回 HTTP 400，`error.code` 是 `EXPORT_NOT_READY`，不回傳下載連結

#### Scenario: 其他租戶的匯出不能下載
- **WHEN** 租戶 B 的成員下載租戶 A 的匯出
- **THEN** 系統回 HTTP 404，不回傳下載連結

#### Scenario: 清理過期的匯出
- **WHEN** 清理工作執行時，有一筆 `completed` 的請求已到 `expiresAt`
- **THEN** 系統刪除該請求在物件儲存的檔案，請求改為 `expired`，`fileKey` 是 `null`
