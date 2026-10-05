# 自動化

自動化規則讓租戶設定「某件事發生時，符合條件就自動做某些事」。例如：收到含「退貨」的訊息就貼標並通知主管；工單升級時指派給資深客服。側欄的「自動化」頁與「渠道 → LINE 關鍵字回覆」頁，底層都是同一張 `AutomationRule` 表。

- **資料來源**：`apps/api/src/modules/automation/*`、`apps/workers/src/handlers/automation.handler.ts`、`apps/workers/src/lib/automation-actions.ts`、`apps/workers/src/lib/automation-facts.ts`、`packages/automation/src/*`、`apps/web/src/app/dashboard/automation/*`、`apps/web/src/app/dashboard/line/keyword-replies/page.tsx`
- **核對日期**：2026-09-30

## 負責的模組

| 模組 | 行程 | 負責什麼 |
| --- | --- | --- |
| `automation` 的 `automation.routes.ts`、`automation.service.ts` | API | 規則的 CRUD、試跑、執行紀錄查詢 |
| `automation` 的 `automation.worker.ts` | API | 訂閱 eventBus，把事件送進 `automation` queue；比對關鍵字並發布 `keyword.matched`。這個檔案同時負責機器人回覆，見[收件匣與對話](./INBOX.md#機器人什麼時候回覆) |
| `apps/workers` 的 `automation.handler.ts` | workers | 取出該事件的啟用規則、組出事實、評估條件、執行動作 |
| `packages/automation` | 兩邊共用 | 規則契約（事件、事實、動作的定義）與規則引擎 |

動作只由 workers 的 `lib/automation-actions.ts` 執行。API 端原本的 `automation/engine/action-executor.ts` 自 2026-05-12 的 `9255245` 起沒有呼叫端，已於 2026-10-02 刪除。workers 尚未實作的動作（`remove_tag`、`assign_bot`、`kb_auto_reply`、`llm_reply`；`create_case` 已於 2026-10-02 補上）列在契約的 `UNSUPPORTED_AUTOMATION_ACTION_TYPES`，編輯器不提供、存檔時拒絕，見 `../../system/AUDIT.md` 的 AUTO-01。

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

規則列表與關鍵字回覆列表顯示全部規則：`GET /api/v1/automation/rules` 每頁最多 100 條，依 priority、createdAt、id 排序，前端依 `meta.totalPages` 逐頁取回（`apps/web/src/lib/fetch-all-pages.ts`）。2026-10-05 之前規則列表只取第一頁的 20 條、關鍵字回覆只取 100 條，之後的規則在列表上看不到。任一頁載入失敗時，列表顯示錯誤，不顯示「沒有自動化規則」。

**workers 會整條略過的規則。** workers 執行前以 `allowUnsupportedActions` 驗證契約，失敗就整條略過、只寫 log。規則列表用同樣的驗證，在這類規則旁標示「規則不會執行」，滑過可看錯誤（`findWorkerSkipErrors`）。

## 規則怎麼被執行

1. 業務模組在 API 行程發布事件，例如 `case.created`。
2. `automation.worker.ts` 的訂閱者把事件與上下文送進 `automation` queue。
3. workers 的 `handleAutomationJob()` 取出同租戶、同事件、`isActive` 為 `true` 的規則，再用 `validateAutomationRuleContract()` 過濾掉不合契約的規則。
4. `buildAutomationFacts()` 依上下文查出聯絡人、對話、工單等資料，組成事實。
5. `evaluateRules()` 依 `priority` 由大到小逐條評估。命中的規則若設了 `stopOnMatch`，就停止評估其餘規則。
6. 對每條命中的規則，`executeWorkerAutomationActions()` 依序執行動作。單一動作失敗只記 log，不影響後續動作。
7. 推送 `automation.executed` socket 事件給租戶。

## 哪些事件能觸發規則

規則編輯器列出 `AUTOMATION_EVENT_DEFINITIONS` 的全部事件，但只有下表「會觸發」的事件真的會送進 queue：

| 事件 | 會觸發 | 送進 queue 的地方 |
| --- | --- | --- |
| `message.received` 收到訊息 | 是 | `automation.worker.ts` |
| `keyword.matched` 關鍵字命中 | 是 | `automation.worker.ts`，見[關鍵字回覆](#關鍵字回覆) |
| `conversation.created` 新對話建立 | 是 | `automation.worker.ts` |
| `case.created` 工單建立 | 是 | `automation.worker.ts` |
| `case.escalated` 工單升級 | 是 | `automation.worker.ts` |
| `contact.created` 聯繫人建立 | 是 | `automation.worker.ts` |
| `contact.tagged` 聯繫人加標籤 | 是 | `automation.worker.ts` |
| `link.clicked` 短連結被點擊 | 是 | `automation.worker.ts` |
| `sla.*` 的 SLA 事件 | 是 | workers 的 `sla.handler.ts` 直接查規則並執行 |
| `case.closed` 工單關閉 | 否 | 事件有發布，但沒有送進 queue |
| `case.assigned` 工單指派 | 否 | 同上 |
| `message.postback`、`case.updated`、`case.status_changed`、`contact.updated` | 否 | 沒有任何程式發布 |

以「否」的事件為觸發的規則可以儲存，但永遠不會執行，見 `../../system/AUDIT.md` 的 AUTO-05。

反過來，`portal.activity.submitted` 有送進 queue，但它不在契約裡，規則編輯器選不到，因此也無法使用。

## 哪些動作會執行

規則編輯器依契約提供動作。workers 只實作了一部分：

| 動作 | workers 有實作 | 做什麼 |
| --- | --- | --- |
| `send_message` 傳送訊息 | 是 | 送一則文字到觸發的對話 |
| `send_material` 傳送素材 | 是 | 送一則素材到觸發的對話。素材的渠道類型與對話不符時略過 |
| `add_tag` 加標籤 | 是 | 對觸發的聯絡人貼標，見下方說明 |
| `assign_agent` 指派客服 | 是 | 指派工單給指定的成員 |
| `update_case_status` 更新工單狀態 | 是 | 改工單狀態 |
| `escalate_case`、`set_case_priority` | 是 | 改工單優先級 |
| `notify` 通知負責人 | 是 | 通知工單負責人 |
| `notify_supervisor` 通知主管 | 是 | 通知所有 `ADMIN` 與 `SUPERVISOR` |
| `create_case` 建立工單 | 是（#211） | 只在有對話的事件提供；在觸發的對話上建立工單，套用 SLA、關聯對話；對話已有未結案工單時不重複開 |
| `remove_tag` 移除標籤 | **否** | 編輯器不提供，存檔時拒絕；既有規則執行時略過 |
| `assign_bot` 指派機器人 | **否** | 同上 |
| `kb_auto_reply` KB 知識庫回覆 | **否** | 同上 |
| `llm_reply` LLM 智能回覆 | **否** | 同上 |

未實作的動作列在契約的 `UNSUPPORTED_AUTOMATION_ACTION_TYPES`。新增或修改規則時，API 拒絕含這些動作的規則。2026-10-02 之前建立的規則若含這些動作，仍然會執行其他動作，只略過這些動作；規則列表與編輯頁會標示「含未支援的動作」。見 `../../system/AUDIT.md` 的 AUTO-01。

**編輯頁載入時移除契約外的動作。** 編輯既有規則時，編輯器依規則的觸發事件（`trigger.type`，沒有時用 `eventType`），移除契約沒有提供的所有動作：尚未支援的、不適用於這個事件的、契約從來沒有的舊動作（例如 UAT 舊規則的 `auto_assign`），以及格式錯誤的項目。編輯頁分兩類列出被移除的動作：尚未支援的動作只有自己不執行；其他動作會讓整條規則不執行，儲存後才恢復。改了觸發事件後不再顯示。實作在 `apps/web/src/lib/automation/rule-actions.ts` 的 `splitRuleActions`。

**驗證錯誤訊息。** 契約驗證（`packages/automation/src/contracts/validation.ts`）的錯誤訊息一律中文，寫第幾個條件或動作，並用契約的中文名稱，例如「第 2 個動作「auto_assign」不適用於「收到訊息」觸發」。條件依畫面順序編號，巢狀群組裡的條件連續計數。契約沒有的欄位或動作沿用原始代碼。

**`add_tag` 以名稱找標籤。** 規則存的是標籤名稱。workers 依名稱找標籤時不限 scope；找不到就用這個名稱建立一個新的標籤。因此標籤被改名或刪除後，規則會默默重建舊名稱的標籤，見 `../../system/AUDIT.md` 的 AUTO-03。貼標後，workers 經由 Redis 的 `domain:event` 頻道把 `contact.tagged` 送回 API 行程，讓以貼標為觸發的規則接著執行。事件帶著來源 `automation`，用來避免無限迴圈。

**工單類動作繞過工單模組。** workers 直接更新 `Case` 的欄位，不經過 `case.service.ts`：

- `update_case_status` 不檢查轉換是否合法，不寫時間軸，也不寫 `resolvedAt`、`closedAt`。由規則轉成 `RESOLVED` 的工單因此不會發送滿意度調查，因為 CSAT 排程以 `resolvedAt` 判斷。
- `escalate_case` 只提高優先級，不把狀態改成 `ESCALATED`，也不發布 `case.escalated`。
- `assign_agent` 只改 `assigneeId`，不發布 `case.assigned`，被指派的人不會收到通知。上下文沒有工單時略過，不會指派對話。

## 關鍵字回覆

「LINE 關鍵字回覆」頁建立的是 `keyword.matched` 事件加上 `send_material` 動作的規則。關鍵字與比對模式存在 `trigger.keywords` 與 `trigger.match_mode`。

每則文字訊息進來時，`automation.worker.ts` 的 `checkKeywordTriggers()` 逐條檢查關鍵字規則：

- 比對方式是**不分大小寫的子字串比對**。關鍵字「退貨」會命中「我想退貨」，也會命中「不退貨了」。
- `match_mode` 為 `any`（預設）時，任一個關鍵字出現就命中；為 `all` 時，全部關鍵字都要出現。
- 命中的每一條規則各發布一次 `keyword.matched`，事件帶著該規則的 ID。workers 收到後只執行這一條規則。因此一則訊息命中兩條規則，客人會收到兩則回覆。

訊息會命中關鍵字規則時，機器人的 AI 與知識庫回覆會讓步，避免客人同時收到兩種回覆。

關鍵字回覆頁寫著兩條規則：只在機器人負責的對話觸發，以及同一個聯絡人對同一條規則每小時最多觸發三次。這兩條目前都沒有生效：`checkKeywordTriggers()` 對所有對話都執行，每小時的上限只寫在已刪除的 `action-executor.ts`，目前沒有任何程式實作。見 `../../system/AUDIT.md` 的 AUTO-04。

## 試跑與紀錄

`POST /automation/rules/:id/test` 以請求帶入的事實評估這一條規則，回傳是否命中。試跑不執行動作，也不查資料庫組事實；沒帶事實時，以空物件評估。

`GET /automation/logs` 讀 `AutomationLog`。規則清單顯示的執行次數與最後執行時間，讀的是 `AutomationRule.runCount` 與 `lastRunAt`。這三個值原本只由已刪除的 `action-executor.ts` 寫入，自 `9255245` 起停止更新，見 `../../system/AUDIT.md` 的 AUTO-02。

## 權限

| 路由 | 權限 |
| --- | --- |
| `GET /automation/rules`、`GET /rules/:id` | `automation.view` |
| `POST`、`PATCH`、`DELETE /automation/rules` | `automation.manage` |
| `POST /automation/rules/:id/test`、`GET /automation/logs` | 只驗登入 |

關鍵字回覆頁呼叫的是同一組路由，因此管理關鍵字回覆也需要 `automation.manage`。側欄的「渠道」選單另外要求 `richmenu.manage` 才顯示。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **5 種動作沒有實作** | 新規則不能使用，既有規則執行時略過。詳見 `../../system/AUDIT.md` 的 AUTO-01 |
| **部分觸發事件永遠不會觸發** | 詳見 `../../system/AUDIT.md` 的 AUTO-05 |
| **關鍵字回覆在 Instagram 私訊與網站聊天室送不出去** | 規則不限渠道，命中時機器人讓步，但 workers 沒有這兩種渠道的外掛，客人收不到任何回覆。詳見 `../../system/AUDIT.md` 的 CHAN-02 |
| **關鍵字回覆頁承諾的兩項保護沒有生效** | 客服接手後仍會自動回覆，也沒有頻率上限。詳見 `../../system/AUDIT.md` 的 AUTO-04 |
| 執行紀錄與執行次數停止更新 | 詳見 `../../system/AUDIT.md` 的 AUTO-02 |
| `add_tag` 不限 scope，會重建已刪除的標籤 | 詳見 `../../system/AUDIT.md` 的 AUTO-03 |
| 「通知主管」看舊的角色列舉 | 詳見 `../../system/AUDIT.md` 的 RBAC-03 |

Canvas 是另一套多步驟流程引擎，與自動化規則互不相干，見[互動流程引擎](../../modules/CANVAS-FLOW-ENGINE.md)。模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
