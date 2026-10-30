# 成員、角色與權限 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build，租戶沒有方案 `planId = null`）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，以 `/auth/me` 確認，只讀）
- 規格：`docs/ref/features/feature-map.json` 的 `members`；功能文件 `docs/ref/features/tenant/MEMBERS.md`、`docs/ref/modules/PERMISSIONS.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 9 份 spec、183 個 scenario。以 scenario 名稱比對測試名稱，35 個找不到同名測試：`auth-session` 25、`channel-team-access` 6、`rbac` 3、`role-management` 1。確定缺實作 10 個，都已在 AUDIT（RBAC-02 3 個、RBAC-05 1 個、TEAM-01 6 個）。缺前端入口 4 項（見下方） |
| 自動測試 | unit：api 13 檔 75 通過、core 3 檔 26 通過、web 4 檔 43 通過。feature：6 檔 88 通過（`modules/agent`、`modules/role`、`guards/permission-check`、`route-permission-guards`、`channel-team-access` 5 檔 83；`modules/auth` 1 檔 5）。無失敗、無 skip |
| 實際操作 | 13 條流程。正常 8，異常 3，待真機驗或未驗 2 |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-MEMBERS-01 | P1 | 改成員角色時不檢查「對方目前的角色比自己高」，也沒有最後一位管理員保護。主管系統角色預設有 `agent.role.assign`，可以把管理員改成 Supervisor 或 Agent。租戶只有一位管理員時（多數租戶的情況），主管一個操作就讓租戶沒有任何人有 `role.manage`、`agent.deactivate`、`agent.purge`、`channel.assign_team`，也無法再改回來（主管不能指派 Admin，`ROLE_ESCALATION`），只能直接改資料庫。停用與刪除有 `LAST_ADMIN_PROTECTED`，改角色沒有 | **實測**（本機）：admin 建立第二位管理員 hc-members-admin2 → 以 `supervisor@open333crm.dev` 登入 `PATCH /agents/<admin2>/role {"role":"SUPERVISOR"}` 回 200，角色變成 Supervisor；從 `/dashboard/settings/agents` 的編輯對話框把它改成 Agent 也成功（角色下拉可用、沒有任何提示）。「最後一位管理員」的情況**只讀程式**：為了不動 seed 帳號沒有實測，`updateAgentRole` 不呼叫 `assertNotLastActiveAdmin`，自我降級守門只在「目標是自己」時檢查 | `apps/api/src/modules/agent/agent.service.ts:240-287`（`updateAgentRole`）；`assertNotLastActiveAdmin` 只在 `:390`、`:418` 呼叫 | 新（規格 `agent-lifecycle` 只規定停用與刪除；`role-management` 的越權防護只比對目標角色） |
| HC-MEMBERS-02 | P2 | 重設他人密碼、停用、刪除都不檢查對方的權限是否比自己高。持有 `agent.password.reset` 的自訂角色可以重設管理員的密碼再以管理員身分登入，等於繞過 `ROLE_ESCALATION` 取得全部權限；持有 `agent.deactivate`／`agent.purge` 的自訂角色可以停用或刪除管理員（不是最後一位時）。這三個碼預設只有 admin，所以要管理員先把它們授予自訂角色才會發生，但權限頁沒有任何提示說它們等同管理員 | **實測**（本機）：自訂角色「hc-members-重設者」只有 `agent.view, agent.password.reset` → `PATCH /agents/<admin2>/password {"newPassword":"Takeover123!"}` 回 200 → 以新密碼登入 admin2 成功。自訂角色「hc-members-停用者」（`agent.view, agent.deactivate, agent.purge`）停用 admin2 回 204 | `agent.service.ts:317-334`（`resetAgentPassword`）、`:376-396`（`deactivateAgent`）、`:408-425`（`purgeAgent`） | 新 |
| HC-MEMBERS-03 | P2 | 舊角色列舉 `role` 由呼叫端任意指定，越權防護只檢查 `roleId`。有 `agent.manage` 的非管理員可以建立 `{"role":"ADMIN","roleId":<低權限自訂角色>}` 的成員：這位成員收到所有管理員與主管通知、AI 額度告警與試用到期信，被「最後一位管理員」保護算成管理員，人員頁也算進「ADMIN」分頁。RBAC-03 說明了雙欄位的後果，這裡補上「非管理員就能製造這種成員」 | **實測**（本機）：自訂角色「hc-members-指派者」（`agent.view, agent.manage, agent.role.assign`）`POST /agents {"role":"ADMIN","roleId":<指派者角色>}` 回 201，`agents.role = ADMIN`；人員頁顯示「ADMIN 3」，該列徽章卻是自訂角色名 | `agent.service.ts:101-110`（custom role 時 `legacyRole = input.role ?? fallbackRole`） | RBAC-03（新的觸發途徑） |
| HC-MEMBERS-04 | P2 | 編輯成員的「可使用的渠道」整組替換時一律寫 `full`。由沒有 `channel.view_all`／`channel.assign_team` 的建立者建立、繼承到 `read_only`／`reply_only` 的成員，被管理員編輯渠道一次就升成 `full`（可以回覆、指派、結案）。頁面沒有層級欄位，管理員看不到原本的層級 | **實測**（本機）：建立者只有一個 `read_only` 渠道 → 建立子帳號，`agent_channel_accesses.accessLevel = read_only` → admin `PUT /agents/<子帳號>/channels {"channelIds":[同一個渠道]}` 回 200 → 層級變成 `full` | `apps/api/src/services/channel-team-access.ts:161-185`（`:181` 寫死 `'full'`）；`apps/web/src/components/settings/AgentManagement.tsx:446-475`（只有勾選框） | 新 |
| RBAC-03 | P2 | 業務規則看舊角色列舉。人員頁的角色分頁與計數也依 `role` 篩選（見 HC-MEMBERS-06） | 本機：同上 | `AgentManagement.tsx:690-697` | RBAC-03（已記錄） |
| TEAM-01 | P2 | 團隊沒有建立途徑。UAT Demo 租戶 5 位啟用成員的 `teams` 都是空的，`GET /channels/teams` 回 `[]`；人員頁的「團隊分組」區塊因此永遠不出現 | UAT 只讀 | — | TEAM-01（已記錄） |
| AUTH-10 | P2 | email 區分大小寫。從「新增人員」對話框以 `HC-MEMBERS-UI@example.test` 建立，已有 `hc-members-ui@example.test` 時仍回 201 | **實測**（本機 UI） | `agent.service.ts:189-195` | AUTH-10（已記錄，仍未修） |
| HC-MEMBERS-05 | P3 | 密碼只有下限 8、沒有上限。bcrypt 只比對前 72 bytes，72 字以後的內容不影響登入 | **實測**（本機）：改成 `"A"×72 + "xyz"` → 以 `"A"×72 + "QQQ"` 登入成功 | `apps/api/src/modules/agent/agent.schema.ts:12, 29, 33` | 新 |
| HC-MEMBERS-06 | P3 | 人員頁的角色分頁「全部／ADMIN／SUPERVISOR／AGENT」依舊列舉篩選，被指派自訂角色的成員算進原本的列舉；下方角色說明寫「Supervisor：可查看所有對話/案件」「Agent：只能看自己負責的對話/案件」，與現況不符（主管預設沒有 `channel.view_all`，客服看得到被授權渠道的所有對話）。手冊 ch16 已提醒讀者忽略這段文字 | 本機開 `/dashboard/settings/agents` | `AgentManagement.tsx:690-697, 874-879` | 新 |
| HC-MEMBERS-07 | P3 | 編輯對話框依序送「改角色 → 重設密碼 → 渠道」三個請求，中途失敗時前面的已經儲存，對話框只顯示最後的錯誤，看起來像全部沒存 | 讀程式 | `AgentManagement.tsx:345-374` | 新 |
| HC-MEMBERS-08 | P3 | 非 UUID 的成員或角色 id（`PATCH /agents/abc/role`、`GET /roles/abc/permissions`）回 400 `DATABASE_ERROR`「資料處理失敗」，不是欄位驗證錯誤。與聯絡人的 HC-CONTACTS-13 同一類 | **實測**（本機） | `apps/api/src/modules/agent/agent.routes.ts:64` 等 `request.params as { id: string }`；`apps/api/src/modules/role/role.routes.ts:36, 50, 58, 65` | 新 |
| HC-MEMBERS-09 | P3 | 改自己的密碼不寫租戶稽核；重設他人密碼有寫（`agent.password.reset`）。AUD-01 的未涵蓋清單沒有列這一項 | 讀程式；本機改密碼後 `tenant_audit_logs` 沒有對應紀錄 | `apps/api/src/modules/agent/agent.flow.ts:73-82` | AUD-01（補一列） |
| HC-MEMBERS-10 | P3 | 對啟用中的成員呼叫重新啟用回 204，並寫一筆 `agent.reactivate` 稽核，稽核出現沒有發生的事 | **實測**（本機）：同一位成員連續 `POST /reactivate` 兩次，稽核有兩筆 | `agent.service.ts:463`（直接 return）；`agent.flow.ts:136-147`（一律寫稽核） | 新 |
| HC-MEMBERS-11 | P3 | 主管改自己的角色（例如降成 Agent）一律被拒，訊息是「改後你將失去管理角色權限的能力（缺少: role.manage）」，但主管本來就沒有 `role.manage`。行為符合主規格（新角色必須含 `selfLock` 碼），訊息讓人誤會 | **實測**（本機 API 與 UI） | `agent.service.ts:267-278` | 新 |
| HC-MEMBERS-12 | P3 | 一般設定頁的新密碼欄提示「至少 6 個字元」，實際是 8；同頁的「角色」欄顯示舊列舉（自訂角色的成員看到「客服」或「管理員」）。手冊 ch16 已註明 | 讀程式 | `apps/web/src/components/settings/GeneralSettings.tsx:157, 217` | 新 |
| HC-MEMBERS-13 | P3 | 新增人員、修改密碼的錯誤只顯示 `error.message`，Zod 錯誤時是通用的「輸入內容有誤」，沒有用 `details.issues`。前端的 `type=email`、`minLength` 擋掉了大部分情況 | 本機 API：`email: " x@y.z"`、密碼 7 字回 400，訊息為通用文字 | `AgentManagement.tsx:81-97` | 新 |

### 已知 AUDIT 項目的核對結果

| AUDIT | 本次結果 |
| --- | --- |
| 原 AUTH-09（停用的成員無法重新啟用） | **已修好**。`GET /agents/inactive` 與「已停用的人員」區塊可用，重新啟用後原密碼登入成功、角色不變（本機實測）。AUDIT 索引已沒有這一項，程式註解仍引用 `AUDIT AUTH-09` |
| RBAC-01 | `agent.delete` 仍在註冊表，角色頁顯示「刪除成員（舊）」。AUDIT 寫註冊表有 56 個碼（2026-10-02），現在是 62 個（本機與 UAT 的 `/roles/matrix` 都是 62） |
| RBAC-03 | 確認；另見 HC-MEMBERS-03 |
| RBAC-05 | 本次沒有執行腳本；`role-management` 的「權限註冊表更新後，租戶對系統角色的修改仍然保留」沒有測試，與 AUDIT 一致 |
| PLAN-08、PLAN-03 | 本機租戶沒有方案，天花板與 60 秒行程快取無法實測（不可改租戶方案）。`permission-check.test.ts` 的「不回傳方案天花板之外的權限碼」通過 |
| TEAM-01 | 確認（UAT 只讀） |
| AUTH-10 | 確認仍存在 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 成員列表 | 本機、UAT | 正常：本機列出啟用中的成員；UAT 5 位啟用、7 位停用 | — | agent 看得到列表與所有人的 email，沒有新增與編輯；主管有新增與編輯、沒有「已停用的人員」 | 分頁依舊列舉（HC-MEMBERS-06） |
| 2 新增成員 | 本機 | 正常：UI 建立自訂角色成員，重新整理仍在；未寄任何信（API log 無信件，符合 AUTH-01 的現況） | 重複 email：對話框顯示「Email 已被使用，請換一個電子信箱」；大小寫不同可建立（AUTH-10）；email 格式錯、密碼 7 字、姓名空白、角色 `OWNER` 都 400；不存在的 `roleId` 404；他租戶或不存在的渠道 400；指派自己看不到的渠道 403 | 指派 Admin 給別人 403 `ROLE_ESCALATION`；但 legacy `role` 可任意指定（HC-MEMBERS-03） | 方案 `maxAgents` 未驗（租戶無方案） |
| 3 改角色 | 本機 | 正常：UI 改成 Supervisor，重新整理一致；改角色後對方舊 token 維持舊權限，重新登入後才生效（符合 PERMISSIONS.md） | 改成比自己高的角色 403；把自己改成沒有 `role.manage` 的角色 422；不存在的成員 404；非 UUID 400 `DATABASE_ERROR`（HC-MEMBERS-08） | **異常**：主管可把管理員降級（HC-MEMBERS-01） | |
| 4 重設他人密碼 | 本機 | 正常：重設後以新密碼登入 | 移除角色的 `agent.password.reset` 後立即 403（快取即時失效） | **異常**：可以重設管理員密碼（HC-MEMBERS-02） | |
| 5 可使用的渠道 | 本機 | 正常：`GET` 回直綁清單，`PUT` 整組替換 | 他租戶或不存在的渠道 400；主管（無 `channel.assign_team`）403、編輯對話框不顯示渠道區塊 | — | **異常**：替換後層級一律 `full`（HC-MEMBERS-04） |
| 6 停用 | 本機 | 正常：UI 停用（確認框文字正確），成員移到「已停用的人員」；登入回 `ACCOUNT_DISABLED`；同 email 建立 409 | 停用自己 422 `SELF_ACTION_FORBIDDEN`（自己的編輯對話框也不顯示停用、刪除）；不存在的成員 404 | 主管 403；自訂角色可停用管理員（HC-MEMBERS-02） | 停用後舊 access token 仍可呼叫 API（文件已載明） |
| 7 重新啟用 | 本機、UAT | 正常：重新啟用後原密碼登入成功 | 對啟用中成員重複呼叫仍 204 並寫稽核（HC-MEMBERS-10） | 主管 `GET /agents/inactive` 403 | UAT 只確認區塊顯示 |
| 8 永久刪除 | 本機 | 正常：成員有一筆通知時刪除 204，通知一併刪除；同 email 可再建立（201）；稽核 `agent.purge` | 刪除自己 422 | 主管 403 | 最後一位管理員保護未實測（不動 seed 管理員），以 feature 測試為準 |
| 9 改自己的密碼 | 本機 | 正常：改後新密碼登入，再改回 | 目前密碼錯 400「目前密碼不正確」（UI 顯示正確）；新密碼 5 字 400 | 只驗登入 | 72 bytes 截斷（HC-MEMBERS-05）；不寫稽核（HC-MEMBERS-09） |
| 10 角色列表與權限矩陣 | 本機、UAT | 正常：本機與 UAT 都有 62 個權限碼；admin 角色的「管理角色權限」標「內建鎖定」且勾選框停用 | — | agent 開角色頁顯示「你沒有查看此設定的權限。」、側欄沒有入口；主管看得到唯讀頁（沒有「新增角色」，勾選框停用） | |
| 11 設定角色權限 | 本機 | 正常：UI 勾「檢視成員」→ 儲存 →「已儲存」→ 重新整理一致；勾「刪除成員」時自動勾起前置的「檢視成員」並標「自動開啟」 | 授予自己沒有的 `agent.purge`：UI 顯示「你本身沒有以下權限，無法授予: agent.purge」；缺前置 422 `DEPENDENCY_UNMET`；未知碼 422；移除自己角色的 `role.manage` 422 `SELF_LOCK` | 沒有 `role.manage` 時唯讀 | 權限移除後下一個請求即 403（Redis 快取有清） |
| 12 自訂角色建立、改名、刪除 | 本機 | 正常：UI 建立後自動選取新角色 | 同名（含前後空白）422 `DUPLICATE`；21 字 400「最多 20 個字」；只有空白 422；使用中 409 並列出姓名；系統角色刪除 403；不存在 404 | — | |
| 13 登入 | 本機 | 部分：密碼登入、停用帳號被擋 | — | — | Passkey 需要實體驗證器，未驗；帳號鎖定與速率限制以 unit 測試為準（實測會讓共用環境的其他代理被 429） |

權限測試用的角色：admin、seed 的 supervisor 與 agent（只讀，不改它們的角色或密碼），以及本機自建的自訂角色「hc-members-指派者」（`agent.view, agent.manage, agent.role.assign`）、「hc-members-重設者」（`agent.view, agent.password.reset`）、「hc-members-管角色」（`role.view, role.manage, agent.view`）、「hc-members-停用者」（`agent.view, agent.deactivate, agent.purge`）。被操作的對象都是自建的 hc-members- 成員。測試結束後全部永久刪除，自訂角色也已刪除；seed 帳號與系統角色沒有改動。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試；「找不到同名測試」不等於沒有測試。

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| agent-lifecycle | 3 | 15 | 0 | 0 | 有 |
| agent-management | 4 | 14 | 0 | 0 | 有 |
| role-management | 10 | 25 | 1：「權限註冊表更新後，租戶對系統角色的修改仍然保留」 | 1（RBAC-05） | 系統角色改名沒有入口 |
| role-settings-page | 6 | 25 | 0 | 0 | 有 |
| permission-model | 7 | 18 | 0 | 0 | 系統行為 |
| permission-check | 7 | 20 | 0 | 0 | 側欄依權限顯示 |
| rbac | 3 | 9 | 3：CLI token 相關三條 | 3（RBAC-02） | — |
| channel-team-access | 3 | 14 | 6：進站分流 4 條、建立渠道指定預設團隊 2 條 | 6（TEAM-01） | 渠道管理頁的團隊授權有入口，但沒有團隊可選 |
| auth-session | 16 | 43 | 25（登入、refresh、記住我、逾時重試、停用租戶等，多數有行為測試但名稱不同） | 未逐條核；「停用租戶的 socket 連線被中斷」見 AUTH-02 | 有 |

規格沒有涵蓋、本次發現的缺口：改角色、重設密碼、停用、刪除都不比較雙方的權限高低（HC-MEMBERS-01、02），`agent-lifecycle` 與 `role-management` 也沒有規定。建議補一條需求：「非 `admin` 系統角色的成員，不能對權限集合比自己大的成員改角色、重設密碼、停用或刪除；改角色同樣套用最後一位管理員保護」。

**有後端、沒有前端入口**：系統角色改名（`PATCH /roles/:id`）；直綁渠道的層級；團隊的建立與成員管理（後端也沒有，TEAM-01）；成員改姓名與 email（租戶端沒有端點）。

**前端送出的值與後端 Zod**：新增 `{name, email, password, role, roleId?, channelIds?}`、改角色 `{role}` 或 `{role, roleId}`、渠道 `{channelIds}`、權限 `{permissions}`、角色名稱 1–20 字，後端都接受。沒有發現前端送出、後端拒絕的值。反方向：後端接受前端不會送的 `{role:"ADMIN", roleId:<自訂角色>}`（HC-MEMBERS-03）。

## 待真機驗

- Passkey 註冊與登入（需要實體驗證器或瀏覽器虛擬驗證器）。
- 方案天花板與 `maxAgents`：本機租戶沒有方案，規定不可改租戶方案。可在有方案的測試租戶驗：方案不含 `marketing` 時角色頁仍勾得到 `marketing.*`（PLAN-08）、`/auth/me/permissions` 不含；人數到上限時新增與重新啟用回 403 `PLAN_LIMIT_EXCEEDED`。
- 多個 API 行程時，換方案後 60 秒內其他行程仍用舊方案（PLAN-03 第三點）。本機只有一個 API 行程。
- HC-MEMBERS-01 的「最後一位管理員被降級」：需要一個只有一位管理員的測試租戶。
- UAT 不邀請成員、不改權限，所有寫入流程只在本機驗。

## UAT 操作紀錄

只讀：以 admin 登入 Demo 租戶，`/auth/me` 確認 tenantId 後讀 `GET /agents`、`/agents/inactive`、`/roles`、`/roles/matrix`、`/auth/me/permissions`、`/channels/teams`，並開 `/dashboard/settings/agents` 與 `/dashboard/settings/roles` 兩頁（全程沒有送出 GET 以外的請求）。沒有建立任何資料，ledger 無紀錄。

## 建議新增到 AUDIT.md 的項目

- HC-MEMBERS-01（P1）：改成員角色不檢查對方權限高低、沒有最後一位管理員保護，主管預設就能讓租戶失去管理員。
- HC-MEMBERS-02（P2）：重設密碼、停用、刪除不檢查對方權限高低，`agent.password.reset` 等於管理員權限。
- HC-MEMBERS-03：併入 RBAC-03，補上「API 允許呼叫端任意指定 legacy `role`」。
- HC-MEMBERS-04（P2）：整組替換直綁渠道時層級一律升成 `full`。
- HC-MEMBERS-09：在 AUD-01 的表格補「改自己的密碼」。
- RBAC-01：權限碼數量更新為 62。

## 文件過時之處

- `docs/ref/features/tenant/MEMBERS.md`：
  - 「權限碼」一節的越權防護沒有說明「只比對目標角色，不比對被操作的成員」，「兩個動作都不能套用在最後一位管理員」應註明改角色不在此列（HC-MEMBERS-01）。
  - 「兩套角色欄位」只寫「指派自訂角色時 `role` 沿用原值」，沒寫建立成員時 `role` 由呼叫端決定（HC-MEMBERS-03）。
  - 「渠道與團隊」沒寫 `PUT /agents/:id/channels` 一律寫 `full`（HC-MEMBERS-04）。
  - 核對日期仍是 2026-09-30。
- `docs/ref/system/AUDIT.md` RBAC-01：「宣告 56 個權限碼」已變成 62 個。
- `apps/api/src/modules/agent/agent.routes.ts:36` 與 `AgentManagement.tsx` 的註解仍引用已從 AUDIT 移除的 AUTH-09。
- 手冊 `apps/web/public/manual/ch16-team.html`：
  - 第 5 節「主管也可以編輯人員。只改密碼或渠道、沒動角色時…可以直接儲存」：主管預設沒有 `agent.password.reset` 與 `channel.assign_team`，編輯對話框裡看不到這兩個欄位。
  - 第 5 節「公司最後一位管理員不能被停用或刪除」正確，但沒有提醒改角色不受這個保護；第 2 節表格「幫人換角色：主管可以（只能給不高於自己的角色）」沒有提醒主管可以把管理員降級。
