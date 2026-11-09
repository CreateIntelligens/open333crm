## 1. 測試

- [x] 1.1 `apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`：「刪除期間並行寫入的進站訊息也會被處理」（anonymize、hard_delete 各一）。另一個交易插入進站訊息後等 300ms 才 commit。修正前兩個都失敗在斷言上（媒體檔沒刪）

## 2. 實作

- [x] 2.1 `data-erasure.handler.ts`：新增 `lockContactConversations()`，以 `FOR UPDATE` 鎖住聯絡人的對話並回傳 id；兩種模式在讀訊息前呼叫，`hard_delete` 改成先鎖聯絡人（`readAvatarObjects`）
- [x] 2.2 `data-erasure.handler.test.ts`：假資料庫的鎖對話查詢回傳對話

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過；data-erasure 的 feature 測試通過
- [x] 3.2 `check-tenant-ctx.mjs --strict`、`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 3.3 `CHANGELOG.md` 更新
- [x] 3.4 `node scripts/validate-openspec.mjs lock-conversations-during-erasure` 通過，歸檔後 `--specs` 通過
