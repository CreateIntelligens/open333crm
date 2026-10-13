## 1. 直傳用途與大小上限（upload-content-detection）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/storage/storage-presign-purpose.test.ts`「Oversized presign request」「Declared size is part of the signature」「Completed object exceeds the purpose limit」「LINE video purpose accepts only mp4」
- [x] 1.2 實作：`storage.service.ts` 的用途表（大小上限＋允許清單）；`presignUpload` 帶大小、用途；`storage.routes.ts` 的 presign／complete body 加 `size`、`purpose`

## 2. 公開網址簽名與取樣檢查（upload-content-detection）

- [x] 2.1 測試先行：「Upload URL is signed for the public storage host」（`s3.provider` 以 `S3_PUBLIC_URL` 簽名，網址含 `content-length`）；「Large file is scanned from samples」（假 provider：不呼叫整檔讀取、呼叫 copy）；既有 `storage-presigned-lifecycle.test.ts` 改用新 provider 介面後照樣通過
- [x] 2.2 實作：`StorageProvider` 加 `headObject`、`getObjectRange`、`copy`；`S3StorageProvider` 用 `S3_PUBLIC_URL` 的 client 簽上傳網址（`requestChecksumCalculation: 'WHEN_REQUIRED'`，避免簽進空內容的 CRC32）；`completePresignedUpload` 改為查大小→取樣偵測→storage 端複製

## 3. 素材編輯器（material-system）

- [x] 3.1 測試先行：`apps/web/tests/unit/components/materials/video-upload-limits.test.tsx`「LINE video over 25 MB」「LINE video over 200 MB」「FB video over 25 MB」
- [x] 3.2 實作：`apps/web/src/lib/direct-upload.ts`（presign → PUT 含進度 → complete）；`CompactVideoField` 加 `uploadPurpose`、預設上限改為 25 MB；`LineVideoEditor` 用 `line-video`

## 4. 完成檢查

- [x] 4.1 本機用真的 MinIO 走一次 LINE 影片直傳（大於 25 MB）：41 MB mp4 經 presign → PUT 200 → complete 判定 `video/mp4`（API 記憶體增加約 23 MB，未整檔讀入）、正式檔大小一致、隔離區清空；`generic` 申請 41 MB 回 413；宣告 1000 bytes 卻上傳 41 MB 被 MinIO 回 403；`localhost:3000` 的 CORS 預檢通過
- 3.1 的「FB video over 25 MB」寫好就通過（原本實際上限已是 25 MB）。mutation：FB 上限改 200 MB 且拿掉一般上傳的 25 MB 上限 → 測試失敗，還原後通過
- [x] 4.2 `CHANGELOG.md`、`docs/ref/features/tenant/MARKETING.md`、部署文件（nginx `/open333crm/` 的 `client_max_body_size`）
- [x] 4.3 `pnpm test` 通過；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 4.4 `node scripts/validate-openspec.mjs line-video-direct-upload` 通過
- [ ] 4.5 部署前改 UAT 主機 nginx；部署後在 UAT 上傳一支超過 25 MB 的 LINE 影片
