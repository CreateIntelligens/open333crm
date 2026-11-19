# 平台帳號認證

營運方帳號的登入、改密碼與忘記密碼流程。與租戶登入完全分離。本文件最後兩節另外記錄租戶端登入與 CLI 登入在畫面與規則上要知道的事；租戶端 token 的簽發與失效見[認證與憑證](../../modules/AUTHENTICATION.md)，密碼登入的防暴力破解見[人員與角色](../tenant/MEMBERS.md#登入)。

- **資料來源**：`apps/api/src/modules/platform/platform-auth.service.ts`、`platform-password-recovery.service.ts`、`apps/api/src/plugins/auth.plugin.ts`、`platform.routes.ts`、`apps/api/src/modules/auth/*`、`apps/web/src/lib/api.ts`、`apps/web/src/app/admin/lib/platform-api.ts`、`apps/web/src/app/login/page.tsx`、`apps/web/src/app/admin/*`、`apps/cli/src/commands/login.ts`
- **核對日期**：2026-11-19

## 程式的入口

平台的認證路由在 `platform.routes.ts`，前綴是 `/api/v1/platform`。租戶的認證路由在 `apps/api/src/modules/auth/auth.routes.ts`，前綴是 `/api/v1/auth`。

| 路由 | 函式 |
| --- | --- |
| `POST /platform/auth/login` | `platform-auth.service.ts` 的 `platformLogin()` |
| `POST /platform/auth/forgot-password` | `platform-password-recovery.service.ts` 的 `requestPasswordReset()` |
| `POST /platform/auth/reset-password` | `resetPasswordWithToken()` |
| `POST /platform/auth/change-password` | `changeOwnPassword()`，掛 `authOnlyGuard`，寫稽核 `platform_user.change_password` |
| 其他 `/platform/*` 路由 | `guard`：`authenticatePlatformSuperuser` → `blockIfMustChangePassword` |
| `POST /auth/login` | `auth.service.ts` 的 `login()` |
| `POST /auth/cli/login` | 同一個 `login()` → `cli-session.flow.ts` 的 `issueCliLoginSessionFlow()` → `cli-session.service.ts` 的 `createCliSession()` |
| `POST /auth/cli/logout` | `revokeCurrentCliSessionFlow()` |
| `POST /auth/refresh`、`POST /auth/logout` | `auth.routes.ts` |
| `/auth/passkeys/*` | `passkey.service.ts` |
| `GET`、`POST`、`DELETE /settings/cli-sessions` | `apps/api/src/modules/settings/cli-session.routes.ts` → `listCliSessionsFlow()`、`createCliSessionFlow()`、`revokeCliSessionFlow()` |

平台忘記密碼與重設的服務（`platform-password-recovery.service.ts`）目前沒有測試。改這個服務之前，先補測試。

## 登入一次會發生什麼

1. 路由先看 `PLATFORM_JWT_SECRET`。沒有設定就回 503 `PLATFORM_DISABLED`，連 body 都不解析。
2. Zod 把 email 去空白並轉小寫，服務層再正規化一次。大小寫與前後空白不影響比對。
3. `platformLogin()` 查帳號、驗密碼，三種失敗回同一個 401（見下一節）。
4. 成功後更新 `lastLoginAt`，簽出平台 JWT。

JWT 的內容只有 `platformUserId` 與 `role: 'PLATFORM_SUPERUSER'`，有效期由 `PLATFORM_JWT_EXPIRES_IN` 控制，預設值在 `apps/api/src/config/env.ts`。

平台 JWT 與租戶 JWT 用不同的 secret 與 namespace，互相驗不過，見[平台後台](./README.md#與租戶後台的隔離)。

## 防帳號枚舉

攻擊者若能分辨「這個 email 沒註冊」與「密碼錯了」，就能先把有效帳號列出來。三處設計讓兩者看起來一樣：

| 位置 | 做法 |
| --- | --- |
| 帳號不存在 | 仍對一個固定的假 bcrypt 雜湊跑一次 `verifyPassword()`，抹平回應時間差 |
| 登入失敗 | 帳號不存在、帳號已停用、密碼錯誤，三種都回 401 `UNAUTHORIZED` |
| 忘記密碼 | 無論 email 是否存在，一律回 202 與同一句訊息。只有存在且啟用中的帳號才真的產生 token 並寄信。請求遇到網路錯誤或速率限制時，忘記密碼頁（`apps/web/src/app/admin/forgot-password/page.tsx`）也顯示相同的成功畫面。被速率限制擋下（429）或 email 格式錯誤（400）時，使用者也以為信已寄出（HC-PLATFORM-AUTH-05） |

## 停用帳號多久生效

立即生效。`authenticatePlatformSuperuser` 驗完簽章之後，會再查一次 `platform_users` 的 `isActive` 與 `mustChangePassword`，不採信 JWT 裡的快照：

- 帳號被停用，手上未過期的 token 立刻失效，回 401 `PLATFORM_USER_DISABLED`。
- `mustChangePassword` 被重新標記（例如平台重寄開通信），下一個請求就被擋。

改密碼則不同。這個查詢不比對密碼變更時間，因此自助改密碼與忘記密碼後的重設，都不會讓已發出的 token 失效，見 `../../system/AUDIT.md` 的 AUTH-03。

代價是每個平台請求都多一次資料庫查詢。租戶側的 `authenticate` 沒有這一步，停用的生效時機因存取面而異，見[租戶管理](./TENANTS.md#停用租戶多久生效)。

## 臨時密碼與兩組 guard

`mustChangePassword` 標記這個帳號目前用的是系統發的臨時密碼。建立帳號與重寄開通信都會把它設成 `true`，使用者改密碼成功後清除。

值是 `true` 時，`blockIfMustChangePassword` 把請求擋成 403 `MUST_CHANGE_PASSWORD`。因此路由分成兩組：

| Guard | 內容 | 用在 |
| --- | --- | --- |
| `guard` | 驗身分，並擋下 `mustChangePassword` | 其餘所有已登入的路由 |
| `authOnlyGuard` | 只驗身分 | 只有 `POST /auth/change-password` |

這個差別是必要的。還沒改密碼的使用者必須還能呼叫改密碼那一條，否則會鎖死。

## 忘記密碼的 token

| 項目 | 規則 |
| --- | --- |
| 產生 | 32 bytes 隨機值，資料庫只存 `sha256` 雜湊，明文只出現在信裡的連結 |
| 有效期 | 60 分鐘，寫在 `platform-password-recovery.service.ts` 的 `RESET_TOKEN_TTL_MINUTES` |
| 次數 | 單次使用。重設成功即清空 `resetTokenHash` 與 `resetTokenExpiresAt` |
| 重複申請 | 後一次申請覆寫前一次的雜湊，舊連結隨即失效 |
| 密碼太短 | Zod 先擋（`newPassword` 至少 8 字元），此時 token 還沒被消耗，可以用同一個連結重送 |

重設成功會一併清掉 `mustChangePassword`。走忘記密碼流程設定的新密碼，視同已完成改密碼。

## 速率限制

`platform.routes.ts` 在自己的 scope 內註冊 `@fastify/rate-limit`，以來源 IP 分組。註冊時設定 `global: false`，所以只有帶 `config.rateLimit` 的路由受限，也就是下表的 3 個公開端點。其他平台路由沒有速率限制。註冊時設定的 `max: 30` 沒有任何路由用到。

| 路由 | 上限 |
| --- | --- |
| `POST /auth/login` | 每分鐘 10 次 |
| `POST /auth/forgot-password` | 每 10 分鐘 5 次 |
| `POST /auth/reset-password` | 每 10 分鐘 10 次 |

**沒有帳號層級的鎖定。** 限制按來源 IP 計算。同一個帳號被多個 IP 輪流嘗試不會觸發鎖定，帳號也不會因為連續失敗而鎖住。租戶端的密碼登入有帳號鎖定，平台端沒有，見 `../../system/AUDIT.md` 的 AUTH-04。

來源 IP 是 `request.ip`。API 只信任私有網段與本機的代理（`apps/api/src/lib/trust-proxy.ts`），因此呼叫端自己帶的 `X-Forwarded-For` 不會被採用。API 前面若加上公網的 CDN，要把 CDN 的 IP 段加進信任清單，否則所有人的來源 IP 都會是 CDN 節點。

這份 rate-limit 設定綁在路由 scope 內，拆檔會一起失效，見 `../../system/AUDIT.md` 的 SEC-03。

## 錯誤碼

| 碼 | HTTP | 情境 |
| --- | --- | --- |
| `PLATFORM_DISABLED` | 503 | 沒有設定 `PLATFORM_JWT_SECRET` |
| `UNAUTHORIZED` | 401 | 登入失敗、token 無效或過期、改密碼時舊密碼錯誤。平台後台的 axios 攔截器（`apps/web/src/app/admin/lib/platform-api.ts`）收到任何 401 時，清除 token 並導回登入頁。因此使用者改密碼時打錯舊密碼會被登出，表單上不顯示錯誤（HC-PLATFORM-AUTH-01）。強制改密碼時打錯臨時密碼也一樣 |
| `PLATFORM_USER_DISABLED` | 401 | token 有效，但帳號已被停用 |
| `FORBIDDEN` | 403 | token 的 `role` 不是 `PLATFORM_SUPERUSER` |
| `MUST_CHANGE_PASSWORD` | 403 | 還沒改掉臨時密碼 |
| `RESET_TOKEN_INVALID` | 410 | 重設 token 不存在或已使用 |
| `RESET_TOKEN_EXPIRED` | 410 | 重設 token 已過期 |

登入、忘記密碼與重設密碼都沒有寫稽核紀錄，見 `../../system/AUDIT.md` 的 SEC-02。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。

## 租戶端登入與 CLI 登入

租戶端與平台是兩條分開的認證，各自使用不同的資料表、密鑰與前端 token 保存方式：

| 項目 | 租戶端 | 平台 |
| --- | --- | --- |
| 資料表 | `agents` | `platform_users` |
| 密鑰 | `JWT_SECRET` | `PLATFORM_JWT_SECRET` |
| 前端保存 token | access token 在記憶體，refresh token 在 httpOnly cookie | localStorage 的 `platformToken` |

一邊的 token 打另一邊的 API 都回 401。客服 API 只收 `typ: 'access'` 的 token，`/auth/refresh` 只收 `typ: 'refresh'` 的 token（`apps/api/src/lib/agent-token.ts`），細節見[認證與憑證](../../modules/AUTHENTICATION.md#認證裝飾器)。

### 密碼登入

`login()` 的防暴力破解與檢查順序見[人員與角色](../tenant/MEMBERS.md#登入)。另外要知道：

- `POST /auth/login` 每個 IP 每分鐘 10 次，超過回 429 `RATE_LIMITED`。同一個 email 第 6 次嘗試起回 429 `ACCOUNT_LOCKED`。
- 帳號鎖定的計數存在 Redis key `login:fail:<sha256(email)>`。email 先去空白並轉小寫再算雜湊。區間從第一次嘗試起算 15 分鐘。
- 每次嘗試一進來就先把計數 +1，再驗密碼（`login-attempts.ts` 的 `registerLoginAttempt()`）。如果改成驗完密碼才 +1，同時送出的大量請求會在 +1 之前全部通過檢查。
- 不存在的帳號也跑一次 bcrypt，成本與正式雜湊相同。`apps/api/tests/unit/modules/auth/login-timing.test.ts` 檢查回應時間不透露帳號是否存在。
- 密碼正確之後，停用的成員回 403 `ACCOUNT_DISABLED`，停用的租戶回 403 `TENANT_DISABLED`。
- 成員的 email 區分大小寫：登入時大小寫與建立時不同就回 401（AUTH-10）。平台端不分大小寫。

速率限制以 `request.ip` 分組。`@fastify/rate-limit` 在 `auth.routes.ts` 與 `platform.routes.ts` 各自以 `global: false` 註冊。把帶 `config.rateLimit` 的路由搬到別的檔案，限制會失效而且不報錯（SEC-03）。計數存在行程記憶體，多個 API 行程各自計算。

### 夾娃娃機與 Passkey

- 夾娃娃機（playcaptcha）只是前端小遊戲。`NEXT_PUBLIC_LOGIN_CAPTCHA_ENABLED` 不是 `false` 時，使用者要先玩完才能按登入。後端不驗證結果，主規格 `login-captcha` 也這樣寫，所以夾娃娃機不是安全控制。
- 「使用 Passkey 登入」按鈕只在 `GET /auth/passkeys/capability` 回啟用時顯示，不受夾娃娃機限制。API 沒有設定 `WEBAUTHN_RP_ID` 或 `WEBAUTHN_ORIGIN` 時，Passkey 停用。Passkey 登入每個 IP 每分鐘 10 次，不經過帳號鎖定的計數。
- `POST /auth/passkeys/authentication/options` 帶 email 時，對啟用中而且有 Passkey 的成員回傳 credential id 清單，不存在的 email 回空清單。不需登入就能確認某個 email 是否為有 Passkey 的成員（HC-PLATFORM-AUTH-03）。

### 換發與登出

- `apps/web/src/providers/AuthProvider.tsx` 掛載時，與 `apps/web/src/lib/api.ts` 收到 401 時，都呼叫 `POST /auth/refresh`。換發會輪替 refresh cookie，新 token 沿用舊 refresh token 的 `rememberMe`。換發失敗時，整頁導向 `/login`。
- `api.ts` 的 401 攔截器只排除 `/auth/login` 與 `/auth/refresh`。Passkey 驗證失敗（401「Passkey 回應無效」）時，攔截器先試換發，失敗後整頁導向 `/login`，錯誤訊息消失，夾娃娃機也要重玩（HC-PLATFORM-AUTH-07）。
- 平台沒有登出 API。平台的登出只清除 localStorage 的 token。

### CLI 登入

- `open333 login`（`apps/cli/src/commands/login.ts`）呼叫 `POST /auth/cli/login`。任何成員都能登入，不看角色（RBAC-02）。這條路由與網頁登入共用同一個 `login()` 與失敗計數。
- CLI 登入建立的 token 的 scope 固定是 `cli:status`、`cli:apis`、`cli:analytics:read`，有效 30 天。CLI 把 token 存在作業系統的 keychain。
- CLI 先在伺服器建立 token，再寫 keychain。keychain 不可用時指令失敗，但伺服器上的 token 已經啟用，只能從網頁撤銷（HC-PLATFORM-AUTH-08）。
- CLI 沒有 `logout` 指令，`POST /auth/cli/logout` 沒有呼叫端。
- 設定頁的 CLI token 明文只顯示一次，資料庫存 bcrypt 雜湊。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 租戶登入 `/login`（`apps/web/src/app/login/page.tsx`） | `POST /auth/login` | 錯誤密碼顯示「電子郵件或密碼不正確」。email 與密碼欄預填已作廢的示範帳號 `admin@demo.com`／`admin123`，正式環境也一樣（HC-PLATFORM-AUTH-02）。勾「記住我」時，refresh cookie 的 Max-Age 是 `REFRESH_TOKEN_EXPIRES_IN`（預設 30 天），否則是 session cookie。cookie 是 `SameSite=Strict`，正式環境另加 `Secure` |
| `/login` 的「使用 Passkey 登入」 | `POST /auth/passkeys/authentication/options` → `/verify` | 見[夾娃娃機與 Passkey](#夾娃娃機與-passkey) |
| 側欄底部「登出」 | `POST /auth/logout` | 只清 cookie，舊 refresh token 仍可換發（AUTH-08） |
| `/dashboard/settings/passkeys` | `GET`、`PATCH`、`DELETE /auth/passkeys`；`POST /auth/passkeys/register/*` | 只驗登入。刪除是把 `revokedAt` 寫入的軟刪除 |
| `/dashboard/settings/cli-sessions` 的「產生 Token」與撤銷 | `GET`、`POST`、`DELETE /settings/cli-sessions` | 要求 `settings.manage`，但側欄不隱藏這一頁，沒有權限的成員看到載入錯誤（RBAC-11）。有效期可選 7、30、90、365 天。勾 MCP 時加上 `mcp:read`。列表列出全租戶所有成員的 CLI token，包括 `open333 login` 建立的 |
| `/admin/login` | `POST /platform/auth/login` | 成功後導到 `/admin/plans`；`mustChangePassword` 是 `true` 時導到 `/admin/change-password?forced=1` |
| `/admin/login` 的「忘記密碼？」→ `/admin/forgot-password` | `POST /platform/auth/forgot-password` | 不論結果都顯示「若此 Email 存在…」 |
| 信中連結 `/admin/reset-password?token=…` | `POST /platform/auth/reset-password` | 新密碼欄 `minLength=8`，與後端相同 |
| 平台側欄「修改密碼」，以及強制改密碼的 `/admin/change-password?forced=1`（不顯示側欄） | `POST /platform/auth/change-password` | 打錯目前密碼會被登出（HC-PLATFORM-AUTH-01） |
| 所有 `/admin/*` 頁（`apps/web/src/app/admin/layout.tsx`） | 經 `platform-api.ts` 呼叫平台 API | 沒有 token 時導回 `/admin/login`。任何 401 都清除 token 並導回登入頁，不顯示原因，帳號被停用時也一樣（HC-PLATFORM-AUTH-06）。`MUST_CHANGE_PASSWORD` 時導到改密碼頁 |

下列 API 或功能沒有畫面入口：

- `POST /auth/cli/logout`：CLI 沒有 `logout` 指令，只能從網頁撤銷。
- 平台登出：沒有 API，只清 localStorage。
- 租戶端忘記密碼：沒有這個流程（AUTH-01）。

前端送出的值：

- 租戶登入：`{email, password, rememberMe}`。email 不轉小寫、不去空白。
- Passkey options：`{email?, rememberMe}`。
- 產生 CLI token：`{name, mcpRead, expiresInDays}`。`name` 先去空白，`expiresInDays` 是 7、30、90 或 365，不送 `scopes`。
- 平台登入與忘記密碼：email 照原樣送出，後端 Zod 去空白並轉小寫。
- 平台改密碼與重設：新密碼前端 `minLength=8`，與後端相同。
