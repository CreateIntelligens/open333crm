## 1. 搬遷前的測試

- [x] 1.1 修改 `tests/feature/modules/data-erasure/data-erasure-flow.test.ts`：刪除工作改從 outbox 檢查；新增「刪除工作寫不進 outbox 時不留下請求與稽核」「commit 之後送不進佇列時，請求仍然成立」。在搬遷前的程式碼上執行，這 3 個測試失敗在斷言上（outbox 沒有刪除工作、寫不進 outbox 時仍回 200），其他 15 個通過
- [x] 1.2 改寫 `tests/unit/modules/data-erasure/data-erasure.test.ts`：service 改收 `TenantCtx`；新增 flow 的「稽核寫不進去時不送出刪除工作」。突變驗證：`recordTenantAudit()` 換成會吞掉錯誤的 `writeTenantAudit()` 時失敗

## 2. 搬遷

- [x] 2.1 `data-erasure.service.ts` 改收 `TenantCtx`，不再寫稽核、不再入列；刪除 `setEnqueueErasureJob`、`closeErasureQueue` 與自建的 BullMQ `Queue`
- [x] 2.2 新增 `data-erasure.flow.ts`：在 `inTenant()` 內建立請求、以 `recordTenantAudit()` 寫稽核、以 `enqueueJob()` 寫刪除工作；`data-erasure.routes.ts` 改呼叫 flow，接收 `events` 選項，讓 1.1、1.2 通過

## 3. 完成定義

- [x] 3.1 `pnpm test:all` 通過；`tsc --noEmit`、`check-tenant-scoping --strict`、`check-prisma-admin-usage --strict`、`check-tenant-ctx --strict` 通過，基準檔已更新
- [x] 3.2 `CHANGELOG.md` 加 Changed 條目；更新 `docs/ref/modules/EVENTS.md`、`docs/ref/system/AUDIT.md` 的 `data-erasure` 佇列
- [x] 3.3 `node scripts/validate-openspec.mjs migrate-data-erasure-tenant-ctx` 與 `--specs` 通過
