## Why

change `platform-control-plane` 在 `aa274cf0` 以改名的方式搬進 `archive/`，delta spec 從來沒有套用（issue #228）。`platform-control-plane` 有 8 個 capability、50 條需求，分成幾個 change 補回。這個 change 是第一個，處理 3 個 capability：

- `platform-auth`：平台管理員的認證、guard 與稽核。
- `tenant-entitlement`：方案的功能天花板。
- `plan-limits`：方案的數值上限。

這 3 個 capability 的大部分需求，已經由 `platform-auth`、`tenant-plan`、`plan-limits-core`、`permission-model`、`permission-check` 涵蓋，但實作的做法與歸檔規格不同。這個 change 照現行程式，補上主規格還沒寫到的行為。

## What Changes

- `platform-auth`：修改「平台操作稽核」，列出實際寫稽核的操作，並規定 payload 不含密碼與平台設定的值。
- `tenant-plan`：
  - 新增「平台變更租戶的方案」：方案變更後立即生效；降級不刪除角色的權限設定，升回後恢復；寫入稽核。
  - 修改「功能天花板交集」：新增情境「方案的 features 不含 core」。
  - 修改「方案管理 API」：平台後台的方案設定頁不能取消 `core`。
- `plan-limits-core`：修改「有效上限解析」。租戶覆寫成 null 時沒有上限；方案沒有設定某個上限時也沒有上限。

### 歸檔需求的處理方式

**`platform-auth`**

| 歸檔的需求 | 處理 |
| --- | --- |
| Platform Superuser Authentication Path | 已由「平台 superuser 獨立認證路徑」涵蓋。現行程式把平台身分放在 `request.platformUser`，不是 `tenantId` 為 null 的 `request.agent` |
| requirePlatformSuperuser Guard | 已由「requirePlatformSuperuser guard 保護全部平台路由」涵蓋。租戶 JWT 無法通過平台 JWT 的驗證，所以回 401，不是歸檔規格寫的 403 |
| PlatformUser Model | 已由「平台 superuser 獨立認證路徑」涵蓋：`PlatformUser` 是不帶 tenantId 的全域表 |
| Platform Audit Log | 修改「平台操作稽核」。歸檔規格列的「改單一租戶的功能覆寫」「改額度」「管理 AI key」沒有實作，所以不列入 |
| Superuser Has No Tenant Data-Plane Access | 已由「requirePlatformSuperuser guard 保護全部平台路由」與情境「平台 JWT 打租戶 API」涵蓋 |

**`tenant-entitlement`**

| 歸檔的需求 | 處理 |
| --- | --- |
| Plan 與 Feature Override 資料模型 | `Plan` 已由 `tenant-plan` 的「Plan 全域資料模型」涵蓋。單一租戶的 `featureOverrides` 沒有實作，已在 #228 請 Daniel 決定 |
| Entitlement 解析公式 | 已由 `tenant-plan` 的「功能天花板交集」涵蓋。歸檔規格要求沒有方案的租戶「至少有 core」，現行程式不施加天花板，主規格照現行程式。`grant`／`revoke` 同上，等 Daniel 決定 |
| core feature 恆開不可關閉 | 修改「功能天花板交集」與「方案管理 API」。沒有 `featureOverrides`，所以「revoke core 不生效」不適用 |
| Feature 與權限點對應之啟動驗證 | 已由 `permission-model` 的「啟動時驗證註冊表」涵蓋。現行設計由每個權限點宣告自己屬於哪個 feature，所以一個權限點不會屬於兩個 feature |
| 有效權限為角色權限與天花板之後端強制交集 | 已由 `tenant-plan` 的「功能天花板交集」與 `permission-check` 的「登入成員的權限端點」涵蓋 |
| 降級不刪資料且升回自動恢復 | 新增「平台變更租戶的方案」。權限設定頁的鎖定狀態沒有實作，已在 #228 請 Daniel 決定 |
| Entitlement 快取與失效鏈 | 做法不同：Redis 依角色與方案快取有效權限（`permission-check` 的「有效權限集合的快取」），租戶對應的方案另有 60 秒的程序內快取，變更方案時清除（新增的「平台變更租戶的方案」）。變更方案的路由是 `PATCH /api/v1/platform/tenants/:id`，不是歸檔規格的 `PUT /admin/tenants/:id/plan` |

**`plan-limits`**

| 歸檔的需求 | 處理 |
| --- | --- |
| 數值上限參數化儲存（非寫死） | 已由 `plan-limits-core` 的「有效上限解析」與 `tenant-plan` 的「方案管理 API」涵蓋。歸檔規格的公式是 `limitOverrides[key] ?? plan.limits[key]`，覆寫成 null 時會改用方案的值；現行程式把 null 當成無上限，主規格照現行程式寫明。平台後台沒有直接修改 `Tenant.limitOverrides` 的途徑，只有核准加購時會寫入（另一個 change 處理） |
| 客服人數上限硬擋（建立時檢查） | 已由 `plan-limits-core` 的「客服人數建立時硬擋」涵蓋 |
| 分眾標籤數上限硬擋（建立時檢查） | 不補。計數範圍不明（要不要算素材標籤與自動建立的標籤），已在 #228 請 Daniel 決定。AUDIT PLAN-04 維持現況 |
| 上限檢查與功能權限正交 | 已由「客服人數建立時硬擋」涵蓋：在權限檢查之後、建立之前檢查 |
| 上限硬擋錯誤可辨識並引導升級 | 已由「客服人數建立時硬擋」涵蓋：`PLAN_LIMIT_EXCEEDED`，帶 `limitKey`、`current`、`max` |

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `platform-auth`：平台操作稽核的範圍與 payload 內容。
- `tenant-plan`：平台變更租戶的方案、core 恆開。
- `plan-limits-core`：覆寫成 null 與方案沒有設定時的有效上限。

## Impact

- 只新增測試與規格，不修改程式。
- `apps/api/tests/unit/modules/platform/`、`apps/web/tests/unit/app/admin/`：新的測試。
