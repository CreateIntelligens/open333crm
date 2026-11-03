## MODIFIED Requirements

### Requirement: 發起資料匯出

`POST /api/v1/tenant/data-export` SHALL 建立一筆 `DataExportRequest`（`status` 是 `pending`，記錄 `tenantId` 與發起的成員），寫一筆 `data.export.request` 稽核，再把產生檔案的工作放進 `data-export` 佇列，然後立即回傳請求的 ID 與狀態。呼叫的成員 SHALL 有 `data.export`，沒有時系統回 HTTP 403，不建立請求。成員也 SHALL 符合「匯出只限可查看所有渠道的成員」。

#### Scenario: 發起匯出
- **WHEN** 有 `data.export` 與 `channel.view_all` 的成員發起匯出
- **THEN** 系統建立 `status` 是 `pending` 的請求，寫一筆 `action` 是 `data.export.request`、`targetId` 是請求 ID 的稽核，並回傳該請求

#### Scenario: 沒有 data.export 不能發起
- **WHEN** 沒有 `data.export` 的成員送出 `POST /api/v1/tenant/data-export`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `data.export`，不建立請求

### Requirement: 下載匯出檔與保留期

`GET /api/v1/tenant/data-export/:id/download` SHALL 只回應同租戶、有 `data.export` 且符合「匯出只限可查看所有渠道的成員」的成員：

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

## ADDED Requirements

### Requirement: 匯出只限可查看所有渠道的成員

匯出檔含全租戶所有渠道的資料，不依成員的渠道可見範圍篩選。所以發起匯出、查詢匯出請求（`GET /api/v1/tenant/data-export/:id`）與下載匯出檔時，成員 SHALL 同時有 `data.export` 與 `channel.view_all`。只缺 `channel.view_all` 時，系統 SHALL 回 HTTP 403，`error.details.requiredPermission` 是 `channel.view_all`，不建立請求、不回傳請求內容或下載連結、不累計下載次數。同時有這兩個權限的成員 SHALL 能查詢與下載同租戶其他成員發起的匯出。

#### Scenario: 沒有 channel.view_all 不能發起匯出
- **WHEN** 有 `data.export`、沒有 `channel.view_all` 的成員送出 `POST /api/v1/tenant/data-export`
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `channel.view_all`，不建立請求、不寫稽核、不送出匯出工作

#### Scenario: 沒有 channel.view_all 不能查詢或下載別人發起的匯出
- **WHEN** 有 `data.export`、沒有 `channel.view_all` 的成員查詢或下載同租戶一筆已完成的匯出
- **THEN** 系統回 HTTP 403，`error.details.requiredPermission` 是 `channel.view_all`，不回傳請求內容或下載連結，`downloadCount` 不變

#### Scenario: 有 data.export 與 channel.view_all 的成員可以查詢與下載別人發起的匯出
- **WHEN** 有 `data.export` 與 `channel.view_all` 的成員查詢並下載同租戶其他成員發起、已完成且未過期的匯出
- **THEN** 系統回 HTTP 200 與請求狀態，下載回 HTTP 200 與下載連結
