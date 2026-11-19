# 工單

對話記錄「客人說了什麼」，工單追蹤「這件事處理完了沒」。客服把需要追蹤的問題開成工單，指派負責人，依狀態推進到解決；解決後系統發出滿意度調查，客人評分後結案。

- **資料來源**：`apps/api/src/modules/case/*`、`apps/api/src/modules/csat/*`、`packages/shared/src/constants/case-transitions.ts`、`packages/shared/src/constants/case-categories.ts`、`apps/web/src/components/case/*`、`apps/web/src/app/dashboard/cases/*`
- **核對日期**：2026-11-19

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `case` | 工單的建立、清單與篩選、狀態轉換、指派、升級、備註、標籤、時間軸、刪除與統計。自動指派在 `assignment.service.ts` |
| `csat` | 發送滿意度調查、記錄分數、逾時自動結案。沒有路由，由排程、進站攔截器與 `case.routes.ts` 呼叫 |
| `sla` | SLA 政策的 CRUD。工單的期限計算、預警與逾時處置，見[服務水準協議](../SLA.md) |

## 程式的入口

工單的路由在 `case.routes.ts`，前綴是 `/api/v1/cases`。從對話開單的 `POST /api/v1/conversations/:id/case` 在 `conversation.routes.ts`。CSAT 沒有自己的路由，`POST /cases/:id/csat` 在 `case.routes.ts`。

| 操作 | flow 或 service 函式 |
| --- | --- |
| 列表、統計 | `case.service.ts` 的 `listCases()`、`getCaseStats()` |
| 建立 | `case.flow.ts` 的 `createCaseFlow()` → `createCase()` → `createCaseRecord()` |
| 從對話建立 | `createCaseFromConversation()`，同一個交易寫入 `conversation.caseId` |
| 改欄位 | `updateCaseFlow()` → `updateCase()` |
| 改狀態 | `transitionCaseFlow()`；升級走 `escalateCase()` |
| 指派 | `assignCase()`；自動指派是 `assignment.service.ts` 的 `autoAssignCase()` |
| 刪除 | `deleteCaseFlow()` |
| 連結對話 | `linkConversationToCase()`，寫 `conversation_linked` 事件，並以對話裡的客服訊息補上首次回應時間 |
| 工單標籤 | `tag.flow.ts` |

## 工單從哪裡來

| 來源 | 端點或位置 | 連結對話 |
| --- | --- | --- |
| 在收件匣從對話開工單 | `POST /conversations/:id/case`（`POST /cases/from-conversation/:conversationId` 行為相同） | 自動連結該對話 |
| 在工單頁直接建立 | `POST /cases` | 不連結，之後可用 `POST /cases/:id/conversations/:conversationId/link` 連結。這個端點只檢查工單的渠道層級是 `full`，不檢查對話的聯絡人，也不檢查成員看不看得到對話的渠道（HC-CASES-03） |

從對話開工單時，`createCaseFromConversation()` 在同一個交易內建立工單並連結對話。一個對話只能連結一個工單，已經連結的對話不能再開工單，也不能再連結到別的工單。一個工單可以連結多個對話。

建立工單時會做下列事情：

