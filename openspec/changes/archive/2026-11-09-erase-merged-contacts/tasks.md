## 1. 測試

- [x] 1.1 `apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`：「匿名化一併清除併入的封存聯絡人」「硬刪除一併刪除併入的封存聯絡人」（各含兩層的合併鏈與封存聯絡人的頭像檔），修正前失敗在斷言上
- [x] 1.2 同檔「刪除後不能解除合併」（anonymize、hard_delete 各一）：以客服解除合併的 flow 呼叫，回 409 `CONTACT_ERASED`，封存聯絡人仍封存。修正前失敗在斷言上
- [x] 1.3 同檔「刪除請求還沒完成時可以解除合併」：pending 的請求不擋解除合併

## 2. 實作

- [x] 2.1 `data-erasure.handler.ts`：`lockErasureContacts()` 找出並鎖住目標與封存聯絡人；兩種模式改以這批聯絡人處理，`affected.mergedContacts` 記筆數；頭像檔共用檢查排除這批聯絡人
- [x] 2.2 `data-erasure.service.ts`：`findCompletedErasure()`；`contact-merge.service.ts` 的 `revertMerge()` 先以 `lockContactsForMerge()` 鎖住被併入方與合併鏈，有完成的刪除請求時丟 409 `CONTACT_ERASED`
- [x] 2.3 `data-erasure.handler.test.ts`：假資料庫配合新的查詢

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過；feature 全套通過
- [x] 3.2 `check-tenant-ctx.mjs --strict`、`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規；`feature-impact.mjs --check` 通過
- [x] 3.3 `CHANGELOG.md`、AUDIT ERASE-01、AUDIT-REVIEWS、GOVERNANCE.md、feature-map、feature-governance skill 更新
- [x] 3.4 `node scripts/validate-openspec.mjs erase-merged-contacts` 通過，歸檔後 `--specs` 通過

## Mutation 紀錄

- `findMergedContacts()` 拿掉遞迴的部分（只找一層）：「匿名化一併清除併入的封存聯絡人」「硬刪除一併刪除併入的封存聯絡人」失敗
- `findCompletedErasure()` 拿掉 `status: 'completed'`：「刪除請求還沒完成時可以解除合併」失敗
- `findMergedContacts()` 的起點條件改成整個租戶：「匿名化一併清除併入的封存聯絡人」（未封存的聯絡人不變）失敗
- 未以測試驗證：解除合併與刪除同時進行的鎖順序（`lockContactsForMerge()`），只以讀程式確認
