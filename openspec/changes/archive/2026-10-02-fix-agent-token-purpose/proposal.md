## Why

`JWT_SECRET` 同時簽發客服 access token、客服 refresh token、粉絲 token 與 MCP 確認 token，而 `authenticate`、另外兩個「JWT 或其他憑證」驗證與 socket 連線只驗簽章、不看用途（docs/ref/system/AUDIT.md AUTH-05，issue #197）：

- refresh token（30 天）能直接當 access token 呼叫 API；成員被停用後 `/auth/refresh` 會擋，但直接拿 refresh token 呼叫 API 不會。
- One ID tasks 9.3.3 預計接回粉絲 token 的簽發路徑（優惠券分支的 Account Link）。接回後粉絲 token 也能通過客服認證，`request.agent.id` 為 undefined，只驗登入的路由全部放行，socket 會加入租戶房間收到全租戶訊息。必須在 9.3.3 之前修好。

另外，前端 socket 建立時把當下的 access token 固定在連線設定，斷線重連一律沿用舊 token；access token 15 分鐘就過期，API 重啟（每次部署）後超過 15 分鐘沒換頁的使用者即時通知會斷掉。本次上線舊格式 access token 會被拒絕，也會碰到這個情況。

## What Changes

- access token 與 refresh token 加上用途欄位 `typ`（`access`／`refresh`）。
- `authenticate`、`authenticateJwtOrCli`、`authenticateJwtOrPartnerKey` 的 JWT 分支與 socket 連線只接受 `typ: 'access'` 且帶 `agentId`、`tenantId` 的 token；其他（refresh、粉絲、MCP 確認、舊格式）回 401。
- `/auth/refresh` 只接受 refresh token。過渡期也接受舊格式 refresh token（沒有 `typ`、帶 `rememberMe`），使用者不會被登出；舊格式最長 30 天內自然消失，之後可移除相容判斷。
- 前端 socket 每次連線（含重連）讀取最新的 access token；被伺服器以驗證失敗拒絕時，先透過 API 觸發換發，再重新連線，連續最多 3 次。

## Capabilities

### Modified Capabilities

- `auth-session`：token 依用途區分。

## Impact

- `apps/api/src/lib/agent-token.ts`（新）、`plugins/auth.plugin.ts`、`plugins/socket.plugin.ts`、`modules/auth/auth.routes.ts`
- `apps/web/src/lib/socket.ts`、`providers/SocketProvider.tsx`
- 上線當下既有的 access token 失效，前端自動換發；不需要 migration。
