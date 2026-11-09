## 1. 測試

- [x] 1.1 `apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`：測試資料的媒體 key 改成上傳產生的格式 `{tenantId}/media/{conversationId}/{uuid}.jpg`；「不刪物件儲存以外或其他租戶的檔案」改為斷言只刪進站媒體檔、頭像檔不刪
- [x] 1.2 同一檔：「匿名化刪除進站訊息的媒體檔」。修正前應失敗（匿名化不刪媒體檔）
- [x] 1.3 同一檔：「匿名化保留出站訊息的媒體檔」
- [x] 1.4 同一檔：「不刪本租戶媒體目錄以外的檔案」（匿名化與硬刪除各一）。修正前應失敗（沒有 `mediaObjectsSkipped`、硬刪除照刪）
- [x] 1.5 同一檔：「仍被保留訊息引用的媒體檔保留」。修正前應失敗。mutation（2026-11-09）：拿掉 `isConversationMediaKey` 的對話檢查，1.4 的兩個測試失敗；拿掉保留訊息的排除，本測試失敗；程式已還原
- [x] 1.6 同一檔：「物件刪除失敗時請求仍然完成」。修正前應失敗（沒有 `mediaObjectsFailed`）
- [x] 1.7 `apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`：刪除失敗時 `affected.mediaObjectsFailed` 與稽核一致

## 2. 實作

- [x] 2.1 `data-erasure.handler.ts`：抽出共用的媒體 key 篩選（租戶、`media` 目錄、本次對話、`{uuid}` 檔名），兩種模式都用
- [x] 2.2 `anonymize`：交易內改寫前讀出進站訊息的 key，排除保留訊息仍引用的 key；commit 後刪除
- [x] 2.3 `deleteMediaObjects()` 回傳刪除與失敗筆數；commit 後把失敗筆數補寫進請求的 `affected`，回傳給完成稽核

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過；data-erasure 的 feature 測試通過
- [x] 3.2 `node scripts/check-tenant-ctx.mjs --strict`、`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 3.3 `CHANGELOG.md` 加上 Fixed 條目；AUDIT ERASE-01 改為部分修正，AUDIT-REVIEWS、`docs/ref/features/tenant/GOVERNANCE.md`、`feature-governance` skill 一起更新
- [x] 3.4 `node scripts/validate-openspec.mjs erase-inbound-media-on-anonymize` 通過，歸檔後 `node scripts/validate-openspec.mjs --specs` 通過
