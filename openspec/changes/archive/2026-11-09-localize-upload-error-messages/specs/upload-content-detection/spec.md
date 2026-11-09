## MODIFIED Requirements

### Requirement: Content-based upload validation

系統 MUST 以檔案 bytes 偵測實際內容類型，不得只信任 multipart 的 client MIME 或原始副檔名。系統 MUST 對每個上傳入口套用該入口允許的 canonical content type 清單；不支援、無法辨識或信心不足的檔案 MUST 被拒絕，且不得進入正式 storage 或 parser。拒絕時錯誤碼 MUST 是 `INVALID_FILE_TYPE`（HTTP 400），`message` MUST 是依原因區分的中文說明（空檔案、無法辨識內容、類型不允許、內容與副檔名不符），偵測器的英文原因 MUST 放在 `details.reason`，不得出現在 `message`。偵測器本身無法使用時，錯誤碼 MUST 是 `FILE_TYPE_DETECTION_UNAVAILABLE`（HTTP 503），`message` MUST 是中文。

#### Scenario: Valid image with forged client MIME

- **WHEN** 使用者上傳實際為 PNG 的檔案，但 client MIME 宣告為 `application/pdf`
- **THEN** 系統依檔案內容偵測並拒絕 MIME/內容不一致的請求，且不儲存檔案

#### Scenario: Valid knowledge document

- **WHEN** 使用者上傳內容與副檔名一致且屬入口允許清單的 PDF、DOCX、XLSX、CSV、HTML、Markdown 或純文字檔
- **THEN** 系統接受檔案，並把經驗證的 canonical type 傳給對應 parser 或 storage metadata

#### Scenario: Unknown or disallowed content

- **WHEN** 上傳內容是未知 binary、偽裝的 executable，或不屬於該入口允許清單
- **THEN** 系統回傳明確的檔案類型錯誤，不呼叫 parser、不建立正式 storage object，且不把檔案內容寫入 log

#### Scenario: Empty file is rejected with a Chinese message

- **WHEN** 上傳 0 bytes 的檔案
- **THEN** 回 400 `INVALID_FILE_TYPE`，`message` 為「檔案是空的，請重新選擇檔案」，`details.reason` 為 `empty file`

#### Scenario: Unrecognized content lists the allowed formats

- **WHEN** 收件匣圖片入口（允許 JPEG、PNG）收到偵測器認不出、或信心低於門檻的檔案
- **THEN** 回 400 `INVALID_FILE_TYPE`，`message` 為「無法辨識檔案內容，請確認檔案沒有損壞，且是允許的格式（JPG、PNG）」，`details.reason` 保留英文原因

#### Scenario: Disallowed type names the detected format

- **WHEN** imagemap 入口（允許 JPEG、PNG、WebP）收到內容是 PDF 的 `manual.pdf`
- **THEN** 回 400 `INVALID_FILE_TYPE`，`message` 為「這裡不接受 PDF 檔案，請改用 JPG、PNG、WEBP」，`details.detectedMime` 為 `application/pdf`

#### Scenario: Content that does not match the extension

- **WHEN** 上傳內容是 PNG、檔名是 `document.pdf`，或 client MIME 宣告為 `application/pdf`
- **THEN** 回 400 `INVALID_FILE_TYPE`，`message` 為「檔案內容（PNG）與副檔名不符，請確認檔案格式或改正副檔名」，`details.reason` 保留英文原因

#### Scenario: Detector unavailable returns a Chinese message

- **WHEN** 偵測器執行時丟出例外
- **THEN** 回 503 `FILE_TYPE_DETECTION_UNAVAILABLE`，`message` 為「暫時無法檢查檔案內容，請稍後再試」，不包含檔案內容

### Requirement: Multipart routes validate before side effects

所有 multipart 檔案入口 MUST 在 storage upload、image transformation、文件 parser 或資料庫寫入前完成內容偵測。既有檔案大小限制、租戶授權與路由允許格式 MUST 維持；偵測失敗 MUST 不留下可被業務流程使用的部分結果。入口自己的類型與大小檢查失敗時，MUST 回標準格式 `{ success: false, error: { code, message } }`，`message` MUST 是中文並說出允許的格式或大小上限。

#### Scenario: Conversation media is validated before storage

- **WHEN** 對話媒體上傳的 bytes 與宣告的 image/video 類型不一致
- **THEN** API 在 `uploadFile` 前回傳 4xx 檔案類型錯誤，且不建立 MinIO object 或 outbound message

#### Scenario: Knowledge upload is validated before parsing

- **WHEN** 知識庫上傳的檔案宣告為 XLSX 但內容不是允許的 spreadsheet
- **THEN** 該檔案被標記失敗或回傳拒絕結果，且 `parseSpreadsheetToQaRows`/文件 parser 不會處理該 bytes

#### Scenario: Conversation media type and size errors are shown in Chinese

- **WHEN** 收件匣傳圖片送出 `text/plain` 檔案，或送出超過 20 MB 的圖片
- **THEN** 回 400 `BAD_REQUEST`，`message` 分別為「不支援這種檔案，請改用 PNG、JPG」與「檔案超過上限 20 MB，請壓縮後再上傳」

#### Scenario: Chatbox background errors use the standard format

- **WHEN** 網站聊天室背景圖上傳沒有附檔案，或檔案類型不是 PNG、JPEG、WebP
- **THEN** 回 400 `BAD_REQUEST` 標準格式，`message` 分別為「請選擇要上傳的檔案」與「不支援這種檔案，請改用 PNG、JPG、WEBP」
