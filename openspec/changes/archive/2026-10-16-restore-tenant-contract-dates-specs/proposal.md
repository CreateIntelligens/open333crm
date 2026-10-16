## Why

change `add-tenant-contract-dates` 在 `aa274cf0` 以改名的方式搬進 `archive/`（issue #228）。它新增的 capability `tenant-contract-dates` 從來沒有套用，所以主規格沒有 `tenant-contract-dates`。

程式已經實作合約日期：`Tenant` 的兩個欄位、平台的 `PATCH /api/v1/platform/tenants/:id/contract`、租戶列表與詳細資料的回傳，以及 `/admin/tenants` 的顯示與編輯。除了平台稽核路由的單元測試之外，這些行為沒有測試。這個 change 照現行程式補上主規格與測試。

## What Changes

- 新增主規格 `tenant-contract-dates`，有 3 條需求：
  - 租戶合約日期只是紀錄。
  - 平台人員設定與查看租戶合約日期。
  - 合約迄日不得早於起日。
- 新增測試 `apps/api/tests/feature/modules/platform/tenant-contract-dates.test.ts`。
- `docs/ref/features/platform/TRIALS.md`：合約日期的操作頁面從 `/admin/trial` 改正為 `/admin/tenants`。

### 歸檔需求的處理方式

| 歸檔的需求 | 處理 |
| --- | --- |
| 租戶合約日期為純記錄欄位 | 新增「租戶合約日期只是紀錄」。歸檔規格的 Scenario「既有租戶不受新欄位影響」描述的是加欄位那一次的 migration，不是系統要持續維持的行為，不補 |
| 平台 superuser 可設定與查看租戶合約日期 | 新增「平台人員設定與查看租戶合約日期」。歸檔規格沒有規定沒送出的欄位怎麼處理，需求照現行程式寫：送 null 清除，沒送出不改變。主規格 `platform-auth` 的「平台路由一律驗證平台帳號」已經涵蓋租戶 token 被拒絕的情況，所以需求只引用，不另寫 Scenario |
| 合約日期驗證 | 新增「合約迄日不得早於起日」。現行程式比較之前，先用資料庫的現值補上沒有送出的日期，所以只送一個日期也擋得住。需求照現行程式寫，並加上 Scenario「只送一個日期時，與另一個日期的現值比較」 |
| 免費試用天數於平台後台可設定（確認性） | **不補。** 主規格 `trial-lifecycle` 的「試用政策參數化」已經涵蓋，包含 Scenario「平台改試用天數即時生效」 |

歸檔 change 的任務 2.4 要求稽核記錄「前後值」。現行程式只記錄修改後的值，平台的其他稽核也一樣。是否記錄修改前的值，等 #228 第 15 項的決定，所以需求只寫「記錄修改後的兩個日期」。

## Capabilities

### New Capabilities

- `tenant-contract-dates`：平台為租戶記錄合約起訖日。

### Modified Capabilities

（無）

## Impact

- `openspec/specs/tenant-contract-dates/spec.md`（歸檔時建立）
- `apps/api/tests/feature/modules/platform/tenant-contract-dates.test.ts`（新增）
- `docs/ref/features/platform/TRIALS.md`
