## Context

`PlatformAuditLog` 欄位：`platformUserId`（null = 系統排程）、`action`、`targetType`、`targetId`、`payload`、`createdAt`。各動作寫入的對象如下（以 `git grep -n "action: '" apps/api/src` 與 `trial.scheduler.ts` 的 `writeSystemAudit` 查證）：

| targetType | targetId | 動作 |
| ---------- | -------- | ---- |
| `tenant` | 租戶 id | `tenant.provision`、`tenant.update`、`tenant.enable`、`tenant.disable`、`tenant.contract.update`、`tenant.ai_privacy.update`、`tenant.trial.extend`、`tenant.trial.convert`、`tenant.trial.restore`、`tenant.trial.expire`（系統）、`tenant.trial.purge`（系統） |
| `agent` | 成員 id，`payload.tenantId` = 租戶 id | `tenant.agent.email.update`（payload 另有新 `email`）、`tenant.agent.resend_welcome` |
| `plan_change_request` | 申請 id（`PlanChangeRequest.tenantId` 指向租戶） | `plan_change.approve`、`plan_change.reject` |
| `plan` | 方案 id | `plan.update` |
| `platform_user` | 平台帳號 id | `platform_user.*`（6 個） |
| `trial_signup` | 申請記錄 id | `trial.signup.fail` |
| `setting` | 設定 key | `setting.update` |
| `queue_job` | `<queue>:<jobId>` | `queue.job.retry` |

## Goals / Non-Goals

**Goals**：依租戶查得到平台對它做過的操作；動作與對象都顯示看得懂的名稱。

**Non-Goals**：全平台稽核紀錄頁、篩選、SEC-02（補寫登入與密碼重設稽核）、拆分 `platform.routes.ts`。

## Decisions

1. **成員紀錄以 `payload.tenantId` 判定，不以成員 id 清單判定。** 成員可能被硬刪（purge），成員 id 清單會漏掉被刪成員的紀錄；兩個成員動作都在 payload 寫了 `tenantId`。Prisma 的 JSON path 篩選（`payload: { path: ['tenantId'], equals }`）在 PostgreSQL 可用。
2. **方案申請的審核也列入租戶紀錄。** 「方案怎麼變了」的答案常是升級申請被核准（`plan_change.approve`），它的對象是申請而不是租戶。以該租戶的申請 id 清單比對 `targetId`。
3. **名稱在 API 端解析。** 前端只拿得到代碼，逐筆查名稱要打多支 API。`describePlatformAuditLogs()` 依 `targetType` 分組，每種類型一次 `findMany`，兩個查詢路由共用。查不到（已刪除、類型未知）時 `targetLabel` 為 `null`；成員被刪除時退回 `payload.email`。`setting` 與 `queue_job` 的代碼本身可讀，直接當名稱。
4. **回應形狀**：租戶路由回傳 `{ items, hasMore }`；查 `limit + 1` 筆判定 `hasMore`。`limit` 預設 100、最多 200（與平台帳號稽核的 200 筆上限一致）。平台帳號路由維持回傳陣列（只增加欄位，前端相容）。
5. **連結在前端組**：路徑是前端關心的事。`tenant`、`agent`、`plan_change_request` 連租戶詳細頁（用 `targetTenantId`），`plan` 連方案頁，`platform_user` 連平台帳號詳細頁，`trial_signup` 連試用管理頁；其他類型不連結。
6. **共用位置**：翻譯表與連結規則放 `apps/web/src/app/admin/lib/audit-log.ts`，表格放 `admin/lib/AuditLogTable.tsx`（`admin/lib/` 已放共用元件 `AuthShell.tsx`、`QueueMonitorLink.tsx`）。

7. **時間以台灣時間顯示**：原本平台帳號頁以 ISO 字串切片顯示，看到的是 UTC。共用表格改用 `lib/taipei-time.ts` 的 `taipeiParts()`，回答「什麼時候做的」時不必換算時區。
8. **載入失敗要看得到**：租戶詳細頁的操作紀錄載入失敗時顯示錯誤訊息，不只留空白。

## Risks / Trade-offs

- 只有筆數上限、沒有往前翻頁。一個租戶的平台操作頻率低，200 筆足以涵蓋；`hasMore` 讓畫面告知使用者只顯示最近 N 筆。需要時再加 `before` 游標。
- JSON path 篩選沒有索引。`platform_audit_logs` 量小（只有平台方操作），可接受。
