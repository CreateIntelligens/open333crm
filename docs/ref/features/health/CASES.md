# 工單 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認），UAT 只讀
- 規格：`docs/ref/features/feature-map.json` 的 `cases`；功能文件 `docs/ref/features/tenant/CASES.md`
- SLA 的計時、預警與逾時處置屬於 `sla` 領域，這裡只記與工單的牽連

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 3 份 spec、14 個 requirement、43 個 scenario。與程式**矛盾** 2 個：`case-management`「Cases Dashboard Create Button Hidden」（規格要求列表頁不可有建立按鈕，`112cde53` 已加上「新增工單」），以及「Case Status Transition Validation」（客服記錄 CSAT 會把任何狀態的工單直接改成 `CLOSED`，HC-CASES-01）。找不到同名測試 18 個（集中在 `case-management` 的刪除、狀態轉換、對話連結、列表刪除與權限情境；權限情境由 `route-permission-guards.test.ts` 以表格涵蓋，只是沒有照 scenario 命名）。缺前端入口 1 個（連結對話到既有工單） |
| 自動測試 | unit：api 12 檔 59 通過、web 8 檔 21 通過、workers 1 檔 11 通過。feature：`test:feature modules/case modules/csat` 5 檔 24 通過。無失敗、無 skip、無 `test.fail` |
| 實際操作 | 11 條流程。正常 3，異常 7，待真機驗 1 |

## 問題清單（依嚴重度）

