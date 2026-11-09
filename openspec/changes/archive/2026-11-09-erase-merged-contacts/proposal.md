## Why

issue #473（AUDIT ERASE-01 的後續）。合併聯絡人時，被併入的聯絡人只設定 `isArchived` 與 `mergedIntoId`，姓名、電話、email 與頭像都還在。資料刪除只處理請求指定的聯絡人：

- 刪除保留下來的那一位之後，其他渠道留下的封存聯絡人仍有客人的個資。
- 刪除之後仍能解除合併，被併入的封存聯絡人恢復成一般聯絡人，姓名與 email 原樣回到聯絡人清單（健檢 HC-GOVERNANCE-06）。

## What Changes

- `anonymize` 與 `hard_delete` 沿 `mergedIntoId` 逐層找出併入目標聯絡人的封存聯絡人，套用與目標聯絡人相同的規則：匿名化清空個人欄位、刪除子資料、改寫進站訊息、刪除媒體檔與頭像檔；硬刪除連同他們的資料一起刪除。`affected.mergedContacts` 記錄筆數。
- 頭像檔的「其他聯絡人還在用」改成「這次刪除處理的聯絡人以外」：合併時主聯絡人沿用被併入那位的頭像，兩位一起刪除時頭像檔也要刪。
- 鎖的順序：交易內先讀出目標與封存聯絡人，依 id 排序以 `FOR UPDATE` 鎖住（與合併引擎相同的排序），鎖住後再讀一次封存聯絡人並鎖住新出現的；之後才鎖對話、讀訊息。
- 解除合併時，被併入方或合併鏈上任何一位有 `completed` 的資料刪除請求，回 HTTP 409 `CONTACT_ERASED`，不改任何資料。檢查之前先鎖住這些聯絡人，與刪除的交易互相等待。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-erasure`：MODIFIED「匿名化聯絡人」「硬刪除聯絡人」「刪除頭像檔的範圍」。
- `contact-management`：MODIFIED「Merge Reversal」，新增刪除後不能解除合併的情境。

## Impact

- workers：`apps/workers/src/handlers/data-erasure.handler.ts`。
- api：`apps/api/src/modules/contact/contact-merge.service.ts`（`revertMerge`）、`apps/api/src/modules/data-erasure/data-erasure.service.ts`（`findCompletedErasure`）。客服解除合併與顧客自助解除（`unbindByCustomer`）都經過 `revertMerge`。
- 測試：`apps/api/tests/feature/modules/data-erasure/data-erasure-flow.test.ts`、`apps/workers/tests/unit/handlers/data-erasure.handler.test.ts`。
- 文件：`CHANGELOG.md`、`docs/ref/system/AUDIT.md` ERASE-01、`docs/ref/system/AUDIT-REVIEWS.md`、`docs/ref/features/tenant/GOVERNANCE.md`、`docs/ref/features/feature-map.json`、`.claude/skills/feature-governance/SKILL.md`。
