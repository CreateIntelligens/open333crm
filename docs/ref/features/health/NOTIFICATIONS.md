# 通知 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只讀）
- 規格：`docs/ref/features/feature-map.json` 的 `notifications`；功能文件 `docs/ref/features/tenant/NOTIFICATIONS.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 3 份 spec。`usage-quota-alerts` 18 個 scenario 全部有實作與同名測試；`standalone-worker-runtime` 中與通知有關的 6 個 requirement、15 個 scenario 都有實作，但「Notification Job Consumer」要求 workers 是**唯一**寫入通知的行程，CSAT 低分與權杖失效兩條路徑違反（HC-NOTIFICATIONS-09）；`email-delivery` 10 個 scenario 有實作與測試（`email-delivery.test.ts`），但都沒有以 scenario 命名。缺前端入口：無。兩邊都沒有：通知偏好／靜音、刪除通知、保留期限 |
| 自動測試 | unit：api 6 檔 44 通過（另跑 csat、meta-token-health 3 檔 25 通過）、workers 4 檔 13 通過、web 1 檔 1 通過，無失敗、無 skip。feature：`case-escalate-notify-targets`、`token-quota-alert`、`meta-token-health`、`csat` 4 檔 22 通過 |
| 實際操作 | 7 條前端流程與 10 條系統來源。前端：正常 5，異常 2。系統來源：實測 7（正常 3、異常 4），只讀程式或以測試為準 3 |

## 問題清單（依嚴重度）

P0、P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-NOTIFICATIONS-01 | P2 | 未指派對話的新訊息通知所有 `ADMIN`、`SUPERVISOR`，不看渠道可見範圍。只能看分店渠道的主管仍收到其他渠道客人的名稱（「某某 傳來新訊息」），點進去是 404 | **實測（本機）**：建自訂角色（`inbox.view, case.view, contact.view`，無 `channel.view_all`）＋成員 `role: SUPERVISOR`、只直綁 LINE-A → 模擬器對 WebChat 渠道送一則訊息 → 該成員收到 `new_message`「hc-notifications-分店外客人 傳來新訊息」；以他登入 `GET /conversations/<該對話>` 回 404 | `apps/api/src/modules/notification/notification.worker.ts:61-74, 217-236` | RBAC-04（已補列；收件人看舊列舉的部分見 RBAC-03） |
| HC-NOTIFICATIONS-02 | P2 | 對話指派給已停用的成員時，客人新訊息只通知那位停用的成員，沒有任何在職的人收到。停用成員不會解除指派 | **實測（本機）**：建成員 → 把對話指派給他 → `POST /agents/:id/deactivate` → 模擬器送訊息 → 唯一的 `new_message` 寫給 `isActive=false` 的成員，ADMIN、SUPERVISOR 都沒收到 | `notification.worker.ts:226-228`（不檢查 `isActive`）；`apps/api/src/modules/agent/agent.service.ts:376-396`（停用不解除指派）。`case.assigned`（`notification.worker.ts:88-96`）與 SLA（`apps/workers/src/handlers/sla.handler.ts:205`）同樣不檢查（讀程式） | CONV-06 |
| HC-NOTIFICATIONS-03 | P2 | 工單升級時在對話框改派負責人，新負責人收不到任何通知。升級只發 `case.escalated`，收件人只有主管與升級前負責人 | **實測（本機）**：工單指派給 supervisor → admin 升級並改派給 agent、勾兩個通知對象 → supervisor 收到 `case_escalated`；agent 沒有 `case_assigned` 也沒有 `case_escalated` | `apps/api/src/modules/case/case.flow.ts:145-155`（`escalateCaseFlow` 不發 `case.assigned`）；`apps/api/src/modules/notification/notification.service.ts:122-150` | CASE-09 |
| HC-NOTIFICATIONS-04 | P2 | 建立工單時直接選負責人，負責人收不到通知（功能文件「要知道的事」已寫，AUDIT 沒有） | **實測（本機）**：`POST /cases {assigneeId: agent}` → 201，agent 沒有任何 `case_assigned` | `case.flow.ts:83`（`afterCaseCreated` 有負責人時直接 return，只有自動派案發 `case.assigned`） | CASE-09（文件已知） |
| CONV-02 | P2 | 指派對話不會通知被指派的人 | **實測（本機）**：`PATCH /conversations/:id {assignedToId: agent}` → 200，5 秒內沒有任何通知寫入。AUDIT 原為「靜態確認」，本次執行時確認 | `notification.worker.ts:244-266`（訂閱存在、無發布端） | CONV-02（已記錄） |
| RBAC-03 | P2 | 收件人看 `Agent.role` 舊列舉 | **實測（本機）**：本機所有自訂角色的 `hc-*` 成員 `role` 都是 `AGENT`，未指派新訊息全部收不到；上面 HC-NOTIFICATIONS-01 的成員只因 `role: SUPERVISOR` 就收到 | `notification.worker.ts:61-74` 等 7 處 | RBAC-03（已記錄） |
| CONV-03 | P2 | 對話轉接真人時沒有通知 | 讀程式：`notification.worker.ts` 沒有訂閱 `conversation.handoff` | 同左 | CONV-03（已記錄） |
| HC-NOTIFICATIONS-05 | P3 | CSAT 低分通知的連結是 `/dashboard/cases?id=<工單>`，工單列表頁不讀 `id`，點了停在列表 | **實測（本機 UI）**：supervisor 點「CSAT 低分警報」→ 網址 `/dashboard/cases?id=…`，畫面是工單列表。手冊第 4 章已註明這個行為 | `apps/api/src/modules/csat/csat.service.ts:306`；`apps/web/src/app/dashboard/cases/page.tsx`（無 `useSearchParams`） | 新 |
| HC-NOTIFICATIONS-06 | P3 | 通知類型徽章缺 `csat_low_score`、`usage_quota_warning`、`usage_quota_critical`、`channel_token_invalid`、`data_export_ready`、`data_export_failed`、`data_erasure_done`，一律顯示「通知」；鈴鐺的圖示表連 `sla_rule` 也沒有 | **實測**：本機 CSAT 卡片徽章為「通知」；UAT Demo 第 1 頁 20 張卡片中 5 張權杖失效顯示「通知」 | `apps/web/src/app/dashboard/notifications/page.tsx:21-32`；`apps/web/src/components/notification/NotificationBell.tsx:10-19` | 新 |
| HC-NOTIFICATIONS-07 | P3 | 標記已讀、全部已讀失敗時畫面沒有任何提示，只丟出未處理的 `AxiosError`；點通知時已讀失敗也不會跳頁 | **實測（本機 UI）**：以 Playwright 讓 `PATCH /notifications/*/read` 回 500 → 按雙勾 → 畫面無任何錯誤文字，`pageerror: AxiosError: Request failed with status code 500` | `page.tsx:57-83`；`NotificationBell.tsx:47-67`（`await` 沒有 try/catch） | 新 |
| HC-NOTIFICATIONS-08 | P3 | 自動化「通知主管」在沒有工單的觸發（例如關鍵字）時，通知沒有連結；「傳送通知」同樣情況會連到對話 | **實測（本機）**：關鍵字規則同時設兩個動作 → 「傳送通知」`clickUrl=/dashboard/inbox?conv=…`，「通知主管」`clickUrl` 為空 | `apps/workers/src/lib/automation-actions.ts:450-461` | 新 |
| HC-NOTIFICATIONS-09 | P3 | CSAT 低分與 FB/IG 權杖失效在 API 行程直接寫入通知並推播（`createAndDispatch`），違反主規格「Notification Job Consumer」（workers 是唯一寫入者）。這兩條沒有重試、沒有去重；寫入失敗只記 log | 讀程式 | `csat.service.ts:300`；`apps/api/src/modules/channel/meta-token-health.ts:159`；`notification.service.ts:16-35` | 新 |
| HC-NOTIFICATIONS-10 | P3 | 非 UUID 的通知 id（`PATCH /notifications/abc/read`）回 400 `DATABASE_ERROR`「資料處理失敗」，不是欄位驗證錯誤 | **實測（本機、UAT）** | `apps/api/src/modules/notification/notification.routes.ts:51` | 新（同 HC-CONTACTS-13 的模式） |
| HC-NOTIFICATIONS-11 | P3 | 通知沒有保留期限也不能刪除。UAT Demo 租戶 admin 已累積 1,075 筆、未讀 89 筆、54 頁；未指派對話每則訊息對每位主管各寫一筆 | **實測（UAT 唯讀）**：`GET /notifications?limit=100` 的 `meta.total` | `notification.service.ts`（無刪除、無清理排程） | 新（功能文件「目前的限制」已寫） |
| HC-NOTIFICATIONS-12 | P3 | 升級的 Zod 仍接受 `notifyTargets: 'team'`，回 200 但沒有任何人收到「團隊」通知。這是為了相容 #261 前的舊頁面，但 API 直呼者無從得知它不生效 | **實測（本機）**：送 `['supervisor','original_assignee','team']` → 200，收件人與不送 `team` 相同；feature 測試 `case-escalate-notify-targets` 的「舊版對話框送出 team 不可被擋」守住這個相容 | `apps/api/src/modules/case/case.routes.ts:111-113` | 新（設計取捨，建議在 OpenAPI 標示 deprecated） |
| HC-NOTIFICATIONS-13 | P3 | 分頁 `page=0` 回 400，訊息是「不可小於 0」 | 本機 `GET /notifications?page=0` | 全域 Zod 錯誤訊息 | 同 HC-CONTACTS-18 |

### 已知 AUDIT 項目的現況

| AUDIT | 結論 |
| --- | --- |
| CONV-02 | 未修。本次執行時確認（見上表）。手冊第 4 章「誰會收到」寫「對話指派給某人 → 被指派的那個人」，與實際不符 |
| CONV-03 | 未修（讀程式） |
| RBAC-03 | 未修，執行時確認 |
| APP-04、APP-05 | 未變（讀程式）：`notification.worker.ts` 仍是 producer；`sla.warning`／`sla.breached` 訂閱仍沒有發布端 |
| EXPORT-01 | 通知連結的部分未修：`data-export.handler.ts:220-226` 仍連到 `/dashboard/settings/data-export/<id>`，前端被 `settings/[section]` 吃掉、顯示「一般設定」 |
| PLAN-13 | 未驗（需要在本機觸發平台金鑰的 AI 呼叫並換方案） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 鈴鐺未讀數 | 本機、UAT | 正常：agent 頁面開著時模擬器送訊息，8 秒內鈴鐺 0 → 1，不用重新整理；UAT 顯示 89 | 未登入 401 | 無權限碼；admin、supervisor、agent 各自只看到自己的數字 | |
| 2 鈴鐺下拉 | 本機、UAT | 正常：最新 10 則，UAT 也是 10 則 | — | 同上 | 圖示缺多種類型（HC-NOTIFICATIONS-06） |
| 3 點一則通知 | 本機 | 正常：新訊息通知點擊後到 `/dashboard/inbox?conv=…`，鈴鐺歸 0 | **異常**：已讀失敗時無提示也不跳頁（HC-NOTIFICATIONS-07）；CSAT 只到列表（HC-NOTIFICATIONS-05）；權杖、匯出的連結見上表 | admin 對 supervisor 的通知 `PATCH` → 404 | |
| 4 通知列表 | 本機、UAT | 正常：全部／未讀／已讀切換，分頁「第 1 / 54 頁」（UAT） | `isRead=foo` 400、`limit=101` 400、`page=0` 400（HC-NOTIFICATIONS-13） | 同上 | |
| 5 單筆標記已讀 | 本機 | 正常：未讀卡片 3 → 2，已讀分頁出現該卡 | **異常**：API 500 時無提示（HC-NOTIFICATIONS-07）；非 UUID id 400 `DATABASE_ERROR`（HC-NOTIFICATIONS-10） | — | |
| 6 全部已讀 | 本機 | 正常：agent 帳號未讀歸 0，重新整理後仍為 0，顯示「沒有未讀通知」 | — | 只影響自己的通知 | UAT 未按（會改 Demo admin 的資料） |
| 7 即時推播 | 本機 | 正常（同流程 1） | 推播失敗只記 log（`notification.handler.test.ts` 覆蓋） | — | |
| 系統：新訊息 | 本機 | 正常：未指派 → admin、supervisor 各一則；指派 agent 後 → 只有 agent | **異常**：負責人停用後只寫給停用者（HC-NOTIFICATIONS-02）；不看渠道可見範圍（HC-NOTIFICATIONS-01） | 收件人看 `role`（RBAC-03） | 本機以模擬器送 WebChat 訊息 |
| 系統：工單指派 | 本機 | 正常：`/cases/:id/assign` → supervisor 收到 `case_assigned`，連到工單詳情 | **異常**：建立時指定負責人不通知（HC-NOTIFICATIONS-04） | — | |
| 系統：工單升級 | 本機 | 正常：勾兩個對象 → 主管與原負責人收到、升級的 admin 自己沒收到 | **異常**：改派的新負責人沒收到（HC-NOTIFICATIONS-03）；`team` 靜默接受（HC-NOTIFICATIONS-12） | — | |
| 系統：CSAT 低分 | 本機 | 正常：`POST /cases/:id/csat {score:1}` → 只有 supervisor 收到，admin 沒有（符合文件） | 連結到列表（HC-NOTIFICATIONS-05） | 只看 `SUPERVISOR` | |
| 系統：自動化通知 | 本機 | 正常：關鍵字規則「傳送通知」→ 對話負責人 agent；「通知主管」→ admin、supervisor | 「通知主管」沒有連結（HC-NOTIFICATIONS-08） | — | 規則已刪除 |
| 系統：指派對話 | 本機 | **異常**：不通知（CONV-02） | — | — | |
| 系統：AI 用量告警 | — | 以測試為準：unit `usage-quota-alert.test.ts` 與 feature `token-quota-alert.test.ts` 全過，18 個 scenario 都有同名測試 | — | 只看 `ADMIN` | 本機沒有觸發真實 AI 呼叫，信件未在 log 驗證 |
| 系統：權杖失效 | UAT（唯讀） | 正常：Demo 租戶 IG333 權杖失效通知存在，17 分鐘前與 3 天前各一則，符合「持續失效每 3 天再提醒」 | 徽章顯示「通知」（HC-NOTIFICATIONS-06） | 只看 `ADMIN` | 本機另有一則 `健檢 FB` 的權杖失效通知 |
| 系統：SLA、資料匯出／刪除 | — | 讀程式＋測試（SLA 屬 `sla` 領域；匯出連結見 EXPORT-01） | — | — | |

權限測試用的角色：admin、supervisor、agent（seed），本機自建「hc-notif-分店主管」角色與成員（測完已刪）。通知路由只驗登入、沒有權限碼，三個角色行為相同；差異只在「誰會收到」，由 `Agent.role` 決定。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試。

| Spec / Requirement | Scenario 數 | 找不到同名測試 | 實作 | 前端入口 |
| --- | --- | --- | --- | --- |
| usage-quota-alerts（6 個 requirement） | 18 | 0 | 全部有：`llm.service.ts` 的累加與偵測、`notification.worker.ts:269-330`、`usage-alert-email.worker.ts`、`usage-alert-emails.ts`（HTML 轉義在 `:85-96`） | 站內通知；方案頁 |
| standalone-worker-runtime：Notification Job Consumer | 2 | 1（「Notification enqueued from API event bus」） | **部分**：主要路徑符合；CSAT、權杖失效在 API 行程直接寫入（HC-NOTIFICATIONS-09） | — |
| standalone-worker-runtime：Notification Job Handling | 3 | 0 | 有：`apps/workers/src/handlers/notification.handler.ts` | — |
| standalone-worker-runtime：同一個事件不重複建立站內通知 | 2 | 0 | 有：`enqueueDispatch` 的 job id | — |
| standalone-worker-runtime：Notification Job Retry | 3 | 0 | 有：兩個 producer 都設 3 次、指數退避 5 秒 | — |
| standalone-worker-runtime：Worker-Originated SLA Notification Dispatch | 5 | 5 | 有（屬 `sla` 領域，未逐條核） | — |
| email-delivery（5 個 requirement） | 10 | 10 | 有：`apps/api/src/modules/email/email.service.ts`（log／webhook／smtp／resend）；行為在 `email-delivery.test.ts`，未以 scenario 命名 | — |

**兩邊都沒有的功能**（使用者可能以為有）：通知偏好／依類型關閉、刪除通知、保留期限、瀏覽器推播、工單事件寄信。`docs/20_NOTIFICATION.md` 有設計，但沒有規格也沒有程式。手冊第 4 章已寫「通知目前不能刪除，也不能關掉某一類通知」。

**前端送出的值與後端 Zod**：`isRead` 只送 `'true'`／`'false'`；`page`、`limit`（10、20）在範圍內；升級對話框 `notifyTargets` 為 `supervisor`、`original_assignee` 的子集或 `[]`，後端接受（另接受 `team`）。沒有發現前端送出、後端拒絕的值。

## 待真機驗

- 真實 LINE／FB／IG 進站訊息觸發的新訊息通知（本機以模擬器代替，走同一個 `message.received`）。
- AI 用量告警的真實觸發與告警信內容（需要平台金鑰的 AI 呼叫與有上限的方案）；換方案後不重發（PLAN-13）。
- 權杖失效信的實際寄送（UAT 為 Resend 真寄，不可在 UAT 觸發）。
- SLA 預警與逾時通知（屬 `sla` 領域健檢）。

## UAT 操作紀錄

只讀：以 admin 登入、`/auth/me` 確認 Demo 租戶、讀 `GET /notifications`、`/unread-count`、開通知頁與鈴鐺截圖，另送 `PATCH /notifications/abc/read`（400，不改資料）。沒有建立、修改或刪除任何資料，也沒有按已讀。

本機建立並已清除：成員 `hc-notifications-off@example.com`、`hc-notifications-branch@example.com`（皆已以 `DELETE /agents/:id` 刪除，通知一併刪除）、角色「hc-notif-分店主管」（已刪除）、自動化規則「hc-notifications-通知規則」（已刪除）。保留：WebChat 測試聯絡人 `hc-notifications-客1`、`hc-notifications-分店外客人` 與其對話（系統沒有刪除聯絡人的 API）、工單「hc-notifications-工單1」（已因 CSAT 評分自動關閉）。對話 `8141a04a-…` 的指派已還原為未指派。

## 建議新增到 AUDIT.md 的項目

- HC-NOTIFICATIONS-01：新訊息通知不套渠道可見範圍，洩漏其他渠道的客人名稱。
- HC-NOTIFICATIONS-02：停用成員不解除指派，客人訊息只通知停用的人。
- HC-NOTIFICATIONS-03、HC-NOTIFICATIONS-04：升級改派與建立時指定負責人都不發 `case.assigned`（可併成一項「指派不經 `/assign` 時不通知」，和 CONV-02 同一類）。
- HC-NOTIFICATIONS-09：CSAT 與權杖失效繞過通知佇列，違反 `standalone-worker-runtime`。
- HC-NOTIFICATIONS-11：通知沒有保留期限（目前只在功能文件）。

## 文件過時之處

- `docs/ref/features/tenant/NOTIFICATIONS.md` 開頭與「目前的限制」寫「除了 AI 額度告警，都不寄信」：FB/IG 權杖失效也寄信給管理員（`meta-token-health.ts:162-167`）。
- 同一份文件的「哪些事件通知誰」與「下列來源不經過上面的流程」缺三種來源：`channel_token_invalid`（API 行程 `createAndDispatch`）、`data_export_ready`／`data_export_failed`、`data_erasure_done`（workers `enqueueNotification`）。
- 同一份文件沒提到自動化「通知主管」與「傳送通知」寫的類型是 `sla_rule`，以及新訊息通知不檢查負責人是否停用、不看渠道可見範圍。
- `apps/web/public/manual/ch04-notifications.html`「誰會收到哪些通知」寫「對話指派給某人 → 被指派的那個人（小標籤會顯示『新訊息』）」：實際不會通知（CONV-02）。
- `docs/20_NOTIFICATION.md` 描述的 Web Push、通知靜音設定、工單事件 email 都沒有實作，應標示為未實作的設計稿。
