# 人員與角色

租戶的成員（`Agent`）是客服與管理員。管理員在「設定 → 人員管理」新增成員、指派角色、指定可用的渠道，在「角色與權限」自訂角色並勾選權限碼。成員以 email 與密碼或 Passkey 登入。

- **資料來源**：`apps/api/src/modules/agent/*`、`apps/api/src/modules/role/*`、`apps/api/src/modules/auth/*`、`apps/api/src/plugins/auth.plugin.ts`、`apps/api/src/guards/rbac.guard.ts`、`apps/api/src/services/permission.service.ts`、`packages/core/src/rbac/*`
- **核對日期**：2026-09-30

## 負責的程式

| 模組 | 負責什麼 |
| --- | --- |
| `agent` | 成員的新增、改角色、重設密碼、停用、清除，以及成員直接可用的渠道 |
| `role` | 角色的 CRUD 與權限碼設定 |
| `auth` | 登入、token 更新、登出、Passkey、CLI 登入，以及 `/auth/me` 與 `/auth/me/permissions` |
| `packages/core/src/rbac/` | 權限碼的註冊表（`permissions.ts`）與功能分組（`features.ts`） |
| `guards/rbac.guard.ts` | `requirePermission()`：路由層的權限檢查 |
| `services/permission.service.ts` | 計算有效權限，並快取在 Redis |

## 成員

### 新增

`createAgent()` 依序：

1. 檢查 email 是否已被使用。email 在**全系統**唯一，不是租戶內唯一，因為登入時靠 email 找出成員所屬的租戶。
2. 檢查方案的成員數上限（`maxAgents`），只計算啟用中的成員。
3. 決定新成員看得到的渠道（`channelIds`）。建立者持有 `channel.view_all` 或 `channel.assign_team` 時可以選任何渠道，層級為 `full`；否則只能選自己看得到的渠道，層級不高於建立者自己的層級，選了看不到的回 403。選了不屬於本租戶的渠道回 400。沒有送時，就是建立者能選的全部渠道。密碼在交易外先雜湊。
4. 以管理員填的密碼建立帳號，並把成員直綁給第 3 步的渠道（`AgentChannelAccess`，`full`）。

`POST /agents` 在同一個交易內建立成員與綁定。新增人員的表單列出建立者能選的渠道，預設全選；全選時不送 `channelIds`，由後端套用相同的預設。渠道可見範圍是 fail-closed：沒有任何綁定、角色也不能檢視所有渠道的成員，什麼都看不到。

新成員不會收到開通信，也不會被要求第一次登入時改密碼。管理員要自己把密碼交給成員。

### 停用與清除

| 動作 | 端點 | 結果 |
| --- | --- | --- |
| 停用 | `POST /agents/:id/deactivate` | `isActive` 設為 `false`。帳號保留，email 仍被佔用 |
| 清除 | `DELETE /agents/:id` | 刪除帳號並釋放 email。成員的通知、CLI token 與 Passkey 一併刪除；工單、對話與訊息上的成員欄位改成空值 |

兩個動作都不能套用在租戶內最後一位啟用中的管理員，避免租戶沒有人能管理。清除不要求先停用。

**停用目前無法復原。** 主規格 `agent-lifecycle` 規定停用的成員可以重新啟用，但沒有重新啟用的路由，`GET /agents` 也不回傳停用的成員，所以管理員在畫面上看不到他們。見 `../../system/AUDIT.md` 的 AUTH-09。

**停用不會立刻踢出登入中的成員。** `authenticate` 只驗 token 簽章，不回查帳號狀態。成員被停用後：

- 手上的 access token 在到期前仍然有效，預設 15 分鐘。
- 已建立的 socket 連線不會中斷，會持續收到即時事件。
- 換新 token（`POST /auth/refresh`）會被擋下。
- CLI token 會被擋下，`verifyCliSession()` 有檢查成員是否啟用。

停用租戶也有類似的延遲，見 `../../system/AUDIT.md` 的 AUTH-02。

### 密碼

| 動作 | 端點 | 權限 |
| --- | --- | --- |
| 改自己的密碼 | `PATCH /agents/me/password`，在「設定 → 一般設定」 | 只驗登入，需要舊密碼 |
| 管理員重設別人的密碼 | `PATCH /agents/:id/password` | `agent.password.reset`，由管理員直接設定新密碼 |

