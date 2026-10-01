## Context

**RLS-06。** 客人點 LINE CSAT Flex 的分數按鈕時，LINE 送出 postback `csat:<分數>:<工單 ID>`。`inbound-postback-interceptors.ts` 的 `handleCsatResponse()` 從 postback **或文字訊息**取出分數與工單 ID，交給 `csat.service.ts` 的 `recordCsatScore(prisma, io, caseId, score)`。

- webhook 路由把 `fastify.prismaAdmin`（BYPASSRLS）交給 `processWebhookEvent()`，一路傳到攔截器的 `ctx.prisma`，中間沒有 `withTenant`。
- `recordCsatScore()` 以 `findUnique({ where: { id: caseId } })` 查工單，不比對租戶與聯絡人。
- `postbackData` 只從 LINE 的 `rawPayload.postback.data` 取值。FB 與 WebChat 收到的是文字提示「回覆 csat:分數」，這個格式不符合攔截器的正規表示式。因此目前只有 LINE 的 CSAT 能運作。
- `case.routes.ts` 的 `POST /cases/:id/csat` 也呼叫 `recordCsatScore()`，傳入 `request.tenantPrisma`。收件匣的 `CsatMessage.tsx` 呼叫這個端點。

**TRIAL-01。** `trial-signup` 的設計（`archive/2026-09-15-trial-signup/design.md` 的 Non-Goals）寫明：「試用轉正式流程屬 plan-change-request；現階段平台後台手動改 planId＋清 trialEndsAt 即可」。兩者在同一個 PR（`acb7568`）實作，但 plan-change-request 的規格沒有提到試用，`approveRequest()` 只寫 `planId`。之後的 `2492a9c` 加了 `convertToPaid()`，清除 `trialEndsAt` 並設 `isActive: true`，但不清 `purgedAt`。

`purgedAt` 目前只是標記：登入與收訊只檢查 `isActive`。`add-trial-data-purge` 的設計提到「真正清空間需後續硬刪 change」，後續的硬刪預計以 `purgedAt` 為條件。

## Goals / Non-Goals

**Goals:**

- CSAT 只能由該工單的客人，在該工單所屬的租戶評分。
- 偽造的 CSAT 訊息（文字或 postback）不會造成任何寫入、訊息或通知，也不會落入 AI 回覆或自動化。
- 試用租戶經由升級申請或「轉付費」成為付費租戶後，不再被試用排程停用或軟刪，也不留下「已清除」的標記。

**Non-Goals:**

- CSAT 攔截器只接受 postback。租戶與聯絡人條件已經足以擋下偽造：以文字送出 `csat:<分數>:<工單 ID>` 只能替自己的工單評分。
- 非 LINE 渠道的 CSAT 重新設計（另外記成 AUDIT 項目）。
- `POST /cases/:id/csat` 的權限碼（屬 RBAC-01）。
- 排程依方案判斷試用租戶。`add-manual-billing-subscription` 之後可能以 `Subscription` 的狀態判斷試用，現在不另建第二個判斷。
- 審核頁顯示租戶的試用狀態。

## Decisions

### D1. `recordCsatScore()` 改以條件查詢工單

`recordCsatScore()` 改為接收一個範圍物件 `{ tenantId, contactId? }`，以 `findFirst({ where: { id: caseId, tenantId, contactId } })` 查工單。查不到就回傳 `false`，不寫入任何資料。

- 進站攔截器傳入 `ctx.tenantId` 與 `ctx.contactId`。`ctx.contactId` 是空值時，攔截器不呼叫 `recordCsatScore()`。
- `POST /cases/:id/csat` 傳入 `request.agent.tenantId`，不傳 `contactId`。這條路由是客服操作，沒有「傳訊的聯絡人」。

**為什麼不只靠 RLS：** 攔截器的 `ctx.prisma` 是 `prismaAdmin`，`withTenant` 在 BYPASSRLS 的連線上不會過濾任何資料列。把進站管線改成租戶連線是另一個範圍更大的修改。因此應用層的條件是這條路徑唯一的防線，測試必須直接驗證這些條件。

**替代方案：** 在攔截器先查工單、比對之後再呼叫 `recordCsatScore()`。這樣 `POST /cases/:id/csat` 仍然沒有租戶條件。把條件放進服務，兩個呼叫端都受保護。

