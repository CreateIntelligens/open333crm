---
name: feature-governance
description: >
  open333CRM「治理」功能顧問：租戶稽核、資料匯出、資料刪除、對外 Webhook 訂閱（只有 API）。改到 tenant-audit、data-export、data-erasure、webhook-subscriptions 模組，或新增敏感操作、新增掛在 Contact 上的資料表之前使用。
---

# 治理：稽核、匯出與資料刪除

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。治理的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

租戶稽核（`TenantAuditLog`、`recordTenantAudit`、`writeTenantAudit`、操作紀錄、誰做了什麼）、
資料匯出（GDPR 可攜權、zip、下載連結）、資料刪除（被遺忘權、`anonymize`、`hard_delete`、ERASE-*）、
對外 Webhook 訂閱（事件推送到外部網址）、試用資料清除對租戶的影響。這些功能沒有後台頁面，也沒有 CLI 指令，只有 API。
相關的模組：tenant-audit、data-export、data-erasure、webhook-subscriptions。
新增敏感操作（要不要寫稽核）、新增掛在 Contact 上的資料表（刪除要不要處理）、刪除成員、改合併邏輯之前也使用。
MCP、API 金鑰、CLI token 屬於設定領域（`.claude/skills/feature-settings/SKILL.md`）。

## 先讀

先讀功能文件 `docs/ref/features/tenant/GOVERNANCE.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `GOVERNANCE.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、API 的輸入值 | 程式的入口 |
| 權限碼與系統角色 | 負責的模組 |
| 寫稽核、新增敏感操作、操作者被刪除 | 租戶稽核日誌 |
| 匯出的權限、打包、清理、物件儲存設定 | 資料匯出 |
| 刪除的範圍、合併鏈、鎖的順序、媒體檔與頭像檔 | 資料刪除 |
| 回收匿名化留下的媒體檔 | 回收匿名化留下的媒體檔 |
| 對外 Webhook 的轉送與重試 | 對外 Webhook |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/tenant-audit/`、`apps/api/tests/unit/modules/data-export/`、`apps/api/tests/unit/modules/data-erasure/`、`apps/api/tests/unit/modules/webhook-subscriptions/`、`apps/api/tests/feature/modules/tenant-audit/`、`apps/api/tests/feature/modules/data-export/`、`apps/api/tests/feature/modules/data-erasure/`、`apps/api/tests/feature/modules/webhook-subscriptions/`、`apps/workers/tests/unit/handlers/`（`data-export.handler.test.ts`、`data-erasure.handler.test.ts`），寫法可以照著參考。

`GOVERNANCE.md` 裡標 `HC-GOVERNANCE-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/GOVERNANCE.md`
- 規格：`openspec/specs/tenant-audit-log/spec.md`、`openspec/specs/tenant-data-export/spec.md`、`openspec/specs/tenant-data-erasure/spec.md`、`openspec/specs/webhook-subscription-egress/spec.md`
- 已知問題：`docs/ref/system/AUDIT.md` 的 AUD-01（稽核涵蓋範圍）、ERASE-01（刪除範圍）、EXPORT-01（匯出）、HOOK-01（對外 Webhook）、TRIAL-03（試用清除只標記）
- 影響分析：`node scripts/feature-impact.mjs --domain governance`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `GOVERNANCE.md` 括號內的章節。

- 稽核的 `payload` 不放個人資料（email、姓名、密碼），只放 ID 與變更摘要。（租戶稽核日誌）
- 搬到 `TenantCtx` 的模組在同一個交易內呼叫 `recordTenantAudit()`。不要在交易內呼叫 `writeTenantAudit()`。（租戶稽核日誌）
- 新增敏感操作（權限、憑證、對外送資料、匯出名單、改個資）時要寫稽核，並更新 `openspec/specs/tenant-audit-log/spec.md` 的清單與 AUD-01。（租戶稽核日誌）
- 發起匯出或刪除時，申請、稽核與佇列工作一起成立或一起 rollback。worker 以申請狀態認領，已經結束的申請不重做。改 handler 時不要拿掉認領與 `markCompleted()` 的列鎖。（資料匯出、資料刪除）
- 匯出要 `data.export` 加 `channel.view_all`。不要新增依渠道篩選的匯出或只限發起者的檢查，除非產品改變 `data.export` 的定位。（資料匯出）
- 刪除的稽核與佇列工作不含 `reason`。完成稽核只有 `contactId`、`mode`、`affected`。（資料刪除）
- 刪除只處理目標聯絡人與併入他的封存聯絡人（`lockErasureContacts()`）。不要改鎖的順序。（資料刪除）
- 媒體檔 key 的格式檢查只用 `@open333crm/core` 的 `isConversationMediaKey()`，worker 與 `scripts/recover-erased-media-orphans.mjs` 共用，不要各寫一份。（資料刪除、回收匿名化留下的媒體檔）
- `anonymize` 在改寫進站訊息之前讀出 `storageKey`。物件刪除在 commit 之後、每個最多一次，失敗筆數記在 `affected.mediaObjectsFailed`、`affected.avatarObjectsFailed`，不要只寫 log。（資料刪除）
- 進站媒體寫回（`resolveInboundMedia()`）與刪除的鎖要一起看，改一邊時檢查另一邊。（資料刪除）
- 新的解除合併入口一律經過 `revertMerge()`，保留 409 `CONTACT_ERASED` 的檢查。（資料刪除）
- 新增掛在 Contact、Conversation、Case 上的資料表時，決定 `anonymize` 與 `hard_delete` 要不要處理它。`Restrict` 關聯一定要在 `hardDelete()` 刪 Contact 之前刪除。（資料刪除）
- 新增以 SetNull 參照 `agents`、又需要問責的表時，在 `purgeAgent()` 加快照。申請的快照寫在稽核的快照之前。背景工作用成員 ID 寫稽核或送通知之前，先呼叫 `requesterExists()`。（租戶稽核日誌）
- `GET /tenant/audit-logs` 的 `actor` 格式不能改，快照放在 `actorSnapshot`。（租戶稽核日誌）
- 錯誤用 `AppError(訊息, code, status)`。

## 回歸清單

改到本領域時，至少重走：

1. 用有 `audit.view` 的帳號查 `GET /tenant/audit-logs`。確認你新增或改動的操作有寫一筆，`payload` 不含個資，`ip` 有值。
2. 發起匯出 → 等 `completed` → 下載 zip。檢查：
   - `manifest.json` 的筆數。
   - CSV 內容：以 `=` 開頭的名稱前面有 `'`，日期是 ISO 字串（`toCsv()` 共用 `@open333crm/shared` 的 `csvRow()`）。
