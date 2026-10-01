## 1. 帳號鎖定與停用帳號回應順序（auth.service）

- [x] 1.1 測試 `tests/unit/modules/auth/login-brute-force.test.ts`：連續失敗 5 次後鎖定、鎖定期滿後可登入、成功登入清除失敗次數、大小寫不同視為同一帳號、不存在的 email 也會鎖定、停用帳號密碼錯誤回 401、停用帳號密碼正確回 403
- [x] 1.2 實作 `modules/auth/login-attempts.ts`（Redis 失敗計數，store 由呼叫端注入）與 `login()` 的鎖定檢查、`ACCOUNT_DISABLED` 移到密碼驗證之後

## 2. IP 限流與 429 回應（auth.routes、error-handler）

- [x] 2.1 測試 `tests/unit/modules/auth/login-rate-limit-route.test.ts`：同一 IP 一分鐘內第 11 次登入回 429 `RATE_LIMITED`
- [x] 2.2 實作 `/login` 的 `config.rateLimit`；`error-handler.plugin.ts` 把 429 轉成 `RATE_LIMITED`「操作太頻繁，請稍候再試」
- [x] 2.3 CLI 密碼登入（`/cli/login`）共用同一個帳號失敗計數；路由可注入計數 store，unit 測試不需 Redis
- [x] 2.4 登入頁改用 `getApiErrorMessage` 顯示錯誤（原本讀 `data.message` 永遠讀不到，鎖定與停用都只顯示「請確認帳號密碼」）

## 3. 只信任私有網段的代理（AUDIT SEC-04）

- [x] 3.1 測試 `tests/unit/lib/trust-proxy.test.ts`：經 nginx 與 Caddy 轉送、公網直接連到 API、沒有代理標頭
- [x] 3.2 實作 `lib/trust-proxy.ts` 並套用到 `index.ts`；`Caddyfile.local` 加 `trusted_proxies static private_ranges`（`caddy validate` 通過）
- [ ] 3.3 部署後在 UAT 確認 API log 的 `remoteAddress` 是使用者真實 IP，不再是 `172.18.0.1`

## 4. 完成檢查

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 `check-tenant-scoping.mjs --strict` 通過；`check-prisma-admin-usage.mjs --strict` 只有 main 既有的 RLS-07 違規，沒有新增
- [x] 4.3 `CHANGELOG.md` 新增條目