### D2. 不符條件的 CSAT 訊息仍然攔截

`handleCsatResponse()` 在文字或 postback 符合 `csat:<1-5>:<id>` 時一律回傳 `true`（已攔截），不論 `recordCsatScore()` 是否寫入。這與現行行為一致：工單已經評分過時，現行程式也回傳 `true`。

不符條件時記一筆 warn 等級的 log，內容包含收訊的租戶、聯絡人與工單 ID。這是偽造嘗試的訊號。

**替代方案：** 放行，當成一般訊息處理。偽造的 `csat:1:<uuid>` 會觸發 AI 回覆與自動化，因此不採用。

### D3. 脫離試用的資料集中定義

在 `trial-admin.service.ts` 定義一個常數 `TRIAL_EXIT_DATA = { trialEndsAt: null, purgedAt: null, isActive: true }`，`convertToPaid()` 與 `approveRequest()` 都使用它。兩個檔案都在 `platform` 模組內，不違反結構規則 4。

`approveRequest()` 的 upgrade 分支先讀租戶的 `trialEndsAt`：

- 不是 null：`planId` 與 `TRIAL_EXIT_DATA` 在同一次 `tenant.update()` 寫入。
- 是 null：只寫 `planId`，與現行相同。

`approveRequest()` 的回傳值加上 `trialExited: boolean`。`platform.routes.ts` 把這個值寫進 `plan_change.approve` 稽核的 payload，事後可以查到哪一次核准讓租戶脫離試用。

**為什麼一併清 `purgedAt`：** 付費且啟用中的租戶如果帶著 `purgedAt`，平台的租戶詳細頁會顯示「已清除」。後續的硬刪如果以 `purgedAt` 為條件，會刪除付費客戶的資料。`add-trial-data-purge` 設計的「復原只清 purgedAt、不自動啟用」，針對的是仍停用的試用租戶；轉正式是平台決定恢復服務，前提不同。

### D4. 租戶編輯頁改方案維持試用，介面加提示

`updateTenant()` 的行為不變。`apps/web/src/app/admin/tenants/[id]/page.tsx` 在方案下拉選單旁邊，對 `trialEndsAt` 不是 null 的租戶顯示提示：改方案不會讓租戶脫離試用；要轉付費，使用試用管理頁的「轉付費」。

## Risks / Trade-offs

- [正式環境已有受影響的租戶] → 部署前執行下方的查詢與修復。
- [客人以文字輸入 `csat:<分數>:<工單 ID>` 替自己的工單評分] → 效果與點按鈕相同，只能評自己在同一租戶的工單，接受這個行為。
- [客服在收件匣替客人評分] → `POST /cases/:id/csat` 仍然可用，只是多了租戶條件。這條路由要不要保留屬於 RBAC-01 的範圍。
- [合併聯絡人之後，工單的 `contactId` 與傳訊者不同] → `contact-merge.service.ts` 會搬移所有帶 `contactId` 的資料列，合併之後工單指向留下的聯絡人，傳訊者也解析成同一個聯絡人。

## Migration Plan

沒有 schema 變更。部署順序：

1. **部署前查詢**。在正式環境找出已經核准升級、仍帶 `trialEndsAt` 的租戶：

   ```sql
   SELECT t.id, t.name, t."isActive", t."trialEndsAt", t."purgedAt", p.slug AS plan
   FROM tenants t
   LEFT JOIN plans p ON p.id = t."planId"
   WHERE t."trialEndsAt" IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM plan_change_requests r
       WHERE r."tenantId" = t.id AND r.type = 'upgrade' AND r.status = 'approved'
     );
   ```

2. **人工確認**每一筆結果確實已經付費，再修復：

   ```sql
   UPDATE tenants
   SET "trialEndsAt" = NULL, "purgedAt" = NULL, "isActive" = true
   WHERE id IN (/* 確認過的租戶 id */);
   ```

   被排程停用過的租戶，`platform_audit_logs` 會有 `tenant.trial.expire` 紀錄，也可能有 `tenant.trial.purge` 紀錄。修復時一併通知這些租戶的管理員。

3. **部署程式**。部署之後新的核准會自動脫離試用。

**回滾：** 程式回滾不需要資料回滾。脫離試用的租戶不會因為回滾而重新進入試用。

## Open Questions

- 部署前查詢由誰在正式環境執行。
