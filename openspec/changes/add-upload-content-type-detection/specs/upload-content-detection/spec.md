## Purpose

在檔案進入 MinIO/S3 或文件解析器前確認其實際內容類型，降低偽裝 MIME、錯誤副檔名與不相容 parser 輸入造成的風險，並讓直傳檔案也有可驗證的安全生命週期。

## ADDED Requirements

### Requirement: Detection feature flag

系統 MUST 提供 `UPLOAD_CONTENT_DETECTION_ENABLED` 環境變數控制內容偵測，預設值 MUST 為 `true`。當值為 `true` 或未設定時，所有受保護上傳入口 MUST 執行內容偵測；當值明確為 `false` 時，系統 MAY 暫時略過偵測以供緊急回退，但 MUST 在 API 啟動時記錄高可見度 warning，且 README MUST 說明此設定會降低上傳安全性。

#### Scenario: Detection is enabled by default

- **WHEN** `UPLOAD_CONTENT_DETECTION_ENABLED` 未設定或設定為 `true`
- **THEN** API 啟動並 preload 本地模型，受保護上傳入口執行內容偵測

#### Scenario: Detection can be disabled for emergency rollback

- **WHEN** `UPLOAD_CONTENT_DETECTION_ENABLED=false`
- **THEN** 受保護上傳入口暫時沿用既有 MIME/route policy 流程，API 啟動 log 明確標示 upload content detection disabled，且不宣稱檔案已通過內容驗證

### Requirement: Content-based upload validation

系統 MUST 以檔案 bytes 偵測實際內容類型，不得只信任 multipart 的 client MIME 或原始副檔名。系統 MUST 對每個上傳入口套用該入口允許的 canonical content type 清單；不支援、無法辨識或信心不足的檔案 MUST 被拒絕，且不得進入正式 storage 或 parser。

#### Scenario: Valid image with forged client MIME

- **WHEN** 使用者上傳實際為 PNG 的檔案，但 client MIME 宣告為 `application/pdf`
- **THEN** 系統依檔案內容偵測並拒絕 MIME/內容不一致的請求，且不儲存檔案

#### Scenario: Valid knowledge document

- **WHEN** 使用者上傳內容與副檔名一致且屬入口允許清單的 PDF、DOCX、XLSX、CSV、HTML、Markdown 或純文字檔
- **THEN** 系統接受檔案，並把經驗證的 canonical type 傳給對應 parser 或 storage metadata

#### Scenario: Unknown or disallowed content

- **WHEN** 上傳內容是未知 binary、偽裝的 executable，或不屬於該入口允許清單
- **THEN** 系統回傳明確的檔案類型錯誤，不呼叫 parser、不建立正式 storage object，且不把檔案內容寫入 log

### Requirement: Multipart routes validate before side effects

所有 multipart 檔案入口 MUST 在 storage upload、image transformation、文件 parser 或資料庫寫入前完成內容偵測。既有檔案大小限制、租戶授權與路由允許格式 MUST 維持；偵測失敗 MUST 不留下可被業務流程使用的部分結果。

#### Scenario: Conversation media is validated before storage

- **WHEN** 對話媒體上傳的 bytes 與宣告的 image/video 類型不一致
- **THEN** API 在 `uploadFile` 前回傳 4xx 檔案類型錯誤，且不建立 MinIO object 或 outbound message

#### Scenario: Knowledge upload is validated before parsing

- **WHEN** 知識庫上傳的檔案宣告為 XLSX 但內容不是允許的 spreadsheet
- **THEN** 該檔案被標記失敗或回傳拒絕結果，且 `parseSpreadsheetToQaRows`/文件 parser 不會處理該 bytes

### Requirement: Presigned upload quarantine lifecycle

presigned upload MUST 先寫入 tenant-scoped quarantine object。系統 MUST 提供完成/掃描操作，在讀取該 object 並通過內容偵測與入口允許清單後，才 promote 成正式檔案並回傳可供業務使用的 key/URL；未完成、失敗或過期的 quarantine object MUST 不可被正式檔案 API 當作已驗證檔案使用。

#### Scenario: Presigned upload is promoted after scan

- **WHEN** client PUT 檔案至 quarantine presigned URL，接著呼叫 complete/scan 且內容通過偵測
- **THEN** 系統建立正式 tenant-scoped object、刪除或封存 quarantine object，並回傳驗證後的 key/URL

#### Scenario: Presigned upload fails content validation

- **WHEN** complete/scan 偵測到 bytes 與宣告 MIME/副檔名不一致或類型不在允許清單
- **THEN** 系統拒絕 promote、刪除 quarantine object 或標記為不可用，且不回傳可使用的正式 URL

### Requirement: Detection diagnostics and security boundaries

系統 MUST 將偵測結果以安全摘要記錄（canonical type、confidence/decision、route），但 MUST NOT 記錄 API secrets、完整檔案內容或不必要的個人資料。檔案內容偵測 MUST 被文件化為 type validation，不得宣稱其提供病毒掃描、惡意程式清除或 sandbox execution。

#### Scenario: Detection result is auditable without file disclosure

- **WHEN** 檔案完成驗證或被拒絕
- **THEN** log 可追蹤偵測決策與結果，但不包含完整 bytes、檔案全文或未遮罩的敏感資訊

#### Scenario: Malware scanning remains separate

- **WHEN** 檔案內容通過型別偵測
- **THEN** 系統只允許進入允許的 storage/parser 流程，不回報「已通過病毒掃描」或「檔案安全」
