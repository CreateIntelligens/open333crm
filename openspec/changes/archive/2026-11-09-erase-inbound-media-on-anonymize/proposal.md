## Why

`anonymize`（資料刪除的預設模式）把進站訊息的 `content` 改成 `{ redacted: true }`，但改寫之前沒有讀出 `content.storageKey`。客人傳來的圖片、影片與檔案因此留在物件儲存，而且資料庫再也找不到這些 key（issue #329，AUDIT ERASE-01 的「物件儲存裡的訊息媒體檔」一列）。客人要求刪除個資時，最可能含個資的照片沒有刪掉。

`hard_delete` 會刪除訊息的媒體檔，但只要 `content.storageKey` 是字串就照刪，沒有確認 key 屬於這個租戶、這位聯絡人的對話。物件刪除失敗時只寫 log，請求的 `affected` 看不出有檔案沒刪掉。

## What Changes

- `anonymize` 在同一個交易內、改寫進站訊息之前，讀出這些訊息的 `storageKey`；交易 commit 之後刪除這些媒體檔。客服上傳的出站訊息媒體檔保留，與出站訊息保留一致。
- 兩種模式只刪除格式是 `{tenantId}/media/{本次對話之一}/{uuid}.{副檔名}` 的 key。格式不符的 key 不刪，筆數記在 `affected.mediaObjectsSkipped`。`anonymize` 時，同一批對話裡仍被保留的訊息（出站訊息）引用的 key 不刪，筆數記在 `affected.mediaObjectsShared`。
- 物件刪除最多執行一次、不重試。刪除失敗的筆數記在 `affected.mediaObjectsFailed` 與 `affected.avatarObjectsFailed`，失敗的 key 寫進 log，請求仍是 `completed`。
- `affected` 增加 `mediaObjects`（`anonymize`）、`mediaObjectsShared`（`anonymize`）、`mediaObjectsSkipped`、`mediaObjectsFailed`、`avatarObjectsFailed`。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-erasure`：MODIFIED「匿名化聯絡人」「硬刪除聯絡人」；ADDED「刪除訊息媒體檔的範圍」「物件儲存的檔案刪除失敗時記錄筆數」。

## Impact

- workers：`apps/workers/src/handlers/data-erasure.handler.ts`。
- 測試：`apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`（測試資料的媒體 key 改成真實上傳的格式）、`apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`。
- API：沒有變更。`GET /api/v1/tenant/data-erasure/:id` 的 `affected` 多出上列欄位。
- 文件：`CHANGELOG.md`、`docs/ref/system/AUDIT.md`（ERASE-01 部分修正）、`AUDIT-REVIEWS.md`、`docs/ref/features/tenant/GOVERNANCE.md`、`feature-governance` skill。
- 範圍外（另開 issue）：被合併封存聯絡人的個資與刪除後仍可解除合併（#473）、已匿名化客人留下的歷史孤兒檔（#474）、匿名化與媒體下載的競態（#475）。
