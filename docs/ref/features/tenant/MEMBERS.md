# 人員與角色

租戶的成員（`Agent`）是客服與管理員。管理員在「設定 → 人員管理」新增成員、指派角色、指定可用的渠道，在「角色與權限」自訂角色並勾選權限碼。成員以 email 與密碼或 Passkey 登入。

- **資料來源**：`apps/api/src/modules/agent/*`、`apps/api/src/modules/role/*`、`apps/api/src/modules/auth/*`、`apps/api/src/plugins/auth.plugin.ts`、`apps/api/src/guards/rbac.guard.ts`、`apps/api/src/services/permission.service.ts`、`packages/core/src/rbac/*`、`packages/shared/src/rbac/*`、`apps/web/src/components/settings/AgentManagement.tsx`、`apps/web/src/components/settings/GeneralSettings.tsx`
- **核對日期**：2026-11-19

## 負責的程式

| 模組 | 負責什麼 |
| --- | --- |
| `agent` | 成員的新增、改角色、重設密碼、停用、永久刪除，以及成員直接可用的渠道 |
| `role` | 角色的 CRUD 與權限碼設定 |
| `auth` | 登入、token 更新、登出、Passkey、CLI 登入，以及 `/auth/me` 與 `/auth/me/permissions` |
| `packages/shared/src/rbac/` | 權限碼的註冊表（`permissions.ts`）與系統角色的預設權限（`default-roles.ts`）。`packages/core/src/rbac/permissions.ts` 只轉出註冊表 |
| `packages/core/src/rbac/` | 功能分組（`features.ts`）與註冊表的檢查（`registry.ts` 的 `validatePermissionRegistry()`） |
| `guards/rbac.guard.ts` | `requirePermission()`：路由層的權限檢查 |
| `services/permission.service.ts` | 計算有效權限，並快取在 Redis |

## 程式的入口

成員的路由在 `agent.routes.ts`，前綴是 `/api/v1/agents`。角色的路由在 `role.routes.ts`，前綴是 `/api/v1/roles`。

| 操作 | 路由 | flow 或 service 函式 |
| --- | --- | --- |
| 成員列表、停用的成員 | `GET /agents`、`GET /agents/inactive` | `agent.flow.ts` 的 `listAgentsFlow()` → `listAgents(isActive)` |
| 新增成員 | `POST /agents` | `createAgentFlow()` → `createAgent()`：`resolveNewAgentChannels()`、`resolveRoleAssignment()`、`insertAgentChannelAccess()` |
| 改角色 | `PATCH /agents/:id/role` | `updateAgentRoleFlow()` → `updateAgentRole()` |
| 重設他人密碼 | `PATCH /agents/:id/password` | `resetAgentPasswordFlow()` → `resetAgentPassword()` |
| 改自己的密碼 | `PATCH /agents/me/password` | `changeOwnPasswordFlow()` → `changeOwnPassword()` |
| 停用、重新啟用 | `POST /agents/:id/deactivate`、`/reactivate` | `deactivateAgentFlow()`、`reactivateAgentFlow()` |
| 永久刪除 | `DELETE /agents/:id` | `purgeAgentFlow()` → `purgeAgent()` |
| 成員直綁的渠道 | `GET`、`PUT /agents/:id/channels` | `listAgentChannelsFlow()`、`setAgentChannelsFlow()` → `channel-team-access.ts` 的 `setAgentChannels()` |
| 角色列表、權限矩陣、角色的權限碼 | `GET /roles`、`GET /roles/matrix`、`GET /roles/:id/permissions` | `role.service.ts` |
| 建立、改名、刪除角色 | `POST /roles`、`PATCH /roles/:id`、`DELETE /roles/:id` | `role.service.ts` 的 `createRole()`、`renameRole()`、`deleteRole()` |
| 設定角色的權限碼 | `PUT /roles/:id/permissions` | `role.flow.ts` 的 `setRolePermissionsFlow()` → `setRolePermissions()` |
| 目前成員的有效權限 | `GET /auth/me/permissions` | `permission.service.ts` 的 `getEffectiveTenantPermissions()` |

