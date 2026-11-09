## Why

`POST /api/v1/knowledge/partner-ingest` 接受 Partner API 金鑰，也接受成員的 JWT（`knowledge.routes.ts` 的註解）。權限碼表把這條路由放在 `knowledge.admin` 底下。

成員用 JWT 呼叫時，`authenticateJwtOrPartnerKey()` 掛上的 `request.agent` 沒有 `roleId`。`requirePermission('knowledge.admin')` 以 `roleId` 查有效權限，查到空集合，所以有 `knowledge.admin` 的成員也收到 403。2026-11-06 在 UAT 以 admin 帳號呼叫時重現了這個問題（`details.requiredPermission` 是 `knowledge.admin`）。

`authenticate()` 有帶 `roleId`，另外兩個 JWT 路徑沒有帶：

- `authenticateJwtOrPartnerKey()`：從 #144 加上權限系統起就沒有帶。
- `authenticateJwtOrCliSession()`：`/auth/me` 與 MCP 目前不讀 `roleId`，所以沒有可觀察的錯誤。

三個函式各寫一份「從 access token 組出成員」的程式，`authenticate()` 後來加上 `roleId` 時，另外兩份沒有跟著改。AUDIT 已記錄這個問題（AUTH-06），修正方向就是共用一個函式。

## What Changes

- 三個認證函式的 JWT 路徑改成呼叫同一個函式組出 `request.agent`，都帶 `roleId`。
- 有 `knowledge.admin` 的成員以 JWT 呼叫合作方推送時，從 403 改成依角色權限判斷：有權限時照常寫入。沒有 `knowledge.admin` 的成員仍然回 403。
- Partner API 金鑰的行為不變。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `km-ingestion`：新增「成員以 JWT 呼叫合作方推送時依角色權限判斷」（ADDED）。

## Impact

- 後端：`apps/api/src/plugins/auth.plugin.ts`。
- API：`POST /api/v1/knowledge/partner-ingest` 帶成員 JWT、成員有 `knowledge.admin` 時，從 403 改成 200。前端不呼叫這條路由，只在 API 金鑰頁的說明裡列出。
- 測試：`apps/api/tests/feature/modules/knowledge/partner-ingest-jwt.test.ts`；`knowledge-test-app.ts` 加上走真實 `auth.plugin` 的選項。
- 文件：`CHANGELOG.md`、`docs/ref/system/AUDIT.md`（AUTH-06、RBAC-02）、`AUDIT-REVIEWS.md`、`docs/ref/modules/AUTHENTICATION.md`、`PERMISSIONS.md`、`feature-knowledge` skill。
