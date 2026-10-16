## Why

change `add-trial-data-purge` 在 `aa274cf0` 被拆成兩半（issue #228）。`tasks.md` 搬進了 `archive/2026-09-15-add-trial-data-purge/`，`proposal.md`、`design.md`、`.openspec.yaml` 與 `specs/` 卻留在 `openspec/changes/add-trial-data-purge/`。delta spec 從來沒有套用，所以主規格沒有 `trial-data-purge`。`trial-lifecycle` 也仍寫著「清除屬後續 change，`trial.dataRetentionDays` 僅先儲存」，這句已經過時。

程式已經由 #156 實作，但軟刪排程、復原與後台顯示都沒有測試。這個 change 照現行程式補上主規格與測試。

## What Changes

- 把留在 `openspec/changes/add-trial-data-purge/` 的檔案搬進 `archive/2026-09-15-add-trial-data-purge/`，補齊既有的歸檔紀錄。`AGENTS.md` 規定不要手動把 change 搬進 `archive/`，原因是手動搬移會略過 CLI 套用規格。這次搬移只是補齊早已歸檔的紀錄；規格由這個 change 以 CLI 歸檔套用。
- 新增主規格 `trial-data-purge`，有 3 條需求：
  - 保留期滿標記軟刪。
  - 平台復原軟刪標記。
  - 平台後台顯示軟刪狀態。
- 修改 `trial-lifecycle` 的「到期自動停用（資料保留）」：刪除過時的那一句，改成「保留期滿時只標記 `purgedAt`，同樣不刪除資料」。
- 新增 feature 測試 `apps/api/tests/feature/modules/trial/trial-data-purge.test.ts`、web 元件測試 `apps/web/tests/unit/app/admin/trial-page.test.tsx`，並在 `platform-audit-routes.test.ts` 新增一個測試。
- `docs/ref/system/AUDIT.md`：新增 TRIAL-04。`docs/ref/system/AUDIT-REVIEWS.md` 記錄這次對照。
- `docs/ref/features/platform/TRIALS.md`：延長與復原的段落指向 TRIAL-04。

### 歸檔需求的處理方式

| 歸檔的需求 | 處理 |
| --- | --- |
| 試用租戶保留期屆滿軟刪 | 改寫成「保留期滿標記軟刪」。Scenario「仍啟用的租戶不軟刪」不補：排程先處理到期停用，再找要標記的租戶，所以一個仍啟用、`trialEndsAt` 早已超過保留期的租戶，會在同一次執行中先被停用再被標記。改補「停用的非試用租戶不標記」 |
| 軟刪租戶無法存取且可復原 | 拆開。復原改寫成「平台復原軟刪標記」，補上 404 與 422。「無法登入與收訊」不寫進這份規格：存取只看 `isActive`，由 `trial-lifecycle` 的到期停用規定，`purgedAt` 本身不影響存取（AUDIT TRIAL-03） |
| `trial-lifecycle` 的「試用到期自動停用與資料保留」 | 主規格的需求名稱是「到期自動停用（資料保留）」，以 MODIFIED 只改過時的那一句，Scenario 不變 |

### 這次發現的問題

**復原之後，下一輪排程又會標記。** 復原只清除 `purgedAt`，租戶仍符合標記的全部條件，一小時內就被重新標記，並再寫一筆 `tenant.trial.purge` 稽核。延長試用與平台的「啟用」也不清除 `purgedAt`，租戶已經啟用，後台仍顯示「已清除」。新增 AUDIT TRIAL-04（P3），修法另外討論。

「平台復原軟刪標記」沒有規定復原之後的狀態要維持多久。這要等 TRIAL-04 決定修法後再補。

## Capabilities

### New Capabilities

- `trial-data-purge`：試用租戶保留期滿的軟刪標記、復原與後台顯示。

### Modified Capabilities

- `trial-lifecycle`：修改「到期自動停用（資料保留）」的描述。

## Impact

- `openspec/specs/trial-data-purge/spec.md`（歸檔時建立）、`openspec/specs/trial-lifecycle/spec.md`
- `openspec/changes/archive/2026-09-15-add-trial-data-purge/`（補齊檔案）
- `apps/api/tests/feature/modules/trial/trial-data-purge.test.ts`、`apps/web/tests/unit/app/admin/trial-page.test.tsx`（新增）
- `apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts`（新增一個測試）
- `docs/ref/system/AUDIT.md`、`docs/ref/system/AUDIT-REVIEWS.md`、`docs/ref/features/platform/TRIALS.md`
