## 1. 搬遷前的測試

- [x] 1.1 修改 `tests/feature/modules/data-export/data-export-flow.test.ts`：新增「發起匯出」（從 outbox 檢查匯出工作）、「發起匯出的稽核記錄來源 IP」、「匯出工作寫不進 outbox 時不留下請求與稽核」「commit 之後送不進佇列時，請求仍然成立」。「沒有 data.export 不能發起」改成比較發起前後的請求數，並檢查 outbox 沒有匯出工作。在搬遷前的程式碼上執行，3 個測試失敗在斷言上（outbox 沒有匯出工作、寫不進 outbox 時仍回 200），其他 7 個通過。「來源 IP」在搬遷前就通過，因為搬遷前的稽核已經記錄 IP
- [x] 1.2 `tests/feature/modules/data-export/data-export.test.ts` 移到 `tests/unit/modules/data-export/data-export.test.ts`：service 改收 `TenantCtx`，下載改經 flow 檢查；新增 flow 的寫入順序（含匯出工作的保留期限）與「稽核寫不進去時不送出匯出工作」。刪除 `data-export-queue-options.test.ts`。突變驗證：`recordTenantAudit()` 換成會吞掉錯誤的 `writeTenantAudit()` 時，「稽核寫不進去時不送出匯出工作」失敗

## 2. 搬遷

- [x] 2.1 `data-export.service.ts` 改收 `TenantCtx`，不再寫稽核、不再入列；刪除 `closeExportQueue` 與自建的 BullMQ `Queue`。下載拆成 `findDownloadableExport`（檢查）與 `countExportDownload`（計數），簽章移到 flow
- [x] 2.2 新增 `data-export.flow.ts`：在 `inTenant()` 內建立請求、以 `recordTenantAudit()` 寫稽核、以 `enqueueJob()` 寫匯出工作；查詢以 `flowOf` 包裝，下載在交易內依序檢查、簽章、計數。`data-export.routes.ts` 改呼叫 flow，接收 `events` 選項，讓 1.1、1.2 通過

## 3. 完成定義

- [x] 3.1 `pnpm test:all` 通過；`tsc --noEmit`、`check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 通過，基準檔已更新
- [x] 3.2 `CHANGELOG.md` 加 Changed 條目；更新 `docs/ref/modules/EVENTS.md` 的 `data-export` 佇列
- [x] 3.3 `node scripts/validate-openspec.mjs migrate-data-export-tenant-ctx` 與 `--specs` 通過
