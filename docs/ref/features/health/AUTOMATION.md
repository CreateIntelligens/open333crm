# 自動化規則 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（web 3000 production build、API 3001、workers；資料庫 open333crm_advisor）／UAT Demo 租戶（a0000000-0000-0000-0000-000000000001，只做唯讀查詢與開頁）
- 測試角色：admin、supervisor（只有 `automation.view`）、agent（沒有 `automation.*`，有 `canvas.use`），都是 seed 帳號；沒有另建角色
- 觸發方式：本機收不到 LINE/FB webhook，用 `POST /api/v1/simulator/send-message` 模擬進站訊息（LINE、FB、WebChat 渠道）。本機 LINE/FB 渠道憑證解不開，所以送出動作的結果是「失敗紀錄」，不是真的送達

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 3 份規格、190 個 scenario（automation-engine 171、automation-contract-composer 16、interaction-canvas 3）：約 10 個缺實作或只做一部分、約 13 個缺測試、約 4 個缺前端入口（估計，見「完備度對照」）。後端有、前端沒有：`GET /automation/logs`、Canvas 全部路由 |
| 自動測試 | unit：api 22 檔 132 案例、workers 20 檔 90 案例、`@open333crm/automation` 3 檔 8 案例、web 14 檔 106 案例，全部通過，0 skip。feature：`remove-retired-automation-actions`、`follow-tracking`、`backfill-follow-tracking`、`outbox-workers` 4 檔 14 案例，全部通過，0 skip（確認只跑這 4 檔） |
| 實際操作 | 11 條流程：正常 4（1、7、8、9），異常 5（2、3、5、6、11），待真機驗 1（10），未驗 1（4） |

