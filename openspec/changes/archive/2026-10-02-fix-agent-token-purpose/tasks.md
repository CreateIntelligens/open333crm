## 1. 後端

- [x] 1.1 測試 `apps/api/tests/unit/lib/agent-token.test.ts`：access／refresh／舊格式 refresh／粉絲／MCP／缺 agentId 的判斷
- [x] 1.2 測試 `apps/api/tests/unit/modules/auth/token-purpose-route.test.ts`：access token、refresh token 當 access token、粉絲 token、舊格式 access token；cookie 放 access token、舊格式 refresh token
- [x] 1.2b 測試 `apps/api/tests/unit/plugins/socket-token.test.ts`：socket 以 refresh、粉絲、舊格式 token 連線被拒（socket 驗證抽成 `decodeSocketAgentToken`）
- [x] 1.3 實作 `lib/agent-token.ts`，套用到 `auth.plugin.ts` 三個 JWT 分支、`socket.plugin.ts`、`/auth/refresh`；簽發帶 `typ`

## 2. 前端

- [x] 2.1 測試 `apps/web/tests/unit/lib/socket.test.ts`：重連使用最新 token、驗證失敗時換發後重連且最多 3 次
- [x] 2.2 實作 `lib/socket.ts`、`SocketProvider.tsx`
- [x] 2.3 審查補強：換發途中登出不把舊連線連回去；重試用完後 Topbar 顯示「即時連線中斷，請重新整理」；補另外兩個驗證分支與密碼登入簽發帶 typ 的測試

## 3. 完成檢查

- [x] 3.1 `pnpm test` 通過；API 與 web `tsc` 通過
- [x] 3.2 `check-tenant-scoping.mjs --strict` 通過
- [x] 3.3 `CHANGELOG.md` 新增條目
- [x] 3.4 部署後在 UAT 確認：登入中的使用者不會被登出、收件匣即時訊息仍會更新（2026-10-02 實測：舊 token 401 → refresh 200 → 重試 200 → socket 重連，使用者未被登出）
