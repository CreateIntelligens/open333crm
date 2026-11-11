## 1. 測試

這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。測試檔的路徑相對於 `apps/api/tests/feature/modules`。

| 需求 | 情境 | 測試檔 |
| --- | --- | --- |
| 記錄租戶內的敏感操作 | 設定角色權限時寫稽核 | `tenant-audit/tenant-audit-routes.test.ts`（新增） |
| 稽核寫入失敗不影響主操作 | 稽核寫入失敗不拋錯 | `tenant-audit/tenant-audit.test.ts`（既有，改名） |
| 查詢租戶稽核 | 依 action 篩選本租戶的稽核 | `tenant-audit/tenant-audit-routes.test.ts`（新增） |
| 查詢租戶稽核 | 沒有 audit.view 不能查詢 | 同上 |
| 查詢租戶稽核 | 分頁與日期篩選 | `tenant-audit/tenant-audit.test.ts`（既有，改名） |
| 發起資料匯出 | 發起匯出 | `data-export/data-export.test.ts`（既有，改名） |
| 發起資料匯出 | 沒有 data.export 不能發起 | `data-export/data-export-flow.test.ts`（新增） |
| 產生匯出檔 | 匯出只含本租戶的資料 | 同上 |
| 產生匯出檔 | 上傳失敗時記錄原因 | 同上 |
| 下載匯出檔與保留期 | 保留期內下載 | 同上 |
| 下載匯出檔與保留期 | 過期的匯出不能下載 | `data-export/data-export.test.ts`（既有，改名） |
| 下載匯出檔與保留期 | 清理後的匯出不能下載 | `data-export/data-export-flow.test.ts`（新增） |
| 下載匯出檔與保留期 | 其他租戶的匯出不能下載 | `data-export/data-export.test.ts`（既有，改名） |
| 下載匯出檔與保留期 | 清理過期的匯出 | `data-export/data-export-flow.test.ts`（新增） |
| 發起聯絡人資料刪除 | 發起匿名化 | `data-erasure/data-erasure-flow.test.ts`（新增） |
| 發起聯絡人資料刪除 | 發起刪除的稽核記錄來源 IP | **沒有測試**。現行程式違反這個 Scenario，記在 AUDIT AUD-02，修正時補測試 |
| 發起聯絡人資料刪除 | 其他租戶的聯絡人被拒 | `data-erasure/data-erasure-flow.test.ts`（新增） |
| 發起聯絡人資料刪除 | 沒有 data.erase 不能發起 | 同上 |
| 匿名化聯絡人 | 匿名化後無法從聯絡人與進站訊息識別客人 | 同上 |
| 硬刪除聯絡人 | 硬刪除連帶刪除對話與工單 | 同上 |
| 硬刪除聯絡人 | 硬刪除不影響其他聯絡人 | 同上 |
| 刪除完成時記錄結果 | 完成稽核不含個人資料 | 同上 |
| 刪除完成時記錄結果 | 聯絡人已不存在時記錄失敗 | 同上 |

- [x] 1.1 寫上表標「新增」的測試，並把標「既有，改名」的測試改用情境名稱

## 2. 突變驗證

每個突變都讓對應的測試失敗，還原後全部通過。

