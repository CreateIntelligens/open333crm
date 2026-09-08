## Context

目前 API 使用 `@fastify/multipart`，全域 file size limit 為 25 MB。`conversation.routes.ts`、`storage.routes.ts`、`knowledge.routes.ts` 與 partner ingest 都先取得 buffer，再依 client MIME/副檔名決定 storage 或 parser；`presign-upload` 則直接提供 S3/MinIO PUT URL。現有 `S3StorageProvider` 已有 `getObject`、`upload`、`delete`，但沒有 quarantine/promotion 抽象。

Magika 官方提供 Node/TypeScript binding，可對 bytes 做內容分類；官方文件指出模型載入後可重複使用，Node 版本可載入本地 model/config。JavaScript 套件依賴 TensorFlow.js，因此模型與 runtime 資產必須納入 Docker image 並實測記憶體。`file-type` 適合先以 magic bytes 做快速 deterministic 判斷；兩者都不是 malware scanner。

## Goals / Non-Goals

**Goals:**

- 集中處理 file bytes → detected type → route allowlist 的判斷。
- 在 multipart side effect 前完成驗證。
- 讓 presigned upload 有 quarantine 與明確 complete/scan 邊界。
- 不信任 client MIME、檔名或副檔名，並保留既有 tenant scoping 和大小限制。

**Non-Goals:**

- 不做 ClamAV、YARA、VirusTotal、sandbox 或 malware verdict。
- 不解析/清理文件內容，也不修改既有 parser 的業務結果。
- 不讓瀏覽器直接載入 Magika model 作為 server-side 安全判斷。
- 不在本 change 重新設計所有 storage metadata schema；若未來需要完整檔案資產狀態表，另立 migration change。

## Decisions

### D1. Two-stage detection: magic bytes plus Magika

先以 `file-type` 或等效 magic-byte detector 做明確格式判斷，再以 Magika 對文字/複合文件補充分類與 confidence。第一層負責快速拒絕明顯偽裝，第二層負責 PDF/Office/text 等較寬的內容分類；只有 canonical type 同時符合入口 allowlist 與一致性規則才通過。

若 `file-type` 回傳 generic ZIP，而 Magika 回傳 DOCX/XLSX，必須再以入口允許的副檔名與 Magika 結果判斷，不能把任意 ZIP 自動視為 Office 文件。

### D2. One detector service with route policies

新增集中式 detector service，輸入 bytes、原始 MIME、檔名與 route policy，輸出 `{ accepted, detectedMime, label, confidence, reason }`。路由只負責傳入自己的 allowlist，不各自實作 magic/Magika 判斷；這可避免 conversation、knowledge、imagemap 對同一檔案作出不同安全決策。

### D3. Build-in and startup-preloaded local model

Docker build 階段將固定版本的 model/config 與 checksum 放入 API image；當 `UPLOAD_CONTENT_DETECTION_ENABLED` 未設定或為 `true` 時，API bootstrap 階段以本地路徑建立並 preload Magika client。request path 不得下載 GitHub model，也不得在第一個使用者上傳時才進行冷啟動。模型版本、npm lockfile 與資產 checksum 必須可追蹤。啟動或偵測失敗時，若功能開啟則採 fail-closed；若功能以 `false` 關閉，只記錄高可見度 warning 並沿用既有流程。

### D4. Multipart integration before side effects

將 detector 放在 `file.toBuffer()` 之後、`uploadFile`/`sharp`/parser/DB write 之前。每個入口的 policy 至少涵蓋目前實際支援類型：conversation image/video、imagemap image、knowledge PDF/DOCX/XLSX/CSV/HTML/Markdown/text、partner attachment；generic storage upload 使用明確 allowlist，不接受任意 binary。

### D5. Presigned uploads use quarantine and promotion

presign 產生 tenant-scoped quarantine key，並新增 authenticated complete/scan endpoint。complete 會從 storage 讀取 object、驗證宣告 metadata 與 bytes，再將通過的 bytes 上傳至正式 key並刪除 quarantine key；拒絕或過期則刪除/失效。因目前 presign 回應尚未有前端使用者，API contract 可在本 change 一次調整，並同步更新文件。

### D6. No automatic malware claim

通過 type detector 只代表「看起來是允許的類型」，不能阻止 Office macro、PDF exploit 或 polyglot 的所有風險。parser 仍需既有大小/錯誤處理；正式上線若要阻擋惡意內容，另接隔離式 malware scanner，且不得把 Magika 結果當作防毒 verdict。

### D7. Explicit emergency feature flag

採用 `UPLOAD_CONTENT_DETECTION_ENABLED`，預設 `true`。關閉只作為偵測器故障時的暫時 rollback，啟動時以 warning 暴露狀態，README 必須提供重新啟用指令與風險說明。另一方案是完全不可關閉，安全性較強但不利於現場救援；本專案選擇可回退但高可見度告警。

### D8. Node 24 LTS with Debian slim runtime

API、Web、Workers 與 dev image 統一使用 `node:24-bookworm-slim`。Node 20 已 EOL，且 Magika 的 `@tensorflow/tfjs-node` 是 native dependency；Debian slim 提供 glibc，較適合 production image。API Docker build 保持全域 `--ignore-scripts`，只在 tfjs-node package directory 執行 `node-pre-gyp install --fallback-to-build`，安裝單一預編譯 N-API binding。Node 24 的 `tfjs-node` 仍會引用已移除的 `util.isNullOrUndefined`，因此 Magika dynamic import 前保留限定的 compatibility shim，並以 Node 24 實際 preload/inference 測試守住。

## Risks / Trade-offs

- **[Risk] Magika model/TFJS 增加 image 大小與啟動時間/記憶體。** → 只在 API process 建立一個 singleton，固定本地 model，記錄 startup 與 steady-state 指標；若超出預算，再評估 Rust/Python sidecar。
- **[Risk] 偵測器對少見或 polyglot 格式誤判。** → 低 confidence/unknown 一律拒絕；parser 前仍保留格式實際解析錯誤處理；不宣稱 malware protection。
- **[Risk] quarantine promotion 中斷留下孤兒 object。** → key 必須 tenant-scoped，complete 失敗清理；增加過期清理 job/管理腳本與測試。
- **[Risk] 既有 presigned client 未呼叫 complete。** → 將 contract 標為 breaking，文件明確要求 complete；目前 repo 無前端呼叫點，部署前檢查外部 client 使用者。
- **[Risk] detector 讀取整個 buffer 增加記憶體壓力。** → 沿用 25 MB multipart limit，Magika 只使用必要內容；presigned complete 需要增加 object size guard，禁止無界下載。

## Migration Plan

1. 加入 dependencies/model assets 與 detector unit tests，先不切換外部 presigned client。
2. 啟用 multipart validation，驗證現有圖片、文件、QA spreadsheet 與 partner attachment 流程。
3. 部署 presigned quarantine/complete contract，更新前端/整合文件；確認無 repo 內 presigned consumer。
4. 逐步清理既有未完成 quarantine objects，監控拒絕率與 parser error。
5. 若偵測器誤判造成阻斷，回退 route integration feature flag 至既有路徑；presigned rollback 只能在確認 quarantine object 不再被使用後，暫時恢復舊 contract。
