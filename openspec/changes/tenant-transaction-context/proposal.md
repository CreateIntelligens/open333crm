## Why

service 的 Prisma 參數型別是 `TenantDb`。這個聯集有三個成員：`withTenant` 的 `tx`、`request.tenantPrisma` 與 `PrismaClient`（實務上多半是 `prismaAdmin`）。三者的查詢寫法相同，但 RLS 與交易的保證不同，所以只讀 service 的程式，看不出它有沒有 RLS，也看不出兩筆寫入會不會一起成功或一起失敗（issue #337）。PR #335 的設計判斷就因此出錯。

#337 已決定全面改成「入口開一個綁定租戶的交易，service 只收這個交易」（方向 3）。本 change 是搬遷的第一步：先建立新的寫法與規則，讓之後每個模組的搬遷 PR 都照同一個做法進行，而且不讓舊寫法再增加。

## What Changes

- 新增 `TenantCtx`：service 的新參數，內含綁定租戶的交易 `tx`、`tenantId`，以及「commit 之後才執行」的方法：
  - `notify`、`notifyAgent`：Socket 推播。service 只指定推播名稱，房間由 `events/socket-push.ts` 決定。
  - `publish`：業務事件。本 change 先交給注入的 `eventBus`，保證與現況相同。改走 outbox 是之後的 change（#337 規劃的階段 1b）。
  - `enqueue`：送 BullMQ job。保證是最多一次，階段 1b 改由 outbox 送出。
- 新增 `inTenant()`：開一個綁定租戶的交易，執行完 commit，再依序執行登記的推播、事件與 job。交易 rollback 時，登記的項目全部丟棄。
- 新增 `tenantHandler()`：包住 route handler，以 `request.agent.tenantId` 呼叫 `inTenant()`。交易 commit 之後才送出回應。
- 新增測試用的 mock ctx，讓 service 的單元測試不需要資料庫。
- 新增 `apps/api/src/lib/db-invariants.ts`：交易內「寫入，撞到唯一鍵就查出既有資料」與「條件更新認領」的共用函式。搬進同一個交易之後，「撞到 P2002 再接住錯誤」的寫法會讓整個交易失效，這兩個函式是替代的寫法。
- 新增 ratchet 檢查腳本 `scripts/check-tenant-ctx.mjs`：計算舊寫法的數量（`TenantDb`、`request.tenantPrisma`、service 內的 `withTenant(`、`$transaction(`），數量比基準檔多時失敗。
- 修改 `AGENTS.md`：結構規則 2、「Which Prisma client to use」表與 Socket 推播一節改成新寫法，並列入新的檢查腳本。
- 在 `docs/ref/system/AUDIT.md` 新增一個項目，記錄「service 收到的 client 決定了它的 RLS 與交易保證」與搬遷進度。

本 change 不搬任何既有模組。既有程式照常運作，行為不變。

## Capabilities

### New Capabilities

- `tenant-transaction-context`：租戶資料存取的交易邊界。內容包括入口如何開綁定租戶的交易、service 收到什麼、推播與事件何時送出、交易 rollback 時的處理，以及舊寫法不得增加的檢查。

### Modified Capabilities

- `socket-room-authorization`：「連線時加入的房間」多加入帶租戶 ID 的成員房間 `tenant:<租戶 ID>:agent:<成員 ID>`。`ctx.notifyAgent()` 推到這個房間，所以給客服人員的推播不會送到別的租戶（PR #341 審查機器人第三輪）。

`tenant-isolation-rls` 不修改：它規範的是「如何在交易內注入租戶身分」。`inTenant()` 建立在既有的 `withTenant()` 上，不改變這些需求。

## Impact

- 新增程式：`apps/api/src/lib/tenant-ctx.ts`（`TenantCtx`、`inTenant()`、`tenantHandler()`）、`apps/api/src/events/socket-push.ts`、`apps/api/src/lib/db-invariants.ts`、`apps/api/tests/support/mock-tenant-ctx.ts`、`scripts/check-tenant-ctx.mjs` 與其基準檔。
- 文件：`AGENTS.md`、`docs/ref/system/AUDIT.md`、`docs/ref/system/AUDIT-REVIEWS.md`、`CHANGELOG.md`。
- 既有的 `TenantDb`、`tenantScopedClient`、`request.tenantPrisma` 保留，搬遷完成後才刪除（#337 規劃的階段 7）。
- 沒有 schema 變更，也沒有新的相依套件。