P0、P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-CASES-01 | P2 | 客服記錄滿意度（`POST /cases/:id/csat`，收件匣 CSAT 卡片的星星）不檢查工單狀態，直接把工單改成 `CLOSED`：不經狀態機、不寫時間軸、不關閉對話。同時把「感謝評分」追蹤訊息送給顧客，2 分以下送「我們會立即安排主管為您跟進處理」，但顧客根本沒評分 | **實測**（本機）：從對話建工單 → 指派（`IN_PROGRESS`）→ `POST /cases/:id/csat {score:2}` 回 200；工單變 `CLOSED`、`csatScore=2`，`case_events` 只有 created／assigned／status_changed，對話仍是 `BOT_HANDLED`，對話多一則「非常抱歉讓您感到不滿意…」，Supervisor 收到 `csat_low_score`。收件匣裡問卷卡片的 5 顆星對客服是可點的（已解決的工單） | `apps/api/src/modules/csat/csat.service.ts:211`、`:315-322`；`apps/api/src/modules/case/case.routes.ts:342`；`apps/web/src/components/inbox/CsatMessage.tsx:29` | 新（違反 `case-management`「Case Status Transition Validation」） |
| HC-CASES-02 | P2 | 工單重開後再解決，若第一次的問卷已寄出超過 72 小時，問卷逾時結案的排程在 1 分鐘內就把工單改成 `CLOSED`，並關閉工單底下所有對話（包括正在進行的對話）。也不會寄第二份問卷：`csatSentAt` 在重開時沒有清掉 | **實測**（本機）：工單解決 → 以 SQL 把 `csatSentAt` 設為 80 小時前（模擬問卷早已寄出）→ `PATCH status=IN_PROGRESS` → `POST /resolve`（05:06:45）→ 05:07:43 工單已是 `CLOSED` | `apps/api/src/modules/csat/csat.scheduler.ts:65-90`（只看 `csatSentAt` 是否逾時）；`apps/api/src/modules/case/case.service.ts:487`（轉換時不重設 `csatSentAt`／`resolvedAt`） | 新 |
| HC-CASES-03 | P2 | 連結對話到工單（`POST /cases/:id/conversations/:conversationId/link`）不檢查對話的聯絡人，也不檢查對話所屬渠道的可見範圍。只能看 LINE-A 的成員可以把 WebChat 的對話掛到 LINE-A 的工單；別的顧客的對話也能掛上。之後 CSAT 問卷寄到 `conversations[0]`（沒有排序），逾時結案會關閉所有掛上的對話 | **實測**（本機）：王小明的工單連結陳美玲的 LINE 對話與另一位顧客的 FB 對話，都回 200；只有 LINE-A 權限、`case.update` 的自訂角色把看不到的 WebChat 對話掛上，回 200，之後 `GET /cases/:id` 的 `conversations` 列出那則 WebChat 對話。問卷實際寄到 LINE-B 的對話（工單渠道是 LINE-A） | `apps/api/src/modules/case/case.service.ts:698-720`；`case.routes.ts:326-339`（只檢查工單的渠道）；`csat.service.ts:85-88`、`csat.scheduler.ts:33-37` | 新（與 RBAC-04 同類） |
| HC-CASES-04 | P2 | 手動指派（`/assign`、`PATCH assigneeId`、建立時帶 `assigneeId`、升級時改派）不檢查負責人看不看得到工單的渠道。被指派的人收到通知，點進去 404，工單也不在他的列表。自動指派有這個檢查，手動沒有。負責人下拉列出租戶全部成員 | **實測**（本機）：把 LINE-A 的工單指派給沒有任何渠道授權的成員 → 200；該成員收到「工單已指派給您」，`GET /cases/:id` 404，`GET /cases?assigneeId=<自己>` 0 筆 | `apps/api/src/modules/case/case.service.ts:374-400`；`apps/web/src/components/case/CaseDetail.tsx:269-277` | 新 |
| HC-CASES-05 | P2 | 建立工單（`POST /cases`、從對話建立）不驗證 `assigneeId`、`teamId` 是否屬於本租戶或啟用中，直接以外鍵寫入；`PATCH /cases/:id` 以 `connect` 寫入也不檢查。只有 `/assign` 與升級有檢查。PostgreSQL 的外鍵檢查不受 RLS 限制，正式環境同樣寫得進去 | **實測**：本機建立暫時租戶與停用成員 → `POST /cases {assigneeId:<他租戶成員>}` 201，回應的 `assignee.name` 是他租戶成員；`PATCH` 同樣 200；`POST /assign` 404。另以 `SET ROLE app_tenant` 在交易內插入同樣的工單成功（已 rollback）。PATCH 在正式環境的 RLS 下是否被擋未驗 | `apps/api/src/modules/case/case.service.ts:302-303`、`:867-870` | 新 |
| HC-CASES-06 | P2 | 工單詳情與建立視窗的「團隊」下拉永遠只有「未指定／不指定」：前端讀 `agent.team`、`agent.teamId`，`GET /agents` 回的是 `teams[].team`。自動指派只在「有團隊、沒負責人」時觸發，因此畫面上無法觸發輪流指派。建立視窗選了負責人也不會自動帶入團隊 | **實測**：本機建團隊並加入 3 位成員，`GET /agents` 回 `teams:[{team:{…}}]`、`team: undefined`；兩個下拉都只有一個選項（UAT 也只有「未指定」）。以 API 帶 `teamId` 建立 3 張工單，自動指派正常輪流（rr1、rr2、rr1），沒有渠道授權的成員被排除 | `apps/web/src/components/case/CaseDetail.tsx:102-106`；`CaseCreateModal.tsx:154-161`；`apps/api/src/modules/agent/agent.service.ts:438` | 新（團隊本身無法建立見 TEAM-01） |
| HC-CASES-07 | P2 | 建立工單時帶負責人：不發 `case.assigned`（負責人收不到通知），狀態也維持 `OPEN`（之後用 `/assign` 指派才會變 `IN_PROGRESS`）。建立視窗把「指派給」放在表單裡，這是常見的指派方式 | **實測**（本機）：`POST /cases {assigneeId:rr2}` → 201、`status: OPEN`，rr2 沒有新的通知 | `apps/api/src/modules/case/case.flow.ts:73-98`（`afterCaseCreated` 只在沒有負責人時處理）；`case.service.ts:295-303` | 新（功能文件已寫，AUDIT 沒有） |
| HC-CASES-08 | P2 | `GET /cases/:id` 回傳聯絡人的全部渠道身分（含 uid、暱稱），不依可見範圍過濾；`GET /contacts/:id` 已過濾。工單的 `conversations` 也列出看不到的渠道的對話 | **實測**（本機）：只能看 LINE-A 的成員讀 LINE-A 工單，`contact.channelIdentities` 含 LINE-B 的 `Ubbb0001`；同一人讀 `GET /contacts/:id` 只有 LINE-A | `apps/api/src/modules/case/case.service.ts:150-157`、`:212-219` | RBAC-04（工單詳情這條路徑是新的） |
| HC-CASES-09 | P2 | 失敗沒有提示：詳情頁改負責人失敗（例如沒有 `case.assign`）時 `handleAssign` 沒有 catch，畫面不提示、下拉回到原值；新增備註失敗只寫 console，輸入框內容保留、沒有訊息 | **實測**（本機，自訂角色只有 `case.view/create/update`）：負責人下拉選一個人 → 沒有任何對話框，重新讀取後仍是空白；唯讀角色按「新增備註」→ 沒有訊息，textarea 內容還在 | `apps/web/src/components/case/CaseDetail.tsx:161-168`；`CaseTimeline.tsx:135-150` | 新 |
| HC-CASES-10 | P2 | 工單頁不依權限隱藏任何操作：「新增工單」、刪除垃圾桶、「關閉案件」、狀態／優先級／分類／負責人／團隊下拉、備註輸入都對唯讀角色顯示，按下才 403 | **實測**（本機，自訂角色只有 `case.view` 等檢視權限）：列表有「新增工單」與 10 個刪除鈕，詳情有「關閉案件」，6 個下拉都可操作；改優先級跳出「權限不足」 | `apps/web/src/app/dashboard/cases/page.tsx:126`；`apps/web/src/components/case/CaseList.tsx:144-161`；`apps/web/src/app/dashboard/cases/[caseId]/page.tsx:128-155`；`CaseDetail.tsx:224-296` | 新（與 HC-CONTACTS-06、07 同類） |
| HC-CASES-11 | P2 | 詳情頁 SLA「首次回應：已達／未達」以時間軸上第一個客服事件判斷（指派、改狀態都算），不讀後端的 `firstResponseAt`。客服還沒回覆顧客，只要先指派，就顯示「已達」 | 讀程式。後端以 `markCaseFirstResponse()` 寫 `firstResponseAt`（客服在關聯對話送出訊息時），前端沒有使用 | `apps/web/src/components/case/CaseDetail.tsx:118-129` | 新 |
| RBAC-04 | P2 | `GET /cases/stats` 與列表頁的狀態分頁計數統計全租戶，不套渠道可見範圍 | **實測**（本機）：沒有任何渠道授權的成員，`GET /cases` 0 筆，`GET /cases/stats` 回 `openCount: 2`、`statusCounts` 含全租戶 | `apps/api/src/modules/case/case.service.ts:773-820` | RBAC-04（已記錄） |
| CASE-02 | P2 | 非 LINE 渠道的滿意度問卷無法回覆 | 讀程式，與 AUDIT 描述一致 | `apps/api/src/modules/csat/csat.service.ts:169-176` | CASE-02（已記錄） |
| SLA-05 | P2 | 沒有關聯對話的工單沒有首次回應時間 | 讀程式，與 AUDIT 描述一致。列表頁建立的工單都屬於這種 | — | SLA-05（已記錄） |
| RBAC-03 | P3 | 自動指派只挑 `role` 為 `AGENT` 的成員；CSAT 低分只通知 `SUPERVISOR`，不含 `ADMIN` | **實測**：自動指派的候選人不含 Supervisor；CSAT 2 分只有 Supervisor 收到通知 | `assignment.service.ts:28-32`；`csat.service.ts:296` | RBAC-03（已記錄，AUDIT 列 P2） |
| HC-CASES-12 | P3 | `case-management` 規格「Cases Dashboard Create Button Hidden」要求列表頁不顯示建立按鈕，`112cde53`（2026-09-23）刻意加上「新增工單」，功能文件與手冊也已改寫成有這個入口。規格沒有更新 | 讀規格與 `git log -S` | `openspec/specs/case-management/spec.md`（Cases Dashboard Create Button Hidden）；`apps/web/src/app/dashboard/cases/page.tsx:126-129` | 新（規格過時） |
| HC-CASES-13 | P3 | 收件匣對話已經有工單時，聯絡人面板仍顯示「建立工單」，送出才收到 409「這則對話已建立過案件」。對話還沒關閉時，面板也沒有顯示或連到既有工單 | **實測**（本機）：對話已建工單 → 面板沒有工單資訊 → 建立視窗送出 → 錯誤「這則對話已建立過案件」 | `apps/web/src/components/inbox/ContactInfoPanel.tsx:185`（只在對話已關閉時顯示工單）、`:319-326` | 新 |
| HC-CASES-14 | P3 | SLA 倒數不看工單狀態：已關閉、已解決的工單在列表與詳情顯示紅色「逾期 13 天」 | **實測**（UAT Demo）：3 張已關閉的工單 SLA 欄顯示「逾期 11～13 天」，詳情頁同樣 | `apps/web/src/components/shared/SlaCountdown.tsx`；`CaseList.tsx:139`；`CaseDetail.tsx:327` | 新 |
| HC-CASES-15 | P3 | 「即將到期」有三種門檻：列表篩選與統計卡寫死 30 分鐘、倒數元件寫死 120 分鐘（橘色），SLA 政策的 `warningBeforeMinutes` 兩邊都不讀 | 讀程式；本機建立政策時 `warningBeforeMinutes` 預設 30 | `case.service.ts:67`、`:777`；`SlaCountdown.tsx:53` | 新 |
| HC-CASES-16 | P3 | 刪除與升級失敗只顯示「刪除工單失敗」「升級失敗」：讀 `response.data.message`，後端錯誤在 `error.message`。其他地方已改用 `getApiErrorMessage` | **實測**（本機，沒有 `case.delete` 的角色）：按刪除 → 「刪除工單失敗」，實際是 403 權限不足 | `apps/web/src/app/dashboard/cases/page.tsx:99-100`；`EscalationModal.tsx:123-124` | 新 |
| HC-CASES-17 | P3 | CSAT 低分通知的連結是 `/dashboard/cases?id=<工單>`，列表頁不讀 `id`，點了只到列表 | **實測**：通知的 `clickUrl` 為 `/dashboard/cases?id=211f…`；`cases/page.tsx` 沒有讀查詢參數 | `apps/api/src/modules/csat/csat.service.ts:306` | 新 |
| HC-CASES-18 | P3 | 非 UUID 的工單 id（`GET /cases/abc`）回 400 `DATABASE_ERROR`「資料處理失敗」，不是欄位驗證錯誤 | **實測**：本機與 UAT 相同 | `apps/api/src/modules/case/case.routes.ts:197` 起各 `/:id` 路由 | 新（與 HC-CONTACTS-13 同類） |
| HC-CASES-19 | P3 | 統計卡「今日解決」以 API 行程的時區切日（`new Date(年, 月, 日)`）；容器是 UTC 時，台灣早上 8 點前解決的算到前一天 | 讀程式 | `apps/api/src/modules/case/case.service.ts:776` | ANA-01 同類 |
| HC-CASES-20 | P3 | 刪除工單的稽核只記 `targetId`，沒有標題、聯絡人或狀態。工單是硬刪除，事後無法知道刪了什麼 | **實測**：`tenant_audit_logs` 只有 action、targetType、targetId、actorId | `apps/api/src/modules/case/case.flow.ts:195-201` | 新（AUD-01 範圍內） |
| HC-CASES-21 | P3 | 時間軸的備註作者一律顯示「客服」：`getCase` 的 `notes` 沒帶作者 | **實測**：admin 新增的備註顯示「客服 內部」 | `case.service.ts:209-211`；`CaseTimeline.tsx:172` | 新 |
| HC-CASES-22 | P3 | 只要有分類就顯示「AI 自動分類」，人工選的也一樣。AI 只替沒有分類的工單分類，而建立視窗的分類是必填，所以畫面建立的工單從來不是 AI 分的 | **實測**：建立時選「退換貨」，詳情頁顯示「AI 自動分類」 | `CaseDetail.tsx:259-261` | 新（手冊已註明） |
| HC-CASES-23 | P3 | 列表搜尋只過濾目前這一頁的 20 筆，分頁文字仍顯示全部筆數；SLA 篩選「正常」不過濾 | **實測**：搜尋「rr-3」剩 1 列，分頁仍顯示「共 11 筆」；讀程式確認 `normal` 不加條件 | `apps/web/src/app/dashboard/cases/page.tsx:66-76`；`case.service.ts:71` | 新（手冊已註明） |
| HC-CASES-24 | P3 | 升級通知送給所有主管與管理員，不看他們能不能看到這個渠道；看不到的人點通知是 404 | **實測**：Supervisor 只有另一個 WebChat 渠道，LINE-A 工單升級時仍收到「工單已升級」 | `apps/api/src/modules/notification/notification.service.ts`（`resolveEscalationRecipients`） | 新（規格 `case-management`「Escalation Notifies The Selected Targets」本來就這樣寫，屬產品決策） |
| HC-CASES-25 | P3 | 功能文件與手冊過時，見「文件過時之處」 | — | `docs/ref/features/tenant/CASES.md`；`apps/web/public/manual/ch02-cases.html` | 新（文件） |

