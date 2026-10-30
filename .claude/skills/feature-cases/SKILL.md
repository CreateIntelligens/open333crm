---
name: feature-cases
description: >
  open333CRM「工單」功能顧問：工單（案件、case、ticket）建立（列表頁「新增工單」、收件匣「建立工單」從對話開單）、
  狀態轉換（開啟／處理中／待處理／已解決／已升級／已關閉、重新開啟、狀態機 VALID_CASE_TRANSITIONS）、
  指派與自動指派（round-robin 輪流派案、團隊）、升級（escalate、通知對象）、備註與時間軸、工單標籤、
  滿意度調查 CSAT（問卷排程、逾時自動結案、客人評分 postback、收件匣星星卡片）、工單與對話關聯、刪除工單。
  當需求、bug 或新功能碰到 /dashboard/cases、case 模組、csat 模組、assignment.service、Case、CaseEvent、
  CaseNote、case.created/assigned/escalated/resolved/closed 時使用。也在改 SLA 政策、渠道可見範圍、
  收件匣聯絡人面板、自動化「建立工單／指派客服」動作、通知前使用，確認不破壞工單。
---

# 工單

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/CASES.md`
  - 注意：「沒指定優先級時自動提高一級」只在 `PATCH status=ESCALATED` 成立，`POST /cases/:id/escalate` 的 `newPriority` 是必填。「被指派的成員必須屬於同一個租戶」只對 `/assign` 與升級成立，建立與 `PATCH` 不檢查（健檢 HC-CASES-05）。
- 健檢結果與已知問題：`docs/ref/features/health/CASES.md`
- 規格：`openspec/specs/case-management/spec.md`、`openspec/specs/csat-survey/spec.md`、`openspec/specs/sla-policy-selection/spec.md`
  - 注意：`case-management` 的「Cases Dashboard Create Button Hidden」已過時，列表頁從 `112cde53` 起有「新增工單」（HC-CASES-12）。
- SLA 計時、預警與逾時處置：`docs/ref/features/SLA.md`（`sla` 領域）
- 手冊：`apps/web/public/manual/ch02-cases.html`
- 影響分析：`node scripts/feature-impact.mjs --domain cases`

路由前綴：`/api/v1/cases`（`case.routes.ts`）；從對話開單另有 `POST /api/v1/conversations/:id/case`（`conversation.routes.ts`）。CSAT 沒有自己的路由，`POST /cases/:id/csat` 在 `case.routes.ts`。

## 前端操作流程

格式：入口 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 列表、篩選、搜尋 | `/dashboard/cases`：狀態分頁、負責人／優先級／分類／SLA 下拉、搜尋框 | `GET /cases?status&priority&category&assigneeId&slaStatus&sortBy=slaDueAt&page&limit=20` → `listCases`；統計卡與分頁計數 `GET /cases/stats` → `getCaseStats` | 無。搜尋在前端過濾**目前這一頁**；`slaStatus=normal` 不加條件；`warning` 寫死 30 分鐘 | `case.view`；列表依渠道可見範圍過濾，統計**不過濾**（RBAC-04） |
| 2 | 列表頁新增工單 | 「新增工單」→ `CaseCreateModal`（不帶 conversationId）：搜尋聯絡人（`GET /contacts?q&limit=10`）→ 選渠道（只列聯絡人有身分的可見渠道）→ 標題、分類必填 | `POST /cases` → `case.flow.ts` `createCaseFlow` → `createCase`（聯絡人不在渠道 400 `CONTACT_NOT_ON_CHANNEL`）→ `createCaseRecord` | 挑 SLA 政策算 `slaDueAt`、寫 `created` 事件、outbox `case.created`；commit 後另開交易做群發歸因與自動指派。帶負責人**不發** `case.assigned`、狀態維持 `OPEN` | `case.create`，帶負責人／團隊另需 `case.assign`；渠道需 `full` / **按鈕不隱藏** |
| 3 | 從對話建立 | 收件匣 `ContactInfoPanel`「建立工單」→ `CaseCreateModal`（帶 conversationId） | `POST /cases/from-conversation/:conversationId`（與 `POST /conversations/:id/case` 相同）→ `createCaseFromConversation` | 同交易建工單並寫 `conversation.caseId`；對話已有工單 409「這則對話已建立過案件」 | 同上；按鈕在已有工單的對話也顯示 |
| 4 | 詳情就地編輯 | `/dashboard/cases/[caseId]`：點標題、優先級／分類／團隊下拉 | `PATCH /cases/:id` → `updateCaseFlow` → `updateCase` | 只改欄位時推播 `case.updated`；改負責人（`null` 取消）不通知 | `case.update`；帶 `assigneeId`/`teamId` 另需 `case.assign`；渠道 `full` / **不隱藏** |
| 5 | 改狀態 | 頂部按鈕「標記解決／關閉案件／重新開啟／升級」（依 `canTransition` 顯示）；狀態下拉（選已關閉先確認、選已升級開升級視窗） | `POST /cases/:id/{resolve,close,reopen}` → `transitionCaseFlow`；下拉走 `PATCH {status}` → `updateCase` 轉交 `transitionCase`／`escalateCase` | 寫 `status_changed`；`RESOLVED` 寫 `resolvedAt` 並發 `case.resolved`，`CLOSED` 寫 `closedAt` 並發 `case.closed`。重開不清 `resolvedAt`、`closedAt`、`csatSentAt` | `case.update`（改成已升級需 `case.escalate`）/ 不隱藏 |
| 6 | 手動指派 | 詳情頁「負責人」下拉（列出全部成員，`GET /agents`） | `POST /cases/:id/assign {assigneeId}` → `assignCase` | `OPEN` 自動改 `IN_PROGRESS`；寫 `assigned`；outbox `case.assigned` → 站內通知。**不檢查負責人看不看得到渠道、是否停用**；下拉失敗沒有提示 | `case.assign`；渠道 `full` |
| 7 | 自動指派（輪流） | 建立時有 `teamId`、沒有 `assigneeId` | `assignment.service.ts` `autoAssignCase` → `getNextAgent` | 候選：團隊內 `role=AGENT`、啟用、直綁或團隊被授權工單渠道 `reply_only/full`；挑未結（OPEN/IN_PROGRESS/PENDING/ESCALATED）最少者，同數以行程記憶體輪流；寫 `auto_assigned`、`case.assigned`。**畫面的團隊下拉永遠是空的**（讀錯 `agent.team`，API 回 `teams[]`），所以目前只有 API、CLI 與自動化觸發得到 | — |
| 8 | 升級 | 「升級」→ `EscalationModal`：原因必填、升級後優先級、改派、通知對象 | `POST /cases/:id/escalate {reason, note?, newPriority, assigneeId?, notifyTargets}` → `escalateCase` | 狀態 `ESCALATED`、改優先級、寫 `escalated`；outbox `case.escalated` → `resolveEscalationRecipients`。改派的新負責人不另外通知 | `case.escalate`；渠道 `full` |
| 9 | 備註、標籤、時間軸 | 詳情右側「時間軸與備註」；「案件標籤」（`TagManager` targetType=CASE） | `POST /cases/:id/notes {content, isInternal}`；`POST/DELETE /cases/:id/tags`（`tag.flow.ts`）；時間軸由 `GET /cases/:id` 的 `events`+`notes` 合成 | 備註不送給客人，「內部」只是樣式；標籤 scope 必須是 CASE。備註失敗沒有提示，作者一律顯示「客服」 | `case.update`；渠道 `reply_only` 即可 |
| 10 | CSAT 問卷與結案 | 系統排程；收件匣 `ChatWindow` 的問卷卡片（`CsatMessage`，客服也能點星星） | 排程 `csat.scheduler.ts`：`csat-send`（解決 5 分鐘後，`sendCsatSurvey` 先認領 `csatSentAt` 再寄）、`csat-auto-close`（寄出 72 小時沒回覆就結案並關閉所有關聯對話）；客人 postback `csat:<分數>:<工單 ID>` → 進站攔截器 → `recordCsatScore`；客服 `POST /cases/:id/csat` | `recordCsatScore` 寫分數、送感謝訊息給顧客、2 分以下通知 `SUPERVISOR`、**不檢查狀態直接改 `CLOSED`**、發 eventBus `case.closed`（最多一次） | 客服評分 `case.update`、渠道 `full` |
| 11 | 刪除 | 列表最右「操作」垃圾桶（`window.confirm`） | `DELETE /cases/:id` → `deleteCaseFlow` | 硬刪除；事件、備註、標籤一併刪，對話解除關聯；同交易寫 `case.delete` 稽核；推播 `case.deleted`（列表不監聽，靠 30 秒輪詢） | `case.delete`；渠道 `full` / 不隱藏，失敗只顯示「刪除工單失敗」 |
| 12 | 連結既有工單（無 UI） | — | `POST /cases/:id/conversations/:conversationId/link` → `linkConversationToCase` | 寫 `conversation_linked`，補首次回應；**不檢查對話的聯絡人與渠道可見範圍** | `case.update`；只檢查工單的渠道 `full` |

**有後端、沒有前端入口**：連結對話到既有工單（流程 12）；修改 `description`；`GET /cases/categories`（前端用 `@open333crm/shared` 的 `CASE_CATEGORIES`）；`GET /cases/:id/events`；`/cases?sortBy=priority|createdAt`；工單合併、子工單（`mergedIntoId`、`parentCaseId`、`CaseRelation`，連後端都沒有，DB-04）。

**前端實際送出的值**：優先級 `LOW|MEDIUM|HIGH|URGENT`；狀態 `OPEN|IN_PROGRESS|PENDING|RESOLVED|ESCALATED|CLOSED`（列表篩選也送大寫，後端另接受小寫）；分類來自 `CASE_CATEGORIES`，詳情頁「未分類」送空字串；更新時另接受 `LEGACY_CASE_CATEGORIES`（維修／查詢／投訴），建立時不接受；升級 `notifyTargets` 只送 `supervisor`、`original_assignee`（後端另接受 `team`，不通知任何人）；取消指派送 `assigneeId: null`；CSAT `score` 1–5 整數。

## 不可破壞的規則
- 狀態轉換只有一張表：`packages/shared/src/constants/case-transitions.ts` 的 `VALID_CASE_TRANSITIONS`。API 的 `validateTransition`、詳情頁下拉、頂部按鈕都讀它。新增改狀態的路徑要經過 `transitionCase` 或 `escalateCase`，否則不寫時間軸、不發事件（`recordCsatScore` 目前就繞過了，HC-CASES-01）。
- 頂部按鈕與狀態下拉要有相同的副作用：`updateCase` 把狀態變更轉給 `transitionCase`／`escalateCase`，`updateCaseFlow` 依 `change.kind` 送相同的推播與事件（S06）。不要在 `updateCase` 裡直接寫 `status`。
- 推播在 commit 之後送出；事件與工單同交易寫 outbox（`case-effects.ts`）。自動指派與群發歸因在 commit 之後各開一個交易，失敗只記 log、不影響已建立的工單。
- 工單依 `channelId` 套用渠道可見範圍：讀 `read_only`、貼標與備註 `reply_only`、其他 `full`；看不到的工單回 404，不是 403。改路由時保留 `assertCaseChannelVisible`／`assertChannelVisible`／`assertConversationChannelVisible`。工單的渠道必須是聯絡人有身分的渠道（`CONTACT_NOT_ON_CHANNEL`）。
- 自動指派只派給看得到、能回覆該渠道的成員（fail-closed）。改 `getNextAgent` 不要拿掉這個條件；手動指派目前沒有這個檢查（HC-CASES-04）。
- 一個對話最多屬於一張工單，一張工單可以有多個對話。CSAT 問卷寄到 `conversations[0]`（沒有排序），逾時結案關閉所有關聯對話。
- CSAT 兩個排程都先以條件更新認領工單（`csatSentAt: null` / `csatRespondedAt: null` 且仍是 `RESOLVED`），是「最多一次」：寧可少寄，不重複寄（`csat-survey` 規格）。不要改成先寄再記。
- 刪除是硬刪除，稽核與刪除同一交易；稽核寫不進去時不可刪除（`tenant-audit-log` 規格）。
- 工單以**政策名稱**記錄 SLA 政策（SLA-04）；改優先級不重算期限。
- 權限碼集中在 `case.routes.ts` 的 `perm` 表；建立或修改時帶負責人／團隊要另查 `case.assign`（`case-permission.ts`，收件匣的從對話建單也用它），改成已升級要另查 `case.escalate`。新增權限點後既有租戶的系統角色不會自動拿到。
- 錯誤訊息用 `AppError(訊息, code, status)`；前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`），不要讀 `response.data.message`。
- UI 不放 emoji 與 ✓。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain cases` 看最新版本。重點：
- **依賴**：聯絡人（建立時搜尋、工單標籤 `TagManager`）、收件匣（從對話開單、首次回應由 `conversation.service.ts` 的 `sendMessage` 寫、CSAT 訊息寫進對話、結案關閉對話）、渠道（可見範圍、自動指派的候選條件）、SLA（挑政策、`slaDueAt`、workers 掃描）、成員（`GET /agents`、團隊、`Agent.role`）、通知（指派、升級、CSAT 低分）、治理（刪除稽核）、LINE（CSAT Flex 與 postback）。
- **被依賴**：收件匣（`ContactInfoPanel`、CSAT 卡片、進站 CSAT 攔截器）、自動化（`case.created`、`case.escalated`；workers 的「建立工單」「指派客服」動作直接寫 `Case`，見 `apps/workers/src/lib/automation-actions.ts`）、SLA（`apps/workers/src/handlers/sla.handler.ts` 寫 `CaseEvent`、提高優先級）、聯絡人（時間軸、合併搬 `Case`）、行銷（`trackBroadcastCase` 群發歸因）、數據分析（工單數、首次回應、CSAT）、AI（`apps/api/src/modules/ai/classify.service.ts` 替沒有分類的新工單分類）。

## 回歸清單
改到本領域時，至少重走：
1. 列表頁「新增工單」：選有兩個渠道的聯絡人 → 選渠道 → 建立 → 導到詳情；錯誤：聯絡人不在渠道、空白標題、舊分類。
2. 收件匣從對話建立工單 → 同一對話再建一次要 409。
3. 狀態：OPEN → 指派（自動變處理中）→ 待處理 → 處理中 → 標記解決 → 關閉 → 重新開啟；每一步時間軸都有事件，`case.resolved`／`case.closed` 進 outbox；不合法的轉換 422 並列出可改的狀態。
4. 升級：勾兩個通知對象，Supervisor 與原負責人各收到一則，升級者自己不收；`notifyTargets: ["everyone"]` 400。
5. 用 API 帶 `teamId` 建工單，確認輪流指派、沒有渠道授權的成員被排除。
6. CSAT：解決後 5 分鐘對話出現問卷；以 SQL 把 `csatSentAt` 調到 72 小時前，確認排程結案並關閉對話；重開工單後不被結案。
7. 用只有 `case.view` 的自訂角色與只能看部分渠道的成員重走 1–4，確認 403、404 與按鈕狀態。
- 自動測試：`pnpm --filter @open333crm/api test -- case csat assignment`；`pnpm --filter @open333crm/web test -- case escalation csat`；`pnpm --filter @open333crm/workers test -- create-case`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/case modules/csat`；權限表在 `apps/api/tests/feature/modules/route-permission-guards.test.ts`。
- E2E：`apps/web/tests/e2e-uat/tenant-cases.spec.ts`、`apps/web/tests/e2e-uat/tenant-fields-cases-contacts-inbox.spec.ts`。

