---
name: feature-automation
description: >
  open333CRM「自動化規則」功能顧問：規則列表與編輯器（觸發事件、條件、動作、執行順序、命中即停止）、
  事件觸發（收到訊息 message.received、關鍵字命中 keyword.matched、新對話、工單建立/升級、
  聯絡人建立 contact.created、聯絡人加標籤 contact.tagged、短連結被點擊 link.clicked、加入好友 contact.followed、SLA 事件）、
  規則動作（傳送訊息、傳送素材、建立工單、改工單狀態/優先級、指派客服、貼標/移除標籤、通知、通知主管、發券）、
  試跑「試試看這條規則」、執行紀錄、關鍵字回覆頁、加好友禮頁、Canvas 互動流程（/api/v1/canvas）。
  當需求、bug 或新功能碰到 /dashboard/automation、/dashboard/line/keyword-replies、/dashboard/line/follow-gift、
  automation、canvas 模組、packages/automation 契約、workers automation-actions、「規則沒觸發」「自動回覆沒送出」
  「關鍵字沒反應」「AI 跟關鍵字一起回」時使用。也在改事件發布、標籤、工單狀態、素材、SLA 前使用。
---

# 自動化規則

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/AUTOMATION.md`
  - 注意：它的「哪些事件能觸發規則」表沒有列「加入好友」`contact.followed`（會觸發，由 LINE follow 事件送進來，見 `packages/automation/src/contracts/events.ts`）；「哪些動作會執行」表沒有列 `issue_coupon`（編輯器隱藏，只在關鍵字回覆與加好友禮頁使用）。
- Canvas：`docs/ref/modules/CANVAS-FLOW-ENGINE.md`（沒有前端；節點無法用 API 互相串接，見健檢 HC-AUTOMATION-06）
- 健檢結果與已知問題：`docs/ref/features/health/AUTOMATION.md`
- 規格：`openspec/specs/automation-engine/spec.md`、`openspec/specs/automation-contract-composer/spec.md`、`openspec/specs/interaction-canvas/spec.md`
- 手冊：`apps/web/public/manual/ch05-automation.html`（關鍵字回覆另見 `apps/web/public/manual/ch10-line.html`）
- 影響分析：`node scripts/feature-impact.mjs --domain automation`

路由前綴：`/api/v1/automation`（規則 CRUD、試跑、logs）、`/api/v1/canvas`（Canvas）。同一個 `canvas.routes.ts` 另外匯出 `/api/v1/identity`（合併建議，屬聯絡人領域）。

## 執行路徑（一定要先懂）
1. 業務模組發布事件 → outbox / eventBus → API 的 `event-automation` 訂閱佇列。
2. `apps/api/src/modules/automation/automation.worker.ts` 把事件轉成 `automation` job（jobId = 事件 id）。`contact.tagged` 的 `source === 'automation'` 直接略過（防迴圈）。
3. workers `apps/workers/src/handlers/automation.handler.ts`：查同租戶、同事件、`isActive` 的規則 → `validateAutomationRuleContract` 過濾 → `buildAutomationFacts`（`packages/automation/src/automation-facts.ts`）→ `evaluateRules`（`packages/automation/src/rules/evaluator.ts`）。`message.received` 時另外逐條比對 `keyword.matched` 規則。
4. 動作只由 `apps/workers/src/lib/automation-actions.ts` 的 `executeWorkerAutomationActions` 執行；每個動作先以「`automation_action` + 事件 id + `<規則 id>#<序號>`」認領。
5. SLA 事件不經 2、3：`apps/workers/src/handlers/sla.handler.ts` 自己查規則、自己組事實、**不做契約驗證、不傳 contactId/conversationId**。
6. Canvas 完全是另一套：`packages/core/src/canvas/flow-runner.ts` + Redis `crm:events` + API 的 `canvas.worker.ts`。

