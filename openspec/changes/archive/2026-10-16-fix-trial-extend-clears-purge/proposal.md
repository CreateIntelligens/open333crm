## Why

AUDIT TRIAL-04 記錄了三個操作和試用軟刪標記 `purgedAt` 的互動問題。2026-10-16 逐項決定：

| 操作 | 現況 | 決定 |
| --- | --- | --- |
| 延長試用 | 啟用租戶並延後 `trialEndsAt`，但不清除 `purgedAt`。直接呼叫 API 延長已清除的租戶後，租戶已經可以登入，後台仍顯示「已清除」，而且只剩「復原」 | 修正：延長時一併清除，和轉正式一致 |
| 復原 | 只清除 `purgedAt`，下一輪排程又標記 | 維持現狀。復原是讓平台人員接著延長或轉正式；誤按復原時，排程再標記也沒關係 |
| 租戶頁的啟用 | 只設 `isActive`。試用已過期的租戶，下一輪排程又停用並重寄到期信 | 暫時維持現狀，留在 TRIAL-04 |

主規格沒有「延長試用」的需求，所以這個 change 照現行程式補上，並寫入修正後的行為。

## What Changes

- `extendTrial()` 在同一次更新中把 `purgedAt` 設為 null。
- `trial-lifecycle` 新增需求「平台延長試用」：起算時間、啟用、清空提醒標記、清除軟刪標記、非試用租戶回 400 `NOT_TRIAL`。
- `trial-data-purge` 修改「平台復原軟刪標記」：寫明復原的用意，以及復原後沒有延長或轉正式時，下一輪排程會再標記。新增 Scenario「復原後沒有延長，下一輪排程再標記」。
- 新增 feature 測試 `apps/api/tests/feature/modules/trial/trial-extend.test.ts`，並在 `trial-data-purge.test.ts` 新增一個測試。
- `docs/ref/system/AUDIT.md`：TRIAL-04 改為部分修正，只留下租戶頁的啟用，並補上重寄到期信。`AUDIT-REVIEWS.md` 記錄這次修正。
- `docs/ref/features/platform/TRIALS.md`、`TENANTS.md`：更新延長、復原與啟用的說明。
- `CHANGELOG.md`：Fixed 新增一條。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `trial-lifecycle`：新增「平台延長試用」。
- `trial-data-purge`：修改「平台復原軟刪標記」。

## Impact

- `apps/api/src/modules/platform/trial-admin.service.ts`
- `apps/api/tests/feature/modules/trial/trial-extend.test.ts`（新增）、`apps/api/tests/feature/modules/trial/trial-data-purge.test.ts`
- `openspec/specs/trial-lifecycle/spec.md`、`openspec/specs/trial-data-purge/spec.md`
- `docs/ref/system/AUDIT.md`、`docs/ref/system/AUDIT-REVIEWS.md`、`docs/ref/features/platform/TRIALS.md`、`docs/ref/features/platform/TENANTS.md`、`CHANGELOG.md`
- 前端不改：試用管理頁對已清除的租戶仍只顯示「復原」，復原後才出現「延長」與「轉正式」。
