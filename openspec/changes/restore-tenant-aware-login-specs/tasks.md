## 1. 測試

這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。新的測試都在 `apps/api/tests/feature/modules/auth/tenant-disabled-access.test.ts`，走真實的 `auth.plugin`、`/auth/login`、`/auth/refresh`、`processWebhookEvent` 與測試資料庫。

| 主規格 | 需求 | 情境 | 測試 |
| --- | --- | --- | --- |
| `auth-session` | 登入依 email 解析所屬租戶 | 登入的 token 帶成員所屬的租戶 | 新增 |
| `auth-session` | 登入依 email 解析所屬租戶 | 其他租戶已使用的 email 不能建立成員 | 既有：`apps/api/tests/feature/modules/agent/agent-management.test.ts` 的「email 已被其他租戶使用：回 409 CONFLICT，不建立成員」 |
| `auth-session` | 停用租戶的成員不能登入或換發 token | 停用租戶的成員以正確密碼登入 | 新增 |
| `auth-session` | 停用租戶的成員不能登入或換發 token | 停用租戶的成員密碼錯誤 | 新增 |
| `auth-session` | 停用租戶的成員不能登入或換發 token | 停用租戶的成員換發 token | 新增 |
| `inbound-message-processing` | 停用租戶的進站事件直接丟棄 | 停用租戶的渠道收到訊息 | 新增 |

「停用租戶的長效憑證與既有連線失效」的 3 個情境沒有測試：現行程式違反這條需求（AUDIT AUTH-02），測試要等修正時一起寫。

- [x] 1.1 寫上表標「新增」的測試

## 2. 突變驗證

每個突變都讓對應的測試失敗，還原後全部通過。

| 突變 | 失敗的測試 |
| --- | --- |
| `auth.service.ts` 的 `login()` 拿掉 `tenant.isActive` 檢查 | 停用租戶的成員以正確密碼登入 |
| `login()` 把 `tenant.isActive` 檢查移到密碼驗證之前 | 停用租戶的成員密碼錯誤 |
| `getActiveAgentForAuth()` 的查詢拿掉 `tenant: { isActive: true }` | 停用租戶的成員換發 token |
| `webhook.service.ts` 拿掉 `channel.tenant?.isActive` 檢查 | 停用租戶的渠道收到訊息 |
| `auth.routes.ts` 簽發 token 時把 `tenantId` 寫死成固定的租戶 | 登入的 token 帶成員所屬的租戶 |

- [x] 2.1 執行上表的突變並還原

## 3. 文件與註解

- [x] 3.1 `agent.service.ts` 的 `createAgent()`：註解改為說明 RLS 下看不到其他租戶的成員，跨租戶的重複由唯一約束與 `error-handler.plugin.ts` 轉成 409
- [x] 3.2 `AUDIT.md`：AUTH-02 補上規格依據；DB-03 註明每日統計的需求沒有補回；`AUDIT-REVIEWS.md` 新增複查紀錄

## 4. 完成檢查

- [x] 4.1 `pnpm test` 與 `pnpm test:feature` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs restore-tenant-aware-login-specs` 與 `--specs` 通過
- [ ] 4.3 PR 合併後以 `pnpm exec openspec archive restore-tenant-aware-login-specs` 歸檔，比較歸檔前後 `validate-openspec.mjs --specs` 印出的「略過 N 則」，並在 #228 勾選 `add-tenant-aware-login`