3. 對自建的測試聯絡人（名稱加前綴）各跑一次 `anonymize` 與 `hard_delete`。用 psql 確認 `affected` 與實際刪除一致，其他聯絡人不受影響。**UAT 不做匯出與刪除。**
4. 合併兩位測試聯絡人 → 刪除主要聯絡人 → 確認：
   - 被併入的封存聯絡人也被匿名化或刪除。
   - `affected.mergedContacts` 有筆數。
   - 解除合併回 409 `CONTACT_ERASED`。
5. 權限：
   - 沒有 `audit.view`、`data.export`、`data.erase`、`webhook.manage` 的角色各打一次，確認 403 的 `requiredPermission`。
   - 有 `data.export`、沒有 `channel.view_all` 的角色打匯出，確認 `requiredPermission` 是 `channel.view_all`。

自動測試：

- `pnpm --filter @open333crm/api test -- tenant-audit data-export data-erasure webhook-subscription webhook-dispatcher`
- `pnpm --filter @open333crm/workers test -- data-erasure data-export`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/tenant-audit modules/data-export modules/data-erasure modules/webhook-subscriptions`
- E2E：沒有。

## 常見 bug 從哪裡查

- 「稽核查不到某個操作」：
  - 先對照 `docs/ref/features/health/GOVERNANCE.md` 的盤點表。很多敏感操作沒有寫稽核（AUD-01、HC-GOVERNANCE-03、HC-GOVERNANCE-04、HC-GOVERNANCE-09）。
  - 有寫的話，查該模組的 flow 有沒有在交易內呼叫 `recordTenantAudit`。
- 「稽核的操作者是空的」：
  - 操作者被永久刪除了，看 `actorSnapshot`。
  - 系統排程寫的稽核，`actorSnapshot` 也是 null。
  - 刪除申請排隊中、發起人被永久刪除時，`data.erasure.complete` 的 `actorId` 是空值，快照取自申請的 `requestedByName`、`requestedByEmail`，而且不送通知。
- 「匯出一直 pending」：
  - workers 有沒有在跑，看 `data-export` 佇列。
  - workers 連不上 MinIO 時，看 workers 的 `S3_ENDPOINT`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`（`resolveMinioConfig()`）。沒設定時 log 有 `[storage] 沒有設定 S3_ENDPOINT` 的 warn。
  - 失敗原因在 `data_export_requests.error`。
- 「匯出內容只要聯絡人卻全部都有」：`scope` 沒作用（EXPORT-01）。
- 「刪除後客人資料還在」：查 ERASE-01 的保留清單、刪除完成之後才併入的聯絡人（`mergedIntoId`）、outbox 與 `webhook_deliveries` 的 payload（HC-GOVERNANCE-08）。
- 「刪除失敗」：看 `data_erasure_requests.error`。硬刪除失敗多半是新加的 `Restrict` 關聯沒在 `hardDelete()` 先刪。
- 「外部收不到 Webhook」：
  - 事件名稱打錯（HOOK-01，不報錯）。
  - 網址被 `isBlockedUrl` 擋。
  - 看 `GET /webhook-subscriptions/:id/deliveries` 的 `statusCode` 與 `errorMessage`。
