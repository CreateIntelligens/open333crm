# 平台帳號認證

營運方帳號的登入、改密碼與忘記密碼流程。與租戶登入完全分離。

- **資料來源**：`apps/api/src/modules/platform/platform-auth.service.ts`、`platform-password-recovery.service.ts`
- **核對日期**：2026-09-23

`platformLogin()` 有兩道防帳號枚舉的設計：

- 帳號不存在時仍對一個假雜湊執行一次 `verifyPassword()`，抹平回應時間差。
- 帳號不存在、已停用、密碼錯誤三種情況回同一個 401 `UNAUTHORIZED`。

忘記密碼的流程同樣防枚舉：`requestPasswordReset()` 無論信箱存在與否都回成功，只有存在且啟用中的帳號才真的產生 token 並寄信。

重設 token 的規則：

- 32 bytes 隨機值，資料庫只存 `sha256` 雜湊，明文只出現在信裡。
- 有效 60 分鐘。
- 單次使用，重設成功後立即清空 token 欄位。
- 新密碼強度不足時保留 token 有效，讓使用者重新提交。

`mustChangePassword` 標記臨時密碼。系統產生臨時密碼時設為真，使用者改密碼成功後清除。

`platform.routes.ts` 因此有兩組 guard：`guard` 含 `blockIfMustChangePassword`，`authOnlyGuard` 不含。除了 `POST /auth/change-password` 用 `authOnlyGuard` 之外，其餘已登入的路由都用 `guard`。這個差別是必要的——未改密碼的使用者必須還能呼叫改密碼那一條。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