## 前端操作流程

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限（後端 / 前端隱藏） |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 規則列表、搜尋、篩選 | `/dashboard/automation`；依 `meta.totalPages` 逐頁取完（每頁 100） | `GET /automation/rules?page&limit=100` → `listRules`（排除 `enabled=false`） | 列表用 `findWorkerSkipErrors` 標「規則不會執行」 | `automation.view` / 側欄依權限隱藏；沒權限直接開網址顯示「權限不足」 |
| 2 | 開關規則 | 列表「啟用」開關 | `PATCH /automation/rules/:id {isActive}` → `updateRule`；改為啟用時做契約驗證，不合格 400 | 無 | `automation.manage` / **不隱藏**（supervisor 看得到、按下才 403） |
| 3 | 新增/編輯規則 | 「新增規則」→ `/dashboard/automation/new`；點列表列 → `/dashboard/automation/[ruleId]` | `POST /automation/rules`、`PATCH /automation/rules/:id` → `createRule`/`updateRule`：Zod → `validateRuleContract` → 素材、券、加好友禮唯一性檢查 | 無事件、無稽核 | `automation.manage` / 儲存、刪除鈕**不隱藏** |
| 4 | 換觸發事件 | 「什麼時候檢查這條規則」下拉（`triggerEventOptions`）；`dispatched:false` 的事件標「（目前不會觸發）」 | — | **條件與動作直接清空、不詢問** | — |
| 5 | 條件 | react-querybuilder（`ConditionBuilder`），欄位依事件由契約產生 | `qbToEngine()` 轉成 `{all|any:[{fact,operator,value}]}` | **數字字串會被轉成數字**（見下方「前端實際送出的值」） | — |
| 6 | 動作 | 「新增動作」（`ActionList`/`ActionEditor`）；素材從素材庫下拉、客服從 `/agents` 下拉 | 編輯器內部 `{type,payload}`，送出時轉 `{type,params}` | — | 素材下拉要 `marketing.view`，客服下拉要 `agent.view`，失敗退回文字框 |
| 7 | 試試看 | 編輯頁下方（只對已儲存版本） | `POST /automation/rules/:id/test {facts}` → `testRule`，只評估條件、不執行 | 無 | **只驗登入**：沒有 `automation.view` 的人也能拿到規則的條件與動作（HC-AUTOMATION-04） |
| 8 | 刪除 | 編輯頁「刪除規則」→ confirm | `DELETE /automation/rules/:id` → 軟刪 `enabled=false, isActive=false` | UI 無法復原 | `automation.manage` / 不隱藏 |
| 9 | 關鍵字回覆 | `/dashboard/line/keyword-replies`「建立關鍵字回覆」：渠道 LINE/FB/THREADS、名稱、關鍵字（Enter 加入）、比對 any/all、素材或券 | `POST/PATCH /automation/rules`（`apps/web/src/hooks/useKeywordReplies.ts` 的 `buildRulePayload`），條件 `conversation.channelType equal <渠道>` | 沒送 `isActive`，建立即啟用 | 同 3 |
| 10 | 加好友禮 | `/dashboard/line/follow-gift` | 同一組路由，`contact.followed` + `issue_coupon`；每租戶只能一條（409） | — | 沒權限時頁面顯示「無法載入加好友禮設定」 |
| 11 | Canvas | **沒有前端** | `/api/v1/canvas` CRUD、`/api/v1/canvas/:id/activate`、`/api/v1/canvas/:id/trigger {contactId,vars}`、`/api/v1/canvas/:id/executions`、`/api/v1/canvas/:id/analytics` | — | `canvas.use`（**agent 系統角色預設就有**） |

**有後端、沒有前端入口**：`GET /automation/logs`（而且自 `9255245` 起沒有任何程式寫入，AUDIT AUTO-02）；Canvas 全部；規則復原；`AutomationExecution` 表沒有任何程式讀寫。

## 前端實際送出的值
- 規則：`{name, description:'', trigger:{type, keywords?, match_mode?}, priority:number, isActive, stopOnMatch, conditions, actions:[{type, params}]}`。
- 後端 Zod（`automation.routes.ts`）：`name` 1–200（trim）、`description` ≤1000、`priority` 0–10000 整數、`keywords` 每個 1–100 字、最多 50 個、`match_mode` `any|all`、`actions` 至少 1 個。不合格時 alert 只顯示「輸入內容有誤，請檢查後重新送出」，編輯器沒有讀 `details.issues`（例如執行順序填 -1）。
- **條件值**：`apps/web/src/lib/automation/qb-to-engine.ts` 的 `parseValue` 把 `"8888"` 轉成數字 `8888`、`"true"` 轉成布林。workers 的 `contains`、`equal` 對字串欄位（訊息內容、聯絡人名稱、標籤）比對數字時永遠不成立（HC-AUTOMATION-01）。用 API 寫入字串 `"7777"` 才會命中。
- 動作參數：契約只檢查「必填有值」，不檢查下拉值是否合法、`agentId` 是否同租戶啟用中的成員。API 可以存 `status:"FOO"`、`agentId:"not-a-uuid"`，執行時才在 workers 失敗、只寫 log（HC-AUTOMATION-07）。
- 渠道值：`LINE`、`FB`、`THREADS`（Instagram）、`WEBCHAT`。
- `issue_coupon` 是 `editorHidden`，規則編輯器的動作下拉沒有；關鍵字回覆頁與加好友禮頁才有。

