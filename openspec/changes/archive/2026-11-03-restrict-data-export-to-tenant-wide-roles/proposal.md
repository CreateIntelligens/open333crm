## Why

issue #428（HC-GOVERNANCE-02，AUDIT RBAC-04 的匯出路徑）：資料匯出的內容是全租戶的資料，所有渠道的聯絡人（含各渠道 uid）、
對話、訊息與工單，worker 只以 `tenantId` 篩選（`apps/workers/src/handlers/data-export.handler.ts`）。但發起、查詢與下載只檢查
`data.export`，而 `data.export` 可以加進任何自訂角色。結果是只該看到某家分店的自訂角色，可以一次拿走所有分店的客戶資料。

產品決定 `data.export` 的定位是「全租戶 GDPR 資料可攜權」，不做依分店範圍篩選的匯出。所以只讓本來就看得到全部渠道的成員使用。

## What Changes

- `POST /api/v1/tenant/data-export`、`GET /api/v1/tenant/data-export/:id`、`GET /api/v1/tenant/data-export/:id/download`
  除了 `data.export`，還要 `channel.view_all`。沒有時回 HTTP 403，`error.details.requiredPermission` 是 `channel.view_all`，
  訊息寫明匯出是全租戶資料、需要「檢視所有渠道」。被拒時不建立請求、不回傳請求內容或下載連結、不累計下載次數。
- 同時有兩個權限的成員可以查詢與下載同租戶其他成員發起的匯出（全租戶角色本來就看得到全部資料）。下載連結是 15 分鐘有效的
  presigned URL，只回給通過檢查的成員。
- `data.export` 的權限說明改寫，寫明匯出全租戶（所有渠道）的資料，需同時持有「檢視所有渠道（總店）」。角色與權限頁直接顯示這段說明。
- 不把 `channel.view_all` 設成 `data.export` 的 `dependsOn`：註冊表只允許一層前置權限，`channel.view_all` 本身已
  `dependsOn: ['channel.view']`（`rbac-registry.test.ts`「dependsOn 只有一層」）。改由路由檢查兩個權限碼。
- `requirePermission()` 加上可選的 `message`，讓這個檢查回傳說明原因的訊息。其他路由的訊息不變。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-data-export`：修改「發起資料匯出」「下載匯出檔與保留期」的權限條件；新增「匯出只限可查看所有渠道的成員」。

## Impact

- 程式：`apps/api/src/modules/data-export/data-export.routes.ts`、`apps/api/src/guards/rbac.guard.ts`、
  `packages/shared/src/rbac/permissions.ts`（只改說明文字）。
- 既有角色：系統角色只有 `admin` 有 `data.export`，而 `admin` 擁有全部權限，不受影響，不需要 reconcile。
  自建角色若有 `data.export` 而沒有 `channel.view_all`，部署後匯出會回 403，要由管理員補上 `channel.view_all` 或拿掉 `data.export`。
- 方案：`channel.view_all` 屬於 `channels` 功能模組。方案不含 `channels`，或 deny 清單含 `channel.view_all` 時，該租戶的匯出也不能用。
- 沒有前端頁面呼叫匯出 API，不需改畫面。
