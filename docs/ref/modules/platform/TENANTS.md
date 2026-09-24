# 租戶管理

租戶的開通、停用與基本資料維護。開通邏輯由平台手動開通與試用自動開通共用。

- **資料來源**：`apps/api/src/modules/platform/platform-tenant.service.ts`、`platform.routes.ts`
- **核對日期**：2026-09-23

## 平台能對租戶做什麼

| 操作 | 路由 | 影響 |
| --- | --- | --- |
| 看清單 | `GET /tenants` | 全部租戶，依建立時間新到舊，不分頁。含方案與成員數 |
| 看明細 | `GET /tenants/:id` | 成員清單，加上渠道、聯絡人、對話、工單的筆數統計 |
| 改名稱或方案 | `PATCH /tenants/:id` | 改方案會失效兩層快取，見下文 |
| 改成員登入 email | `PATCH /tenants/:id/agents/:agentId` | 全域唯一，重複回 409 |
| 重寄成員開通信 | `POST /tenants/:id/agents/:agentId/resend-welcome` | 信裡沒有密碼 |
| 停用或啟用 | `PATCH /tenants/:id/active` | 只改 `isActive`，沒有任何防呆 |
| 手動開通 | `POST /tenants` | 建租戶、角色與管理員帳號 |

**沒有刪除租戶的途徑。** 停用只是把 `isActive` 設成 `false`；試用租戶的 `purgedAt` 也只是標記，業務資料一直留在資料庫裡。

## 開通一個租戶建立了什麼

`provisionTenant()` 在同一個交易內依序做三件事：

1. 建 `Tenant`，綁上方案。
2. `seedRolesForTenant()` 建三個系統角色與各自的預設權限。
3. 建管理員 `Agent`，`role` 為 `ADMIN`，並綁上剛才建好的 admin 角色。

這個函式收呼叫端傳入的 transaction client，因此兩條開通路徑共用同一份邏輯：

| 路徑 | 呼叫者 | 差異 |
| --- | --- | --- |
| 平台手動開通 | `provisionTenantViaApi()` | 自行開交易。不設 `trialEndsAt`，租戶一開始就不在試用排程的掃描範圍內 |
| 試用自動開通 | `trial` 模組的 `trial.service.ts` | 與驗證 token 的消耗放在同一個交易內。設定 `trialEndsAt` |

密碼由呼叫端決定要傳明文（函式內部雜湊）或已雜湊的值。試用流程在申請時就已經 bcrypt，開通時直接搬過來，明文不會留在任何地方。

email 的唯一檢查刻意放在交易外先做，讓衝突回 409 `CONFLICT`，而不是交易內的 Prisma `P2002`。

## 手動開通的信裡沒有密碼

平台手動開通時，管理員密碼由操作者在表單上自己填，至少 8 字元。開通信只有站台名稱與登入網址，**密碼要線下轉交**。

這與平台帳號的開通信相反，那一封帶系統產生的臨時密碼，見[平台帳號管理](./PLATFORM-USERS.md#建立帳號時不輸入密碼)。兩者的差別在於誰知道密碼：平台帳號的密碼連建立者都不知道，租戶管理員的密碼則是建立者自己設的。

手動開通的寄信同樣是 fire-and-forget，寄不出去只寫 log，開通仍然成功。

開通信請收件者「登入後立即修改密碼」，但租戶端沒有任何強制機制，也沒有忘記密碼流程，見 `../../system/AUDIT.md` 的 AUTH-01。

## 改方案的連帶效果

`PATCH /tenants/:id` 帶 `planSlug` 時，服務會比對是否真的換了方案；有換才失效權限天花板快取與租戶方案快取。這是改動租戶方案的入口之一，其餘入口與各自要失效的快取見[平台後台](./README.md#方案異動的連鎖效果)。

這條路徑不檢查方案是否停售，也不檢查是升級還是降級。降級到功能較少的方案時，超出新上限的既有資料不會被處理。成員數若已超過新方案的 `maxAgents`，既有成員照常使用，只有下一次新增成員時才會被擋。

## 停用租戶多久生效

不是立刻，但有上限。租戶側的 `authenticate` 只驗 JWT 簽章，不回查資料庫。停用當下已經發出的 access token 因此仍然可用，直到它自己過期。有效期由 `ACCESS_TOKEN_EXPIRES_IN` 控制，預設值在 `apps/api/src/config/env.ts`。

續命與重新登入這兩條路都被擋住了：

- `POST /auth/refresh` 用 `getActiveAgentForAuth()` 重查資料庫，條件包含 `tenant: { isActive: true }`，停用的租戶換不到新的 access token。
- `login()` 在驗完密碼之後才檢查租戶狀態，停用回 403 `TENANT_DISABLED`。順序是刻意的：放在密碼驗證之後，未通過驗證的人就無法用錯誤碼的差異推測某個 email 屬於哪個租戶。

所以停用的延遲最多是一個 access token 的有效期。平台帳號那邊是每個請求都回查資料庫，停用即時生效，見[平台帳號認證](./AUTH.md#停用帳號多久生效)。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
