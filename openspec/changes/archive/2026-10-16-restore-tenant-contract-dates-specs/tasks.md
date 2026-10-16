## 1. 測試

這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。新的測試都在 `apps/api/tests/feature/modules/platform/tenant-contract-dates.test.ts`，走真實的 `platform.routes`、`updateTenantContract` 與測試資料庫。

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 租戶合約日期只是紀錄 | 合約到期不觸發任何自動行為 | 新增 |
| 平台人員設定與查看租戶合約日期 | 平台設定合約起訖日 | 新增 |
| 平台人員設定與查看租戶合約日期 | 合約日期出現在租戶列表與租戶詳細資料 | 新增 |
| 平台人員設定與查看租戶合約日期 | 只設定其中一個日期 | 新增 |
| 平台人員設定與查看租戶合約日期 | 送 null 清除日期，沒送的日期不變 | 新增 |
| 合約迄日不得早於起日 | 迄日早於起日被拒絕 | 新增 |
| 合約迄日不得早於起日 | 只送一個日期時，與另一個日期的現值比較 | 新增 |

租戶的 token 被拒絕，由既有的 `apps/api/tests/unit/modules/platform/platform-auth-guard.test.ts`「租戶 JWT 打平台 API：每一條需要登入的平台路由都回 401 UNAUTHORIZED」檢查。這個測試從 `onRoute` 收集所有平台路由，包含合約日期的端點。

- [x] 1.1 寫上表標「新增」的測試

## 2. 突變驗證

每個突變都讓對應的測試失敗，還原後全部通過。

| 突變 | 失敗的測試 |
| --- | --- |
| `platform.routes.ts` 把稽核的 action 改成別的名稱 | 平台設定合約起訖日 |
| `trial-admin.service.ts` 的 `updateTenantContract()` 拿掉迄日早於起日的檢查 | 迄日早於起日被拒絕；只送一個日期時，與另一個日期的現值比較 |
| `updateTenantContract()` 沒送起日時不讀資料庫的現值 | 只送一個日期時，與另一個日期的現值比較 |
| `updateTenantContract()` 把沒送出的日期寫成 null | 送 null 清除日期，沒送的日期不變 |
| `platform-tenant.service.ts` 的 `listTenants()` 不回傳 `contractEndDate` | 合約日期出現在租戶列表與租戶詳細資料 |
| `trial.scheduler.ts` 的 `runTrialLifecycle()` 也掃描有合約迄日的租戶，並把已過的合約迄日當成試用到期日 | 合約到期不觸發任何自動行為 |
| `platform.routes.ts` 的 Zod schema 把 `contractEndDate` 改成必填 | 只設定其中一個日期 |

- [x] 2.1 執行上表的突變並還原

## 3. 文件

- [x] 3.1 `TRIALS.md`：合約日期的操作頁面改正為 `/admin/tenants`

## 4. 完成檢查

- [x] 4.1 `pnpm test` 與 `pnpm test:feature` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs restore-tenant-contract-dates-specs` 與 `--specs` 通過
- [x] 4.3 在同一個 PR 以 `pnpm exec openspec archive restore-tenant-contract-dates-specs` 歸檔，並替新的主規格寫 `## Purpose`
