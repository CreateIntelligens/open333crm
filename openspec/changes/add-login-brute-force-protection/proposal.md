## Why

`POST /api/v1/auth/login` 沒有速率限制，也沒有失敗鎖定，可以無限次嘗試密碼（docs/ref/system/AUDIT.md SEC-05，issue #197）。登入頁的 playcaptcha 只在前端判斷，直接呼叫 API 就能繞過；`login-captcha` 規格本來就寫明「後端 rate limit 才是擋暴力嘗試的權威防護」，但這層一直沒有實作。

依 IP 的限流本身也不可靠（AUDIT SEC-04）：API 設 `trustProxy: true`，`request.ip` 取 `X-Forwarded-For` 最左邊的值，使用者可以自己帶標頭偽造；而 UAT／正式部署（主機 nginx → Caddy → api）的 Caddy 預設丟掉上游的 `X-Forwarded-For`，API 看到所有人都是 docker 閘道 `172.18.0.1`。只加 IP 限流的話，全站會共用同一個限流額度，任何人每分鐘打 10 次錯誤登入就能讓所有人登不進來。

另外，停用帳號在驗證密碼之前就回 `ACCOUNT_DISABLED`，不知道密碼的人可以藉此確認某個 email 是已停用的帳號。

## What Changes

- `/login` 依來源 IP 限流：每分鐘 10 次，超過回 429。
- 依帳號（email，不分大小寫）計算登入失敗：15 分鐘內失敗 5 次就鎖定，鎖定期間即使密碼正確也回 429 `ACCOUNT_LOCKED`，直到 15 分鐘的計算區間結束。登入成功時清除失敗次數。不存在的 email 也照樣計算，回應與存在的帳號一致，不透露帳號是否存在。
- `ACCOUNT_DISABLED` 改在密碼驗證通過之後才回應。
- `trustProxy` 改為只信任私有網段與本機的代理（`lib/trust-proxy.ts`），`Caddyfile.local` 設定 `trusted_proxies static private_ranges` 保留主機 nginx 的 `X-Forwarded-For`。`request.ip` 因此是 nginx 附加的真實 IP，使用者偽造的值不會被採用。
- 限流套件回的 429 原本被全域錯誤處理改寫成「請求格式不正確」，改回 `RATE_LIMITED`「操作太頻繁，請稍候再試」。

不做：captcha 的伺服器端驗證。playcaptcha 沒有可交給後端驗證的 token，要做必須換成有伺服器端驗證的服務，另案處理。

## Capabilities

### Modified Capabilities

- `auth-session`：新增登入的速率限制、失敗鎖定與停用帳號回應順序。

## Impact

- `apps/api/src/modules/auth/auth.routes.ts`、`auth.service.ts`、新檔 `login-attempts.ts`
- `apps/api/src/plugins/error-handler.plugin.ts`
- 使用 Redis（既有 `REDIS_URL`），不需要 migration。
- `apps/api/src/lib/trust-proxy.ts`、`apps/api/src/index.ts`、`Caddyfile.local`。部署會 `--force-recreate` 重建 Caddy，新設定隨部署生效。
- 限制：真實使用者本身在私有網段（例如經 VPN 連入）時會被當成代理略過。