### AUDIT 項目現況

| 項目 | 結論 |
| --- | --- |
| RBAC-04（`GET /cases/stats`） | 仍未修，實測確認。`POST /cases` 與從對話建立的渠道檢查（#281）實測正常：沒有授權的渠道回 404 |
| CASE-02 | 仍未修 |
| SLA-04 | 部分修正的部分實測正常：只剩已關閉工單的政策可以刪除（本機刪除成功）。工單仍以名稱記錄政策；讀程式：政策刪除後詳情頁仍顯示政策名稱，`slaPolicyData` 為 null、不顯示時限 |
| SLA-05 | 仍未修 |
| RBAC-03 | 仍未修，實測確認 |
| DB-04 | 仍未修：`mergedIntoId`、`parentCaseId`、`CaseRelation` 沒有讀寫 |
| AUTO-05 | `case.closed`、`case.assigned`、`case.updated`、`case.status_changed` 仍不會觸發自動化；CSAT 結案的 `case.closed` 走舊的 eventBus（最多一次） |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 列表、篩選、搜尋 | 本機、UAT | 正常：本機 11 筆、UAT 10 筆；狀態分頁、優先級篩選；`status=open` 小寫也接受 | `page=0` 400（訊息「不可小於 0」，同 HC-CONTACTS-18）；非 UUID 400 `DATABASE_ERROR`（HC-CASES-18） | 無渠道授權的成員列表 0 筆，統計卡仍是全租戶（RBAC-04） | **異常**：搜尋只限本頁（HC-CASES-23）；已關閉的工單顯示逾期（HC-CASES-14） |
| 2 列表頁新增工單 | 本機 | 正常：搜尋「王小明」→ 選聯絡人 → 兩個 LINE 渠道選一個 → 建立 → 導到詳情，重新整理一致 | 聯絡人不在渠道 400 `CONTACT_NOT_ON_CHANNEL`；空白標題 400；舊分類「維修」400；按鈕在必填未填時停用 | 沒有 `case.create` 403；只有建立權限帶負責人 403 `case.assign`。**按鈕不隱藏**（HC-CASES-10） | **異常**：團隊下拉只有「不指定」（HC-CASES-06）；帶負責人不通知（HC-CASES-07）；可帶他租戶成員（HC-CASES-05） |
| 3 從對話建立工單 | 本機 | 正常：`POST /conversations/:id/case` 201，對話掛上工單 | 已有工單的對話再建 409 | 看不到對話渠道 404（feature 測試涵蓋） | **異常**：面板仍顯示「建立工單」，送出才 409（HC-CASES-13） |
| 4 詳情就地編輯 | 本機、UAT（只讀） | 正常：改標題、優先級 `HIGH`，重新整理一致；狀態下拉只列合法轉換 | — | `PATCH` 帶負責人 403 `case.assign`、改成已升級 403 `case.escalate`，改標題 200。前端不隱藏，改優先級跳出「權限不足」 | **異常**：改負責人失敗無提示（HC-CASES-09）；SLA 首次回應判斷錯（HC-CASES-11）；「AI 自動分類」（HC-CASES-22） |
| 5 狀態轉換 | 本機 | 正常：OPEN →（指派）IN_PROGRESS → PENDING → IN_PROGRESS → RESOLVED；每次寫 `status_changed`；`case.resolved` 進 outbox | OPEN→RESOLVED、PENDING→RESOLVED、RESOLVED→OPEN（`/reopen`）都 422，訊息列出可改的狀態 | 唯讀角色看得到「關閉案件」（HC-CASES-10） | 頂部按鈕只在狀態機允許時出現，正常 |
| 6 指派 | 本機 | 正常：`/assign` 寫 assigned 與 status_changed，被指派者收到通知 | 他租戶成員 `/assign` 404 | 沒有 `case.assign` 403 | **異常**：可指派給看不到渠道的人（HC-CASES-04） |
| 7 自動指派（輪流） | 本機（API） | 正常：同團隊 2 位有 LINE-A 權限的 AGENT 輪流；沒有渠道授權的成員排除；回應是指派前的 OPEN，之後推播更新 | — | 候選人只看 `role=AGENT`（RBAC-03） | **異常**：畫面無法選團隊，觸發不了（HC-CASES-06）。團隊只能用 SQL 建（TEAM-01） |
| 8 升級 | 本機 | 正常：升級成 URGENT、改派，Supervisor 與原負責人收到通知，升級者自己不收 | 原因空白 400、`notifyTargets:["everyone"]` 400、缺 `newPriority` 400 | 沒有 `case.escalate` 403 | 失敗只顯示「升級失敗」（HC-CASES-16）；看不到渠道的主管也收到通知（HC-CASES-24） |
| 9 備註、標籤、時間軸 | 本機 | 正常：備註（內部／非內部）出現在時間軸；CASE 標籤貼上、移除；`/events` 列出事件 | 空白備註 400、5001 字 400；重複貼同一標籤 201（同 HC-CONTACTS-09） | 唯讀角色貼標、備註 403 | **異常**：備註失敗無提示（HC-CASES-09）、作者一律「客服」（HC-CASES-21） |
| 10 CSAT 問卷與結案 | 本機 | 正常：解決後約 5 分鐘寫入 `csatSentAt`、在對話建立問卷訊息；LINE 投遞因本機假憑證失敗，只寫 log，符合 `csat-survey` 規格 | — | 客服記錄評分需 `case.update` | **異常**：客服評分直接結案（HC-CASES-01）；重開後再解決 1 分鐘內被結案（HC-CASES-02）；問卷寄到哪個對話不固定（HC-CASES-03）；低分通知連結（HC-CASES-17） |
| 11 刪除 | 本機 | 正常：刪除後對話解除關聯、寫 `case.delete` 稽核；列表刷新 | — | 沒有 `case.delete` 403，但畫面只顯示「刪除工單失敗」（HC-CASES-16）；按鈕不隱藏 | 稽核內容太少（HC-CASES-20） |