租戶端沒有「忘記密碼」流程。唯一的管理員忘記密碼時，只能請平台營運方處理，見 `../../system/AUDIT.md` 的 AUTH-01。

## 角色與權限

### 兩套角色欄位

`Agent` 同時有兩個角色欄位：

| 欄位 | 內容 | 誰在用 |
| --- | --- | --- |
| `role` | 舊的三級列舉：`ADMIN`、`SUPERVISOR`、`AGENT` | 工單自動指派、通知收件人、自動化的「通知主管」、試用到期通知 |
| `roleId` | 指向細粒度的 `Role` | 路由的權限檢查、渠道可見範圍、角色與權限頁 |

schema 的註解說明這是過渡期的雙寫。指派系統角色時，兩個欄位一起更新；指派自訂角色時，`role` 沿用成員原本的值。因此同屬一個自訂角色的兩個成員，可能一個收到所有主管通知、另一個會被自動指派工單，而介面上看不出差別。見 `../../system/AUDIT.md` 的 RBAC-03。

### 系統角色與自訂角色

每個租戶開通時建立三個系統角色：`admin`、`supervisor`、`agent`。

| | 系統角色 | 自訂角色 |
| --- | --- | --- |
| 改名 | 可以 | 可以 |
| 刪除 | 不行 | 可以，但還有成員使用時會被擋下 |
| 改權限碼 | 可以；`admin` 角色的鎖定權限不能移除 | 可以 |

### 權限碼

權限碼定義在 `packages/core/src/rbac/permissions.ts`，每個屬於一個功能（`features.ts`）。設定角色的權限碼時，`setRolePermissions()` 依序檢查：

1. 每個權限碼都存在於註冊表。
2. 勾選的權限碼，其前置權限（`dependsOn`）也要勾選。
3. **防越權**：編輯者不是管理員時，不能授予自己沒有的權限。
4. **管理員鎖定**：`admin` 系統角色不能移除標記為 `adminLock` 的權限。
5. **防自鎖**：不能從自己目前的角色移除標記為 `selfLock` 的權限，例如 `role.manage`。

指派角色也有同樣的防越權檢查，並且不能把自己改成沒有 `selfLock` 權限的角色。

### 有效權限怎麼算

成員實際能用的權限，是角色授予的權限碼再扣掉方案不允許的部分。`requirePermission()`、渠道可見範圍與 socket 房間授權都用這個結果。計算步驟、快取，以及改角色或方案之後多久生效，見[權限計算](../../modules/PERMISSIONS.md)。

新增權限碼之後，既有租戶的角色不會自動取得，要執行 reconcile 腳本；而這個腳本會覆蓋管理員對系統角色的修改，見 `../../system/AUDIT.md` 的 RBAC-05。

「角色與權限」頁顯示的是角色本身的權限碼，沒有套用方案天花板，因此畫面上勾選的權限不一定真的生效，見 `../../system/AUDIT.md` 的 PLAN-08。

很多路由沒有掛 `requirePermission()`，只驗登入。這些路由不受角色與方案限制，見 `../../system/AUDIT.md` 的 RBAC-01。

## 渠道與團隊

