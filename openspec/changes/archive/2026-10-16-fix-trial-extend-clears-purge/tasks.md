## 1. 延長試用清除軟刪標記

- [x] 1.1 寫測試「延長已清除的試用」（`apps/api/tests/feature/modules/trial/trial-extend.test.ts`），確認修正前在 `purgedAt` 的比對失敗
- [x] 1.2 `extendTrial()` 在同一次更新中把 `purgedAt` 設為 null，確認測試通過

## 2. 現行行為的測試

下列情境描述現行行為，測試寫好時就通過，所以以突變驗證。

| 需求 | 情境 | 測試檔 |
| --- | --- | --- |
| 平台延長試用 | 延長未到期的試用 | `apps/api/tests/feature/modules/trial/trial-extend.test.ts` |
| 平台延長試用 | 延長已到期停用的試用 | 同上 |
| 平台延長試用 | 非試用租戶不能延長 | 同上 |
| 平台復原軟刪標記 | 復原後沒有延長，下一輪排程再標記 | `apps/api/tests/feature/modules/trial/trial-data-purge.test.ts` |

| 突變 | 失敗的測試 |
| --- | --- |
| `restorePurgedTenant()` 復原時把 `trialEndsAt` 設為當下 | 復原後沒有延長，下一輪排程再標記 |
| `extendTrial()` 一律從當下起算 | 延長未到期的試用 |
| `extendTrial()` 不啟用租戶 | 延長已到期停用的試用、延長已清除的試用 |
| `extendTrial()` 不清空 `trialRemindersSent` | 延長已到期停用的試用 |
| `extendTrial()` 拿掉 `NOT_TRIAL` 的檢查 | 非試用租戶不能延長 |

- [x] 2.1 寫上表的測試
- [x] 2.2 執行上表的突變並還原

## 3. 文件

- [x] 3.1 `AUDIT.md`：TRIAL-04 改為部分修正；`AUDIT-REVIEWS.md` 記錄這次修正
- [x] 3.2 `TRIALS.md`、`TENANTS.md`：更新延長、復原與啟用的說明
- [x] 3.3 `CHANGELOG.md`：Fixed 新增一條

## 4. 完成檢查

- [x] 4.1 `pnpm test` 與 `pnpm test:feature` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs fix-trial-extend-clears-purge` 與 `--specs` 通過
- [x] 4.3 在同一個 PR 以 `pnpm exec openspec archive fix-trial-extend-clears-purge` 歸檔
