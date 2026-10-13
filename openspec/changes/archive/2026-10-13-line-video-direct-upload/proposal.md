## Why

LINE 影片訊息的檔案上限是 200 MB，FB Messenger 附件是 25 MB。後台兩邊都只能上傳 25 MB：

- `/files/upload` 走 multipart，`@fastify/multipart` 的 `fileSize` 是 25 MB，檔案整包讀進 API 記憶體再檢查內容。把上限調到 200 MB，每個上傳都會在 API 佔用最多 200 MB 記憶體；API 跟其他容器共用同一台主機。
- 既有的直傳流程（`/files/presign-upload` → `/files/complete-upload`）沒有前端在用，而且用不了：
  - 上傳網址用 `S3_ENDPOINT`（UAT 是 `http://minio:9000`）簽名，瀏覽器連不到；改打公開網域時主機名稱不同，MinIO 回 `SignatureDoesNotMatch`（2026-10-13 本機實測）。
  - complete 時把整個檔案讀進記憶體檢查，上限也是 25 MB（`MAX_QUARANTINE_BYTES`）。
  - 簽名不限制檔案大小，任何登入的人可以往隔離區放任意大小的檔案。

PR #268 的 bot 審查也指出 FB 影片沿用 LINE 的上限常數（實際被 25 MB 的上傳端點蓋過，結果正確，但寫法不明確）。

## What Changes

- 直傳網址改用 `S3_PUBLIC_URL` 簽名，瀏覽器可以直接上傳到 MinIO/S3。
- 申請直傳時要帶檔案大小與用途（`generic` 25 MB、`line-video` 200 MB）。大小簽進網址，實際上傳的大小不同時 MinIO/S3 拒收。
- complete 時先查物件大小，超過用途上限就刪除並回 413；內容檢查只讀檔案開頭與結尾；通過後用伺服器端複製轉成正式檔，不把整個檔案讀進 API。
- LINE 影片編輯器改走直傳，上限 200 MB，顯示上傳進度；FB 影片維持 multipart，上限明確寫 25 MB。

## Capabilities

### Modified Capabilities

- `upload-content-detection`：修改「Presigned upload quarantine lifecycle」，新增「Presigned upload limits by purpose」。
- `material-system`：新增「Video Upload Limits Follow Each Channel」。

## Impact

- API：`apps/api/src/modules/storage/`（`s3.provider.ts`、`storage.provider.ts`、`storage.service.ts`、`storage.routes.ts`）、`apps/api/src/modules/upload/upload-content-detector.ts`
- Web：`apps/web/src/lib/direct-upload.ts`（新）、`components/materials/CompactVideoField.tsx`、`line/LineVideoEditor.tsx`、`editors.tsx`
- 部署：主機 nginx 的 `/open333crm/`（直通 MinIO）沒有設 `client_max_body_size`，預設 1 MB，要放寬到 210 MB 並關閉 request buffering。這份設定不在 repo 內，部署時要手動改。
- 儲存空間：一支 LINE 影片最多 200 MB，UAT 主機磁碟 40 GB。