成員能看到哪些渠道，由兩種授權決定，見[收件匣與對話](./INBOX.md#誰看得到哪些對話)：

| 授權 | 設定位置 | 端點 |
| --- | --- | --- |
| 直接授權給成員 | 人員管理頁 | `GET`、`PUT /agents/:id/channels`，需要 `channel.assign_team` |
| 授權給團隊 | 渠道管理頁 | 見[渠道管理](./CHANNELS.md#誰看得到這個渠道) |

**團隊沒有建立的途徑。** API、前端與種子資料都沒有建立團隊或加入成員的功能。渠道管理頁只能從既有的團隊中選擇，而正常情況下沒有任何團隊。依團隊授權渠道與依團隊自動指派工單，因此都只能直接改資料庫才用得起來。見 `../../system/AUDIT.md` 的 TEAM-01。

## 登入

| 方式 | 端點 | 說明 |
| --- | --- | --- |
| 密碼 | `POST /auth/login` | 以 email 找出成員與租戶。依序檢查帳號是否鎖定、密碼是否正確、成員是否啟用、租戶是否啟用 |
| Passkey | `POST /auth/passkeys/authentication/options`、`/verify` | 同樣檢查成員與租戶是否啟用 |
| CLI | `POST /auth/cli/login` | 發出 CLI token，見 `../../system/AUDIT.md` 的 RBAC-02 |

登入成功後回傳 access token，refresh token 放在 httpOnly cookie。兩者的有效期由 `ACCESS_TOKEN_EXPIRES_IN` 與 `REFRESH_TOKEN_EXPIRES_IN` 設定，預設 15 分鐘與 30 天。`POST /auth/refresh` 換發時會從資料庫重讀角色，並擋下已停用的成員與租戶。`POST /auth/logout` 只清掉 cookie，已發出的 token 在到期前仍然有效。

**密碼登入有兩層防暴力破解。**

| 層 | 計算單位 | 上限 | 超過時 |
| --- | --- | --- | --- |
| 速率限制 | 來源 IP | 每分鐘 10 次 | 429 `RATE_LIMITED` |
| 帳號鎖定（`auth/login-attempts.ts`） | email，不分大小寫 | 15 分鐘內 5 次。成功登入時清除計數 | 429 `ACCOUNT_LOCKED`，鎖到區間結束，密碼正確也不放行 |

- CLI 的密碼登入（`POST /auth/cli/login`）共用同一個帳號計數。Passkey 登入不經過帳號計數。
- email 不存在時同樣計數，也同樣比對一次密碼雜湊。回應內容與回應時間都不透露帳號是否存在。
- 帳號計數存在 Redis。Redis 故障時略過帳號鎖定、照常登入，並寫 error log；IP 的速率限制仍然有效。
- 停用成員與停用租戶的檢查在密碼驗證之後。不知道密碼的人無法從回應分辨帳號是否停用。

帳號鎖定只看 email，知道某位成員 email 的人可以讓這位成員一直無法以密碼登入，見 `../../system/AUDIT.md` 的 SEC-06。

各種 token 的簽發與驗證、停用成員或改角色之後多久生效，見[認證與憑證](../../modules/AUTHENTICATION.md)。登出、改密碼或被重設密碼之後，已發出的 refresh token 仍可換發，最長 30 天，見 `../../system/AUDIT.md` 的 AUTH-08。

## 權限一覽

| 動作 | 權限 |
| --- | --- |
| 查看成員 | `agent.view` |
| 新增、修改成員 | `agent.manage` |
| 指派角色 | `agent.role.assign` |
| 重設他人密碼 | `agent.password.reset` |
| 停用成員 | `agent.deactivate` |
| 清除成員 | `agent.purge` |
| 查看角色 | `role.view` |
| 管理角色與權限碼 | `role.manage` |

側欄的「人員管理」沒有要求權限，所有成員都看得到入口；沒有 `agent.view` 的成員點進去會收到 403。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 登出或改密碼不會讓 refresh token 失效 | 詳見 `../../system/AUDIT.md` 的 AUTH-08 |
| 知道 email 就能讓成員無法以密碼登入 | 詳見 `../../system/AUDIT.md` 的 SEC-06 |
| **團隊沒有建立的途徑** | 詳見 `../../system/AUDIT.md` 的 TEAM-01 |
| **停用的成員無法重新啟用** | 管理員也看不到停用的成員。詳見 `../../system/AUDIT.md` 的 AUTH-09 |
| 業務規則看舊的角色列舉 | 包含「最後一位管理員」的保護。詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| **reconcile 腳本覆蓋系統角色的修改** | 詳見 `../../system/AUDIT.md` 的 RBAC-05 |
| 開發環境的 `supervisor` 看得到所有渠道 | 預設權限有兩份，demo 資料的 `supervisor` 多了 `channel.view_all`；正式租戶沒有，這是定案的行為。詳見 `../../system/AUDIT.md` 的 RBAC-06 |
| 角色頁顯示的權限不套方案天花板 | 詳見 `../../system/AUDIT.md` 的 PLAN-08 |
| 停用成員不會中斷登入中的 token 與 socket | access token 有效到過期，socket 直到斷線。各憑證的生效時間見[認證與憑證](../../modules/AUTHENTICATION.md#停用與撤銷什麼時候生效) |
| 沒有忘記密碼流程 | 詳見 `../../system/AUDIT.md` 的 AUTH-01 |
| 登出不撤銷 token | 只清 cookie |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
