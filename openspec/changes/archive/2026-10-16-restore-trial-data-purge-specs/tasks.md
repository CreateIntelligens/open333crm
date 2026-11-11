## 1. 測試

這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。

| 需求 | 情境 | 測試檔 |
| --- | --- | --- |
| 保留期滿標記軟刪 | 保留期滿的停用試用租戶被標記 | `apps/api/tests/feature/modules/trial/trial-data-purge.test.ts`（新增） |
| 保留期滿標記軟刪 | 保留期未滿不標記 | 同上 |
| 保留期滿標記軟刪 | 已標記的租戶不重複處理 | 同上 |
| 保留期滿標記軟刪 | 停用的非試用租戶不標記 | 同上 |
| 平台復原軟刪標記 | 復原已標記的租戶 | 同上 |
| 平台復原軟刪標記 | 復原寫入平台稽核 | `apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts`（新增一個測試） |
| 平台復原軟刪標記 | 未標記的租戶不能復原 | `apps/api/tests/feature/modules/trial/trial-data-purge.test.ts`（新增） |
| 平台後台顯示軟刪狀態 | 已標記的租戶狀態是 purged | 同上 |
| 平台後台顯示軟刪狀態 | 已清除的租戶只能復原 | `apps/web/tests/unit/app/admin/trial-page.test.tsx`（新增） |
| 到期自動停用（資料保留） | 到期停用 | `apps/api/tests/feature/modules/trial/trial-data-purge.test.ts`（新增）檢查停用、稽核與資料保留。登入與收訊由 `apps/api/tests/feature/modules/auth/tenant-disabled-access.test.ts`（既有）的「停用租戶的成員以正確密碼登入」「停用租戶的渠道收到訊息」涵蓋 |

- [x] 1.1 寫上表標「新增」的測試

## 2. 突變驗證

每個突變都讓對應的測試失敗，還原後全部通過。

| 突變 | 失敗的測試 |
| --- | --- |
| `trial.scheduler.ts` 不檢查保留期 | 保留期未滿不標記、到期停用 |
| `trial.scheduler.ts` 的標記查詢拿掉 `purgedAt: null` | 已標記的租戶不重複處理 |
| `trial.scheduler.ts` 的標記查詢拿掉 `trialEndsAt` 不是 null 的條件 | 停用的非試用租戶不標記 |
| `trial.scheduler.ts` 的標記稽核 action 改成 `tenant.trial.purged` | 保留期滿的停用試用租戶被標記 |
| `trial.scheduler.ts` 標記時刪除該租戶的聯絡人 | 保留期滿的停用試用租戶被標記 |
| `trial.scheduler.ts` 的 `purgedAt` 改設成 `trialEndsAt` | 保留期滿的停用試用租戶被標記 |
| `trial-admin.service.ts` 的 `restorePurgedTenant()` 同時啟用租戶 | 復原已標記的租戶 |
| `restorePurgedTenant()` 拿掉 `NOT_PURGED` 的檢查 | 未標記的租戶不能復原 |
| `platform.routes.ts` 的復原稽核 `targetId` 改成固定值 | 復原寫入平台稽核 |
| `trial-admin.service.ts` 的 `listTrialTenants()` 不判斷 `purged` | 已標記的租戶狀態是 purged |
| `apps/web/src/app/admin/trial/page.tsx` 對已清除的租戶也顯示延長與轉正式 | 已清除的租戶只能復原 |
| `trial.scheduler.ts` 到期時不停用租戶 | 到期停用 |

- [x] 2.1 執行上表的突變並還原

## 3. 文件

- [x] 3.1 把留在 `openspec/changes/add-trial-data-purge/` 的檔案搬進 `archive/2026-09-15-add-trial-data-purge/`
- [x] 3.2 `AUDIT.md`：新增 TRIAL-04
- [x] 3.3 `TRIALS.md`：延長與復原的段落指向 TRIAL-04
- [x] 3.4 `AUDIT-REVIEWS.md`：記錄新增 TRIAL-04

## 4. 完成檢查

- [x] 4.1 `pnpm test:feature` 通過。`pnpm test` 有 1 個 api unit 測試逾時，是 issue #299 記錄的偶發測試（`other-channel-context-wiring.test.ts`），與這個 change 無關；單獨重跑 api 的 unit 測試全部通過
- [x] 4.2 `node scripts/validate-openspec.mjs restore-trial-data-purge-specs` 與 `--specs` 通過
- [x] 4.3 在同一個 PR 以 `pnpm exec openspec archive restore-trial-data-purge-specs` 歸檔，並替新的主規格寫 `## Purpose`
