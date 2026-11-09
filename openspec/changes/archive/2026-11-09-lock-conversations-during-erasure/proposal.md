## Why

PR #479（#329）的第三輪審查指出：資料刪除先讀這位聯絡人的訊息、收集媒體檔，再改寫或刪除訊息。PostgreSQL 預設是 READ COMMITTED，兩個步驟之間、或刪除開始時還沒 commit 的進站訊息不會被收集：

- `anonymize`：這則訊息的內容沒有改寫成 `{ redacted: true }`，媒體檔也沒刪。
- `hard_delete`：這則訊息隨對話一起刪除，媒體檔卻留在物件儲存，資料庫再也找不到。

客人在刪除進行時傳訊息就會發生，留下的正是最可能含個資的照片。

## What Changes

- 兩種模式在讀訊息之前，依序鎖住聯絡人與他的對話（`FOR UPDATE`）。插入訊息與對話時的外鍵檢查會等這些鎖，所以刪除開始時還沒 commit 的進站訊息會先 commit，再被刪除讀到；之後才開始的寫入會等刪除結束。
- `hard_delete` 改成先讀頭像（鎖聯絡人），再鎖對話、讀訊息。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-erasure`：ADDED「刪除期間並行寫入的訊息也被處理」。主規格沒有描述並行寫入的需求，所以用 ADDED。

## Impact

- workers：`apps/workers/src/handlers/data-erasure.handler.ts`（新增 `lockContactConversations()`）。
- 測試：`apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`、`apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`（假資料庫的 raw 查詢）。
- 行為：刪除執行期間，這位客人的收訊會等刪除交易結束（通常不到 1 秒）。
- 文件：`CHANGELOG.md`。
