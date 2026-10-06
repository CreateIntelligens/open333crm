## 1. 測試

這個 change 只補規格與測試，不修改程式的行為。每個情境的測試如下。測試名稱以情境名稱開頭；標「新增」或「改名」的是這個 change 加上或改名的測試。

測試檔的簡稱：

- `check`：`apps/api/tests/feature/guards/permission-check.test.ts`（新增）
- `roles`：`apps/api/tests/feature/modules/role/role-management.test.ts`（新增）
- `guards`：`apps/api/tests/feature/modules/route-permission-guards.test.ts`
- `cli`：`apps/api/tests/unit/modules/auth/cli-session-auth.test.ts`
- `registry`：`packages/core/tests/unit/rbac/rbac-registry.test.ts`
- `validation`：`packages/core/tests/unit/rbac/registry-validation.test.ts`（新增）

**`rbac`**

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 路由以權限碼授權 | 缺少路由要求的權限碼 | `guards`（改名） |
| 路由以權限碼授權 | 只有路由要求的權限碼 | `guards`（改名） |
| 路由以權限碼授權 | 角色列舉不影響路由存取 | `guards`（新增） |
| Partner API 金鑰只通過白名單權限碼 | 白名單內的權限碼放行 | `check` |
| Partner API 金鑰只通過白名單權限碼 | 白名單外的權限碼被拒 | `check` |
| CLI token 的授權 | scope 不足時被拒 | `cli`（改名） |
| CLI token 的授權 | 沒有報表權限的成員不能以 CLI 讀報表 | 現況違反（AUDIT RBAC-02），修正時補測試 |
| CLI token 的授權 | 方案不含的功能不能透過 MCP 使用 | 現況違反（AUDIT RBAC-02），修正時補測試 |
| CLI token 的授權 | 權限檢查的 guard 不直接放行 CLI token | 現況違反（AUDIT RBAC-02），修正時補測試 |

**`permission-check`**

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 權限檢查 guard | 有權限碼的成員通過 | `check` |
| 權限檢查 guard | 沒有權限碼的成員被拒 | `check` |
| 權限檢查 guard | 未登入時回 401 | `check` |
| 任一權限碼即可通過 | 只有其中一個權限碼也通過 | `check` |
| 任一權限碼即可通過 | 一個權限碼都沒有時被拒 | `check` |
| 依請求內容追加權限碼 | 建立工單時指派負責人需要 case.assign | `guards`（由原本的一個測試拆出） |
| 依請求內容追加權限碼 | 建立工單時不指派就不需要 case.assign | `guards`（由原本的一個測試拆出） |
| 有效權限集合 | implies 的權限碼遞迴加入 | `registry`（改名） |
| 有效權限集合 | 沒有角色的成員權限為空 | `check` |
| 有效權限集合的快取 | 修改角色權限後立即生效 | `check` |
| 登入成員的權限端點 | 回傳含 implies 的權限碼 | `check` |
| 登入成員的權限端點 | 不回傳方案天花板之外的權限碼 | `check` |

**`permission-model`**

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 權限註冊表是權限點的唯一來源 | 每個權限點的必要欄位都有值 | `registry`（新增） |
| 權限註冊表是權限點的唯一來源 | 不在註冊表的權限碼不能授予 | `roles` |
| 權限碼命名 | 註冊表的權限碼都符合命名規則 | `registry`（新增） |
| 權限碼命名 | 重複的權限碼讓驗證失敗 | `validation` |
| 前置權限（dependsOn） | 缺少前置權限時被拒 | `roles` |
| 前置權限（dependsOn） | 同時授予前置權限時接受 | `roles` |
| 隱含權限（implies） | 隱含權限不存成資料列 | `roles` |
| 啟動時驗證註冊表 | 指向不存在的權限碼、implies 形成循環、同一個權限碼同時是前置與隱含權限、不存在的功能、沒有 selfLock 的權限點 | `validation` |
| 啟動時驗證註冊表 | 正式的註冊表通過驗證 | `registry`（改名） |
| 路由與註冊表一致 | 路由用了不在註冊表的權限碼 | `registry`（改名） |
| 路由與註冊表一致 | 路由用的權限碼都在註冊表內 | `registry`（改名） |
| 稽核與合規權限點 | 三個權限碼屬於 core 功能、data.erase 依賴 contact.view、預設只有 admin 有 | `registry`（新增） |

**`role-management`**

情境「權限註冊表更新後，租戶對系統角色的修改仍然保留」現況違反（AUDIT RBAC-05），修正時補測試。其他情境都在 `roles`。

**突變驗證**

新增與改名的測試都對應現行程式，寫好時就通過，沒有先看到失敗。改以突變驗證確認：改壞下表的程式之後，對應的測試會失敗。33 處都讓測試失敗。

