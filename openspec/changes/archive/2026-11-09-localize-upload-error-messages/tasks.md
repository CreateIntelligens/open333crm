## 1. 內容偵測的拒絕訊息

- [x] 1.1 測試 `apps/api/tests/unit/modules/upload/upload-validation-messages.test.ts`：空檔案、無法辨識、信心不足、類型不允許、副檔名不符、宣告類型不符、偵測無法使用，各自的中文訊息與 `details.reason`；在現有程式上 7 個都斷言失敗
- [x] 1.2 `apps/api/src/shared/messages/upload.ts` 新增訊息函式；`detectUploadContent()` 回傳 `rejection` 分類；`assertUploadContent()` 用中文訊息、英文原因放 `details.reason` 並寫 log
- [x] 1.3 突變驗證：`details` 拿掉 `reason` 時 6 個失敗；類型不允許的分類改成 `unrecognized` 時 1 個失敗
- [x] 1.3a PR #492 review：宣告 MIME 不符拆成 `mime_mismatch`，訊息不提副檔名；測試先改成新訊息並斷言失敗。補「偵測器正常、檔案被拒時一律回 400，不是 503」；突變驗證：catch 不再原樣丟出 AppError 時失敗
- [x] 1.3b PR #492 第二輪 review：副檔名檢查移到宣告 MIME 檢查之前，兩者都不符時回 `extension_mismatch`；測試「副檔名與宣告的類型都不符：優先提示副檔名不符」先斷言失敗
- [x] 1.4 `knowledge-upload-encoding.test.ts` 的假 `assertUploadContent()` 改成新的中文訊息（假函式要跟真函式一樣）

## 2. 入口自己的類型、大小檢查

- [x] 2.1 測試 `apps/api/tests/unit/modules/conversation/send-media-errors.test.ts`：傳圖片類型不符、傳影片類型不符、圖片超過 20 MB；在現有程式上 3 個都斷言失敗
- [x] 2.2 測試 `apps/api/tests/unit/modules/channel/chatbox-background-upload-errors.test.ts`：背景圖類型不符、沒附檔案回標準格式中文訊息；在現有程式上 2 個都斷言失敗
- [x] 2.3 `conversation.routes.ts`、`channel.routes.ts` 改用 `unsupportedFileTypeMessage()`、`fileTooLargeMessage()` 與 `AppError`；`storage.service.ts` 的超過上限改用 `fileTooLargeMessage()`

## 3. 前端

- [x] 3.1 測試 `apps/web/tests/unit/components/materials/compact-upload-field-errors.test.tsx`：後端沒回訊息的 413 顯示「檔案過大」在現有程式上 2 個失敗；顯示後端中文訊息、直傳失敗保留中文說明，寫好就通過
- [x] 3.2 `CompactImageField`、`CompactVideoField` 改用 `getApiErrorMessage()`
- [x] 3.3 突變驗證：`CompactImageField` 不讀錯誤、一律顯示 fallback 時 2 個失敗；`CompactVideoField` 不保留直傳訊息時 1 個失敗

## 4. 完成定義

- [x] 4.1 `pnpm test`
- [x] 4.2 `pnpm --filter @open333crm/web build`
- [x] 4.3 api feature 全套（`TEST_DATABASE_NAME=open333crm_test_p6g`）
- [x] 4.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`；`feature-impact --check`
- [x] 4.5 `node scripts/validate-openspec.mjs localize-upload-error-messages`
- [x] 4.6 `CHANGELOG.md` `## [2026-11-09]`；`docs/ref/features/health/` 對應項目更新