## 問題清單（依嚴重度）

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-AUTOMATION-01 | P1 | 規則編輯器把純數字的條件值轉成數字存檔，「訊息內容」「聯絡人名稱」「聯絡人標籤」這類字串欄位的條件因此永遠不成立。訂單編號、選單數字（「1」「2」）、電話這類最常見的關鍵字都受影響；「試試看」也顯示不會觸發，管理員只會以為規則壞了 | **實測**。本機 admin 在 `/dashboard/automation/new` 建「收到訊息、訊息內容 包含 8888、新增標籤」並啟用；送出的 body 是 `"value":8888`（數字），重新整理後畫面仍顯示 8888。模擬進站訊息「我的單號 8888 還有 7777」：這條規則沒有貼標；同時用 API 存入字串 `"7777"` 的對照規則有貼標。`POST /rules/:id/test {facts:{"message.text":"單號 8888"}}` 回 `matched:false` | `apps/web/src/lib/automation/qb-to-engine.ts:9-16,82`（`parseValue`）、`packages/automation/src/rules/operators.ts`（`contains` 遇到非字串比較值回 false） | AUTO-06 |
| HC-AUTOMATION-02 | P2 | SLA 規則路徑和一般路徑不一致：不做契約驗證（含已停用動作的 SLA 規則不會被略過），也不把 `contactId` 傳給動作，契約允許的「新增標籤」「移除標籤」在 SLA 規則永遠被略過（log「no contact in context」）。手冊第 6 節已提醒不要用 | 讀程式（子代理對照） | `apps/workers/src/handlers/sla.handler.ts:226-260`、`apps/workers/src/lib/automation-actions.ts:321` | AUTO-07 |
| HC-AUTOMATION-03 | P2 | 「聯絡人加標籤」觸發的規則沒有「剛貼上的標籤」條件可用，只能用「聯絡人標籤 包含 X」，而這個條件看的是聯絡人身上全部標籤。之後聯絡人每被貼上**任何**標籤，規則都再執行一次 | **實測**。建 `contact.tagged` 規則（條件：聯絡人標籤 包含 hc-automation-tagM，動作：通知主管）→ 人工貼 tagM，admin、supervisor 各收到 1 則通知 → 再貼無關的 tagN → 又各收到 1 則（共 4 則） | `apps/api/src/modules/automation/automation.worker.ts:479`（只傳 contactId，丟掉 tagId/tagName）、`packages/automation/src/contracts/facts.ts`（沒有對應事實） | AUTO-08 |
| HC-AUTOMATION-04 | P2 | 試跑與執行紀錄只驗登入：沒有 `automation.view` 的成員可以用規則 ID 呼叫 `POST /automation/rules/:id/test`，拿到規則的名稱、條件與動作全文（含通知文字、素材 ID、客服 ID）。權限說明寫 `automation.view` 涵蓋「logs、test」 | **實測**。agent（沒有 `automation.view`，`GET /automation/rules` 回 403）呼叫 `/rules/<id>/test` → 200，回應含 `rule.conditions`、`rule.actions`；`GET /automation/logs` → 200 | `apps/api/src/modules/automation/automation.routes.ts:196,210`、`packages/shared/src/rbac/permissions.ts:70` | AUTO-09（PLAN-04 只從方案角度提到 7 條中 5 條有檢查） |
| HC-AUTOMATION-05 | P2 | workers 的工單類動作繞過工單模組：`update_case_status` 不檢查狀態轉換、不寫 `resolvedAt`/`closedAt`、不寫工單事件，規則轉成「已解決」的工單不會發滿意度調查；`assign_agent` 不通知被指派的人；這幾個 `case.update` 只用 `where: { id }`，沒有自帶 tenantId（worker 是 BYPASSRLS 連線）。功能文件有寫行為，AUDIT 沒有項目 | **實測**。`case.created` 規則（設定優先級 URGENT、指派 supervisor、改狀態 RESOLVED）由自動建單觸發後：工單 URGENT、assignee 是 supervisor、status RESOLVED，`resolvedAt` 是 null，`case_events` 只有一筆 `created`；supervisor 沒有收到指派通知 | `apps/workers/src/lib/automation-actions.ts:295-305,385-428` | AUTO-10（功能文件 AUTOMATION.md「工單類動作繞過工單模組」） |
| HC-AUTOMATION-06 | P2 | Canvas 實際上無法使用，且權限過寬：節點的 `nextNodeId` 必須是 UUID，但節點 ID 由資料庫產生、更新路由也不收 `nodes`，所以用 API 建不出兩個以上互相串接的節點；草稿（DRAFT）流程也能觸發；`contactId` 不存在也回 202。agent 系統角色預設就有 `canvas.use`；`API_FETCH` 節點直接 `fetch()` 任意網址，沒有 `isBlockedUrl()` 檢查，目前因為無法串接而走不到，一旦修好串接就會變成成員可以讓伺服器請求內網網址 | **實測**（agent 帳號）：建 TRIGGER→API_FETCH→ACTION 流程（201，狀態 DRAFT）→ `POST /canvas/:id/trigger` → 202；執行紀錄 `FAILED`、`stepCount 1`、`Node … not found in flow`。觸發不存在的聯絡人 ID 也回 202。`PATCH /canvas/:id {nodes:[]}` 回 200 但節點不變。SSRF 部分是讀程式 | `apps/api/src/modules/canvas/canvas.routes.ts:37,51-58,137`、`apps/api/src/modules/canvas/canvas.service.ts:69-79,230-250`、`packages/core/src/canvas/api-fetch-node.ts:51`、`packages/shared/src/rbac/default-roles.ts:65` | AUTO-11（RLS-01、APP-07 是引擎連線與喚醒，與本項不同） |
| HC-AUTOMATION-07 | P2 | 動作參數只檢查「有填」，不檢查值：`update_case_status` 可存 `status:"FOO"`、`assign_agent`／`notify` 的 `agentId` 可存非 UUID、不存在或其他租戶的成員。編輯器用下拉選單不會送出這些值，但 API、CLI、MCP 可以；執行時才在 workers 失敗並只寫 log | **實測**：`POST /automation/rules` 帶上述值都回 201（測試規則建成停用，未執行） | `packages/automation/src/contracts/validation.ts:147-160`、`apps/api/src/modules/automation/automation.service.ts:205-209` | AUTO-12 |
| HC-AUTOMATION-08 | P2 | 「短連結被點擊」的說明寫「可以依是哪一條連結決定要做什麼」，但契約沒有連結相關的條件欄位；workers 的事實其實帶了 slug，規則用到時存檔驗證拒絕。手冊已註明 | 讀程式（子代理對照） | `packages/automation/src/contracts/events.ts:144-149`、`packages/automation/src/contracts/facts.ts:55-88`、`packages/automation/src/contracts/validation.ts:91-94` | AUTO-13 |
| HC-AUTOMATION-09 | P2 | 規則列表與編輯頁不依權限隱藏「新增規則」、啟用開關、「儲存規則」、「刪除規則」；只有 `automation.view` 的主管按下才收到 403 | **實測**：supervisor 開 `/dashboard/automation` 看得到「新增規則」與開關；開既有規則「儲存規則」可按，按下 alert「權限不足…」。手冊已註明 | `apps/web/src/app/dashboard/automation/page.tsx:53,68`、`apps/web/src/app/dashboard/automation/[ruleId]/page.tsx:208-260` | RBAC-11 |
| HC-AUTOMATION-10 | P3 | 存檔被 Zod 擋下時只 alert「輸入內容有誤，請檢查後重新送出」，不說是哪個欄位；執行順序輸入框允許負數 | **實測**：執行順序填 -1 儲存，alert 只有那一句；API 的 `details.issues` 其實有「priority 不可小於 0」 | `apps/web/src/app/dashboard/automation/[ruleId]/page.tsx:240-243,410-417` | 新 |
| HC-AUTOMATION-11 | P3 | 沒有 `automation.view` 的人直接開規則網址，看到空白表單與可按的「刪除規則」，沒有權限說明（列表頁有） | **實測**：agent 開 `/dashboard/automation/<id>`，名稱欄空白、「刪除規則」存在 | `apps/web/src/app/dashboard/automation/[ruleId]/page.tsx:113,296-307` | 新 |
| HC-AUTOMATION-12 | P3 | workers 對整個租戶房間推 `automation.executed`，內容是完整的 context（含客人訊息全文、聯絡人與對話 ID），不套用渠道可見範圍；web 沒有任何程式接收這個事件 | 讀程式：`git grep automation.executed apps/web/src` 沒有結果 | `apps/workers/src/handlers/automation.handler.ts:231-236` | 新 |
| HC-AUTOMATION-13 | P3 | Canvas worker 的查詢沒有租戶限制：寄信時 `templateView.findFirst`、`messageTemplate.findUnique` 只用 templateId；`add_tag` 不檢查 tagId 屬於同租戶。目前流程無法串接（HC-06），走不到 | 讀程式 | `apps/api/src/modules/canvas/canvas.worker.ts:181-198,223-251` | RLS-01（相關） |
| HC-AUTOMATION-14 | P3 | 本機模擬器 `simulateInboundMessage()` 不發布 `contact.created`（只發 `conversation.created`、`message.received`），以「聯繫人建立」觸發的規則在本機無法用模擬器驗證 | **實測**：模擬新聯絡人進站，`conversation.created` 規則有貼標，`contact.created` 規則沒有 | `apps/api/src/channels/simulator/simulator.service.ts:56-111`；真實路徑在 `apps/api/src/modules/webhook/inbound-contact-resolver.ts:157-175` | 新 |
| HC-AUTOMATION-15 | P3 | 文件過時（見文末「文件過時之處」） | — | — | 新 |

