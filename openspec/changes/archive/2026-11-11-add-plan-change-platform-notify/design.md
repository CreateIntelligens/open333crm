## Context

`POST /api/v1/plan-change` 以 `fastify.prismaAdmin` 呼叫 `createPlanChangeRequest()`。平台帳號（`platform_users`）是平台層資料表，
沒有 RLS，只有 `app_admin` 連線查得到。寄信的共用函式是 `apps/api/src/modules/email/email.service.ts` 的 `sendEmail()`，
平台帳號相關的信件範本在 `apps/api/src/modules/platform/platform-user-emails.ts`。平台稽核表 `platform_audit_logs` 的
`platformUserId` 可為 null，代表系統動作。

## Goals / Non-Goals

**Goals:** 新申請寄信給啟用中的平台帳號；寄送失敗不影響申請，但留下查得到的紀錄；平台側欄顯示待審數量。

**Non-Goals:** 平台審核後通知租戶（PLAN-17）；平台端站內通知；寄送失敗自動重試。

## Decisions

### D1：寄信放在 flow，回應之後才寄

新增 `plan-change.flow.ts` 的 `submitPlanChangeRequest()`：先以 `createPlanChangeRequest()` 建立申請，再開始寄送通知，回傳
`{ request, notification }`。路由回應 `request`，不等 `notification`。SMTP 一封信要一到數秒，平台帳號越多越慢，等寄完才回應會拖慢租戶的送出。

`notification` 這個 promise 不會 reject：查詢、寄信與寫稽核的錯誤都在 flow 內處理。測試直接 await 它；路由測試以 `vi.waitFor()` 等寄信 mock 被呼叫。

替代方案是走 outbox（`ctx.enqueue()`）加 BullMQ 佇列重試。這需要 TenantCtx、新佇列、worker 註冊與佇列監控設定，而這個路由目前用
`prismaAdmin`。寄送失敗本來就會留下稽核紀錄，側欄也會顯示待審數量，所以這次不加重試，見 Risks。

### D2：查詢在 service，收 executor 參數

`plan-change.service.ts` 新增 `getPlanChangeNotifyContext(prisma, request)`：查租戶名稱、目標方案名稱（升級時）與啟用中的平台帳號。
flow 用 `prismaAdmin` 呼叫它（結構規則 1、2）。

### D3：信件範本沿用 platform-user-emails.ts

在 `platform-user-emails.ts` 新增 `sendPlanChangeRequestedEmail()`，沿用同檔的 `wrap()`、`button()` 與 HTML 跳脫。既有的 `safeSend()`
會吞掉錯誤，這個函式改成把錯誤丟給呼叫端，flow 才能記下哪些收件人失敗。

### D4：寄送結果寫平台稽核

每次寄送後寫一筆 `plan_change.notify_platform`，`platformUserId` 是 null，`payload` 是
`{ tenantId, type, recipients, sent, failed: [{ email, reason }] }`。失敗原因截到 200 字。查詢收件人失敗時也寫一筆，`payload.error` 是原因。
寫稽核本身失敗時只能寫 log，不可以讓錯誤蓋掉原本的結果或變成 unhandled rejection。

`writePlatformAudit()` 的 `platformUserId` 型別改成 `string | null`，資料表本來就允許 null。

### D5：側欄數量用既有的待審列表

側欄呼叫既有的 `GET /platform/plan-change-requests`，以回傳的筆數當待審數量，不新增端點（一個租戶最多一筆待審，列表很小）。
換頁時重新載入，每 60 秒重新載入一次；升級申請頁核准或駁回後送出 `window` 事件 `platform:plan-changes-updated`，側欄收到後重新載入。
載入失敗時不顯示數量，升級申請頁本身仍列出所有待審申請。

## Risks / Trade-offs

- 寄送失敗不重試：API 行程在寄信途中重啟，或 SMTP 暫時失敗，信就不會再寄。緩解：稽核紀錄記下失敗的收件人，側欄的待審數量不依賴寄信。
  若之後要重試，改走 outbox 佇列（D1 的替代方案）。
- 稽核紀錄目前沒有平台介面可以依 `action` 查詢（AUDIT PLAN-11），要查資料庫 `platform_audit_logs`。
