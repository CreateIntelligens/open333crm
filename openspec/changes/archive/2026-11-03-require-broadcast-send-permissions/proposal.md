## Why

Issue #409 的 MKT-02、MKT-03（`docs/ref/system/AUDIT.md`，健檢 HC-MARKETING-01、02）：

- MKT-02：建立群發（`POST /marketing/broadcasts`）只要求 `marketing.manage`，「立即發送」才要求 `marketing.broadcast`。
  建立時帶 `scheduledAt`，`broadcast.scheduler.ts` 到期直接送出，不檢查任何人的發送權限。只有 `marketing.manage` 的成員因此可以對顧客群發。
- MKT-03：建立群發帶 `couponId` 時不檢查 `coupon.issue`，沒有優惠券權限的成員可以建立並送出附券群發；
  `audience-preview` 帶 `couponId` 時也把券的剩餘名額回給沒有 `coupon.view` 的成員。

主規格沒有描述群發要哪些權限，所以開 change。

## What Changes

- 建立群發帶非空的 `scheduledAt` 時，另外要求 `marketing.broadcast`；帶 `couponId` 時另外要求 `coupon.issue`。缺少時回 403，
  `error.details.requiredPermission` 是缺少的那個權限碼，錯誤訊息說明是排程或附券需要的權限。
- 「立即發送」附券群發時，除了 `marketing.broadcast` 也要求 `coupon.issue`。
- `audience-preview` 帶 `couponId` 時要求 `coupon.view`，缺少時回 403（不改成「不回剩餘名額」，見 design D2）。
- 排程器到期送出前，以「排定送出的成員」當下的有效權限重新檢查：成員不存在、已停用，或少了需要的權限時不送出，
  群發標為 `failed`，`failureCode`／`failureReason` 寫明原因，後台列表看得到。
- 群發新增 `scheduledById` 欄位記錄排定送出的成員（建立排程時是建立者；附券群發「立即發送」與券詳情批次發券是按下的人）。
- 前端建立群發表單：沒有 `marketing.broadcast` 時排程欄位停用並說明；沒有 `coupon.issue` 時附券欄位停用並說明。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `marketing-scheduling`：新增「Scheduling A Broadcast Requires The Broadcast Permission」、「Permissions Needed To Send A Broadcast」與
  「The Scheduler Rechecks The Scheduling Member's Permissions」。
- `coupon-management`：新增「附券廣播需要發券權限」與「附券廣播的受眾預覽需要檢視優惠券權限」。

## Impact

- `apps/api/src/modules/marketing/marketing.routes.ts`、`marketing.service.ts`、`broadcast.scheduler.ts`、
  `broadcast-coupon.service.ts`、`broadcast-coupon.flow.ts`，新檔 `broadcast-send-authority.ts`
- `apps/api/src/guards/rbac.guard.ts`（條件式權限的錯誤訊息、在 handler 內檢查權限）
- `packages/database/prisma/schema.prisma` 與新 migration（`broadcasts.scheduledById`）
- `apps/web/src/app/dashboard/marketing/page.tsx`、`apps/web/src/components/marketing/BroadcastCouponField.tsx`
- MCP `crm_line_broadcast_initiate` 帶 `scheduledAt` 建立的群發也由排程器以建立者的權限重新檢查