## 常見 bug 從哪裡查
- 「工單自己變成已關閉」：先看 `case_events` 有沒有 `status_changed`。沒有的話是 CSAT：客人或客服評分（`csat.service.ts` 的 `recordCsatScore` 不寫事件）、或問卷逾時結案（`csat.scheduler.ts`，重開過的工單也會被結案，HC-CASES-02）。SLA 逾時只提高優先級，不結案。
- 「被指派的人說打開是 404／列表看不到」：負責人沒有該渠道的授權。手動指派不檢查（HC-CASES-04），查 `agent_channel_accesses` 與團隊的 `channel_team_accesses`。
- 「指派了卻沒收到通知」：建立時帶負責人不發 `case.assigned`（`case.flow.ts` 的 `afterCaseCreated`）；升級時改派也不發。只有 `/assign` 與自動指派會通知。
- 「自動指派沒反應」：畫面送不出 `teamId`（HC-CASES-06）；有團隊時看候選條件（`role=AGENT`、啟用、渠道授權 `reply_only/full`），全部不符就只寫 log「No available agent」。輪流位置存在行程記憶體，重啟或多行程各自從頭。
- 「客人沒收到滿意度調查」：工單要有關聯對話（列表頁建的工單沒有）；只有轉成 `RESOLVED` 才寄，直接關閉不寄；非 LINE 渠道客人回不了（CASE-02）；投遞失敗只寫 log，`csatSentAt` 已寫入不會重寄。
- 「首次回應一直未達／已達」：後端看 `Case.firstResponseAt`（只在關聯對話的客服訊息寫入，SLA-05），詳情頁的「已達／未達」卻是用時間軸的第一個客服事件算（`apps/web/src/components/case/CaseDetail.tsx`，HC-CASES-11）。
- 「統計卡數字跟列表對不上」：統計不套渠道可見範圍（RBAC-04）；「即將到期」統計 30 分鐘、倒數元件 120 分鐘（HC-CASES-15）；「今日解決」以 API 行程時區切日。
- 「改分類被 400」：建立只收 `CASE_CATEGORIES`；舊工單更新時另收 `LEGACY_CASE_CATEGORIES`（`case.routes.ts`）。
- 「按了沒反應」：詳情頁改負責人、新增備註失敗都沒有提示（HC-CASES-09），看瀏覽器 console 與 API 回應。