**AUDIT 既有項目的現況（都還沒修好）**

- AUTO-02：UAT Demo 的 `GET /automation/logs` 共 88 筆，最新一筆 2026-05-12；本機規則執行多次後 `automation_logs` 仍是 0 筆。
- AUTO-03：`add_tag` 仍以名稱、不分 scope 找標籤，找不到就建（本機規則建出 `hc-automation-tagA` 等新標籤）。
- AUTO-05：本機啟用 `case.closed` 規則後關閉符合條件的工單，規則沒有執行。
- CHAN-02：WebChat 對話命中關鍵字規則，外送訊息寫「系統未載入 WEBCHAT 渠道外掛，無法送出」。
- RBAC-03：「傳送通知」沒指定對象時送給 `role` 為 ADMIN、SUPERVISOR 的成員（本機實測送給 admin、supervisor）。
- RLS-01、APP-07：`flow-runner.ts` 仍匯入 module-level `prisma`（讀程式）。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 規則列表 | 本機 UI＋UAT UI | 正常：列表、摘要句、事件名稱；UAT Demo 140 條全部列出（逐頁取） | — | 正常：agent 側欄沒有「自動化」，直接開網址顯示「權限不足…」與「重新載入」 | — |
| 2 開關規則 | 本機 UI＋API | 正常：列表開關停用 R11，重新整理仍是停用 | 不合契約的規則啟用回 400（unit 測試覆蓋） | 異常：supervisor 看得到開關、PATCH 403（HC-09） | — |
| 3 新增/編輯 | 本機 UI＋API | 正常：UI 建規則後跳到編輯頁，重新整理讀回一致；API 建 `message.received` 多動作規則 201 | 名稱空白時「儲存規則」停用；`priority -1`、關鍵字 101 字、說明 1001 字回 400（訊息籠統，HC-10）；`llm_reply` 回「已停用，請刪除」；未知事件、事件不適用的動作回中文錯誤；只送 `payload` 的動作回「必須填寫訊息內容」 | 異常：supervisor 可按儲存（HC-09）；agent 看到空白表單（HC-11） | 參數值不驗證（HC-07） |
| 4 換觸發事件 | — | 未驗 | — | — | 手冊已寫「會直接清空，不會先問」 |
| 5 條件 | 本機 UI＋模擬進站 | 文字條件「包含 hc-automation-r1」正常命中 | 數字條件永遠不成立（HC-01） | — | `stopOnMatch`：高優先序勾停止的規則命中後，同事件其他規則都不執行（符合文件） |
| 6 動作 | 本機模擬進站 | `add_tag`、`create_case`（含優先級、分類、`case.created` 連鎖）、`notify`（指定與回退）、`notify_supervisor`、`set_case_priority`、`assign_agent`、`update_case_status`、`send_message`、`send_material`（變數代入）都有執行 | 送出動作在本機只有失敗紀錄（憑證）；WebChat 送不出（CHAN-02） | — | 異常：工單類動作繞過工單模組（HC-05）；SLA 路徑貼標不執行（HC-02，讀程式） |
| 7 試試看 | 本機 UI＋API | 正常：填符合的值顯示「會觸發」與「會執行：…」，不符合顯示「不會觸發：條件不符合」 | — | 異常：沒有 `automation.view` 也能試跑並讀到規則內容（HC-04） | — |
| 8 刪除 | 本機 UI＋API | 正常：確認後回列表，`enabled=false, isActive=false` | — | 正常：supervisor、agent `DELETE` 回 403 | UI 無法復原 |
| 9 關鍵字回覆 | 本機 UI＋模擬進站；UAT 開頁 | 正常：建 FB 規則（條件 `conversation.channelType equal FB`、`send_material`）→ FB 訊息觸發送素材、LINE 同關鍵字不觸發 | 沒有關鍵字與素材時儲存鈕仍可按（點下後由頁面驗證，未逐項） | 未驗 supervisor 存檔 | WebChat 對話送不出（CHAN-02）；UAT 頁面能開 |
| 10 加好友禮 | 本機、UAT 開頁 | 頁面能開；agent 顯示「無法載入加好友禮設定」 | — | — | `contact.followed` 需 LINE follow webhook（待真機驗） |
| 11 Canvas | 本機 API（agent） | 異常：流程建得起來但節點無法串接，執行一步就 FAILED（HC-06） | DRAFT 可觸發、不存在的聯絡人回 202 | agent 預設有 `canvas.use` | 沒有前端；UAT Demo 0 個流程 |