每個寫入操作都寫租戶稽核：`agent.create`、`agent.role.assign`、`agent.password.reset`、`agent.deactivate`、`agent.reactivate`、`agent.purge`、`agent.channels.set`、`role.permission.update`。改自己的密碼不寫稽核（HC-MEMBERS-09）。

## 成員

### 新增

`createAgent()` 依序：

1. 檢查 email 是否已被使用。email 在**全系統**唯一，不是租戶內唯一，因為登入時靠 email 找出成員所屬的租戶。
2. 檢查方案的成員數上限（`maxAgents`），只計算啟用中的成員。
3. 決定新成員看得到的渠道（`channelIds`）。建立者持有 `channel.view_all` 或 `channel.assign_team` 時可以選任何渠道，層級為 `full`；否則只能選自己看得到的渠道，層級不高於建立者自己的層級，選了看不到的回 403。選了不屬於本租戶的渠道回 400。沒有送時，就是建立者能選的全部渠道。密碼在交易外先雜湊。
4. 以管理員填的密碼建立帳號，並把成員直綁給第 3 步的渠道（`AgentChannelAccess`，`full`）。

`POST /agents` 在同一個交易內建立成員與綁定。新增人員的表單列出建立者能選的渠道，預設全選；全選時不送 `channelIds`，由後端套用相同的預設。渠道可見範圍是 fail-closed：沒有任何綁定、角色也不能檢視所有渠道的成員，什麼都看不到。

新成員不會收到開通信，也不會被要求第一次登入時改密碼。管理員要自己把密碼交給成員（AUTH-01）。

`createAgentSchema` 的檢查：

- `email` 不轉小寫，也不去除空白（AUTH-10）。
- `password` 至少 8 個字元，沒有上限。bcrypt 只看前 72 bytes，超過的部分不影響登入（HC-MEMBERS-05）。
- `role` 必填；`roleId` 選填。

email 重複時回 409。被同租戶的成員用掉時，`createAgent()` 自己查到並回 409。被其他租戶的成員用掉時，RLS 藏起對方，寫入時撞到資料庫的唯一約束，由 `error-handler.plugin.ts` 轉成 409 `CONFLICT`。

主管系統角色預設有 `agent.manage`。指派的角色不能含建立者自己沒有的權限（403 `ROLE_ESCALATION`）。

### 停用與永久刪除