## 每個觸發事件實際會不會執行（2026-10-30 本機實測）
| 事件 | 會觸發 | 備註 |
| ---- | ---- | ---- |
| `message.received` | 是（實測） | `stopOnMatch` 會讓同事件、優先序較低的**所有**規則都不評估 |
| `keyword.matched` | 是（實測） | 不分大小寫子字串；`stopOnMatch` 無效；渠道條件有效（FB 規則對 LINE 訊息不觸發） |
| `conversation.created` | 是（實測） | — |
| `case.created` | 是（實測，含 `create_case` 開出的單） | — |
| `contact.tagged` | 是（實測，人工貼標） | 自動化貼的標不觸發；**貼任何標籤都會重新觸發**「聯絡人標籤包含 X」的規則（HC-AUTOMATION-03） |
| `contact.created` | 讀程式：只有真實進站 `inbound-contact-resolver.ts` 發布 | 模擬器 `simulator.service.ts` 不發布，本機用模擬器測不到 |
| `link.clicked`、`contact.followed`、`case.escalated`、`sla.*` | 讀程式 | 待真機或時間驗證 |
| `case.closed`、`case.assigned`、`message.postback`、`case.updated`、`case.status_changed`、`contact.updated` | 否（`case.closed` 實測不觸發） | AUDIT AUTO-05 |

## 每個動作 workers 實際做什麼
| 動作 | 本機實測結果 | 注意 |
| ---- | ---- | ---- |
| `send_message` / `send_material` | 有寫外送訊息；本機 LINE/FB 憑證解不開時寫「渠道憑證無法解密」；WebChat 寫「系統未載入 WEBCHAT 渠道外掛」（CHAN-02） | 素材變數用聯絡人資料代入 |
| `create_case` | 建單、套 SLA、寫 `case_events`、發 `case.created` | 對話已有未結案工單時不開 |
| `add_tag` / `remove_tag` | 正常；依名稱找不到就建標籤（AUTO-03） | SLA 規則永遠略過（沒有 contactId，HC-AUTOMATION-02） |
| `set_case_priority` / `escalate_case` | 只改 `priority` | 不改狀態、不發 `case.escalated` |
| `update_case_status` | 改成 RESOLVED，但 `resolvedAt` 仍是 null、沒有工單事件 | 不檢查狀態轉換，CSAT 不會發（HC-AUTOMATION-05） |
| `assign_agent` | 只改 `assigneeId` | 不通知、不發 `case.assigned`；`agentId` 不驗證 |
| `notify` | 指定 → 工單負責人 → 對話負責人 → 全部 ADMIN/SUPERVISOR（看 `Agent.role`，RBAC-03） | — |
| `notify_supervisor` | 全部 ADMIN/SUPERVISOR | RBAC-03 |
| `issue_coupon` | 見行銷領域 `apps/workers/src/lib/rule-coupon-issue.ts` | — |

## 不可破壞的規則
- 後端存 `{type, params}`、編輯器用 `{type, payload}`：`splitRuleActions` 載入時轉、`handleSave` 送出時轉回。workers 與契約驗證都同時接受 `params ?? payload`，但 API 的 Zod 會把 `payload` 丟掉（只送 `payload` 會變成空參數而 400）。
- 動作只在 workers 執行；不要在 API 端重新加動作執行器。新增動作要同時改契約 `packages/automation/src/contracts/actions.ts`、workers 分支、編輯器，契約定義了但 workers 沒有分支的動作會只寫 warn。
- workers 走 BYPASSRLS 連線，每個查詢都要自帶 `tenantId`。目前 `update_case_status`、`escalate_case`、`set_case_priority`、`assign_agent` 仍以 `where: { id: caseId }` 更新（`caseId` 來自內部事實，現況不可被外部指定，但不要照抄）。
- 規則動作每個事件最多執行一次（`side_effect_claims`）；不要拿掉認領，否則客人會收到重複回覆。
- 不合契約的規則不可啟用；停用永遠可以。契約拿掉動作時要附 migration 清既有規則（參考 `20261005100000_remove_retired_automation_actions`）。
- `keyword.matched` 的 `keywords` 必須非空白，否則 `includes('')` 會讓規則對每則訊息觸發。
- 關鍵字規則能回覆時 AI 讓步（`apps/api/src/modules/automation/keyword-yield.ts`）；改條件評估或渠道清單要讓 API 與 workers 用同一個 `buildAutomationFacts`、`AUTOMATION_DELIVERY_CHANNEL_TYPES`。
- `contact.tagged` 防迴圈靠 `source:'automation'`；新增貼標路徑時要帶來源。
- 加好友禮每租戶一條（後端 409）。
- UI 不放 emoji 與 ✓。

