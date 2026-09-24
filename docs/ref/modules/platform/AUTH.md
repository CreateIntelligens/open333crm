# 平台帳號認證

營運方帳號的登入、改密碼與忘記密碼流程。與租戶登入完全分離。

- **資料來源**：`apps/api/src/modules/platform/platform-auth.service.ts`、`platform-password-recovery.service.ts`、`apps/api/src/plugins/auth.plugin.ts`、`platform.routes.ts`
- **核對日期**：2026-09-23

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
| 忘記密碼 | 無論 email 是否存在，一律回 202 與同一句訊息。只有存在且啟用中的帳號才真的產生 token 並寄信 |

## 停用帳號多久生效

立即生效。`authenticatePlatformSuperuser` 驗完簽章之後，會再查一次 `platform_users` 的 `isActive` 與 `mustChangePassword`，不採信 JWT 裡的快照：

- 帳號被停用，手上未過期的 token 立刻失效，回 401 `PLATFORM_USER_DISABLED`。
- `mustChangePassword` 被重新標記（例如平台重寄開通信），下一個請求就被擋。

代價是每個平台請求都多一次資料庫查詢。租戶側的 `authenticate` 沒有這一步，兩邊的取捨不同，見[租戶管理](./TENANTS.md#停用租戶多久生效)。

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

`platform.routes.ts` 在自己的 scope 內註冊 `@fastify/rate-limit`，以 `request.ip` 分組：

| 範圍 | 上限 |
| --- | --- |
| 這個 scope 的所有路由 | 每分鐘 30 次 |
| `POST /auth/login` | 每分鐘 10 次 |
| `POST /auth/forgot-password` | 每 10 分鐘 5 次 |
| `POST /auth/reset-password` | 每 10 分鐘 10 次 |

兩件事要知道：

- **沒有帳號層級的鎖定。** 限制按來源 IP 計算。同一個帳號被多個 IP 輪流嘗試不會觸發鎖定，帳號也不會因為連續失敗而鎖住。
- **`request.ip` 可以由呼叫端決定**，因此上面所有限制都繞得過。`trustProxy: true` 讓 API 取 `X-Forwarded-For` 最左邊的值，而 repo 內的 nginx 是附加不是覆寫，偽造的值會原樣留在最左邊。詳見 `../../system/AUDIT.md` 的 SEC-04。

這份 rate-limit 設定綁在路由 scope 內，拆檔會一起失效，見 `../../system/AUDIT.md` 的 SEC-03。

## 錯誤碼

| 碼 | HTTP | 情境 |
| --- | --- | --- |
| `PLATFORM_DISABLED` | 503 | 沒有設定 `PLATFORM_JWT_SECRET` |
| `UNAUTHORIZED` | 401 | 登入失敗、token 無效或過期、改密碼時舊密碼錯誤 |
| `PLATFORM_USER_DISABLED` | 401 | token 有效，但帳號已被停用 |
| `FORBIDDEN` | 403 | token 的 `role` 不是 `PLATFORM_SUPERUSER` |
| `MUST_CHANGE_PASSWORD` | 403 | 還沒改掉臨時密碼 |
| `RESET_TOKEN_INVALID` | 410 | 重設 token 不存在或已使用 |
| `RESET_TOKEN_EXPIRED` | 410 | 重設 token 已過期 |

登入、忘記密碼與重設密碼都沒有寫稽核紀錄，見 `../../system/AUDIT.md` 的 SEC-02。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