權限測試用的角色：admin；本機自建「hc-cases-唯讀」（`case.view, inbox.view, contact.view, tag.view, agent.view`，直綁 LINE-A）、「hc-cases-編輯」（再加 `case.create, case.update, inbox.reply`，直綁 LINE-A）、沒有渠道授權的系統 Agent 角色成員。三個系統角色預設都有全部 6 個 `case.*` 權限，按鈕不隱藏只在自訂角色看得到。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試；找不到同名測試不等於沒有測試。

| Spec / Requirement | Scenario 數 | 實作 | 找不到同名測試 | 前端入口 |
| --- | --- | --- | --- | --- |
| case-management／Case Deletion API | 2 | 有（`case.service.ts` `deleteCase`） | 2（`case-flow-transaction.test.ts` 測刪除與稽核，名稱不同） | 列表垃圾桶 |
| case-management／Case Status Transition Validation | 2 | **部分**：公開的轉換路由都經 `validateTransition`，但 `POST /cases/:id/csat` 直接改 `CLOSED`（HC-CASES-01） | 2 | 頂部按鈕、狀態下拉 |
| case-management／Case Conversation Linking | 4 | 有，但不檢查聯絡人與對話渠道（HC-CASES-03） | 4（從對話建立有 `case-create-channel.test.ts`；連結既有工單、跨租戶連結沒有測試） | 「連結既有工單」**沒有前端入口** |
| case-management／Cases Dashboard Deletion | 3 | 有；失敗時只有通用訊息 | 3 | 有 |
| case-management／Cases Dashboard Create Button Hidden | 2 | **與程式矛盾**（HC-CASES-12） | 2 | — |
| case-management／工單路由依權限碼授權 | 6 | 有 | 5（`route-permission-guards.test.ts` 以表格涵蓋） | — |
| case-management／Escalation Notify Targets Are Validated | 2 | 有 | 0 | 有 |
| case-management／Escalation Notifies The Selected Targets | 7 | 有 | 0 | 有 |
| csat-survey（2 個 requirement） | 9 | 有 | 0 | 系統排程 |
| sla-policy-selection／建立工單時優先套用預設政策 | 2 | 有 | 0 | 「SLA 政策」下拉 |
| sla-policy-selection（其餘 3 個，屬 `sla` 領域） | 4 | 有 | 0 | SLA 設定頁 |

