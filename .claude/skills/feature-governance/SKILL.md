---
name: feature-governance
description: >
  open333CRM「治理：稽核、匯出與資料刪除」功能顧問：租戶稽核紀錄（TenantAuditLog、recordTenantAudit、
  writeTenantAudit、操作紀錄、誰做了什麼、登入紀錄）、資料匯出（GDPR 可攜權、匯出全部資料、zip、下載連結）、
  資料刪除（被遺忘權、匿名化 anonymize、硬刪除 hard_delete、客人要求刪除個資、ERASE-*）、對外 Webhook 訂閱
  （webhook-subscriptions、事件推送到外部網址）、試用資料清除對租戶的影響。這些功能沒有後台頁面，只有 API：
  /api/v1/tenant/audit-logs、/api/v1/tenant/data-export、/api/v1/tenant/data-erasure、/api/v1/webhook-subscriptions。
  當需求、bug 或新功能碰到 tenant-audit、data-export、data-erasure、webhook-subscriptions 模組時使用。
  也在新增任何敏感操作（要不要寫稽核）、新增掛在 Contact 上的資料表（刪除要不要處理）、刪除成員、改合併邏輯前使用。
---

# 治理：稽核、匯出與資料刪除

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/GOVERNANCE.md`
  - 注意：其中「角色的建立、改名與刪除沒有稽核」已過時，`apps/api/src/modules/role/role.flow.ts` 都有寫（HC-GOVERNANCE-15）。「目前會寫稽核」表也缺代發連結、Meta 串接、MCP LINE 的稽核。
- 健檢結果與已知問題：`docs/ref/features/health/GOVERNANCE.md`
- 規格：`openspec/specs/tenant-audit-log/spec.md`、`openspec/specs/tenant-data-export/spec.md`、`openspec/specs/tenant-data-erasure/spec.md`、`openspec/specs/webhook-subscription-egress/spec.md`
- 已知問題：`docs/ref/system/AUDIT.md` 的 AUD-01（稽核涵蓋範圍）、ERASE-01（刪除範圍）、EXPORT-01（匯出）、HOOK-01（對外 Webhook）、TRIAL-03（試用清除只標記）
- 影響分析：`node scripts/feature-impact.mjs --domain governance`

路由前綴（`apps/api/src/index.ts`）：`/api/v1/tenant/audit-logs`、`/api/v1/tenant/data-export`、`/api/v1/tenant/data-erasure`、`/api/v1/webhook-subscriptions`。MCP、API 金鑰、CLI token 屬於設定領域（`.claude/skills/feature-settings/SKILL.md`）。

## 前端操作流程

**這個領域沒有任何前端頁面，也沒有 CLI 指令**，只能直接呼叫 API。下表的「入口」都是 API。

格式：入口 → API → 後端 → 副作用 → 權限（後端；前端隱藏不適用）

| # | 流程 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---------- | ------ | ---- |
| 1 | 查詢稽核 | `GET /tenant/audit-logs?action&actorId&from&to&page&pageSize(≤100)` → `apps/api/src/modules/tenant-audit/tenant-audit.flow.ts` `listTenantAuditFlow` | 無。`action` 只能完全比對 | `audit.view`（系統角色只有 admin 有） |
| 2 | 寫稽核（各模組） | 交易內 `recordTenantAudit(ctx, …)`；舊寫法交易外 `writeTenantAudit(prisma, …)` | 交易內的寫入失敗會讓主操作 rollback；舊寫法失敗只記 log | — |
| 3 | 發起匯出 | `POST /tenant/data-export {scope?}` → `apps/api/src/modules/data-export/data-export.flow.ts` `requestExportFlow` | 同一交易：建 `pending` 請求、寫 `data.export.request`、匯出工作寫 outbox → `data-export` 佇列 → `apps/workers/src/handlers/data-export.handler.ts` 打包 zip 上傳 MinIO、通知發起人 | `data.export` |
| 4 | 查狀態、下載 | `GET /tenant/data-export/:id`、`GET /:id/download` → 15 分鐘 presigned URL | `downloadCount++`；**不寫稽核** | `data.export`（任何持有者都能下載別人發起的匯出） |
| 5 | 匯出清理 | workers 每小時 `data-export-cleanup` | 過期（7 天）刪 MinIO 物件、請求改 `expired` | — |
| 6 | 發起刪除 | `POST /tenant/data-erasure {contactId, mode: anonymize\|hard_delete, reason?}` → `apps/api/src/modules/data-erasure/data-erasure.flow.ts` `requestErasureFlow` | 同一交易：驗聯絡人同租戶、建請求、寫 `data.erasure.request`（payload 不含 reason）、工作寫 outbox → `apps/workers/src/handlers/data-erasure.handler.ts`；完成寫 `data.erasure.complete`、通知發起人 | `data.erase`（依賴 `contact.view`）；**不檢查渠道可見範圍** |
| 7 | 查刪除狀態 | `GET /tenant/data-erasure/:id` | 無。沒有列表端點 | `data.erase` |
| 8 | Webhook 訂閱 | `GET/POST /webhook-subscriptions`、`GET/PATCH/DELETE /:id`、`GET /:id/deliveries?limit`、`POST /:id/test` | 建立與修改時檢查網址（`isBlockedUrl`，要公開 HTTPS）；刪除是硬刪除；**全部不寫稽核** | 讀 `webhook.view`（supervisor 預設有，讀得到 `secret`）、寫 `webhook.manage` |
| 9 | 對外轉送（系統） | `event-webhook` 佇列 → `apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts` | 每個訂閱一筆 `WebhookDelivery`（存事件原文），重試 3 次 | — |

**有後端、沒有前端入口**：本領域全部。匯出完成通知的連結 `/dashboard/settings/data-export/<id>` 是 404（EXPORT-01）。

**實際送出的值**：匯出 `scope` 是任意字串陣列，存下來但 worker 不讀（EXPORT-01）；刪除 `mode` 只收 `anonymize`、`hard_delete`；Webhook `events` 是任意字串陣列，打錯不報錯（HOOK-01）。

## 不可破壞的規則
- 稽核 `payload` 不放個人資料（email、姓名、密碼）。只放 ID 與變更摘要。
- 搬到 `TenantCtx` 的模組在**同一個交易**內呼叫 `recordTenantAudit()`；`writeTenantAudit()` 不能在交易內呼叫（接住錯誤後交易已失效）。
- 發起匯出／刪除的「請求、稽核、佇列工作」一起成立或一起 rollback；worker 以請求狀態認領（`pending|processing` → `processing`），已結束的請求不重做。改 handler 不要拿掉認領與 `markCompleted` 的列鎖。
- 刪除的 `payload`、佇列工作不含 `reason`；完成稽核只有 `contactId`、`mode`、`affected`。
- 刪除只能動目標聯絡人；頭像檔只刪本租戶 `avatars/` 目錄、且沒有其他聯絡人在用的檔案。
- **新增掛在 Contact、Conversation、Case 上的資料表時**：決定 `anonymize` 與 `hard_delete` 要不要處理它，`Restrict` 關聯一定要在 `hardDelete()` 刪 Contact 之前顯式刪除，否則硬刪除會失敗。只存 `contactId` 字串、沒有外鍵的表（ClickLog、BroadcastRecipient、KbArticleFeedback、FlowExecution）兩種模式都不處理（ERASE-01）。
- `TenantAuditLog.actor` 是 `onDelete: SetNull`：永久刪除成員會讓他的稽核失去操作者（HC-GOVERNANCE-01）。改成員刪除或稽核結構時不要讓情況更糟。
- 新增敏感操作（權限、憑證、對外送資料、匯出名單、改個資）時要寫稽核，並更新 `openspec/specs/tenant-audit-log/spec.md` 的清單與 AUD-01。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain governance` 看最新版本。重點：
- **被依賴**：成員與角色（`agent.*`、`role.*` 稽核）、渠道（建立刪除與團隊授權）、設定（`settings.update`）、聯絡人（合併、解除合併、代發連結）、工單（`case.delete`）、LINE（MCP 的 `mcp.line.*`）、平台試用（`purgedAt` 只標記，TRIAL-03）。
- **依賴**：聯絡人（刪除與合併紀錄）、收件匣（對話與訊息）、工單、會員入口（活動提交與積分）、通知（完成通知）、成員（actor 外鍵）、設定（API 金鑰、CLI、MCP 沒有稽核）、自動化（事件來源，HOOK-01）。

