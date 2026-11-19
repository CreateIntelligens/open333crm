# 自動化

自動化規則讓租戶設定「某件事發生時，符合條件就自動做某些事」。例如：收到含「退貨」的訊息就貼標並通知主管；工單升級時指派給資深客服。側欄的「自動化」頁與「渠道 → 關鍵字回覆」頁，底層都是同一張 `AutomationRule` 表。

- **資料來源**：`apps/api/src/modules/automation/*`、`apps/workers/src/handlers/automation.handler.ts`、`apps/workers/src/lib/automation-actions.ts`、`packages/automation/src/*`、`apps/web/src/app/dashboard/automation/*`、`apps/web/src/app/dashboard/line/keyword-replies/page.tsx`
- **核對日期**：2026-11-19

## 負責的模組

| 模組 | 行程 | 負責什麼 |
| --- | --- | --- |
| `automation` 的 `automation.routes.ts`、`automation.flow.ts`、`automation.service.ts` | API | 規則的 CRUD、試跑、執行紀錄查詢。每個請求在 flow 開的一個租戶交易內完成 |
| `automation` 的 `automation.worker.ts` | API | 處理 `event-automation` 佇列的事件，把事件送進 `automation` queue。這個檔案同時負責機器人回覆，見[收件匣與對話](./INBOX.md#機器人什麼時候回覆) |
| `apps/workers` 的 `automation.handler.ts` | workers | 取出該事件的啟用規則、組出事實、評估條件、執行動作。處理 `message.received` 時，一併比對關鍵字規則 |
| `packages/automation` | 兩邊共用 | 規則契約（事件、事實、動作的定義）與規則引擎 |

動作只由 workers 的 `lib/automation-actions.ts` 執行。API 沒有動作執行器。契約定義的動作，workers 都有實作。workers 遇到沒有分支的動作類型時，只寫一筆 warn log 並略過。`assign_bot`、`kb_auto_reply`、`llm_reply` 已從契約拿掉，見下方「已拿掉的動作」。

## 程式的入口

規則的路由在 `automation.routes.ts`，前綴是 `/api/v1/automation`。每條路由呼叫 `automation.flow.ts` 的 flow，每個 flow 是 `flowOf()` 包住一個 service 函式。Canvas 的路由前綴是 `/api/v1/canvas`，見[互動流程引擎](../../modules/CANVAS-FLOW-ENGINE.md)。`/api/v1/identity`（合併建議）屬於聯絡人領域，路由在 `contact/merge-suggestion.routes.ts`。

| 路由 | flow → service 函式 |
| --- | --- |
| `GET /automation/rules` | `listRulesFlow()` → `listRules()`。只列出 `enabled` 為 `true` 的規則 |
| `GET /automation/rules/:id` | `getRuleFlow()` → `getRule()` |
| `POST /automation/rules` | `createRuleFlow()` → `createRule()` |
| `PATCH /automation/rules/:id` | `updateRuleFlow()` → `updateRule()` |
| `DELETE /automation/rules/:id` | `deleteRuleFlow()` → `deleteRule()` |
| `POST /automation/rules/:id/test` | `testRuleFlow()` → `testRule()` |
| `GET /automation/logs` | `listLogsFlow()` → `listLogs()` |

`createRule()` 與 `updateRule()` 依序檢查：

1. 路由的 Zod schema。
2. `validateRuleContract()`：契約驗證。
3. `assertSendMaterialReferences()`、`assertSendMaterialChannels()`：素材存在、啟用中、渠道與條件相符。
4. `assertIssueCouponReferences()`：優惠券。
5. `assertSingleFollowGift()`：每個租戶只能有一條加好友禮，第二條回 409。

建立、修改與刪除規則不發布事件，也不寫租戶稽核紀錄。

規則的執行在下列檔案：

| 步驟 | 程式 |
| --- | --- |
| 把事件送進 `automation` queue | `apps/api/src/modules/automation/automation.worker.ts` |
| 取出規則、過濾、組事實、評估 | `apps/workers/src/handlers/automation.handler.ts` 的 `handleAutomationJob()`；事實由 `packages/automation/src/automation-facts.ts` 的 `buildAutomationFacts()` 組出；評估由 `packages/automation/src/rules/evaluator.ts` 的 `evaluateRules()` 執行 |
| 執行動作 | `apps/workers/src/lib/automation-actions.ts` 的 `executeWorkerAutomationActions()` |
| SLA 事件的規則 | `apps/workers/src/handlers/sla.handler.ts` 的 `evaluateSlaAutomationRules()` |

## 一條規則由什麼組成

| 部分 | 欄位 | 內容 |
| --- | --- | --- |
| 觸發事件 | `eventType`（同時存在 `trigger.type`） | 規則對哪個事件反應 |
| 條件 | `conditions` | json-rules-engine 的條件樹。可用的事實依事件而不同 |
| 動作 | `actions` | 條件成立時依序執行的動作 |
| 優先順序 | `priority` | 數字越大越先評估 |
| 命中即停止 | `stopOnMatch` | 這條規則命中後，同一個事件不再評估其他規則 |
| 啟用 | `isActive` | 列表上的開關 |
| 已刪除 | `enabled` | 為 `false` 代表已刪除。刪除是軟刪除，會同時把 `isActive` 設為 `false` |

`packages/automation/src/contracts/` 定義了每個事件提供哪些資料（`requires`），以及每個動作需要哪些資料。建立與更新規則時，`validateRuleContract()` 依此檢查：事件不提供聯絡人時，就不能選需要聯絡人的動作。

規則列表與關鍵字回覆列表顯示全部規則：`GET /api/v1/automation/rules` 每頁最多 100 條，依 priority、createdAt、id 排序，前端依 `meta.totalPages` 逐頁取回（`apps/web/src/lib/fetch-all-pages.ts`）。任一頁載入失敗時，列表顯示錯誤，不顯示「沒有自動化規則」。

**規則頁的用語。** 列表與編輯頁用一句話描述規則，例如「當收到訊息時，如果開啟案件數等於 0，就建立工單「客戶諮詢」」（`rule-summary.ts`）。列表顯示事件的中文名稱、可依名稱搜尋與依啟用狀態篩選。編輯頁把 `priority` 稱為「執行順序」（數字越大越先檢查），`stopOnMatch` 稱為「這條規則執行後，不再檢查其他規則」，條件建構器全部中文（`condition-builder-labels.ts`），觸發事件下方顯示契約的 `description`。契約中 `dispatched: false` 的事件在選單標示「（目前不會觸發）」。「指派客服」從客服名單選人，不必填 ID。

**條件值的型別。** 編輯器依欄位在契約的型別存比較值（`qb-to-engine.ts`）：數字欄位（例如開啟案件數）存數字，是／否欄位存布林，其他欄位（訊息內容、聯絡人名稱、標籤等）一律存字串，即使填的是「8888」「1」這類純數字。規則引擎（`packages/automation/src/rules/operators.ts`）在欄位值是字串、比較值是數字時，把數字當成文字比對，所以資料庫裡以數字儲存的舊規則，與 API 存入的數字一樣會命中。數字欄位的比對不變。

**不合契約的規則不可啟用。** 把規則改為啟用時，API 以儲存後的觸發、條件與動作做契約驗證，不通過回 400；停用永遠可以。編輯器遇到契約沒有的觸發事件時顯示「未知觸發事件（<代碼>）」。既有資料用 `scripts/disable-invalid-automation-rules.mjs` 停用（預設 dry-run）。

**建立規則時的啟用狀態。** `POST /automation/rules` 依請求的 `isActive` 建立規則；沒送時預設啟用。

**workers 會整條略過的規則。** workers 執行前以 `allowUnsupportedActions` 驗證契約，失敗就整條略過、只寫 log。規則列表用同樣的驗證，在這類規則旁標示「規則不會執行」，滑過可看錯誤（`findWorkerSkipErrors`）。

## 規則怎麼被執行

1. 業務模組發布事件，例如 `case.created`。`contact.created` 只由真實進站的 `apps/api/src/modules/webhook/inbound-contact-resolver.ts` 發布。本機模擬器 `simulator.service.ts` 不發布這個事件，所以用模擬器測不到以「聯繫人建立」觸發的規則（HC-AUTOMATION-14）。事件送進自動化訂閱者的佇列 `event-automation`，見[事件與背景工作](../../modules/EVENTS.md)。
2. `automation.worker.ts` 的訂閱者把事件 id、事件與上下文送進 `automation` queue。job id 是事件 id，所以同一個事件送兩次時只評估一次。這個去重只在完成的 job 保留期間（24 小時）有效。
3. workers 的 `handleAutomationJob()` 取出同租戶、同事件、`isActive` 為 `true` 的規則，再用 `validateAutomationRuleContract()` 過濾掉不合契約的規則。
4. `buildAutomationFacts()` 依上下文查出聯絡人、對話、工單等資料，組成事實。
5. `evaluateRules()` 依 `priority` 由大到小逐條評估。命中的規則若設了 `stopOnMatch`，就停止評估其餘規則。
6. 對每條命中的規則，`executeWorkerAutomationActions()` 依序執行動作。單一動作失敗只記 log，不影響後續動作。
7. 推送 `automation.executed` socket 事件給租戶。

**SLA 事件的規則走另一條路徑。** `sla.handler.ts` 的 `evaluateSlaAutomationRules()` 自己查規則、自己組事實，再呼叫 `executeWorkerAutomationActions()`。這條路徑與一般路徑有兩個差異（HC-AUTOMATION-02）：

- 不做契約驗證，所以含已停用動作的 SLA 規則不會被略過。
- 只把 `caseId`、`assigneeId`、`title` 傳給動作，不傳 `contactId` 與 `conversationId`。需要聯絡人的「新增標籤」「移除標籤」在 SLA 規則永遠略過，log 寫「no contact in context」。

**命中即停止的範圍。** `message.received` 等一般事件的規則，命中一條勾了 `stopOnMatch` 的規則後，同一個事件、`priority` 較低的所有規則都不評估。關鍵字規則逐條各自評估，`stopOnMatch` 不會擋下其他關鍵字規則。

**同一個事件的動作最多執行一次。** 事件可能送兩次，`automation` job 也可能重試。每個動作執行前，workers 以「`automation_action` + 事件 id + `<規則 id>#<動作序號>`」寫一筆認領紀錄，已經有紀錄就跳過。認領紀錄保存 30 天，所以 30 天內重送時，客人不會收到第二則訊息，沒有指定優先度的升級也不會再升一級。認領之後動作失敗不重做。SLA 排程觸發的規則沒有事件 id，不認領，由 SLA 自己的紀錄避免重複。規則在事件重送之間改了動作順序時，序號會對不上，可能重複執行一次。

## 哪些事件能觸發規則

規則編輯器列出 `AUTOMATION_EVENT_DEFINITIONS` 的全部事件，但只有下表「會觸發」的事件真的會送進 queue：

| 事件 | 會觸發 | 送進 queue 的地方 |
| --- | --- | --- |
| `message.received` 收到訊息 | 是 | `automation.worker.ts` |
| `keyword.matched` 關鍵字命中 | 是 | 不經 queue：workers 處理 `message.received` 時比對，見[關鍵字回覆](#關鍵字回覆) |
| `conversation.created` 新對話建立 | 是 | `automation.worker.ts` |
| `case.created` 工單建立 | 是 | `automation.worker.ts` |
| `case.escalated` 工單升級 | 是 | `automation.worker.ts` |
| `contact.created` 聯繫人建立 | 是 | `automation.worker.ts` |
| `contact.tagged` 聯繫人加標籤 | 是 | `automation.worker.ts` |
| `link.clicked` 短連結被點擊 | 是 | `automation.worker.ts` |
| `contact.followed` 加入好友 | 是 | `automation.worker.ts`：處理 LINE 的 follow 事件（`message.received`、`contentType: follow`）時，另外把這個事件排入佇列，並帶上回覆權杖。動作在權杖的期限內用回覆方式送出。「加好友禮」頁建立的就是這個事件的規則 |
| `sla.*` 的 SLA 事件 | 是 | workers 的 `sla.handler.ts` 直接查規則並執行 |
| `case.closed` 工單關閉 | 否 | 事件有發布，但沒有送進 queue |
| `case.assigned` 工單指派 | 否 | 同上 |
| `message.postback`、`case.updated`、`case.status_changed`、`contact.updated` | 否 | 沒有任何程式發布 |

以「否」的事件為觸發的規則可以儲存，但永遠不會執行，見 `../../system/AUDIT.md` 的 AUTO-05。

`contact.tagged` 的規則沒有「剛貼上的標籤」條件，只能用「聯絡人標籤 包含 X」。這個條件看的是聯絡人身上的全部標籤，所以聯絡人之後每被貼上任何一個標籤，規則都再執行一次（HC-AUTOMATION-03）。自動化自己貼的標籤不觸發，見下方 `add_tag` 的說明。

反過來，`portal.activity.submitted` 有送進 queue，但它不在契約裡，規則編輯器選不到，因此也無法使用。

## 哪些動作會執行

規則編輯器依契約提供動作（`issue_coupon` 除外），workers 都有實作：

| 動作 | workers 有實作 | 做什麼 |
| --- | --- | --- |
| `send_message` 傳送訊息 | 是 | 送一則文字到觸發的對話。送不出時見[送出失敗的紀錄](#送出失敗的紀錄) |
| `send_material` 傳送素材 | 是 | 送一則素材到觸發的對話。素材的渠道類型與對話不符時略過。編輯器從素材庫下拉挑選（顯示名稱與渠道）。建立或修改動作時，`materialId` 必須是同租戶、啟用中的素材，否則回 400。規則條件一定要成立的「對話渠道等於 X」（頂層或巢狀的「全部」群組）與素材的渠道類型不分大小寫比對，不同時回 400；只改條件也檢查，只改名稱、停用或重新啟用不檢查。素材含 `{{coupon.url}}`（顧客專屬券連結）時也回 400：自動化規則不會發券，workers 會把沒代入的變數拿掉，顧客拿不到券；關鍵字回覆對話框與規則編輯器選到這種素材時會提醒。「關鍵字回覆」頁編輯時一律送出完整的動作，所以規則指向的素材停用或含券連結時，要改選素材才能存；只切換啟用開關不受影響 |
| `add_tag` 加標籤 | 是 | 對觸發的聯絡人貼標，見下方說明 |
| `assign_agent` 指派客服 | 是 | 指派工單給指定的成員 |
| `update_case_status` 更新工單狀態 | 是 | 改工單狀態 |
| `escalate_case`、`set_case_priority` | 是 | 改工單優先級 |
| `notify` 傳送通知 | 是 | 選填「通知誰」（`agentId`）。依序通知：指定的客服（同租戶、啟用中）、工單負責人、對話負責客服；都沒有時通知所有 `ADMIN` 與 `SUPERVISOR` |
| `notify_supervisor` 通知主管 | 是 | 通知所有 `ADMIN` 與 `SUPERVISOR` |
| `create_case` 建立工單 | 是 | 只在有對話的事件提供；在觸發的對話上建立工單，套用 SLA、關聯對話；對話已有未結案工單時不重複開 |
| `remove_tag` 移除標籤 | 是 | 刪除聯絡人身上、本租戶、`tagId` 或名稱相符的標籤，不限 scope（與 `add_tag` 對稱）；找不到時不做任何事、不建立標籤 |
| `issue_coupon` 發送優惠券 | 是 | 發一張優惠券給觸發的聯絡人並送到對話（`apps/workers/src/lib/rule-coupon-issue.ts`，屬於行銷領域）。編輯器不顯示這個動作（契約的 `editorHidden`），只在「關鍵字回覆」與「加好友禮」頁設定 |

**已拿掉的動作。** `assign_bot`、`kb_auto_reply`、`llm_reply` 不在契約內：機器人在負責的對話裡已會用知識庫與 AI 回覆，規則再觸發一次可能讓客人收到兩則回覆。契約以 `RETIRED_AUTOMATION_ACTIONS` 保留它們的中文名稱：新增或修改規則時，API 以「第 N 個動作「LLM 智能回覆」已停用，請刪除」拒絕，編輯頁列出「LLM 智能回覆（已停用）」。規則若還含這些動作，workers 驗證失敗、整條略過，規則列表標示「規則不會執行」。資料 migration `20261005100000_remove_retired_automation_actions` 在部署時清理既有規則：還有其他動作的規則移除這 3 種動作、繼續執行；只有這 3 種動作的規則停用，動作保留原樣。

**編輯頁載入時移除契約外的動作。** 編輯既有規則時，編輯器依規則的觸發事件（`trigger.type`，沒有時用 `eventType`），移除契約沒有提供的所有動作：不適用於這個事件的、已停用的（列為「LLM 智能回覆（已停用）」）、契約不認得的舊動作（例如 UAT 舊規則的 `auto_assign`，列為「未知動作（auto_assign）」），以及格式錯誤的項目。這些動作會讓整條規則不執行，編輯頁列出被移除的動作，儲存後恢復。改了觸發事件後不再顯示。實作在 `apps/web/src/lib/automation/rule-actions.ts` 的 `splitRuleActions`。

**驗證錯誤訊息。** 契約驗證（`packages/automation/src/contracts/validation.ts`）的錯誤訊息一律中文，寫第幾個條件或動作，並用契約的中文名稱，例如「第 1 個動作「傳送訊息」不適用於「工單關閉」觸發」。條件依畫面順序編號，巢狀群組裡的條件連續計數。契約完全沒有的欄位或動作只有原始代碼，訊息會說明「不是系統提供的」，例如「第 2 個動作「auto_assign」不是系統提供的動作，請刪除」；編輯頁列為「未知動作（auto_assign）」。

**下拉參數只收選項內的值**。「目標狀態」「優先級」「新優先級」「分類」等下拉參數有值時必須是契約的選項之一，否則存規則回 400，例如「第 1 個動作「更新工單狀態」的「目標狀態」不能是「FOO」，請從選項中選擇」；選填的下拉留空照常通過。API、CLI、MCP 都走同一個驗證。既有規則若存了選項外的值，workers 驗證失敗、整條略過，規則列表標示「規則不會執行」。負責人、通知對象（`agentId`）仍不檢查（AUTO-12）。「目標狀態」的選項是開啟、處理中、待處理、已升級、已解決、已關閉。

**`add_tag` 以名稱找標籤。** 規則存的是標籤名稱。workers 依名稱找標籤時不限 scope；找不到就用這個名稱建立一個新的標籤。因此標籤被改名或刪除後，規則會默默重建舊名稱的標籤，見 `../../system/AUDIT.md` 的 AUTO-03。貼標時，workers 在同一個交易把 `contact.tagged` 寫進 outbox，讓以貼標為觸發的規則接著執行。事件帶著來源 `automation`，自動化訂閱者據此略過，避免無限迴圈。

**工單類動作繞過工單模組。** workers 直接更新 `Case` 的欄位，不經過 `case.service.ts`。`update_case_status` 與工單模組共用 `packages/shared` 的規則，其餘動作沒有：

- `update_case_status` 依工單的狀態轉換規則（`canTransition()`），和客服手動改狀態一樣：例如「開啟」不能直接改成「已解決」。不合法（含不存在的狀態值）時不改工單，工單時間軸寫一筆「自動化規則「<名稱>」沒有改狀態：不能從「開啟」直接改成「已解決」」（`automation_status_skipped`）；目標狀態等於目前狀態時不改也不寫。合法時同一個交易寫時間軸 `status_changed`（顯示「（自動化規則「<名稱>」）」），轉成已解決、已關閉時把 `case.resolved`、`case.closed` 寫進 outbox，內容與手動轉換相同（`caseStatusOutcomeEvent()`）；推播 `case.updated` 的 `source` 是 `automation`。`resolvedAt`、`closedAt` 用 `caseTransitionTimestamps()`，由規則轉成 `RESOLVED` 的工單會寄滿意度調查。動作先以 `tenantId` 讀目前狀態，再以讀到的狀態條件更新；讀取之後狀態被改掉時不覆寫。
- `escalate_case` 只提高優先級，不把狀態改成 `ESCALATED`，也不發布 `case.escalated`。
- `assign_agent` 只改 `assigneeId`，不發布 `case.assigned`，被指派的人不會收到通知。上下文沒有工單時略過，不會指派對話。
- workers 以 BYPASSRLS 的連線查詢。`escalate_case`、`set_case_priority`、`assign_agent` 以 `where: { id: caseId }` 讀寫工單，沒有帶 `tenantId`。`caseId` 來自 workers 內部組出的上下文，外部無法指定。`update_case_status` 已帶 `tenantId`。

**動作的參數格式。** 後端存 `{type, params}`。規則編輯器內部用 `{type, payload}`：載入時由 `splitRuleActions()` 轉換，儲存時轉回 `params`。workers 與契約驗證都接受 `params ?? payload`，但 API 的 Zod 只保留 `params`，只送 `payload` 的動作會變成空參數，存檔回 400。

**存檔的欄位限制。** `automation.routes.ts` 的 Zod schema 限制下列欄位，不合格時回 400，`details.issues` 列出每個欄位的錯誤：

- `name`：去掉前後空白後 1 到 200 字。
- `description`：最多 1000 字。
- `priority`：0 到 10000 的整數。
- `trigger.keywords`（關鍵字規則）：1 到 50 個，每個 1 到 100 字，不可只有空白。
- `trigger.match_mode`：`any` 或 `all`。
- `actions`：至少 1 個。
- `conditions`：只檢查是物件，不檢查條件值的型別。

## 關鍵字回覆

「關鍵字回覆」頁（側欄「渠道 → 關鍵字回覆」，網址仍是 `/dashboard/line/keyword-replies`）建立的是 `keyword.matched` 事件加上「傳送素材」（`send_material`）、「發送優惠券」（`issue_coupon`）至少一個動作的規則。關鍵字與比對模式存在 `trigger.keywords` 與 `trigger.match_mode`。

每條關鍵字回覆屬於一個渠道：LINE、Facebook 或 Instagram。

- 渠道存成條件「對話渠道等於 X」（`conversation.channelType` 的 `equal`，值為 `LINE`、`FB`、`THREADS`），規則只在這個渠道的對話觸發，並對同一渠道類型的所有帳號生效（例如所有 LINE 官方帳號、所有粉專）。沒有「只對某個帳號」的設定。
- 建立時選渠道；已有渠道條件的規則不能改渠道。在自動化規則編輯器建立、沒有渠道條件的規則，列表顯示「未限定渠道」，在這頁儲存時加上所選渠道的條件（預設為素材的渠道，沒有素材時為 LINE）。渠道條件不是上述單一寫法的規則（例如等於 `WEBCHAT`），這頁不能儲存，要到自動化規則編輯。
- 素材選單只列所選渠道的素材。Instagram 沒有素材（素材庫只允許 `line`、`fb`），只能發券。規則原本的素材與渠道不符、已刪除或已停用且沒有改選時，這頁擋下儲存並說明原因，列表的素材欄也標示原因。
- 列表有「渠道」欄與渠道篩選。切換啟用開關或儲存後，列表立即重新載入規則與規則明細。
- Facebook 與 Instagram 的入站訊息沒有回覆權杖，規則的回覆與發券訊息以一般傳送送出；顧客剛傳訊息，一定在 Meta 的 24 小時視窗內。顧客開啟票券時以 email 驗證碼驗證身分。

每則文字訊息進來時，workers 評估 `message.received` 的 job，以 `matchKeywordTrigger()`（`packages/automation/src/keyword/keyword-match.ts`）逐條檢查啟用中的關鍵字規則：

- 比對方式是**不分大小寫的子字串比對**。關鍵字「退貨」會命中「我想退貨」，也會命中「不退貨了」。
- `match_mode` 為 `any`（預設）時，任一個關鍵字出現就命中；為 `all` 時，全部關鍵字都要出現。
- 空白或不是字串的關鍵字不命中任何訊息。存檔時已經驗證關鍵字，這條規則只影響驗證之前的舊資料。
- 命中的每一條規則，以 `keyword.matched` 為觸發事件執行一次，所以 LINE 照舊用 reply 回覆。因此一則訊息命中兩條規則，客人會收到兩則回覆。
- 命中的每一條規則也發出一個 `keyword.matched` 事件，只給對外 Webhook。workers 以「`keyword_matched` + 入站訊息 id + 規則 id」認領，同一則訊息評估兩次也只發出一個。

AI 是否讓步的判斷也呼叫 `matchKeywordTrigger()`，所以兩邊對同一則訊息得出相同的命中結果。

訊息會命中關鍵字規則、而且規則能在這個渠道回覆時，機器人的 AI 與知識庫回覆會讓步，避免客人同時收到兩種回覆。能回覆是指規則有「傳送訊息」，或有素材渠道與對話相同的「傳送素材」，而且 workers 送得到這個渠道（`channel-plugins` 的 `AUTOMATION_DELIVERY_CHANNEL_TYPES`：LINE、FB、Instagram）。只加標籤、素材是別的渠道的規則，或網站聊天室的對話，不會讓 AI 讓步。規則的條件不成立、或規則不合契約（workers 會整條略過）時，也不會讓 AI 讓步；條件用與 workers 相同的 `buildAutomationFacts`（`@open333crm/automation`）評估。

「傳送素材」的素材渠道與對話不同時，素材不送出，對話會多一則標示「沒有送出」的紀錄，說明素材與對話的渠道不同。

關鍵字回覆頁存檔時只更換第一個「傳送素材」與第一個「發送優惠券」；第二個以後的同類動作（例如在規則編輯器加的）原樣保留。原本只發券的規則加上素材時，素材排在第一個發券之前。

### 送出失敗的紀錄

自動化的送出（傳送訊息、傳送素材、發券）沒有送到客人時：

- 對話還在（含渠道已停用、聯絡人沒有綁定渠道身分、憑證解不開、渠道拒收）：對話多一則 `metadata.deliveryFailed` 的紅色系統訊息，對話的 `lastMessageAt` 也更新，對話會浮到收件匣上方。發券的失敗紀錄只寫一則。
- 對話已不存在：沒有地方寫訊息。`send_message`、`send_material` 的動作標成失敗，寫一筆 `AutomationLog`（`success: false`、`errorMsg`、`actionsRan`），可由 `GET /automation/logs` 查到。動作執行時發生錯誤、或找不到素材，也寫這筆紀錄。

關鍵字回覆不限對話狀態，也沒有次數上限。workers 對所有對話都比對：客人每傳一則含關鍵字的訊息就觸發一次，客服接手的對話也會自動回覆。關鍵字回覆頁的說明寫的就是這個行為。

## 試跑與紀錄

`POST /automation/rules/:id/test` 以請求帶入的事實評估這一條規則，回傳是否命中。試跑不執行動作，也不查資料庫組事實；沒帶事實時，以空物件評估。

編輯頁的「試試看這條規則」依**已儲存**的條件產生表單：條件用到的每個欄位一格，名稱與輸入方式取自契約（`apps/web/src/lib/automation/rule-test-form.ts`），沒填的欄位不送。結果以中文顯示「會觸發」與會執行的動作，或「不會觸發：條件不符合」。

`GET /automation/logs` 讀 `AutomationLog`。workers 只在有動作失敗時寫入（見[送出失敗的紀錄](#送出失敗的紀錄)），成功的執行不寫。`AutomationRule.runCount` 與 `lastRunAt` 不會更新，見 `../../system/AUDIT.md` 的 AUTO-02。規則列表因此不顯示執行次數，避免管理員看到停住的數字。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 規則列表 `/dashboard/automation`：搜尋、依啟用狀態篩選 | `GET /automation/rules?page&limit=100`，依 `meta.totalPages` 逐頁取完 | 列表以 `findWorkerSkipErrors()` 標示「規則不會執行」 |
| 列表的「啟用」開關 | `PATCH /automation/rules/:id`，只送 `isActive` | 改為啟用時做契約驗證，不通過回 400 |
| 「新增規則」→ `/dashboard/automation/new`；點列表的一列 → `/dashboard/automation/[ruleId]` | 新增 `POST /automation/rules`；修改 `PATCH /automation/rules/:id` | 送出 `{name, description, trigger:{type, keywords?, match_mode?}, priority, isActive, stopOnMatch, conditions, actions:[{type, params}]}`。失敗時以 `alert` 顯示 `getApiErrorMessage()` 的訊息，不顯示 `details.issues` 的逐欄位錯誤。「執行順序」輸入框允許負數（HC-AUTOMATION-10） |
| 「什麼時候檢查這條規則」下拉（`triggerEventOptions()`） | 不呼叫 API | 換觸發事件時，條件與動作直接清空，不詢問。契約中 `dispatched: false` 的事件標示「（目前不會觸發）」 |
| 條件（`ConditionBuilder`，使用 react-querybuilder） | 不呼叫 API | 可選的欄位依觸發事件由契約產生。`qbToEngine()` 轉成 `{all或any:[{fact, operator, value}]}` |
| 「新增動作」（`ActionList`、`ActionEditor`） | 素材下拉 `GET /marketing/materials?isActive=true`；客服下拉 `GET /agents` | 素材下拉需要 `marketing.view`，客服下拉需要 `agent.view`。沒有權限或載入失敗時，下拉退回文字框並說明原因。`issue_coupon` 不在動作下拉裡 |
| 編輯頁下方的「試試看這條規則」 | `POST /automation/rules/:id/test`，送 `facts` | 只試跑已儲存的版本，只評估條件，不執行動作 |
| 編輯頁的「刪除規則」 | `DELETE /automation/rules/:id` | 先以 `confirm` 確認。刪除把 `enabled`、`isActive` 都設成 `false`，畫面上沒有復原的方法 |
| 關鍵字回覆 `/dashboard/line/keyword-replies` 的「建立關鍵字回覆」：渠道、名稱、關鍵字（按 Enter 加入）、比對方式、素材或優惠券 | `POST /automation/rules`、`PATCH /automation/rules/:id`，內容由 `apps/web/src/hooks/useKeywordReplies.ts` 的 `buildRulePayload()` 組出 | 不送 `isActive`，所以建立後立即啟用 |
| 加好友禮 `/dashboard/line/follow-gift` | 同一組路由，規則是 `contact.followed` 加 `issue_coupon` | 每個租戶只能有一條，第二條回 409。沒有權限時頁面顯示「無法載入加好友禮設定」 |

規則列表與編輯頁不依權限隱藏「新增規則」、啟用開關、「儲存規則」與「刪除規則」。只有 `automation.view` 的成員按下後才收到 403（HC-AUTOMATION-09）。沒有 `automation.view` 的成員直接開規則網址時，看到空白的表單與可以按的「刪除規則」，沒有權限說明（HC-AUTOMATION-11）。

下列 API 或資料沒有畫面入口：

- `GET /automation/logs`。
- Canvas 的全部路由。
- 已刪除規則的復原。
- `AutomationExecution` 資料表。沒有任何程式讀寫這張表。

## 權限

| 路由 | 權限 |
| --- | --- |
| `GET /automation/rules`、`GET /rules/:id`、`POST /rules/:id/test`、`GET /automation/logs` | `automation.view` |
| `POST`、`PATCH`、`DELETE /automation/rules` | `automation.manage` |

關鍵字回覆頁呼叫的是同一組路由，因此管理關鍵字回覆也需要 `automation.manage`。Canvas 的路由要求 `canvas.use`，系統的 agent 角色預設就有這個權限碼。側欄的「渠道」選單另外要求 `richmenu.manage` 才顯示。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **部分觸發事件永遠不會觸發** | 詳見 `../../system/AUDIT.md` 的 AUTO-05 |
| **關鍵字回覆在網站聊天室送不出去** | 規則不限渠道，但 workers 沒有網站聊天室的外掛，規則的回覆送不出去（收件匣有失敗紀錄）。機器人不會因此讓步，訪客仍收到 AI 回覆。Instagram 私訊已可回覆。詳見 `../../system/AUDIT.md` 的 CHAN-02 |
| 執行紀錄與執行次數停止更新 | 詳見 `../../system/AUDIT.md` 的 AUTO-02 |
| `add_tag` 不限 scope，會重建已刪除的標籤 | 詳見 `../../system/AUDIT.md` 的 AUTO-03 |
| 「通知主管」看舊的角色列舉 | 詳見 `../../system/AUDIT.md` 的 RBAC-03 |

Canvas 是另一套多步驟流程引擎，與自動化規則互不相干，見[互動流程引擎](../../modules/CANVAS-FLOW-ENGINE.md)。模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
