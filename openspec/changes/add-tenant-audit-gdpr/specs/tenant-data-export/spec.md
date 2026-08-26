## ADDED Requirements

### Requirement: 租戶可發起資料匯出請求
系統 SHALL 提供 API 讓具 `data.export` 權限的成員發起本租戶業務資料的匯出。發起後系統 MUST 建立一筆 `DataExportRequest`（狀態 `pending`、綁定 `tenantId` 與 `requestedBy`），並以非同步方式（BullMQ worker）處理，不阻塞 HTTP 回應。發起動作 MUST 寫入 `TenantAuditLog`（`action=data.export.request`）。

#### Scenario: 成功發起匯出
- **WHEN** 具 `data.export` 權限的成員發起匯出
- **THEN** 系統建立 `DataExportRequest(status=pending)`、入列非同步 job、寫稽核，並立即回傳請求 id 與 pending 狀態

#### Scenario: 無權限被拒
- **WHEN** 不具 `data.export` 權限的成員發起匯出
- **THEN** 系統回傳 403 且不建立任何請求

### Requirement: 非同步產生匯出檔並存物件儲存
匯出 worker SHALL 逐表撈取該 `tenantId` 的業務資料（至少涵蓋聯絡人、對話、訊息、案件及其附屬資料），產生同時包含 JSON（保留關聯完整性）與 CSV（主表扁平化）的 zip 檔，上傳至物件儲存，並將 `DataExportRequest` 更新為 `completed`、寫入 `fileKey`、`fileSizeBytes` 與 `expiresAt`。完成後系統 SHALL 通知發起者。撈取資料時 MUST 僅限當前 `tenantId`。

#### Scenario: 匯出完成並通知
- **WHEN** worker 完成打包並上傳
- **THEN** `DataExportRequest.status=completed`、`fileKey` 與 `expiresAt` 已寫入，且發起者收到站內通知

#### Scenario: 匯出只含本租戶資料
- **WHEN** worker 為 A 租戶產生匯出檔
- **THEN** 產出的 zip 不含任何 B 租戶的資料

#### Scenario: 匯出失敗記錄原因
- **WHEN** worker 處理過程發生錯誤
- **THEN** `DataExportRequest.status=failed` 並記錄 `error`，且發起者被通知失敗

### Requirement: 一次性下載與檔案保留期
系統 SHALL 提供下載 API，僅允許具 `data.export` 權限且屬於該請求同一租戶的成員，在請求 `status=completed` 且未過期時下載，每次下載使 `downloadCount` 遞增。匯出檔 MUST 於 `expiresAt` 到期後被清除且不可再下載（狀態轉為 `expired`）。

#### Scenario: 有效期內下載
- **WHEN** 同租戶且具權限的成員在保留期內請求下載已完成的匯出
- **THEN** 系統提供檔案（或短時效下載連結）並將 `downloadCount` 加一

#### Scenario: 過期不可下載
- **WHEN** 成員在 `expiresAt` 之後請求下載
- **THEN** 系統拒絕下載，該請求狀態為 `expired`，且物件儲存中的檔案已被清除

#### Scenario: 跨租戶下載被拒
- **WHEN** B 租戶成員嘗試下載 A 租戶的匯出檔
- **THEN** 系統回傳 403/404 且不提供任何檔案