## 回歸清單
改到本領域時，至少重走：
1. 用有 `audit.view` 的帳號查 `GET /tenant/audit-logs`，確認你新增或改動的操作有寫一筆，`payload` 不含個資，`ip` 有值。
2. 發起匯出 → 等 `completed` → 下載 zip，檢查 manifest.json 筆數與 CSV 內容。
3. 對自建的測試聯絡人（名稱加前綴）各跑一次 `anonymize` 與 `hard_delete`，用 psql 確認 `affected` 與實際刪除一致，其他聯絡人不受影響。**UAT 不做匯出與刪除。**
4. 合併兩位測試聯絡人 → 刪除主要聯絡人 → 檢查被併入的封存聯絡人與合併紀錄（ERASE-01、HC-GOVERNANCE-06）。
5. 沒有 `audit.view`／`data.export`／`data.erase`／`webhook.manage` 的角色各打一次，確認 403 的 `requiredPermission`。
- 自動測試：`pnpm --filter @open333crm/api test -- tenant-audit data-export data-erasure webhook-subscription webhook-dispatcher`；`pnpm --filter @open333crm/workers test -- data-erasure data-export`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/tenant-audit modules/data-export modules/data-erasure modules/webhook-subscriptions`。
- E2E：沒有。

## 常見 bug 從哪裡查
- 「稽核查不到某個操作」：先對照 `docs/ref/features/health/GOVERNANCE.md` 的盤點表，很多敏感操作本來就沒寫（AUD-01、HC-GOVERNANCE-03、04、09）。有寫的話查該模組的 flow 是否在交易內呼叫 `recordTenantAudit`。
- 「稽核的操作者是空的」：操作者被永久刪除了（HC-GOVERNANCE-01），或是 worker 寫的（`data.erasure.complete` 的 actor 是發起人）。
- 「匯出一直 pending」：workers 有沒有在跑、`data-export` 佇列；容器內 workers 連不上 MinIO 見 STO-01。失敗原因在 `data_export_requests.error`。
- 「匯出內容只要聯絡人卻全部都有」：`scope` 沒作用（EXPORT-01）。
- 「刪除後客人資料還在」：查 ERASE-01 的保留清單、被合併的封存聯絡人（`mergedIntoId`）、outbox 與 `webhook_deliveries` 的 payload（HC-GOVERNANCE-08）。
- 「刪除失敗」：看 `data_erasure_requests.error`；硬刪除失敗多半是新加的 `Restrict` 關聯沒在 `hardDelete()` 先刪。
- 「外部收不到 Webhook」：事件名稱打錯（HOOK-01，不報錯）、網址被 `isBlockedUrl` 擋、看 `GET /webhook-subscriptions/:id/deliveries` 的 `statusCode` 與 `errorMessage`。
