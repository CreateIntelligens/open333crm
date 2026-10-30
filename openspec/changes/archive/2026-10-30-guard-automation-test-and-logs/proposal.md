## Why

`POST /api/v1/automation/rules/:id/test`（試跑規則）與 `GET /api/v1/automation/logs`（執行紀錄）只檢查登入，不檢查權限碼。這兩條路由從 `7cbe5198`（2026-03-18）起就是這樣。

權限註冊表（`packages/shared/src/rbac/permissions.ts`）登記 `automation.view` 涵蓋「規則列表、詳情、logs、test」，同一組的其他路由也都檢查 `automation.view` 或 `automation.manage`。因此沒有 `automation.view` 的成員可以：

- 試跑任何一條規則。回應包含規則的條件與動作。
- 讀取整個租戶的自動化執行紀錄。

系統預設的「客服」角色沒有 `automation.view`。角色設定取消勾選「檢視自動化」也擋不住這兩條路由。

#337 第八批搬遷 `automation` 時發現這個問題，記在 `docs/ref/features/tenant/AUTOMATION.md` 的權限表。

## What Changes

- 兩條路由加上 `requirePermission('automation.view')`。缺少這個權限碼時回 HTTP 403，`error.details.requiredPermission` 是 `automation.view`。
- 回應內容與其他狀態碼不變。

對前端沒有影響：

- 側欄的「自動化」需要 `automation.view` 才顯示。
- 規則頁先呼叫 `GET /automation/rules/:id`，這條路由已經要求 `automation.view`。所以看得到「試試看這條規則」的成員都有這個權限碼。
- 前端沒有呼叫 `GET /automation/logs`。

受影響的只有直接呼叫 API、又沒有 `automation.view` 的成員。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `automation-engine`：新增「試跑規則與讀取執行紀錄要求檢視權限」。

## Impact

- `apps/api/src/modules/automation/automation.routes.ts`
- `apps/api/tests/feature/modules/automation/automation-routes.test.ts`
- `docs/ref/features/tenant/AUTOMATION.md` 的權限表
- `CHANGELOG.md`
