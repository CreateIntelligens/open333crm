## 1. 測試

- [x] 1.1 `inbound-side-effects.ts`：把背景工作抽成可等待的 `resolveInboundMedia()`（不改行為），讓測試等它結束
- [x] 1.2 `apps/api/tests/feature/modules/webhook/inbound-media-erasure.test.ts`：「下載完成時訊息沒有變動」「下載期間訊息被匿名化」「匿名化的交易進行中下載完成」「下載失敗時訊息已被匿名化」。後三個修正前失敗在斷言上

## 2. 實作

- [x] 2.1 寫回改成交易內 `FOR SHARE` 鎖對話 + 以原內容為條件的 `updateMany`；條件不成立時不推送，以 `deleteFile()` 刪除剛上傳的物件
- [x] 2.2 `apps/api/tests/unit/modules/webhook/inbound-media.test.ts`：假資料庫改成交易與條件更新

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過；feature 全套通過
- [x] 3.2 `check-tenant-ctx.mjs --strict`、`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規；`feature-impact.mjs --check` 通過
- [x] 3.3 `CHANGELOG.md`、GOVERNANCE.md、feature-governance skill 更新
- [x] 3.4 `node scripts/validate-openspec.mjs skip-media-write-after-erasure` 通過，歸檔後 `--specs` 通過

## Mutation 紀錄

- 拿掉 `FOR SHARE`：「匿名化的交易進行中下載完成」失敗（內容最後是 redacted，但剛上傳的物件沒刪，成為孤兒檔）
- 拿掉內容相等的條件：「下載期間訊息被匿名化」「匿名化的交易進行中下載完成」「下載失敗時訊息已被匿名化」失敗