**有後端、沒有前端入口**：連結對話到既有工單（`POST /cases/:id/conversations/:conversationId/link`）；`PATCH /cases/:id` 的 `description`（詳情頁不能改描述）；`GET /cases/categories`（前端直接用 `@open333crm/shared` 常數）；`GET /cases/:id/events`（詳情頁用 `GET /cases/:id` 內含的 events）；`POST /cases/from-conversation/:id`（收件匣用的是 `POST /conversations/:id/case`，兩者行為相同）。前端 `useCases` 不監聽 socket `case.deleted`，別人刪除的工單要等 30 秒輪詢才消失。

**前端送出的值與後端 Zod**：優先級 `LOW|MEDIUM|HIGH|URGENT`、狀態 6 個列舉、分類來自 `CASE_CATEGORIES`（詳情頁另送空字串＝未分類，更新時接受）、升級 `notifyTargets` 只送 `supervisor`、`original_assignee`、`newPriority` 必送、取消指派送 `assigneeId: null`、團隊送 `teamId: <id>|null`、評分 `score` 1–5 整數。沒有發現前端送出、後端拒絕的值。

## 待真機驗

- LINE 渠道的 CSAT Flex 問卷送達、客人點分數後 postback `csat:<分數>:<工單 ID>` 被攔截寫入、回覆感謝訊息、工單結案（本機 LINE 憑證是假的，投遞必失敗）。
- FB／IG 渠道的問卷文字提示（CASE-02 預期客人無法回覆）。
- HC-CASES-05 的 `PATCH /cases/:id` 以 `connect` 寫入他租戶成員，在正式環境 `app_tenant` 連線下是否被 RLS 擋下（`POST /cases` 的外鍵寫入已在本機以 `app_tenant` 驗證可寫入）。

