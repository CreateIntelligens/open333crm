## Why

主規格 `platform-auth` 的「requirePlatformSuperuser guard 保護全部平台路由」與現行程式有三處不同：

- 程式裡沒有 `requirePlatformSuperuser()`。實際的 guard 是 `auth.plugin.ts` 的 `authenticatePlatformSuperuser`。
- 需求寫「非平台 superuser 一律回 403/401」，沒有寫哪一種情況回哪一個狀態碼。
- 需求寫「登入除外」。實際上忘記密碼與重設密碼也不需要登入。

`platform-user-management` 的「帳號標記須改密碼時，除改密碼外的平台功能一律受阻」寫「JWT SHALL 攜帶此旗標」。實際上平台 JWT 只有 `platformUserId` 與 `role`，guard 每次請求都從資料庫讀取 `mustChangePassword`。

這兩條需求的情境都沒有自動化測試。#250 的審查發現了這個缺口。

## What Changes

- `platform-auth`：
  - 需求「requirePlatformSuperuser guard 保護全部平台路由」改名為「平台路由一律驗證平台帳號」，並照現行程式寫明 3 個公開端點、驗證的檢查順序，以及每一種情況的狀態碼。
  - 新增需求「沒有設定 PLATFORM_JWT_SECRET 時停用平台後台」。這個行為原本只寫在 `docs/ref/` 的文件裡。它從改名的需求拆出來，讓每條需求不超過 500 字元。
- `platform-user-management`：「帳號標記須改密碼時，除改密碼外的平台功能一律受阻」改成每次請求從資料庫讀取旗標，被擋時回 403 `MUST_CHANGE_PASSWORD`。
- 為上面兩條需求，以及 `platform-auth`「平台 superuser 獨立認證路徑」的 2 個情境補上測試。測試由 Fastify 的 `onRoute` 收集平台路由，之後新增的平台路由也會被檢查。
- 不改程式。
- 修正 `docs/ref/features/platform/AUTH.md` 的速率限制表。表上寫平台的所有路由每分鐘限 30 次，但 `platform.routes.ts` 以 `global: false` 註冊 `@fastify/rate-limit`，只有帶 `config.rateLimit` 的 3 個公開端點受限。AUDIT SEC-03 的寫法正確。

## Capabilities

### New Capabilities

（無。`platform-auth` 新增的需求屬於既有的 capability。）

### Modified Capabilities

- `platform-auth`：改名並改寫「requirePlatformSuperuser guard 保護全部平台路由」，新增「沒有設定 PLATFORM_JWT_SECRET 時停用平台後台」。
- `platform-user-management`：改寫「帳號標記須改密碼時，除改密碼外的平台功能一律受阻」。

## Impact

- 測試：`apps/api/tests/unit/modules/platform/platform-auth-guard.test.ts`、`apps/api/tests/unit/modules/platform/platform-auth-disabled.test.ts`。
- 文件：`docs/ref/features/platform/AUTH.md` 的速率限制。
- 程式：沒有改動。
