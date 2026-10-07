## 1. 測試

測試名稱以情境名稱開頭。所有情境都描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。

測試檔的簡稱：

- `plan`：`apps/api/tests/unit/modules/platform/tenant-plan.test.ts`
- `audit`：`apps/api/tests/unit/modules/platform/platform-audit-routes.test.ts`
- `limits`：`apps/api/tests/unit/modules/platform/plan-limits.test.ts`
- `page`：`apps/web/tests/unit/app/admin/plans-page.test.tsx`
- `channel`：`apps/api/tests/unit/modules/channel/channel-plan-limits.test.ts`

| 主規格 | 需求 | 情境 | 測試 |
| --- | --- | --- | --- |
| `platform-auth` | 平台操作稽核 | 改 plan 留稽核 | `audit` |
| `platform-auth` | 平台操作稽核 | 列出的寫入操作都寫入稽核 | `audit`：逐條打 22 種寫入請求 |
| `platform-auth` | 平台操作稽核 | 開通租戶的稽核不含管理員密碼 | `audit` |
| `platform-auth` | 平台操作稽核 | 更新平台設定的稽核不含設定值 | `audit` |
| `tenant-plan` | 平台變更租戶的方案 | 變更方案後立即生效 | `plan` |
| `tenant-plan` | 平台變更租戶的方案 | 降級不刪除角色的權限設定 | `plan` |
| `tenant-plan` | 平台變更租戶的方案 | 升回原方案後恢復權限 | `plan` |
| `tenant-plan` | 平台變更租戶的方案 | 變更方案留稽核 | `audit` |
| `tenant-plan` | 功能天花板交集 | trial 方案未含 marketing | `plan` |
| `tenant-plan` | 功能天花板交集 | 無 plan 租戶不受影響 | `plan` |
| `tenant-plan` | 功能天花板交集 | 平台改 plan features 即時生效 | `plan` |
| `tenant-plan` | 功能天花板交集 | 方案的 features 不含 core | `plan` |
| `tenant-plan` | 方案管理 API | 更新 limits | `plan` |
| `tenant-plan` | 方案管理 API | 平台後台不能取消 core | `page` |
| `plan-limits-core` | 有效上限解析 | 覆寫優先 | `limits` |
| `plan-limits-core` | 有效上限解析 | 沒有覆寫時採用方案的值 | `limits` |
| `plan-limits-core` | 有效上限解析 | 無 plan 無上限 | `limits` |
| `plan-limits-core` | 有效上限解析 | 覆寫成 null 時沒有上限 | `limits` |
| `plan-limits-core` | 有效上限解析 | 方案沒有設定這個上限 | `limits` |
| `granular-plan-entitlement` | 渠道數量上限 | 達渠道數上限擋新建 | `channel` |
| `granular-plan-entitlement` | 渠道數量上限 | 無上限不擋 | `channel` |
| `granular-plan-entitlement` | 渠道數量上限 | 停用的渠道不計數 | `channel` |
| `granular-plan-entitlement` | 渠道數量上限 | 租戶覆寫渠道數上限 | `channel` |

- [x] 1.1 寫上表的測試
- [x] 1.2 執行 `pnpm test`

## 2. 突變驗證

每個突變改壞一處程式，執行對應的測試，確認測試失敗，再還原程式。33 個突變都讓測試失敗。

| 情境 | 突變 | 結果 |
| --- | --- | --- |
| trial 方案未含 marketing | 有效權限不與天花板取交集 | 失敗 |
| trial 方案未含 marketing | `requirePermission()` 不擋 | 失敗 |
| 無 plan 租戶不受影響 | 沒有方案時也套用天花板 | 失敗 |
| 平台改 plan features 即時生效 | 改方案的 features 時不清快取 | 失敗 |
| 方案的 features 不含 core | 天花板不加入 core | 失敗 |
| 更新 limits | 更新方案時不寫入 limits | 失敗 |
| 平台後台不能取消 core | core 的勾選框不停用 | 失敗 |
| 平台後台不能取消 core | 所有功能的勾選框都停用 | 失敗 |
| 變更方案後立即生效 | 變更方案時不清租戶的方案快取 | 失敗 |
| 降級不刪除角色的權限設定 | 有效權限的快取不分方案 | 失敗 |
| 降級不刪除角色的權限設定 | 變更方案時刪除角色的 `marketing.view` | 失敗 |
| 升回原方案後恢復權限 | 變更方案時刪除角色的 `marketing.view` | 失敗 |
| 變更方案留稽核 | 稽核的 payload 不含 `planSlug` | 失敗 |
| 改 plan 留稽核 | action 改名 | 失敗 |
| 改 plan 留稽核 | 不寫稽核 | 失敗 |
| 開通租戶的稽核不含管理員密碼 | payload 記下整個 body | 失敗 |
| 更新平台設定的稽核不含設定值 | payload 記下設定值 | 失敗 |
| 覆寫優先 | 不採用覆寫值 | 失敗 |
| 沒有覆寫時採用方案的值 | 沒有覆寫時不採用方案的值 | 失敗 |
| 無 plan 無上限 | 沒有方案時上限為 0 | 失敗 |
| 覆寫成 null 時沒有上限 | 覆寫成 null 時改用方案的值 | 失敗 |
| 方案沒有設定這個上限 | 方案沒有這個 key 時上限為 0 | 失敗 |
| 列出的寫入操作都寫入稽核 | 合約日期的 action 改名 | 失敗 |
| 列出的寫入操作都寫入稽核 | 駁回方案申請不寫稽核 | 失敗 |
| 列出的寫入操作都寫入稽核 | 把試用申請標為失敗時不寫稽核 | 失敗 |
| 列出的寫入操作都寫入稽核 | 重寄平台帳號的開通信時不寫稽核 | 失敗 |
| 列出的寫入操作都寫入稽核 | 自助改密碼時不寫稽核 | 失敗 |
| 列出的寫入操作都寫入稽核 | 停用平台帳號記成啟用 | 失敗 |
| 達渠道數上限擋新建 | 不檢查渠道數上限 | 失敗 |
| 達渠道數上限擋新建 | 渠道數等於上限時放行 | 失敗 |
| 無上限不擋 | 沒有上限時當成 0 | 失敗 |
| 停用的渠道不計數 | 停用的渠道也計數 | 失敗 |
| 租戶覆寫渠道數上限 | 不採用租戶的覆寫 | 失敗 |

「升回原方案後恢復權限」的突變一開始沒有讓測試失敗：角色權限的快取仍然含被刪除的權限。測試改成升回之後先清除快取，確認權限來自角色仍然保留的設定。

- [x] 2.1 執行上表的突變

## 3. 歸檔

- [x] 3.1 `node scripts/validate-openspec.mjs restore-platform-plan-specs` 通過
- [x] 3.2 以 `pnpm exec openspec archive` 歸檔
- [x] 3.3 `node scripts/validate-openspec.mjs --specs` 通過