## UAT 操作紀錄

只讀：以 `admin@open333crm.dev` 登入，`/auth/me` 確認 Demo 租戶；讀 `/cases`、`/cases/stats`、`/cases/categories`、`/agents`，開列表頁與一張已關閉工單的詳情頁。沒有建立、修改或刪除任何資料。

本機建立的資料（名稱前綴 `hc-cases-`）：工單 10 張（已全部刪除，連結的對話已解除關聯，問卷與追蹤訊息已刪除）、CASE 標籤 1 個（已刪除）、團隊 1 個（已刪除）、SLA 政策 1 個（已刪除）、暫時租戶與停用成員各 1 筆（已刪除）。保留：自訂角色「hc-cases-唯讀」「hc-cases-編輯」與 5 位成員 `hc-cases-{ro,ed,rr1,rr2,noch}@example.com`（密碼 `HcCases1234!`），沒有改任何租戶設定。

## 建議新增到 AUDIT.md 的項目

- HC-CASES-01：客服記錄 CSAT 繞過狀態機直接結案，並對顧客送出評分追蹤訊息（違反 `case-management`「Case Status Transition Validation」）。
- HC-CASES-02：工單重開後再解決，問卷逾時結案的排程立即結案並關閉對話；重開不重設 `csatSentAt`。
- HC-CASES-03：連結對話到工單不檢查聯絡人與對話渠道的可見範圍；問卷寄到 `conversations[0]`。
- HC-CASES-04：手動指派不檢查負責人的渠道可見範圍。
- HC-CASES-05：建立與修改工單不驗證 `assigneeId`、`teamId` 屬於本租戶（外鍵不受 RLS 限制）。
- HC-CASES-06：團隊下拉讀錯欄位，自動指派在畫面上無法觸發（可併入 TEAM-01）。
- HC-CASES-07：建立時帶負責人不發 `case.assigned`、狀態不變。
- HC-CASES-08：`GET /cases/:id` 不依可見範圍過濾聯絡人的渠道身分與工單的對話（可併入 RBAC-04 的表格）。
- HC-CASES-09、HC-CASES-10：失敗無提示、操作不依權限隱藏。
- HC-CASES-11：詳情頁首次回應達標判斷不讀 `firstResponseAt`。