## 完備度對照

規格逐條對照由子代理讀程式完成，同性質的 Requirement 合併一列，scenario 數是合計。

| Spec / Requirement（組） | scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- | --- |
| automation-engine：Event Trigger、Worker-Owned Triggering、Worker Evaluates Jobs | 6 | 有（`automation.worker.ts:65` jobId=事件 id） | `automation.worker.test`、`automation.handler.test` | 不適用 |
| Rule Conditions、Actions、Storage、Create Case Action Scope | 11 | 部分（`update_case_status` 見 HC-05、參數值見 HC-07） | `automation-contract.test`、`automation-create-active*` | 有 |
| Remove Tag、Retired Actions（含既有規則 migration） | 9 | 有；SLA 路徑不略過含停用動作的規則（HC-02） | `automation-remove-tag`、`automation-retired-actions`（api、workers）、`remove-retired-automation-actions`（feature） | 有 |
| Package-Defined Rule Contract、Contract Consumers | 5 | 部分（SLA 路徑沒用契約驗證） | `automation-contract.test` | 有 |
| SLA Event Catalog、SLA Automation Facts、Shared SLA Semantics | 14 | 部分（SLA 規則動作沒有 contactId） | `sla-contract.test`、`sla-outcome-once.test`；「SLA 規則動作執行」沒有測試 | 有（事件可選） |
| Unified Contact Tagging、Write Path、Loop Protection | 7 | 有（防迴圈比規格嚴：source=automation 整個不評估） | `tagging.service.test`、`tag.flow.test`、`tag-on-click.test` | 不適用 |
| Short Link Click Trigger Event | 3 | 有 | `shortlink.flow.test`、`automation.worker.test` | 有 |
| Short Link Click Facts | 1 | 缺（HC-08） | 無 | 缺 |
| Add Tag Worker Action、End-to-End Click-to-Tag | 5 | 部分（沒有端到端） | `automation-add-tag.test` | 不適用 |
| 規則列表、編輯器、摘要、試跑表單、新規則啟用狀態 | 32 | 有 | `rule-list`、`rule-summary`、`rule-test-form`、`rule-actions`、`condition-builder-labels`、`automation-list-order`、`automation-create-active` | 有 |
| 自動化建立工單、自動分類 | 6 | 有（`automation-actions.ts:134-230`） | `automation-create-case.test` | 有 |
| 傳送素材引用、素材挑選、券連結 | 12 | 有 | `send-material-reference`、`send-material-coupon-url`、`keyword-reply-coupon-url`、`action-editor` | 有 |
| AI 讓步、渠道不符紀錄、非文字不做 AI 回覆 | 19 | 有（`keyword-yield.ts`） | `keyword-yield-channel`、`keyword-suppresses-ai`、`non-text-no-ai-reply`、`automation-material-channel-mismatch` | 不適用 |
| 傳送通知的收件人 | 7 | 有（`automation-actions.ts:80-106`） | `automation-notify`、`automation-notify-copy` | 有 |
| 不合契約不可啟用、未知觸發事件 | 4 | 有 | `rule-activation`、`rule-actions` | 有 |
| 每則訊息一則回覆、動作認領、keyword 比對與發出、情緒分析 | 15 | 有 | `bot-reply-claim`、`automation-skipped-claims`、`keyword-match`、`sentiment-claim`、`sentiment-llm-fallback` | 不適用 |
| 加入好友事件、次數、回覆期限 | 8 | 有 | `follow-tracking`、`backfill-follow-tracking`、`automation-follow-gift`、`automation-keyword-reply` | 有（加好友禮頁） |
| 關鍵字回覆頁（保留動作與條件、依渠道、Instagram、券連結素材） | 11 | 有 | `keyword-reply-edit-dialog`、`keyword-reply-material-cell`、`follow-event-options` | 有 |
| automation-contract-composer（7 個 Requirement） | 16 | 有 | `automation-contract.test`、`contracts/facts.test` | 有 |
| interaction-canvas：節點執行引擎 | 1 | 部分（無法串接，HC-06） | 無 | 缺 |
| interaction-canvas：智慧時間窗口 | 1 | 有（`smart-window.ts`） | `canvas-flow.test` | 缺 |
| interaction-canvas：API 資料抓取節點 | 1 | 有（沒有網址檢查） | 無 | 缺 |