| 改壞的程式 | 失敗的測試 |
| --- | --- |
| `rbac.guard.ts`：403 不帶 `details` | 沒有權限碼的成員被拒 |
| `rbac.guard.ts`：`requireAnyPermission()` 的 `some` 改成 `every` | 只有其中一個權限碼也通過 |
| `rbac.guard.ts`：Partner API 金鑰一律放行 | 白名單外的權限碼被拒 |
| `rbac.guard.ts`：清空 `PARTNER_KEY_ALLOWED` | 白名單內的權限碼放行 |
| `rbac.guard.ts`：沒有角色時放行 | 沒有角色的成員權限為空 |
| `rbac.guard.ts`：角色列舉是 `ADMIN` 時放行 | 角色列舉不影響路由存取 |
| `permission.service.ts`：不套方案天花板 | 不回傳方案天花板之外的權限碼 |
| `permission.service.ts`：不展開 `implies` | 回傳含 implies 的權限碼 |
| `role.service.ts`：設定權限後不清快取 | 修改角色權限後立即生效 |
| `role.service.ts`：系統角色可以刪除 | 系統角色不能刪除 |
| `role.service.ts`：改名時也改 `slug` | 系統角色改名不改 slug |
| `role.service.ts`：建立角色時帶權限碼 | 只給名稱即可建立 |
| `role.service.ts`：不檢查同名 | 同名的角色被拒 |
| `role.routes.ts`：設定權限只要求 `role.view` | 沒有 role.manage 不能設定權限 |
| `role.routes.ts`：查詢角色要求 `role.manage` | 只有 role.view 也能查詢角色 |
| `role.service.ts`：不檢查 `adminLock` | admin 的鎖定權限不能移除 |
| `role.service.ts`：不檢查 `selfLock` | 不能從自己的角色移除 role.manage |
| `role.service.ts`：不做越權檢查 | 授予自己沒有的權限碼被拒 |
| `role.service.ts`：`admin` 角色不豁免越權檢查 | admin 角色的編輯者不受限 |
| `agent.service.ts`：指派角色不做越權檢查 | 指派權限比自己多的角色被拒 |
| `agent.service.ts`：不檢查自我降級 | 不能把自己改成沒有 role.manage 的角色 |
| `role.service.ts`：使用中的角色可以刪除 | 有成員使用的角色不能刪除 |
| `role.service.ts`：系統角色排在後面 | 角色列表標示系統角色 |
| `role.service.ts`：權限矩陣少了 `adminLock` | 權限矩陣涵蓋註冊表的每個權限點 |
| `role.service.ts`：接受不在註冊表的權限碼 | 不在註冊表的權限碼不能授予 |
| `role.service.ts`：不檢查前置權限 | 缺少前置權限時被拒 |
| `role.service.ts`：把 `implies` 的權限碼存成資料列 | 隱含權限不存成資料列 |
| `registry.ts`：6 項驗證各拿掉一項 | `validation` 的 6 個對應情境 |

「沒有 role.manage 不能設定權限」原本只斷言 403，第一次突變驗證時沒有失敗：拿掉 `role.manage` 的檢查之後，越權防護也回 403。測試已改成同時斷言 `error.details.requiredPermission` 是 `role.manage`。

`role.service.ts` 的 `loadTenantRole()` 拿掉 `tenantId` 條件之後，`roles` 的 3 個跨租戶情境仍然通過，因為 app_tenant 連線的 RLS 也擋住了其他租戶的角色。這兩層防護是刻意的設計，見 AGENTS.md 的 Multi-Tenancy 一節。

- [x] 1.1 對照情境與現有測試
- [x] 1.2 為沒有測試的情境新增測試，把涵蓋情境的現有測試改成情境名稱，並以突變驗證確認
- [x] 1.3 現況違反的情境記在 `docs/ref/system/AUDIT.md` 的 RBAC-02 與 RBAC-05，補上規格依據

## 2. 文件

- [x] 2.1 `docs/ref/modules/PERMISSIONS.md` 與 `packages/core/src/rbac/permissions.ts` 的註解改成放寬後的命名規則
- [x] 2.2 `docs/ref/system/AUDIT-REVIEWS.md` 新增一筆紀錄

## 3. 完成檢查

- [x] 3.1 `openspec validate restore-rbac-permission-specs --strict` 通過
- [x] 3.2 以 `openspec archive` 歸檔本 change
- [x] 3.3 改寫 `rbac`、`permission-check`、`permission-model` 與 `role-management` 的 Purpose
- [x] 3.4 `openspec validate --specs --strict` 通過
- [x] 3.5 `pnpm test` 與 `pnpm --filter @open333crm/api test:feature` 通過
