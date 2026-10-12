## Decisions

### D1. 升級通知對象

- 事件 `case.escalated` 的 payload 加上 `notifyTargets`（呼叫端沒帶時為 `undefined`）、`previousAssigneeId`（升級前的 `assigneeId`）與 `actorId`（升級的客服）。
- 「依勾選算出收件人」抽成 `notification.service.ts` 的 `resolveEscalationRecipients(db, tenantId, input)`，worker 只負責呼叫與送出。這樣單元測試可以用 mock 的 Prisma 執行器測各種組合。
- `notifyTargets` 未帶（舊呼叫端、自動化）時維持原本行為：只通知主管與管理員。帶空陣列表示客服兩個都沒勾，不送通知。
- 原指派人要是同租戶、`isActive` 的 agent，而且不是升級的客服本人。

### D2. 電話規則

`z.string().trim().max(30).regex(/^[0-9+\-()# ]*$/)`，空字串存成 `null`。只限字元與長度，不判斷國碼或位數（2026-10-12 使用者決定）。

### D3. LIFF ID

`channel.routes.ts` 的 PATCH 在 `settings.liffConfig.liffId` 有值時檢查 `/^\d{10}-[A-Za-z0-9]{8}$/`（LINE 文件範例 `1234567890-AbcdEfgh`）。`settings` 其他鍵維持 `z.record`，不在這次範圍。

### D4. 分析日期區間

`dateRangeSchema` 與 `exportSchema` 加 `.refine(from <= to, { path: ['from'] })`，所有分析端點共用。
