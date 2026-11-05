# tenant-data-export Specification

## Purpose
規定租戶怎麼匯出自己的業務資料（聯絡人、對話、訊息、工單），用於資料可攜或備份：發起申請、workers 打包上傳、在 7 天保留期內下載，以及到期後清理檔案。

## Requirements

### Requirement: 發起資料匯出

`POST /api/v1/tenant/data-export` SHALL 建立一筆 `DataExportRequest`（`status` 是 `pending`，記錄 `tenantId` 與發起的成員），寫一筆 `data.export.request` 稽核，再把產生檔案的工作放進 `data-export` 佇列，然後立即回傳請求的 ID 與狀態。呼叫的成員 SHALL 有 `data.export`，沒有時系統回 HTTP 403，不建立請求。成員也 SHALL 符合「匯出只限可查看所有渠道的成員」。

#### Scenario: 發起匯出
- **WHEN** 有 `data.export` 與 `channel.view_all` 的成員發起匯出
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

### Requirement: worker 不重新處理已結束的匯出請求

worker 開始處理匯出工作時，MUST 以條件更新把請求從 `pending` 或 `processing` 改成 `processing`。請求是 `completed`、`failed` 或 `expired` 時，worker MUST 直接結束，MUST NOT 產生或上傳匯出檔、改變請求狀態或通知。請求是 `processing` 時，代表上一次執行中途結束，worker MUST 重新處理。把請求改成 `completed` 時 MUST 以 `processing` 為條件，條件不成立時 MUST NOT 通知。

#### Scenario: 已完成的請求再執行一次

- **WHEN** 匯出請求已經是 `completed`，同一個匯出工作再執行一次
- **THEN** 請求的 `fileKey` 與 `expiresAt` MUST 不變，發起的成員 MUST NOT 收到第二則完成通知

#### Scenario: 上一次執行中途結束

- **WHEN** 匯出請求是 `processing`，`fileKey` 是空值，同一個匯出工作再執行一次
- **THEN** 請求 MUST 是 `completed` 並有 `fileKey`，發起的成員 MUST 收到一則完成通知

#### Scenario: 兩次同時執行

- **WHEN** 同一個匯出工作同時執行兩次
- **THEN** 請求 MUST 是 `completed`，發起的成員 MUST 只收到一則完成通知

### Requirement: 發起匯出的寫入一起成立

發起匯出時，系統 MUST 在同一個交易寫入請求、`data.export.request` 稽核與匯出工作。其中一項寫不進去時，系統 MUST NOT 留下另外兩項，並回錯誤。匯出工作 MUST 在交易 commit 之後才送進 `data-export` 佇列，至少送出一次。commit 之後送不進佇列時，系統 MUST 仍回成功，請求維持 `pending`，匯出工作 MUST 留在 outbox，由補送排程送出。

#### Scenario: 匯出工作寫不進 outbox 時不留下請求與稽核

- **WHEN** 成員發起匯出，匯出工作寫不進 outbox
- **THEN** 系統回錯誤，租戶沒有新的匯出請求，也沒有新的 `data.export.request` 稽核

#### Scenario: 稽核寫不進去時不送出匯出工作

- **WHEN** 成員發起匯出，`data.export.request` 稽核寫不進去
- **THEN** 交易 rollback，匯出工作 MUST NOT 送進佇列

#### Scenario: commit 之後送不進佇列時，請求仍然成立

- **WHEN** 成員發起匯出，交易 commit 之後匯出工作送不進佇列
- **THEN** 系統回 HTTP 200，請求是 `pending`，匯出工作留在 outbox，還沒有標記已送出

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

### Requirement: 匯出檔的 CSV 欄位經過跳脫與公式防護

資料匯出 zip 中 `csv/` 的檔案 SHALL 讓標題列與每個欄位經過與報表匯出相同的規則：含逗號、雙引號、CR 或 LF 的欄位以雙引號包住並把 `"` 改成 `""`；以 `=`、`+`、`-`、`@`、Tab、CR 開頭的文字前面加 `'`；數字照原樣輸出；日期輸出 ISO 8601 字串。

#### Scenario: 聯絡人名稱以公式開頭又含逗號
- **WHEN** 匯出的聯絡人名稱是 `=HYPERLINK("http://evil.example","點我, 領獎")`
- **THEN** `csv/contacts.csv` 該列欄數與標題列相同，名稱欄是 `'` 加上原名稱

#### Scenario: 數字與日期欄位照原樣輸出
- **WHEN** 某列的數字欄位是 -3、日期欄位是 2026-11-04 00:00 UTC
- **THEN** 數字欄是 `-3`，日期欄是 `2026-11-04T00:00:00.000Z`
