## Why

主規格 `tenant-plan` 的「功能天花板交集」規定 `getEffectivePermissions()` 回傳「角色權限 ∩ 天花板」。`apps/api/src/services/permission.service.ts` 有兩個函式：

- `getEffectivePermissions()`：回傳角色權限加上 `implies` 的閉包，不套用天花板。設定角色權限與指派角色的越權防護用這個函式。
- `getEffectiveTenantPermissions()`：再與方案的功能天花板取交集。權限檢查的 guard 與 `GET /api/v1/auth/me/permissions` 用這個函式。

行為符合規格，只有需求寫的函式名稱不對。讀者照名稱去找，會找到不套用天花板的那個函式。

## What Changes

- MODIFIED `tenant-plan` 的「功能天花板交集」：函式名稱改成 `getEffectiveTenantPermissions()`。其他文字與 3 個情境都不變。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `tenant-plan`：更正需求中的函式名稱。

## Impact

- 只修改規格，不修改程式的行為，也不需要新的測試。
- `permission-check` 的「有效權限集合」引用這條需求，引用的是需求名稱，不受影響。