合計 190 個 scenario。缺實作或部分約 10 個，缺測試約 13 個，缺前端入口約 4 個（Canvas 3、短連結條件 1）。

## 待真機驗

- LINE 關鍵字回覆以 reply 權杖在 30 秒內送出、超過改 push（本機 LINE 憑證解不開）。
- FB、Instagram 關鍵字回覆的實際送達（本機只看到外送失敗紀錄與渠道條件生效）。
- 加入好友 `contact.followed`、加好友禮發券（需要 LINE follow webhook）。
- `contact.created`（真實進站才發布，HC-14）、`link.clicked`（需真實點擊短連結）、`case.escalated`。
- SLA 五種事件觸發的規則（需要等到期限；路徑讀程式見 HC-02）。

## 建議新增到 AUDIT.md 的項目

1. HC-AUTOMATION-01：編輯器把數字條件值轉成數字，字串欄位條件永遠不成立（P1）。
2. HC-AUTOMATION-02：SLA 規則路徑不做契約驗證、不傳 contactId（P2）。
3. HC-AUTOMATION-03：`contact.tagged` 沒有「剛貼的標籤」條件，任何貼標都重觸發（P2）。
4. HC-AUTOMATION-04：`/automation/rules/:id/test`、`/automation/logs` 沒有權限檢查，可讀規則內容（P2；可併入 PLAN-04 或另立 RBAC 項）。
5. HC-AUTOMATION-05：workers 工單類動作繞過工單模組（狀態轉換、`resolvedAt`、工單事件、指派通知、無 tenantId 的 update）（P2）。
6. HC-AUTOMATION-06：Canvas 節點無法串接、DRAFT 可觸發、agent 預設有 `canvas.use`、`API_FETCH` 無網址檢查（P2）。
7. HC-AUTOMATION-07：動作參數值不驗證（P2）。
8. HC-AUTOMATION-08：`link.clicked` 沒有連結條件欄位（P2）。