## 跨功能牽連
執行 `node scripts/feature-impact.mjs --domain automation` 看最新版本。重點：
- **依賴**：聯絡人（標籤、聯絡人事件）、工單（工單類動作直接改 Case）、收件匣（進站事件、AI 讓步）、渠道（workers 外掛清單）、行銷（素材、發券）、通知、SLA（SLA 規則路徑）、短連結（`link.clicked`）、LINE（`contact.followed`、reply 權杖）、成員（指派、通知對象）。
- **被依賴**：LINE（關鍵字回覆、加好友禮頁）、行銷（關鍵字領券）、收件匣、平台方案（PLAN-04）、平台佇列監控。

## 回歸清單
1. 建 `message.received` 規則（條件「訊息內容 包含 退貨」，動作貼標＋建立工單＋傳送通知＋傳送訊息）→ 用 `POST /api/v1/simulator/send-message` 送含「退貨」的訊息 → 標籤、工單、通知、外送訊息（或失敗紀錄）都出現。
2. 條件值用純數字（例如「包含 8888」）重走 1，確認會命中（目前不會，HC-AUTOMATION-01）。
3. `case.created` 規則（指派、改優先級、改狀態、指定通知）→ 由 1 的建立工單觸發。
4. `contact.tagged` 規則 → 人工貼標觸發一次；自動化貼標不觸發；再貼別的標籤是否重觸發。
5. 關鍵字回覆頁建 FB 規則 → FB 訊息觸發、LINE 訊息不觸發；WebChat 送不出（CHAN-02）。
6. `stopOnMatch`：兩條同事件規則，高優先序勾停止 → 低的不執行。
7. supervisor（只有 `automation.view`）：列表看得到、儲存/開關/刪除 403；agent：側欄沒有自動化、直接開網址顯示權限不足。
8. 試試看：填符合與不符合的值各一次。
- 自動測試：`pnpm --filter @open333crm/api test -- automation`、`pnpm --filter @open333crm/workers test -- automation`、`pnpm --filter @open333crm/automation test`、`pnpm --filter @open333crm/web test -- automation keyword follow-gift`；feature：`remove-retired-automation-actions`、`follow-tracking`、`backfill-follow-tracking`、`outbox-workers`（照 AGENTS.md 先搶鎖）。
- E2E：`apps/web/tests/e2e-uat/tenant-automation.spec.ts`、`apps/web/tests/e2e-uat/tenant-automation-editor-fixes.spec.ts`。

## 常見 bug 從哪裡查
- 「規則沒觸發」：先看事件是不是 AUTO-05 的不會觸發事件；再看列表有沒有「規則不會執行」；再看條件值是不是被轉成數字（直接查 `automation_rules.conditions`）；再看是否被更高優先序、勾了「執行後停止」的規則擋掉。workers log 有 `[automation] N/M rule(s) matched`。
- 「有觸發但客人沒收到」：查該對話的外送訊息 `metadata.deliveryFailed` / `deliveryError`（憑證、WebChat 外掛、素材渠道不符）。
- 「同一則訊息回兩次」：一則訊息命中幾條關鍵字規則就回幾次；或關鍵字規則不能回覆而 AI 沒讓步（`keyword-yield.ts`）。
- 「SLA 規則的貼標沒作用」：SLA 路徑沒傳 contactId（`apps/workers/src/handlers/sla.handler.ts` 的 `evaluateSlaAutomationRules`）。
- 「規則改成已解決，客人沒收到滿意度調查」：`update_case_status` 不寫 `resolvedAt`。
- 「執行紀錄空白」：AUTO-02，沒有程式寫入。
- 「Canvas 流程跑完一步就失敗」：節點 `nextNodeId` 無法指到同一請求建立的節點；執行紀錄 `errorMessage` 會是 `Node … not found in flow`。
