## 1. 測試

測試名稱以情境名稱開頭。`platform-auth-disabled.test.ts` 測沒有設定 `PLATFORM_JWT_SECRET` 的情境，其他情境在 `platform-auth-guard.test.ts`。兩個檔案都走真實的 `auth.plugin.ts` 與 `platform.routes.ts`，Prisma 換成只有平台帳號的記憶體版本。

兩個測試檔都以 Fastify 的 `onRoute` 收集所有平台路由，逐條呼叫。之後新增的平台路由不必改測試，也會被檢查。

情境都描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。

| 主規格 | 需求 | 情境 |
| --- | --- | --- |
| `platform-auth` | 平台 superuser 獨立認證路徑 | 平台帳號登入成功 |
| `platform-auth` | 平台 superuser 獨立認證路徑 | 租戶 JWT 打平台 API |
| `platform-auth` | 平台路由一律驗證平台帳號 | 未帶 token 存取平台 API |
| `platform-auth` | 平台路由一律驗證平台帳號 | 只有 3 個公開端點不需要 token |
| `platform-auth` | 平台路由一律驗證平台帳號 | token 的角色不是平台管理員 |
| `platform-auth` | 平台路由一律驗證平台帳號 | 平台帳號不存在 |
| `platform-auth` | 平台路由一律驗證平台帳號 | 平台帳號已停用 |
| `platform-auth` | 平台路由一律驗證平台帳號 | 平台 JWT 打租戶 API |
| `platform-auth` | 沒有設定 PLATFORM_JWT_SECRET 時停用平台後台 | 沒有設定 PLATFORM_JWT_SECRET |
| `platform-user-management` | 帳號標記須改密碼時，除改密碼外的平台功能一律受阻 | 標記須改密碼的帳號嘗試存取其他平台功能 |
| `platform-user-management` | 帳號標記須改密碼時，除改密碼外的平台功能一律受阻 | 標記須改密碼的帳號可呼叫改密碼 API |

- [x] 1.1 寫上表的測試

## 2. 突變驗證

每個突變改壞一處程式，執行 `platform-auth` 的兩個測試檔，確認測試失敗，再還原程式。

16 個突變中，14 個讓測試失敗。

| 情境 | 突變 | 結果 |
| --- | --- | --- |
| 未帶 token 存取平台 API、租戶 JWT 打平台 API、沒有設定 PLATFORM_JWT_SECRET | `GET /plans` 不掛 guard | 失敗 |
| 只有 3 個公開端點不需要 token、平台帳號登入成功 | 登入也要求 token | 失敗 |
| 平台帳號登入成功 | 登入簽出的 `role` 不是 `PLATFORM_SUPERUSER` | 失敗 |
| 租戶 JWT 打平台 API | 平台 JWT 改用租戶的 secret | 失敗 |
| 租戶 JWT 打平台 API | 租戶 JWT 改用平台的 secret | 失敗 |
| token 的角色不是平台管理員 | guard 不檢查 `role` | 失敗 |
| 平台帳號不存在 | guard 不檢查帳號存在 | 測試通過，見下方說明 |
| 平台帳號已停用 | guard 不檢查帳號停用 | 失敗 |
| 沒有設定 PLATFORM_JWT_SECRET | guard 不檢查 `PLATFORM_JWT_SECRET` | 失敗 |
| 沒有設定 PLATFORM_JWT_SECRET | 登入不檢查 `PLATFORM_JWT_SECRET` | 失敗 |
| 平台 JWT 打租戶 API | 租戶認證不檢查 token 用途 | 測試通過，見下方說明 |
| 平台 JWT 打租戶 API | 租戶 JWT 改用平台的 secret，而且租戶認證不檢查 token 用途 | 失敗 |
| 標記須改密碼的帳號嘗試存取其他平台功能 | `GET /plans` 改掛只驗身分的 `authOnlyGuard` | 失敗 |
| 標記須改密碼的帳號嘗試存取其他平台功能 | 須改密碼時不擋 | 失敗 |
| 標記須改密碼的帳號可呼叫改密碼 API | 改密碼改掛 `guard`，須改密碼時也擋 | 失敗 |
| 標記須改密碼的帳號可呼叫改密碼 API | 改密碼後不清除 `mustChangePassword` | 失敗 |

「guard 不檢查帳號存在」沒有讓測試失敗，這不是測試的漏洞。帳號不存在時，查詢回傳 `null`，下一行讀 `user.isActive` 拋出錯誤。guard 的 `catch` 把錯誤轉成同一個 401 `UNAUTHORIZED`，所以回應與檢查存在時相同。

「租戶認證不檢查 token 用途」沒有讓測試失敗，因為平台 JWT 打租戶 API 有兩道檢查。租戶認證先以 `JWT_SECRET` 驗證簽章，平台 JWT 是以 `PLATFORM_JWT_SECRET` 簽發，在這一步就失敗。只拿掉其中一道時，另一道仍會回 401，所以兩道一起拿掉才會讓測試失敗。token 用途的檢查另外由 `token-purpose-route.test.ts` 涵蓋。

- [x] 2.1 執行上表的突變

## 3. 文件

- [x] 3.1 `docs/ref/features/platform/AUTH.md`：速率限制表移除「這個 scope 的所有路由每分鐘 30 次」，改寫成只有 3 個公開端點受限

## 4. 歸檔

- [x] 4.1 `node scripts/validate-openspec.mjs clarify-platform-auth-guard` 通過
- [x] 4.2 以 `pnpm exec openspec archive` 歸檔
- [x] 4.3 `node scripts/validate-openspec.mjs --specs` 通過