1. 挑選 SLA 政策並計算期限，見[期限從哪裡來](#期限從哪裡來)。
2. 寫入工單，狀態為 `OPEN`，優先級沒指定時為 `MEDIUM`。
3. 寫一筆 `created` 事件到時間軸。
4. 發布 `case.created` 事件，自動化規則可以訂閱。
5. 把工單歸因到該聯絡人最近一筆群發，見[行銷](./MARKETING.md)。
6. 沒有指定負責人、但有指定團隊時，自動指派，見[指派](#指派)。

建立時直接帶 `assigneeId` 不會發布 `case.assigned`，被指派的人不會收到通知。只有之後呼叫 `POST /cases/:id/assign` 才會通知。

**分類是固定清單。** 可用的分類在 `packages/shared` 的 `CASE_CATEGORIES`，`GET /cases/categories` 回傳這份清單。建立工單時只接受清單內的值；更新時另外接受 `LEGACY_CASE_CATEGORIES` 的舊值，避免舊工單無法存檔。租戶不能自訂分類。

## 狀態

合法的轉換定義在 `packages/shared` 的 `VALID_CASE_TRANSITIONS`。API 以 `case-state-machine.ts` 的 `validateTransition()` 檢查。詳情頁 `CaseDetail.tsx` 讀同一份表，產生頂部按鈕與狀態下拉選項。新增改狀態的路徑要經過 `transitionCase()` 或 `escalateCase()`，否則不寫時間軸、不發布事件。

| 目前狀態 | 可以轉成 |
| --- | --- |
| `OPEN` | `IN_PROGRESS`、`CLOSED` |
| `IN_PROGRESS` | `PENDING`、`RESOLVED`、`ESCALATED`、`CLOSED` |
| `PENDING` | `IN_PROGRESS`、`ESCALATED`、`CLOSED` |
| `RESOLVED` | `CLOSED`、`IN_PROGRESS` |
| `ESCALATED` | `IN_PROGRESS`、`CLOSED` |
| `CLOSED` | `OPEN` |

有些轉換是其他操作的副作用：

- 指派 `OPEN` 的工單時，狀態自動改成 `IN_PROGRESS`。
- 自動指派一律把狀態改成 `IN_PROGRESS`。
- 升級把狀態改成 `ESCALATED`。

### 改狀態的路徑

| 路徑 | 呼叫端 | 寫時間軸 | 發布事件 |
| --- | --- | --- | --- |
| `POST /cases/:id/resolve`、`/close`、`/reopen` | 工單詳情頁的按鈕 | 有 | `case.resolved`、`case.closed` |
| `POST /cases/:id/escalate` | 升級對話框 | 有 | `case.escalated` |
| `PATCH /cases/:id` 帶 `status` | 工單詳情頁的狀態下拉選單 | 有 | 與上面兩列相同 |

各路徑允許的轉換相同，副作用也相同。`PATCH /cases/:id` 帶 `status` 時，`updateCase()` 把改成 `ESCALATED` 的請求交給 `escalateCase()`，其他狀態交給 `transitionCase()`，`updateCaseFlow()` 再依結果送出與頂部按鈕相同的推播與事件。因此從下拉選單改狀態，一樣會寫時間軸、發布事件，也會觸發通知、自動化與對外 Webhook。詳情頁的下拉選單選「已關閉」時先要求確認，選「已升級」時開啟升級對話框。

### 解決時間與關閉時間

`resolvedAt` 與 `closedAt` 由 `packages/shared` 的 `caseTransitionTimestamps()` 決定。上表三條路徑、指派時的自動改狀態、評分後結案、問卷逾時結案，以及自動化規則的「改工單狀態」動作（workers 的 `update_case_status`）都用這個函式。自動化的動作也用同一組轉換規則（`canTransition()`）：不允許的轉換不改工單，時間軸寫 `automation_status_skipped`；允許的轉換寫 `status_changed`（`actorType: 'automation'`），轉成已解決、已關閉時發布與手動轉換相同內容的 `case.resolved`、`case.closed`（`caseStatusOutcomeEvent()`）：

| 轉換 | `resolvedAt` | `closedAt` |
| --- | --- | --- |
| 轉成 `RESOLVED` | 寫入轉換時間 | 不變 |
| `RESOLVED` → `CLOSED` | 保留 | 寫入轉換時間 |
| 其他狀態 → `CLOSED`（直接關閉） | null，不算已解決 | 寫入轉換時間 |
| 轉成其他狀態（重開、處理中、待處理、升級） | 清除 | 不變 |

報表以 `resolvedAt` 判斷「已解決」，所以直接關閉與重開的工單不算已解決。2026-11-04 之前的資料沒有補值：那時直接關閉的工單沒有 `resolvedAt`，當時重開、之後沒有再改狀態的工單仍保留舊的 `resolvedAt`。重開不清除 `closedAt`。

狀態機保留兩條離開「完成」狀態的轉換（刻意的設計）：`CLOSED → OPEN`（重新開啟，客人說問題沒有解決）與 `RESOLVED → IN_PROGRESS`（改回處理中，客服誤按「標記解決」）。工單再次轉成 `RESOLVED` 時，API 的 `transitionCase()` 與 workers 的 `update_case_status` 都套用 `@open333crm/shared` 的 `caseTransitionCsatFields()`：還沒有評分時清除 `csatSentAt` 與 `csatRespondedAt`，問卷排程再寄一份；已有評分時保留，不再寄問卷、不逾時結案。

推播（`case.updated` 等）在交易 commit 之後送出。事件與工單的變更在同一個交易寫進 outbox，保證至少送出一次，見[事件與背景工作](../../modules/EVENTS.md)。推播與事件的內容寫在 `case-effects.ts`。

## 指派

**手動指派**走 `POST /cases/:id/assign`，會寫 `assigned` 事件並發布 `case.assigned`，被指派的人收到通知。`/assign` 與升級檢查被指派的成員屬於同一個租戶，但不檢查成員是否已停用，也不檢查成員看不看得到工單的渠道（HC-CASES-04）。建立工單與 `PATCH /cases/:id` 帶 `assigneeId` 時，不檢查成員屬於哪個租戶（HC-CASES-05）。

**自動指派**由 `assignment.service.ts` 的 `autoAssignCase()` 執行，寫 `auto_assigned` 事件並發布 `case.assigned`。觸發條件是：建立工單時沒有指定負責人，但有指定團隊。

自動指派在建立工單的交易 commit 之後另開一個交易執行，在回應送出之前完成。指派失敗時只寫 log，工單照樣建立。建立工單的回應是指派之前的工單，所以負責人是空的，狀態是 `OPEN`；畫面由指派之後的 `case.updated` 推播更新。

候選人的規則如下：

1. 候選人是該團隊內、`role` 為 `AGENT`、而且啟用中的成員，並且直綁或所屬團隊被授權工單的渠道，層級為 `reply_only` 或 `full`。看不到渠道的成員不會被指派，否則工單會從他的收件匣消失、打開回 404。沒有符合的人時不指派。
2. 挑未結工單最少的人。未結是指狀態為 `OPEN`、`IN_PROGRESS`、`PENDING` 或 `ESCALATED`。
3. 同數時輪流。輪流的位置存在行程記憶體，API 重新啟動或有多個行程時，各自從頭輪。

候選人看的是舊的 `role` 列舉，不是「角色與權限」頁設定的細粒度角色。被指派自訂角色的成員會不會被自動指派，取決於他原本的 `role`，見 `../../system/AUDIT.md` 的 RBAC-03。

自動化規則的「指派客服」動作也能指派工單，見[自動化](./AUTOMATION.md)。

## 升級

升級走 `POST /cases/:id/escalate`，原因與新的優先級（`newPriority`）都必填，可以同時指定新的負責人。`PATCH /cases/:id` 把狀態改成 `ESCALATED` 時沒有帶優先級，系統自動提高一級；已經是 `URGENT` 就維持不變。畫面的狀態下拉選「已升級」會打開升級視窗，不走這條路徑。升級時改派的新負責人不會收到通知。

升級會發布 `case.escalated`。誰收到通知由請求的 `notifyTargets` 決定（升級對話框的勾選），只接受下列值，其他值回 400：

| 值 | 收到通知的人 |
| --- | --- |
| `supervisor` | 租戶內在職的 `ADMIN` 與 `SUPERVISOR` |
| `original_assignee` | 升級前的負責人；已停用時不通知 |
| `team` | 不通知任何人。系統沒有實作通知團隊，升級對話框不提供這個選項；API 仍接受，舊頁面送出不會回 400 |

升級的人自己不會收到通知，同一個人只收到一則。沒帶 `notifyTargets`（例如舊的呼叫端）時只通知 `ADMIN` 與 `SUPERVISOR`；帶空陣列表示兩個都沒勾，不送通知。收件人由 `notification.service.ts` 的 `resolveEscalationRecipients()` 計算。

SLA 逾時也會自動提高優先級，這由 workers 處理，見[服務水準協議](../SLA.md)。

## 期限從哪裡來

建立工單時，`createCaseRecord()` 依下列順序挑 SLA 政策：

1. 請求有帶 `slaPolicyId`，就用那一個。
2. 否則挑同租戶、同優先級的政策：設為預設的優先，沒有預設時取最早建立的。自動化的「建立工單」也照這個順序。

挑到政策時，`slaDueAt` 設為「現在加上政策的解決時限」。挑不到時，工單沒有期限。

工單以**政策名稱**記錄所用的政策（`Case.slaPolicy`），不是以 ID。之後改優先級不會重算期限。政策改名時會同步更新工單上的名稱；仍有未結案工單使用的政策不能刪除。其餘限制見 `../../system/AUDIT.md` 的 SLA-04。

工單清單可以依 SLA 狀態篩選：`breached` 是已過期，`warning` 是即將到期。預警的時間門檻寫在 `case.service.ts` 的 `listCases()`。

## 備註與時間軸

時間軸由兩種紀錄合成：

- **事件**（`CaseEvent`）：系統自動寫入，例如建立、指派、狀態轉換、升級、連結對話、自動指派。
- **備註**（`CaseNote`）：客服手動新增。

新增備註時可以取消勾選「內部備註」。這個選項只改變時間軸上的樣式，備註不會送給客人。

## 解決之後

`csat.scheduler.ts` 的 `setupCsatScheduler()` 在 API 行程定期執行下列工作：

1. **寄送滿意度問卷**（排程 id `csat-send`）。工單轉成 `RESOLVED` 30 分鐘後（`CSAT_SURVEY_DELAY_MINUTES`），對工單連結、而且渠道外掛實作 `buildCsatSurvey()` 的對話寄出滿意度問卷（目前只有 LINE）。工單有多個對話時，問卷寄到 `conversations[0]`，這個順序沒有排序（HC-CASES-03）。沒有這種對話的工單不寄，停在已解決，也不會被逾時結案，由客服手動結案。這是刻意的設計。已有評分的工單不寄。租戶停用（含試用到期）時不處理該租戶的工單；重新啟用後，解決時間已過的工單仍會寄出。
2. **問卷逾時結案**（排程 id `csat-auto-close`）。問卷寄出後超過時限仍沒有回覆，把工單轉成 `CLOSED`、發布 `case.closed`，並關閉該工單所有尚未關閉的對話。這個結案不寫時間軸事件。

延遲與時限是 `csat.scheduler.ts` 開頭的常數，租戶不能調整。

排程的 job 可能重跑，兩期也可能重疊，所以兩個工作都先以條件更新認領工單，認領成功才往下做：

- 寄送滿意度問卷：`sendCsatSurveyFlow()` 在同一個交易內寫入 `csatSentAt` 並建立問卷訊息。寫入 `csatSentAt` 的條件是工單仍是 `RESOLVED`、還沒有 `csatSentAt`、還沒有評分、租戶啟用中。沒寫入就不建立問卷訊息、不送到渠道。問卷訊息寫入失敗時，`csatSentAt` 一起 rollback，下一期重試。交易 commit 之後，才在交易外送到渠道。每次解決因此最多寄一份。
- 問卷逾時結案：改成 `CLOSED` 的那次更新，條件是工單仍是 `RESOLVED`、還沒有 `csatRespondedAt`。這次更新與 `case.closed`（寫進 outbox）在同一個交易內 commit。沒寫入就不發事件、不關閉對話。排程讀取之後客服重開工單，或客人回覆評分，工單都不會被蓋回 `CLOSED`。

問卷送到渠道是「最多一次」：交易 commit 之後，送出失敗或行程中途結束，這張工單都不會再處理，問卷少寄一份。寧可少寄，不重複寄。問卷逾時結案的 `case.closed` 經 outbox 至少送出一次；commit 之後才關閉工單底下的對話，關閉失敗只記 log。

問卷送不到客人時（渠道停用、找不到客人在該渠道的帳號、渠道拒收或送出出錯），系統留下客服看得到的紀錄，不自動重寄，`csatSentAt` 保留：

- 對話裡的問卷訊息 `metadata` 加上 `deliveryFailed: true` 與 `deliveryError`（原因），並再推一次 `message.new`。收件匣的問卷卡片顯示「這份問卷沒有送出，客人並未收到」與原因，對話列表也標紅。
- 工單時間軸寫一筆 `csat_send_failed`（`actorType: 'system'`，`payload.reason`），顯示為「滿意度問卷沒有送出，客人沒有收到：<原因>」。

送不出的問卷不重寄。

問卷的版型由渠道外掛的 `buildCsatSurvey()` 產生，csat 模組不比對 `channelType`。LINE 是 Flex Message，五個分數按鈕；其他渠道沒有實作，不寄問卷。

客人點選分數後，按鈕送出 `csat:<分數>:<工單 ID>`，由進站管線的 CSAT 攔截器交給 `recordCsatScoreFlow()` 記錄，並回一則感謝訊息。每張工單只記第一次評分：寫入分數的更新帶 `csatScore: null` 條件，客人連點兩次時只有一次寫入，感謝訊息、低分通知與 `case.closed` 都只有一次。客服也可以用 `POST /cases/:id/csat` 代評。評分後工單改成 `CLOSED`，並關閉工單底下的對話，與問卷逾時結案相同。這次結案不檢查工單目前的狀態，也不經過 `transitionCase()`：`recordCsatScoreFlow()` 自己寫 `csat_rated` 與 `status_changed`（HC-CASES-01）。

分數、問卷卡片的分數、時間軸、感謝訊息、工單結案與 `case.closed`（寫進 outbox）在同一個交易內寫入，一起 commit 或一起 rollback。任何一筆寫入失敗時，這次評分不留下任何東西，客人可以再點一次，客服可以再按一次。commit 之後，系統才推送收件匣、把感謝訊息送到渠道、發低分通知、關閉對話。

1～2 分只發站內通知 `csat_low_score`，不升級工單。收件人是有效權限含 `case.assign`、啟用中、看得到工單渠道的成員（`notification.service.ts` 的 `resolveCaseManagerRecipients()`），不看舊的角色列舉。預設的客服角色也有 `case.assign`。低分通知在記分 commit 之後另開一個交易寫入。通知送不出時，這個交易 rollback，系統再另開交易在工單時間軸寫一筆 `csat_low_score_notify_failed`，分數不受影響。

記錄分數之後，客服在後台看得到結果：

- 這張工單的問卷訊息 `metadata` 寫入 `csatScore` 與 `csatRatedBy`（`customer` 或 `agent`），系統再推一次 `message.new`。收件匣的問卷卡片改成唯讀，標題顯示「客人評 N 分」或「客服代評 N 分」。
- 客人的評分訊息存成「我的評分：N 分」（與 LINE 按鈕的 `displayText` 相同），原始的 `csat:<分數>:<工單 ID>` 存在訊息的 `metadata.postbackData`。
- 工單時間軸寫一筆 `csat_rated`（客人評分 `actorType: 'contact'`，客服代評 `actorType: 'agent'` 並記錄客服），顯示為「客人評分：N 分（說明）」或「客服代評滿意度：N 分（說明）」。評分後自動關閉寫一筆 `status_changed`（`actorType: 'system'`、`payload.reason: 'csat_rated'`），顯示為「狀態：已解決 → 已關閉（評分後自動關閉）」。
- 工單的 `csatRatedBy` 記錄評分來源（`customer` 或 `agent`）。工單詳情頁的「滿意度」區塊顯示分數、說明與評分時間，客服代評時另外標示「客服代評」；問卷已寄出但還沒評分時顯示「問卷已寄出，客人尚未評分」。報表的 CSAT 平均只算客人自評，見[數據分析與報表](./ANALYTICS.md)。

`recordCsatScoreFlow()` 只寫入屬於收訊租戶、而且聯絡人就是傳訊者的工單；客服手動記錄時只比對租戶。不符合條件的 CSAT 訊息仍會被攔截，但不寫入、不回覆。


## 刪除

`DELETE /cases/:id` 是硬刪除。工單的事件、備註與標籤一併刪除，連結的對話解除關聯但保留。刪除會寫一筆 `case.delete` 租戶稽核紀錄，這是事後唯一的痕跡。任何狀態的工單都能刪除，只要渠道層級為 `full`。

刪除與稽核在同一個交易寫入。稽核寫入失敗時，工單不會被刪除，請求回錯誤。

## 權限

工單的路由以權限碼檢查，並另外檢查渠道可見範圍（見[誰看得到哪些工單](#誰看得到哪些工單)）：

| 動作 | 權限 |
| --- | --- |
| 列表、單筆、分類、統計、時間軸 | `case.view` |
| 建立工單（含從對話建立） | `case.create` |
| 修改、貼標、備註、解決、關閉、重開、連結對話、記錄滿意度 | `case.update` |
| 指派（`/assign`，或建立與修改時帶負責人、團隊） | `case.assign` |
| 升級（`/escalate`，或修改時把狀態改成 `ESCALATED`） | `case.escalate` |
| 刪除 | `case.delete` |

新增權限碼之後，既有租戶的系統角色不會自動拿到這個權限碼。

## 誰看得到哪些工單

工單依它的 `channelId` 套用渠道可見範圍，規則與收件匣相同，見[收件匣與對話](./INBOX.md#誰看得到哪些對話)。各操作要求的層級：

| 層級 | 允許的操作 |
| --- | --- |
| `read_only` | 讀工單、讀時間軸 |
| `reply_only` | 貼標、加備註 |
| `full` | 建立工單（含從對話建立）、改欄位、改狀態、指派、升級、連結對話、記錄 CSAT、刪除 |

建立工單時，看不到指定的渠道或對話所屬的渠道，回 404。`GET /cases/stats` 沒有套用可見範圍，統計的是全租戶的工單。見 `../../system/AUDIT.md` 的 RBAC-04。

## 畫面怎麼呼叫 API

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 工單列表 `/dashboard/cases`：狀態分頁、負責人、優先級、分類與 SLA 篩選 | `GET /cases`（每頁 20 筆）；統計卡與分頁計數 `GET /cases/stats` | 搜尋框只在前端過濾目前這一頁。`slaStatus=normal` 不加任何條件（HC-CASES-23） |
| 列表的「新增工單」（`CaseCreateModal`，不帶對話） | `POST /cases` | 先搜尋聯絡人（`GET /contacts?q&limit=10`）。渠道只列出聯絡人有身分、成員看得到的渠道。標題與分類必填。聯絡人在該渠道沒有身分時回 400 `CONTACT_NOT_ON_CHANNEL`。沒有權限的成員也看得到這個按鈕（HC-CASES-10） |
| 收件匣聯絡人面板（`ContactInfoPanel`）的「建立工單」（`CaseCreateModal`，帶對話） | `POST /cases/from-conversation/:conversationId` | 對話已有工單時，按鈕仍然顯示，送出後回 409「這則對話已建立過案件」（HC-CASES-13） |
| 詳情頁 `/dashboard/cases/[caseId]`：點標題、優先級、分類、團隊下拉 | `PATCH /cases/:id` | 只改欄位時推播 `case.updated`。改負責人或取消指派（`assigneeId: null`）不通知。團隊下拉永遠是空的：畫面讀 `agent.team`，API 回的是 `teams[]`（HC-CASES-06）。所以只有 API、CLI 與自動化觸發得到自動指派 |
| 詳情頁的頂部按鈕與狀態下拉 | `POST /cases/:id/{resolve,close,reopen,escalate}`；下拉走 `PATCH /cases/:id` 帶 `status` | 見[改狀態的路徑](#改狀態的路徑) |
| 詳情頁的「負責人」下拉 | `POST /cases/:id/assign` | 下拉列出全部成員（`GET /agents`），不排除停用的成員，也不排除看不到渠道的成員（HC-CASES-04）。指派失敗時畫面沒有提示（HC-CASES-09） |
| 升級視窗 `EscalationModal` | `POST /cases/:id/escalate` | 原因必填。通知對象只送 `supervisor`、`original_assignee`。失敗時只顯示「升級失敗」（HC-CASES-16） |
| 詳情頁右側的「時間軸與備註」、「案件標籤」（`TagManager`） | `POST /cases/:id/notes`；`POST`、`DELETE /cases/:id/tags` | 時間軸由 `GET /cases/:id` 的 `events` 與 `notes` 合成。標籤的 scope 必須是 `CASE`。新增備註失敗時畫面沒有提示（HC-CASES-09）。備註的作者一律顯示「客服」（HC-CASES-21） |
| 收件匣 `ChatWindow` 裡的問卷卡片（`CsatMessage`） | 客服代評走 `POST /cases/:id/csat` | 客服也能點卡片的分數 |
| 列表最右的垃圾桶 | `DELETE /cases/:id` | 先以 `window.confirm` 確認。列表不監聽 `case.deleted`，靠 30 秒輪詢更新。失敗時只顯示「刪除工單失敗」（HC-CASES-16） |

下列 API 沒有畫面入口：

- 連結對話到既有工單：`POST /cases/:id/conversations/:conversationId/link`。
- 修改 `description`。
- `GET /cases/categories`。前端改用 `@open333crm/shared` 的 `CASE_CATEGORIES`。
- `GET /cases/:id/events`。
- `GET /cases?sortBy=priority` 與 `sortBy=createdAt`。

前端送出的值：

- 優先級：`LOW`、`MEDIUM`、`HIGH`、`URGENT`。
- 狀態：`OPEN`、`IN_PROGRESS`、`PENDING`、`RESOLVED`、`ESCALATED`、`CLOSED`。列表篩選也送大寫，後端另外接受小寫。
- 分類：`CASE_CATEGORIES` 的值。詳情頁的「未分類」送空字串。
- CSAT 分數：1 到 5 的整數。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 非 LINE 渠道不寄滿意度調查 | 刻意的設計：等需要時再做快速回覆按鈕。這些工單停在已解決，由客服手動結案 |
| **沒有關聯對話的工單，首次回應 SLA 必定逾時** | 詳見 `../../system/AUDIT.md` 的 SLA-05 |
| 自動指派看舊的角色列舉 | 詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| 工單以政策名稱連結 SLA | 詳見 `../../system/AUDIT.md` 的 SLA-04 |
| 合併、子工單與工單關聯沒有實作 | schema 有 `mergedIntoId`、`parentCaseId` 與 `CaseRelation`，API 沒有讀寫。詳見 `../../system/AUDIT.md` 的 DB-04 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
