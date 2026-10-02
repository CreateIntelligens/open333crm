# 工單

對話記錄「客人說了什麼」，工單追蹤「這件事處理完了沒」。客服把需要追蹤的問題開成工單，指派負責人，依狀態推進到解決；解決後系統發出滿意度調查，客人評分後結案。

- **資料來源**：`apps/api/src/modules/case/*`、`apps/api/src/modules/csat/*`、`packages/shared/src/constants/case-transitions.ts`、`packages/shared/src/constants/case-categories.ts`、`apps/web/src/components/case/*`、`apps/web/src/app/dashboard/cases/*`
- **核對日期**：2026-09-30

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `case` | 工單的建立、清單與篩選、狀態轉換、指派、升級、備註、標籤、時間軸、刪除與統計。自動指派在 `assignment.service.ts` |
| `csat` | 發送滿意度調查、記錄分數、逾時自動結案。沒有路由，由排程、進站攔截器與 `case.routes.ts` 呼叫 |
| `sla` | SLA 政策的 CRUD。工單的期限計算、預警與逾時處置，見[服務水準協議](../SLA.md) |

## 工單從哪裡來

| 來源 | 端點或位置 | 連結對話 |
| --- | --- | --- |
| 在收件匣從對話開工單 | `POST /conversations/:id/case` | 自動連結該對話 |
| 在工單頁直接建立 | `POST /cases` | 不連結，之後可用 `POST /cases/:id/conversations/:conversationId/link` 連結 |

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

合法的轉換定義在 `packages/shared` 的 `VALID_CASE_TRANSITIONS`。API 以 `case-state-machine.ts` 的 `validateTransition()` 檢查，前端 `CaseDetail.tsx` 另有一份相同的表用來產生下拉選項。

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
| `PATCH /cases/:id` 帶 `status` | 工單詳情頁的狀態下拉選單 | 沒有 | 沒有 |

各路徑允許的轉換相同，都會寫入 `resolvedAt` 與 `closedAt`。差別在時間軸與事件：從下拉選單改的狀態不留紀錄，也不會觸發通知、自動化與對外 Webhook。從下拉選單選「已升級」時，主管不會收到通知。詳見 `../../system/AUDIT.md` 的 CASE-01。

## 指派

**手動指派**走 `POST /cases/:id/assign`，會寫 `assigned` 事件並發布 `case.assigned`，被指派的人收到通知。被指派的成員必須屬於同一個租戶，但不檢查是否已停用。

**自動指派**由 `assignment.service.ts` 的 `autoAssignCase()` 執行。觸發條件是：建立工單時沒有指定負責人，但有指定團隊。規則如下：

1. 候選人是該團隊內、`role` 為 `AGENT`、而且啟用中的成員。
2. 挑未結工單最少的人。未結是指狀態為 `OPEN`、`IN_PROGRESS`、`PENDING` 或 `ESCALATED`。
3. 同數時輪流。輪流的位置存在行程記憶體，API 重新啟動或有多個行程時，各自從頭輪。

候選人看的是舊的 `role` 列舉，不是「角色與權限」頁設定的細粒度角色。被指派自訂角色的成員會不會被自動指派，取決於他原本的 `role`，見 `../../system/AUDIT.md` 的 RBAC-03。

自動化規則的「指派客服」動作也能指派工單，見[自動化](./AUTOMATION.md)。

## 升級

升級走 `POST /cases/:id/escalate`，需要填原因。可以同時指定新的優先級與新的負責人。沒指定優先級時，自動提高一級；已經是 `URGENT` 就維持不變。

升級會發布 `case.escalated`，租戶內所有 `ADMIN` 與 `SUPERVISOR` 會收到通知。請求中的 `notifyTargets` 只記在事件裡，不影響誰收到通知。

SLA 逾時也會自動提高優先級，這由 workers 處理，見[服務水準協議](../SLA.md)。

## 期限從哪裡來

建立工單時，`createCaseRecord()` 依下列順序挑 SLA 政策：

1. 請求有帶 `slaPolicyId`，就用那一個。
2. 否則挑同租戶、同優先級的任一個政策。

挑到政策時，`slaDueAt` 設為「現在加上政策的解決時限」。挑不到時，工單沒有期限。