| 動作 | 端點 | 結果 |
| --- | --- | --- |
| 停用 | `POST /agents/:id/deactivate` | `isActive` 設為 `false`。帳號保留，email 仍被佔用 |
| 查詢停用的成員 | `GET /agents/inactive` | 列出本租戶停用的成員，要 `agent.deactivate` |
| 重新啟用 | `POST /agents/:id/reactivate` | `isActive` 改回 `true`，角色維持停用前。要 `agent.deactivate`，並套用方案的客服人數上限 |
| 永久刪除 | `DELETE /agents/:id` | 刪除帳號並釋放 email。成員的通知、CLI token 與 Passkey 一併刪除；工單、對話與訊息上的成員欄位改成空值。稽核與資料匯出、刪除請求的操作者欄位也改成空值，刪除前先把名稱與 email 存進快照欄位（見[稽核](GOVERNANCE.md#租戶稽核日誌)） |

停用與永久刪除都不能用在自己身上（422 `SELF_ACTION_FORBIDDEN`）。兩個動作也都不能套用在租戶內最後一位啟用中的管理員（422 `LAST_ADMIN_PROTECTED`），避免租戶沒有人能管理；把最後一位管理員改成不含 `role.manage` 的角色也一樣。「管理員」依權限判斷：角色的有效權限含 `role.manage`（標記 `selfLock` 的權限碼）就算，不看舊的角色列舉 `role`（`agent.service.ts` 的 `roleIsAdmin()`、`listAdminRoleIds()`）。永久刪除不要求先停用。

`purgeAgent()` 的步驟：

1. 檢查最後一位管理員（`assertNotLastActiveAdmin()`），再檢查對方的權限是否比自己高。
2. 刪除以 RESTRICT 參照成員的資料：通知、CLI session、Passkey。新增一張以 RESTRICT 參照 `agents` 的表時，必須同步加進這一步，否則刪除失敗。
3. 把成員的名稱與 email 寫進資料匯出請求、資料刪除請求與稽核的操作者快照。
4. 刪除成員。團隊成員與渠道綁定隨之刪除（cascade），工單、對話、訊息上的成員欄位改成空值。

**不能對權限比自己高的成員操作。** 改角色、重設密碼、停用、永久刪除另一位成員時，對方目前角色的權限含操作者沒有的權限碼，後端回 403 `TARGET_OUTRANKS_ACTOR`（`error.details.exceededPermissions` 列出多出的權限碼）。操作者是 `admin` 系統角色時不受限。因此主管不能降級、停用或重設管理員的密碼；持 `agent.password.reset` 的自訂角色也不能重設管理員的密碼。比較的是角色原始的權限（`loadRolePermissions()`）。新增其他「對另一位成員」的操作時，也要呼叫 `assertTargetNotAboveActor()`。

改角色（`updateAgentRole()`）依序檢查：

1. 新角色含操作者沒有的權限：403 `ROLE_ESCALATION`。
2. 目標是自己，而且新角色沒有 `selfLock` 權限碼：422 `SELF_LOCK`。
3. 新角色沒有 `role.manage`，而且對方是最後一位啟用中的管理員：422 `LAST_ADMIN_PROTECTED`。
4. 對方目前的權限比自己高：403 `TARGET_OUTRANKS_ACTOR`。

改角色之後，對方要換發 token 才拿到新權限，最長 15 分鐘。

**停用可以復原。** `GET /agents` 只回傳啟用中的成員；有 `agent.deactivate` 的成員在「人員管理」頁的「已停用的人員」看到停用的成員，可以重新啟用或進編輯永久刪除。停用的成員仍佔用自訂角色，刪除角色被擋時，錯誤訊息會列出佔用的成員並標示已停用。

**停用不會立刻踢出登入中的成員。** `authenticate` 只驗 token 簽章，不回查帳號狀態。成員被停用後：

- 手上的 access token 在到期前仍然有效，預設 15 分鐘。
- 已建立的 socket 連線不會中斷，會持續收到即時事件。
- 換新 token（`POST /auth/refresh`）會被擋下。
- CLI token 會被擋下，`verifyCliSession()` 有檢查成員是否啟用。

停用租戶也有類似的延遲，見 `../../system/AUDIT.md` 的 AUTH-02。

### 密碼

| 動作 | 端點 | 權限 |
| --- | --- | --- |
| 改自己的密碼 | `PATCH /agents/me/password`。入口有兩個：「設定 → 一般設定」（有確認欄）與「人員管理」右上的「修改密碼」（沒有確認欄） | 只驗登入，需要舊密碼。不寫稽核（HC-MEMBERS-09） |
| 管理員重設別人的密碼 | `PATCH /agents/:id/password` | `agent.password.reset`，由管理員直接設定新密碼 |

租戶端沒有「忘記密碼」流程。唯一的管理員忘記密碼時，只能請平台營運方處理，見 `../../system/AUDIT.md` 的 AUTH-01。

## 角色與權限

### 兩套角色欄位

`Agent` 同時有兩個角色欄位：

| 欄位 | 內容 | 誰在用 |
| --- | --- | --- |
| `role` | 舊的三級列舉：`ADMIN`、`SUPERVISOR`、`AGENT` | 工單自動指派、通知收件人、自動化的「通知主管」、試用到期通知 |
| `roleId` | 指向細粒度的 `Role` | 路由的權限檢查、渠道可見範圍、角色與權限頁 |

schema 的註解說明這是過渡期的雙寫。建立成員時，`role` 由呼叫端送出（必填），`roleId` 選填；有 `roleId` 時權限以它為準，`role` 仍照呼叫端送的值寫入。指派系統角色時，兩個欄位一起更新；指派自訂角色時，`role` 沿用成員原本的值。因此同屬一個自訂角色的兩個成員，可能一個收到所有主管通知、另一個會被自動指派工單，而介面上看不出差別。見 `../../system/AUDIT.md` 的 RBAC-03。

### 系統角色與自訂角色

每個租戶開通時建立三個系統角色：`admin`、`supervisor`、`agent`。

| | 系統角色 | 自訂角色 |
| --- | --- | --- |
| 改名 | 可以 | 可以 |
| 刪除 | 不行 | 可以，但還有成員使用時會被擋下 |
| 改權限碼 | 可以；`admin` 角色的鎖定權限不能移除 | 可以 |

### 權限碼

權限碼定義在 `packages/shared/src/rbac/permissions.ts`，每個屬於一個功能（`features.ts`）。設定角色的權限碼時，`setRolePermissions()` 依序檢查：

1. 每個權限碼都存在於註冊表。
2. 勾選的權限碼，其前置權限（`dependsOn`）也要勾選。
3. **防越權**：編輯者不是管理員時，不能授予自己沒有的權限。
4. **管理員鎖定**：`admin` 系統角色不能移除標記為 `adminLock` 的權限。
5. **防自鎖**：不能從自己目前的角色移除標記為 `selfLock` 的權限，例如 `role.manage`。

各步的錯誤：未知的權限碼 422 `VALIDATION_ERROR`、缺前置權限 422 `DEPENDENCY_UNMET`、越權 403 `PRIVILEGE_ESCALATION`、管理員鎖定 422 `ADMIN_LOCK`、自鎖 422 `SELF_LOCK`。

`setRolePermissionsFlow()` 在 commit 之後（`scope.afterCommit`）清除 Redis 的 `perms:role:<id>` 與 `perms:tenant:<id>:*`，改動立即生效。快取不能在 commit 之前清除：另一個請求會在 commit 之前讀到舊資料，再寫回快取。

註冊表的限制，由 `validatePermissionRegistry()` 與 `rbac-registry.test.ts` 檢查：

- `dependsOn` 只能一層。
- 同一個權限碼不能同時出現在 `dependsOn` 與 `implies`。
- 至少要有一個 `selfLock` 權限碼，否則 API 不啟動，`agent.service.ts` 載入時也丟出錯誤。

角色的名稱 1～20 字，在租戶內唯一，重複時回 422 `DUPLICATE`。刪除還有成員使用的角色回 409 `ROLE_IN_USE`，訊息列出成員的姓名，含停用的成員。刪除系統角色回 403。

指派角色也有同樣的防越權檢查，並且不能把自己改成沒有 `selfLock` 權限的角色。改別人的角色時，對方目前的權限也不能比自己高（`TARGET_OUTRANKS_ACTOR`），見[停用與永久刪除](#停用與永久刪除)。

### 有效權限怎麼算

成員實際能用的權限，是角色授予的權限碼（加上 `implies`）再扣掉方案不允許的部分，由 `getEffectiveTenantPermissions()` 計算。路由檢查用這個結果。越權防護比較的是角色原始的權限 `loadRolePermissions()`：在租戶交易內查資料庫，不讀快取。兩者不要混用。`requirePermission()`、渠道可見範圍與 socket 房間授權都用這個結果。計算步驟、快取，以及改角色或方案之後多久生效，見[權限計算](../../modules/PERMISSIONS.md)。

租戶的方案在 API 行程的記憶體快取 60 秒（`apps/api/src/services/tenant-plan.cache.ts`），Redis 的 `FLUSHDB` 清不到。換方案之後短時間內的 403，多半是這個快取。

前端把有效權限存在 `AuthProvider.tsx`，重新載入頁面才更新。

**新增權限碼的步驟：**

1. 加進 `packages/shared/src/rbac/permissions.ts`，給它 `feature`，需要時加 `dependsOn`、`implies`。
2. 在 `default-roles.ts` 決定哪些系統角色預設有這個權限碼。
3. 路由掛 `requirePermission()`。需要時在 `Sidebar.tsx` 的 `perm` 加上這個權限碼。
4. 部署後執行 `node scripts/grant-new-role-permissions.mjs <權限碼...>`，再清除 Redis 的 `perms:*`。

既有租戶的角色不會自動取得新的權限碼。不要用 reconcile 腳本（`scripts/reconcile-system-role-permissions.mjs`）補權限碼：這個腳本覆蓋管理員對系統角色的修改，見 `../../system/AUDIT.md` 的 RBAC-05。

新路由一律用 `requirePermission()`，不要用 `requireRole()` 或 `requireAdmin()`。

「角色與權限」頁顯示的是角色本身的權限碼，沒有套用方案天花板，因此畫面上勾選的權限不一定真的生效，見 `../../system/AUDIT.md` 的 PLAN-08。

很多路由沒有掛 `requirePermission()`，只驗登入。這些路由不受角色與方案限制，見 `../../system/AUDIT.md` 的 RBAC-01。

## 渠道與團隊

成員能看到哪些渠道，由兩種授權決定，見[收件匣與對話](./INBOX.md#誰看得到哪些對話)：

| 授權 | 設定位置 | 端點 |
| --- | --- | --- |
| 直接授權給成員 | 人員管理頁 | `GET`、`PUT /agents/:id/channels`，需要 `channel.assign_team`。`PUT` 以送出的渠道清單整批取代，層級一律寫 `full`，不能指定 `reply_only` 或 `read_only`。原本是 `read_only` 或 `reply_only` 的綁定，存檔後變成 `full`（HC-MEMBERS-04） |
| 授權給團隊 | 渠道管理頁 | 見[渠道管理](./CHANNELS.md#誰看得到這個渠道) |

直綁的層級只在建立成員時依建立者的層級寫入。之後沒有端點可以改層級。

成員看不到任何對話時，先看 `agent_channel_accesses` 有沒有直綁，再看角色有沒有 `channel.view_all`。可見範圍的邏輯在 `apps/api/src/services/channel-visibility.ts`。

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
| 永久刪除成員 | `agent.purge` |
| 查看角色 | `role.view` |
| 管理角色與權限碼 | `role.manage` |

側欄的「人員管理」沒有要求權限，所有成員都看得到入口；沒有 `agent.view` 的成員點進去會收到 403，列表是空的。三個系統角色預設都有 `agent.view`。`agent.password.reset`、`agent.deactivate`、`agent.purge`、`channel.assign_team` 預設只有 `admin`。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 人員管理 `/dashboard/settings/agents`（`AgentManagement.tsx`） | `GET /agents` | 上方分頁「全部／Admin／Supervisor／Agent」依舊的角色列舉 `role` 篩選。自訂角色的成員算進他原本的列舉 |
| 右上「新增人員」 | `POST /agents` | 沒有 `agent.manage` 時按鈕隱藏。渠道勾選清單預設全選 |
| 列表「編輯」→ 角色下拉 → 儲存 | `PATCH /agents/:id/role` | 角色沒變就不送。沒有 `agent.role.assign` 時下拉停用 |
| 編輯對話框「重設密碼」 | `PATCH /agents/:id/password` | 沒有 `agent.password.reset` 時欄位隱藏 |
| 編輯對話框的可使用渠道 | `GET /channels/assignable`、`GET`、`PUT /agents/:id/channels` | 沒有 `channel.assign_team` 時區塊隱藏 |
| 編輯對話框左下「停用」 | `POST /agents/:id/deactivate` | 自己的對話框沒有這個按鈕 |
| 列表下方「已停用的人員」 | `GET /agents/inactive`、`POST /agents/:id/reactivate` | 沒有 `agent.deactivate` 時區塊隱藏。停用的成員也可以從這裡進編輯，再永久刪除 |
| 編輯對話框「刪除」 | `DELETE /agents/:id` | 沒有 `agent.purge` 時按鈕隱藏 |
| 右上「修改密碼」、一般設定的修改密碼（`GeneralSettings.tsx`） | `PATCH /agents/me/password` | 見[密碼](#密碼) |
| 角色權限 `/dashboard/settings/roles` | `GET /roles`、`GET /roles/matrix`、`GET /roles/:id/permissions` | 沒有 `role.view` 時側欄與分頁隱藏。`agent.role.assign` 隱含 `role.view`，所以主管看得到唯讀的頁面。畫面不套方案天花板（PLAN-08） |
| 勾選權限碼 → 底部「儲存變更」 | `PUT /roles/:id/permissions` | 勾選時帶出前置權限。沒有 `role.manage` 時勾選框停用，也沒有「新增角色」 |
| 左欄「新增角色」、自訂角色的鉛筆與垃圾桶 | `POST /roles`、`PATCH /roles/:id`、`DELETE /roles/:id` | 只有自訂角色有鉛筆與垃圾桶 |
| 登入 `/login`（密碼、Passkey） | 見[登入](#登入) | |

畫面送出的值：

- 新增成員：`{ name, email, password }`。系統角色加上 `{ role: 'ADMIN' | 'SUPERVISOR' | 'AGENT' }`；自訂角色加上 `{ role: 'AGENT', roleId }`。`channelIds` 只在使用者動過勾選清單時送出；沒有送出時，後端套用建立者能指派的全部渠道。
- 改角色：系統角色送 `{ role }`；自訂角色送 `{ role: <成員目前的列舉>, roleId }`，所以舊的列舉不跟著變（RBAC-03）。
- 渠道：`{ channelIds: [...] }`，整組取代。
- 角色的權限碼：`{ permissions: [...] }`，整組取代。
- 角色名稱：前端 `trim()` 之後送出，輸入框 `maxLength=20`。

越權與自鎖的錯誤訊息寫在 `agent.service.ts` 與 `role.service.ts`。`AgentManagement.tsx` 的 `resolveApiError` 把錯誤碼轉成畫面上的中文原因。

下列功能沒有畫面入口：

- 系統角色改名：`PATCH /roles/:id` 可以改，但頁面只對自訂角色顯示鉛筆。
- 修改直綁渠道的層級：連 API 也沒有。
- 建立團隊、管理團隊成員：連 API 也沒有（TEAM-01）。
- 修改成員的姓名與 email：租戶端沒有端點，只有平台後台能改 email。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 登出或改密碼不會讓 refresh token 失效 | 詳見 `../../system/AUDIT.md` 的 AUTH-08 |
| email 區分大小寫，和建立時的大小寫不同就無法登入 | 詳見 `../../system/AUDIT.md` 的 AUTH-10 |
| 知道 email 就能讓成員無法以密碼登入 | 詳見 `../../system/AUDIT.md` 的 SEC-06 |
| **團隊沒有建立的途徑** | 詳見 `../../system/AUDIT.md` 的 TEAM-01 |
| 業務規則看舊的角色列舉 | 自動指派、通知收件人、試用到期信。「最後一位管理員」的保護依權限判斷。詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| **reconcile 腳本覆蓋系統角色的修改** | 詳見 `../../system/AUDIT.md` 的 RBAC-05 |
| 角色頁顯示的權限不套方案天花板 | 詳見 `../../system/AUDIT.md` 的 PLAN-08 |
| 停用成員不會中斷登入中的 token 與 socket | access token 有效到過期，socket 直到斷線。各憑證的生效時間見[認證與憑證](../../modules/AUTHENTICATION.md#停用與撤銷什麼時候生效) |
| 沒有忘記密碼流程 | 詳見 `../../system/AUDIT.md` 的 AUTH-01 |
| 登出不撤銷 token | 只清 cookie |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
