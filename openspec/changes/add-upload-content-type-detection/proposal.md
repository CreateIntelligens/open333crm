## Why

目前多個上傳入口直接信任 multipart 的 `file.mimetype`，而知識庫 parser 還會以 MIME 或副檔名決定如何解析檔案。攻擊者可以把不符合內容的檔案偽裝成圖片、PDF、DOCX 或 XLSX，造成錯誤解析、公開儲存或後續處理風險；系統需要在檔案進入 storage/parser 前確認真實內容類型。

## What Changes

- 新增集中式檔案內容偵測能力：使用 magic-byte 偵測確認檔案簽名，再使用 Magika 分類文字與複合文件內容。
- 在一般 multipart upload、對話媒體、LINE imagemap、知識庫 upload 與 partner attachment 路徑，在 storage 或 parser 前執行內容驗證。
- 對 client MIME、副檔名與實際偵測結果不一致的檔案拒絕，回傳可識別的檔案類型錯誤；不把完整檔案內容寫入 log。
- **BREAKING**：presigned upload 改為 quarantine → complete/scan → promote 流程；未完成偵測的物件不得作為可用檔案回傳或被業務流程使用。
- Magika model 在 API image 內固定部署並於 API 啟動時 preload；request runtime 只使用本地已初始化的 singleton，不從外部網站下載。
- 新增 `UPLOAD_CONTENT_DETECTION_ENABLED` 環境開關，預設開啟；可在偵測器故障時暫時關閉，並在啟動 log 明確警告目前處於未防護模式。
- 在 README 文件記錄模型部署、環境變數、預設值、關閉風險與重新啟用方式。
- 保留既有路由的大小限制、租戶隔離、檔名不信任與既有 parser 行為；本 change 不提供病毒掃描或惡意程式清除。

## Capabilities

### New Capabilities

- `upload-content-detection`: 在檔案儲存與解析前，依檔案 bytes 判斷內容類型並套用路由允許清單，包含 multipart 與 presigned upload 的安全生命週期。

### Modified Capabilities

- 無。

## Impact

- API storage、conversation、knowledge、channel/attachment upload routes 與共用 upload service。
- 新增 `file-type` 與 `magika` runtime dependencies，以及固定的 Magika model/config assets。
- S3/MinIO storage provider 需要支援 quarantine 物件讀取、promotion 與刪除。
- 前端或外部 presigned upload client 需要在 PUT 後呼叫 complete/scan endpoint。
- 新增偵測器單元測試、路由拒絕測試、presigned lifecycle 測試與 parser regression 測試。
- 無資料庫 migration；不包含 ClamAV/YARA、沙箱執行或完整 malware scanning service。