工單以**政策名稱**記錄所用的政策（`Case.slaPolicy`），不是以 ID。之後改優先級不會重算期限。這幾點的後果見 `../../system/AUDIT.md` 的 SLA-03 與 SLA-04。

工單清單可以依 SLA 狀態篩選：`breached` 是已過期，`warning` 是即將到期。預警的時間門檻寫在 `case.service.ts` 的 `listCases()`。

## 備註與時間軸

時間軸由兩種紀錄合成：

- **事件**（`CaseEvent`）：系統自動寫入，例如建立、指派、狀態轉換、升級、連結對話、自動指派。
- **備註**（`CaseNote`）：客服手動新增。

新增備註時可以取消勾選「內部備註」。這個選項只改變時間軸上的樣式，備註不會送給客人。

## 解決之後

`csat.scheduler.ts` 的 `setupCsatScheduler()` 在 API 行程定期執行下列工作：

1. **發送調查**。工單轉成 `RESOLVED` 一段時間後，對工單連結的其中一個對話發送滿意度調查。沒有連結對話的工單不發送。
2. **逾時結案**。調查發出後超過時限仍沒有回覆，把工單轉成 `CLOSED`、發布 `case.closed`，並關閉該工單所有尚未關閉的對話。這個結案不寫時間軸事件。

延遲與時限是 `csat.scheduler.ts` 開頭的常數，租戶不能調整。

調查的形式依渠道而不同，由 `buildCsatChannelMessage()` 產生：

| 渠道 | 形式 |
| --- | --- |
| LINE | Flex Message，五個分數按鈕 |
| 其他渠道 | 文字提示，請客人回覆 `csat:<分數>` |

客人點選分數後，按鈕送出 `csat:<分數>:<工單 ID>`，由進站管線的 CSAT 攔截器交給 `recordCsatScore()` 記錄，並回一則感謝訊息。每張工單只記第一次評分。客服也可以用 `POST /cases/:id/csat` 手動記錄。

`recordCsatScore()` 只寫入屬於收訊租戶、而且聯絡人就是傳訊者的工單；客服手動記錄時只比對租戶。不符合條件的 CSAT 訊息仍會被攔截，但不寫入、不回覆。

非 LINE 渠道的提示格式不含工單 ID，攔截器認不出客人的回覆，見 `../../system/AUDIT.md` 的 CASE-02。

## 刪除

`DELETE /cases/:id` 是硬刪除。工單的事件、備註與標籤一併刪除，連結的對話解除關聯但保留。刪除會寫一筆 `case.delete` 租戶稽核紀錄，這是事後唯一的痕跡。任何狀態的工單都能刪除，只要渠道層級為 `full`。

## 誰看得到哪些工單

工單依它的 `channelId` 套用渠道可見範圍，規則與收件匣相同，見[收件匣與對話](./INBOX.md#誰看得到哪些對話)。各操作要求的層級：

| 層級 | 允許的操作 |
| --- | --- |
| `read_only` | 讀工單、讀時間軸 |
| `reply_only` | 貼標、加備註 |
| `full` | 改欄位、改狀態、指派、升級、連結對話、記錄 CSAT、刪除 |

下列操作沒有套用可見範圍：`POST /cases` 不檢查 `channelId` 是否可見，`GET /cases/stats` 統計的是全租戶的工單。見 `../../system/AUDIT.md` 的 RBAC-04。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| 非 LINE 渠道無法回覆滿意度調查 | 詳見 `../../system/AUDIT.md` 的 CASE-02 |
| **首次回應 SLA 必定逾時** | 詳見 `../../system/AUDIT.md` 的 SLA-01 |
| 狀態下拉選單不寫時間軸、不發布事件 | 詳見 `../../system/AUDIT.md` 的 CASE-01 |
| 自動指派看舊的角色列舉 | 詳見 `../../system/AUDIT.md` 的 RBAC-03 |
| 工單以政策名稱連結 SLA | 詳見 `../../system/AUDIT.md` 的 SLA-04 |
| 合併、子工單與工單關聯沒有實作 | schema 有 `mergedIntoId`、`parentCaseId` 與 `CaseRelation`，API 沒有讀寫。詳見 `../../system/AUDIT.md` 的 DB-04 |
| 工單路由沒有權限碼 | 只驗登入與渠道可見範圍。詳見 `../../system/AUDIT.md` 的 RBAC-01 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
