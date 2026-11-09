## Why

issue #470：上傳的檔案被內容偵測（Magika）拒絕時，畫面直接顯示英文，例如 `File content type rejected: file content type is unknown`。客服與管理員看不懂原因，也不知道要怎麼改。收件匣傳圖片、影片的 `Unsupported file type. Allowed: …`、`File exceeds 20 MB limit`，以及網站聊天室背景圖的 `{ "error": "No file uploaded" }`、`{ "error": "Unsupported background image type" }` 也是英文，背景圖的回應連格式都不是 `{ success, error: { code, message } }`，前端 `getApiErrorMessage()` 讀不到訊息。

主規格「Content-based upload validation」只寫「回傳明確的檔案類型錯誤」，沒有規定訊息內容與語言，也沒有區分原因。訊息是使用者看得到的行為，所以依 AGENTS.md 的表格開 change，並以 MODIFIED 補上情境。

## What Changes

- 內容偵測拒絕時，`message` 改成中文並依原因區分：空檔案、無法辨識內容（含偵測信心不足）、類型不允許、內容與副檔名不符（含與宣告的類型不符）。訊息說出偵測到的格式或該入口允許的格式。
- 偵測暫時無法使用（503）的訊息改成中文。
- 英文原因放在 `details.reason`，與既有的 `detectedMime`、`label`、`confidence` 一起；log 記錄原因、入口、偵測結果，不記錄檔名與內容。
- 錯誤碼（`INVALID_FILE_TYPE`、`FILE_TYPE_DETECTION_UNAVAILABLE`、`BAD_REQUEST`）與 HTTP 狀態不變。
- 收件匣傳媒體的類型不符、檔案過大，與網站聊天室背景圖的沒附檔案、類型不符，改成中文；背景圖改用 `AppError`，回應變成標準格式。
- 訊息集中在 `apps/api/src/shared/messages/upload.ts`。直傳的「檔案超過上限」（`storage.service.ts`）也改用同一個函式，訊息多了「請壓縮後再上傳」。
- 前端 `CompactImageField`、`CompactVideoField` 改用 `getApiErrorMessage()`：後端沒回訊息時（例如代理伺服器的 413）依狀態顯示說明，不再顯示「上傳失敗」或英文的 `Request failed with status code 413`。

## Capabilities

### Modified Capabilities

- `upload-content-detection`：「Content-based upload validation」補上拒絕原因的中文訊息與 `details.reason`；「Multipart routes validate before side effects」補上入口自己的類型、大小檢查的中文訊息。

## Impact

- API：`apps/api/src/shared/messages/upload.ts`（新）、`modules/upload/upload-validation.ts`、`upload-content-detector.ts`、`conversation/conversation.routes.ts`、`channel/channel.routes.ts`、`storage/storage.service.ts`
- Web：`components/materials/CompactImageField.tsx`、`CompactVideoField.tsx`
- 呼叫端只看錯誤碼的程式不受影響。合作方推送（partner-ingest）的附件被拒時只寫 log、不回給合作方，所以不受中文訊息影響。
- 文件：`CHANGELOG.md`、`docs/ref/features/health/` 的 HC-KNOWLEDGE-11、HC-INBOX-12、HC-CHANNELS-03