## 文件過時之處

- `docs/ref/features/tenant/AUTOMATION.md`：「哪些事件能觸發規則」表缺「加入好友」`contact.followed`（會觸發）；「哪些動作會執行」表缺 `issue_coupon`（契約有，編輯器隱藏）；權限表沒提到試跑會回傳規則全文（HC-04）。
- `docs/ref/modules/CANVAS-FLOW-ENGINE.md`：沒有寫節點無法用 API 串接（HC-06），也沒寫 agent 預設有 `canvas.use`；「目前的限制」宜加上這兩點。
- `apps/web/public/manual/ch05-automation.html`：
  - 第 5 節「渠道條件目前只能選 LINE、Facebook、WebChat，還不能選 Instagram」已過時：契約已列 Instagram（`THREADS`）。
  - 第 4 節觸發時機表沒有「加入好友」。
  - 第 6 節「傳送訊息、傳送素材……什麼時機能用：收到訊息、關鍵字命中、新對話建立」漏了「加入好友」。
  - 沒有提醒「條件值只填數字時不會命中」（HC-01，修好前應加註）。
  - 第 6 節「只想在 LINE 依關鍵字回素材」：關鍵字回覆已支援 LINE、Facebook、Instagram。
- `packages/shared/src/rbac/permissions.ts:70` 的 `automation.view` 說明寫涵蓋「logs、test」，但兩條路由沒有掛這個權限。

## 本機留下的資料

- 已刪除：自動化規則 18 條（`hc-automation-` 開頭，軟刪）、標籤 9 個。
- 無法刪除、保留：Canvas 流程 `hc-automation-flow1`（已改 ARCHIVED，沒有刪除路由）與 2 筆 FAILED 執行；模擬進站產生的聯絡人 `hc-automation-c1`、`c2`、`c3`、`fb1`、`wc1` 與其對話、訊息；自動建立的工單 2 張（`hc-automation-case-R1`，其中 1 張已關閉）；站內通知若干。
- 沒有改租戶設定、角色或 seed 帳號。UAT 沒有建立任何資料。