| 突變 | 失敗的測試 |
| --- | --- |
| `role.routes.ts` 的稽核 action 改成 `role.permission.updated` | 設定角色權限時寫稽核 |
| `tenant-audit.service.ts` 的 `listTenantAudit()` 不套用 `action` 篩選 | 依 action 篩選本租戶的稽核 |
| `tenant-audit.routes.ts` 拿掉 `requirePermission('audit.view')` | 沒有 audit.view 不能查詢 |
| `data-export.routes.ts` 的 `POST /` 拿掉 `requirePermission('data.export')` | 沒有 data.export 不能發起 |
| `data-export.handler.ts` 讀聯絡人時不限租戶 | 匯出只含本租戶的資料 |
| `data-export.handler.ts` 失敗時只記錄 `error`，不改成 `failed` | 上傳失敗時記錄原因 |
| `data-export.handler.ts` 完成通知的類型改成別的名稱 | 匯出只含本租戶的資料 |
| `data-export.service.ts` 的 `getExportDownload()` 不累加 `downloadCount` | 保留期內下載 |
| `data-export.handler.ts` 的 `handleDataExportCleanup()` 不刪除物件儲存的檔案 | 清理過期的匯出 |
| `data-erasure.routes.ts` 的 `mode` 預設改成 `hard_delete` | 發起匿名化 |
| `data-erasure.routes.ts` 拿掉 `requirePermission('data.erase')` | 沒有 data.erase 不能發起 |
| `data-erasure.handler.ts` 匿名化時不刪渠道身分 | 匿名化後無法從聯絡人與進站訊息識別客人 |
| `data-erasure.handler.ts` 匿名化時不清電話 | 匿名化後無法從聯絡人與進站訊息識別客人 |
| `data-erasure.handler.ts` 匿名化時連出站訊息也抹除 | 匿名化後無法從聯絡人與進站訊息識別客人 |
| `data-erasure.handler.ts` 硬刪除對話時不限聯絡人 | 硬刪除不影響其他聯絡人 |
| `data-erasure.handler.ts` 硬刪除後不刪媒體檔 | 硬刪除連帶刪除對話與工單 |
| `data-erasure.handler.ts` 完成稽核的 `payload` 多帶 `requestedBy` | 完成稽核不含個人資料 |
| `data-erasure.handler.ts` 聯絡人不存在時直接結束，不拋錯 | 聯絡人已不存在時記錄失敗 |
| `data-export.service.ts` 的 `getExportDownload()` 對清理後的請求回 410 | 清理後的匯出不能下載 |
| `data-erasure.service.ts` 的 `requestErasure()` 不保存 `reason` | 發起匿名化 |
| `requestErasure()` 把 `reason` 放進佇列的工作內容 | 發起匿名化 |
| `requestErasure()` 把 `reason` 寫進稽核的 `payload` | 發起匿名化 |
| `data-export.handler.ts` 匯出的聯絡人不含渠道身分 | 匯出只含本租戶的資料 |
| `data-export.handler.ts` 匯出的對話不含標籤 | 匯出只含本租戶的資料 |
| `data-export.handler.ts` 匯出的工單不含備註 | 匯出只含本租戶的資料 |
| `data-export.handler.ts` 匯出的工單不含事件 | 匯出只含本租戶的資料 |
| `data-erasure.handler.ts` 匿名化時不刪長期記憶 | 匿名化後無法從聯絡人與進站訊息識別客人 |
| `data-erasure.handler.ts` 匿名化時不刪 `IdentityMap` | 匿名化後無法從聯絡人與進站訊息識別客人 |
| `tenant-audit.service.ts` 的 `listTenantAudit()` 查詢拿掉 `tenantId` | `tenant-audit/tenant-audit.test.ts`（既有）的「listTenantAudit 跨租戶隔離：租戶 B 查不到租戶 A 的稽核」 |
| `data-erasure.service.ts` 的 `requestErasure()` 查聯絡人時拿掉 `tenantId` | `apps/api/tests/unit/modules/data-erasure/data-erasure.test.ts`（既有）的「rejects foreign contact」 |

最後兩列的突變，新增的測試沒有抓到，因為新測試的路由以 `app_tenant` 連線執行，RLS 仍然擋住其他租戶的資料。既有的測試以略過 RLS 的連線或 mock 執行，所以抓得到。

- [x] 2.1 執行上表的突變並還原

## 3. 文件

- [x] 3.1 `AUDIT.md`：ERASE-01 補上被合併的聯絡人，新增 EXPORT-01 與 AUD-02
- [x] 3.2 `GOVERNANCE.md`：補上漏列的稽核動作、被合併的聯絡人與 EXPORT-01

## 4. 完成檢查

- [x] 4.1 `pnpm test:feature` 通過。`pnpm test` 有 2 個 api unit 測試失敗，都是 issue #299 記錄的偶發測試，與這個 change 無關；單獨重跑 api 的 unit 測試全部通過
- [x] 4.2 `node scripts/validate-openspec.mjs restore-tenant-audit-gdpr-specs` 與 `--specs` 通過
- [x] 4.3 在同一個 PR 以 `pnpm exec openspec archive restore-tenant-audit-gdpr-specs` 歸檔，並替三份新的主規格寫 `## Purpose`