## 文件過時之處

- `openspec/specs/case-management/spec.md` 的「Cases Dashboard Create Button Hidden」與現況相反（HC-CASES-12），應以 change 改成 MODIFIED 或 REMOVED。
- `docs/ref/features/tenant/CASES.md`「升級」：寫「沒指定優先級時，自動提高一級」，但 `POST /cases/:id/escalate` 的 `newPriority` 是必填；自動提高只發生在 `PATCH status=ESCALATED`（畫面不會走這條，會改開升級視窗）。
- `docs/ref/features/tenant/CASES.md`「指派」：寫「被指派的成員必須屬於同一個租戶」，只對 `/assign` 與升級成立；建立與 `PATCH` 不檢查（HC-CASES-05）。也沒提到手動指派不看渠道可見範圍（HC-CASES-04）。
- `docs/ref/features/tenant/CASES.md`「解決之後」：沒提到客服記錄 CSAT 會直接結案（HC-CASES-01）。核對日期仍是 2026-09-30。
- `apps/web/public/manual/ch02-cases.html` 第 5 節寫「解決或關閉時會寄滿意度調查給顧客」：只有轉成「已解決」才寄，直接關閉不寄。第 7 節寫備註作者「目前都顯示為『Agent』」，畫面實際顯示「客服」。第 4 節寫「團隊：選了負責客服後會自動帶入」，實際永遠帶不出團隊（HC-CASES-06）。
