---
name: feature-notifications
description: >
  open333CRM「通知」功能顧問：右上角鈴鐺、通知列表（全部/未讀/已讀）、標記已讀與全部已讀、
  notification.new 即時推播、通知收件人怎麼算（新訊息通知誰、工單指派/升級通知誰、升級對話框的
  「通知對象」notifyTargets、CSAT 低分、SLA、自動化「傳送通知」「通知主管」）、AI 用量 80%/100% 告警信、
  FB/IG 權杖失效通知、系統信寄送模式（EMAIL_DELIVERY_MODE）。當需求、bug 或新功能碰到 notification、
  Notification 表、createAndDispatch、enqueueNotification、usage.quota.threshold、/dashboard/notifications、
  NotificationBell、「沒收到通知」「通知太多」「通知點了跳錯頁」「通知偏好/靜音」時使用。
  也在改工單指派/升級、收訊流程、成員停用、渠道可見範圍、自動化通知動作前使用，確認收件人沒有算錯。
---

# 通知

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/NOTIFICATIONS.md`
  - 注意：其中「除了 AI 額度告警，都不寄信」已過時，FB/IG 權杖失效也寄信（`apps/api/src/modules/channel/meta-token-health.ts`）；也沒列出權杖失效、資料匯出、資料刪除三種通知來源。見健檢「文件過時之處」。
  - `docs/20_NOTIFICATION.md` 是早期設計稿，裡面的 Web Push、靜音設定、工單事件寄信**都沒有實作**，不要照它回答。
- 健檢結果與已知問題：`docs/ref/features/health/NOTIFICATIONS.md`
- 規格：`openspec/specs/usage-quota-alerts/spec.md`、`openspec/specs/standalone-worker-runtime/spec.md`（Notification Job Consumer／Handling／Retry、同一個事件不重複建立站內通知）、`openspec/specs/email-delivery/spec.md`
- 收件人與角色的關係：`docs/ref/system/AUDIT.md` 的 RBAC-03（收件人看 `Agent.role` 舊列舉）
- 影響分析：`node scripts/feature-impact.mjs --domain notifications`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 鈴鐺未讀數 | Topbar 鈴鐺（`apps/web/src/components/notification/NotificationBell.tsx`） | `GET /notifications/unread-count` → `getUnreadCount`；每 60 秒輪詢，收到 socket `notification.new` 立即重抓 | 無 | 只驗登入，無權限碼；每人只看自己的（`agentId` + `tenantId`） |
| 2 | 鈴鐺下拉 | 點鈴鐺 | `GET /notifications?page=1&limit=10` | 無 | 同上 |
| 3 | 點一則通知 | 鈴鐺下拉或通知列表 | 未讀時 `PATCH /notifications/:id/read` → `markAsRead`，再 `router.push(clickUrl)` | 寫 `isRead`、`readAt`。別人的通知回 404 | 同上 |
| 4 | 通知列表 | 側欄「客服工作 → 通知」`/dashboard/notifications` | `GET /notifications?isRead=true|false&page&limit=20` | 無；分頁 20 則 | 同上 |
| 5 | 單筆標記已讀 | 列表卡片右側雙勾 | `PATCH /notifications/:id/read` | 同 3，但不跳頁 | 同上 |
| 6 | 全部已讀 | 列表 Topbar 或鈴鐺下拉「全部已讀」 | `POST /notifications/read-all` → `markAllAsRead` | 只改自己的未讀 | 同上。列表頁按鈕一律顯示（沒有未讀也顯示） |
| 7 | 即時推播（系統） | 任何頁面 | workers 寫入後 `publishSocketEvent` → Redis `socket:emit` → API 轉送到 `agent:<成員 ID>` 房間 | 前端兩個 SWR（列表、未讀數）重抓 | — |

**通知從哪裡來（系統流程，沒有操作入口）**

| 來源 | 觸發 | 收件人 | 寫入路徑 | 類型 / clickUrl |
| ---- | ---- | ------ | -------- | --------------- |
| 客人傳訊息 | `message.received` | 對話有負責人 → 只通知負責人（**不檢查是否已停用**）；沒有 → 所有啟用中的 `ADMIN`、`SUPERVISOR`（**不看渠道可見範圍**） | `notification.worker.ts` → `notification` queue → workers | `new_message` / `/dashboard/inbox?conv=` |
| 工單指派 | `case.assigned`（只有 `POST /cases/:id/assign` 與自動派案發布） | 被指派人 | 同上 | `case_assigned` / `/dashboard/cases/:id` |
| 工單升級 | `case.escalated` | `resolveEscalationRecipients`：`notifyTargets` 含 `supervisor` → 所有 ADMIN+SUPERVISOR；含 `original_assignee` → 升級前負責人；沒帶 → 只有主管；`[]` → 沒人；升級的人自己一律排除。**升級時改派的新負責人不通知** | 同上 | `case_escalated` |
| CSAT ≤ 2 分 | `recordCsatScore()` | 只有 `SUPERVISOR`（不含 ADMIN） | API 行程直接 `createAndDispatch`（不經佇列、不重試） | `csat_low_score` / `/dashboard/cases?id=`（列表頁不讀 id） |
| SLA 預警／逾時 | workers `sla.handler.ts` | 負責人；逾時再加 ADMIN+SUPERVISOR | workers 直接 `enqueueNotification` | `sla_warning`、`sla_breached`、`first_response_*`、`customer_waiting_breached` |
| 自動化「傳送通知」 | workers `automation-actions.ts` | 指定客服 → 工單負責人 → 對話負責人（都要啟用中）→ 都沒有時 ADMIN+SUPERVISOR | 同上 | `sla_rule` / 工單或對話 |
| 自動化「通知主管」 | 同上 | ADMIN+SUPERVISOR | 同上 | `sla_rule` / 只有工單時才有連結 |
| AI 用量 80%／100% | `usage.quota.threshold`（`llm.service.ts` 累加後偵測，Redis `SET NX` 每月每門檻一次） | 所有啟用中的 `ADMIN` | 站內通知走佇列；email 走 `usage-alert-email` 佇列，job id `<事件 id>__<管理員 id>` | `usage_quota_warning`、`usage_quota_critical` / `/dashboard/plan` |
| FB/IG 權杖失效 | `meta-token-health.ts` 每 6 小時；持續失效每 3 天再提醒 | 所有 `ADMIN` | API 行程 `createAndDispatch` + `sendEmail` | `channel_token_invalid` / `/dashboard/settings/channels` |
| 資料匯出／刪除完成 | workers `data-export.handler.ts`、`data-erasure.handler.ts` | 發起人 | `enqueueNotification` | `data_export_ready`、`data_export_failed`（連到不存在的頁面，EXPORT-01）、`data_erasure_done`（無連結） |

**沒有發布端的訂閱**：`conversation.assigned`（CONV-02，指派對話不會通知）、`sla.warning`／`sla.breached` 在 API 行程（APP-05）。`conversation.handoff` 沒有訂閱（CONV-03）。

**有後端、沒有前端入口**：無。**前端有、後端沒有**：無。**兩邊都沒有**：通知偏好／靜音、刪除通知、保留期限、Web Push、工單事件寄信（`docs/20_NOTIFICATION.md` 的設計未實作）。

**前端實際送出的值**：列表 `isRead` 只送 `'true'`/`'false'` 或不送，`page`、`limit` 10 或 20；升級對話框（`apps/web/src/components/case/EscalationModal.tsx`）的 `notifyTargets` 是 `['supervisor','original_assignee']` 的子集，兩個都不勾時送 `[]`。後端 Zod（`apps/api/src/modules/case/case.routes.ts`）另外接受 `'team'`，只接受、不通知任何人；#261 曾因前端送 `team`、後端不接受而 400，**收緊這個列舉前要先確認沒有呼叫端會送**。

## 不可破壞的規則
- 站內通知的寫入只在 workers（`apps/workers/src/handlers/notification.handler.ts`）；API 的 `notification.worker.ts` 只送 job（規格 `standalone-worker-runtime`「Notification Job Consumer」）。CSAT 與權杖失效是現存例外，不要再新增 `createAndDispatch` 的呼叫端。
- 同一個事件不重複通知：job id 一律 `<事件 id>__<成員 id>`（自動化是 `<事件 id>__<規則 id>#<序號>__<成員 id>`）。新增收件人邏輯時沿用 `enqueueDispatch`，不要自己 `add` 沒有 jobId 的 job。
- 推播失敗只記 log、job 照常完成；寫入失敗要丟錯讓 BullMQ 重試（3 次、指數退避 5 秒）。不要把寫入失敗吞掉。
- 用量告警不可阻擋 AI 回覆：整段 fire-and-forget；告警信一定經佇列，不在訂閱者內直接寄。
- 告警信與權杖失效信的使用者輸入（租戶名稱、渠道名稱）要 HTML 轉義。
- 收件人目前看 `Agent.role` 舊列舉（RBAC-03）。細粒度角色、渠道可見範圍都不影響誰收到。改成看權限時要一起處理：未指派新訊息、升級、SLA、自動化通知主管、CSAT、用量告警、權杖失效七個地方。
- worker 走 BYPASSRLS 連線（`app.prismaAdmin` 傳給 `setupNotificationWorker`），每個查詢都要自帶 `tenantId`。
- 成員清除（`purgeAgent`）會先刪他的通知（外鍵 RESTRICT）；新增掛在 Agent 上的通知相關表也要加進去。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain notifications` 看最新版本。重點：
- **被依賴**：收件匣（新訊息）、工單（指派、升級、CSAT）、SLA、自動化（兩個通知動作）、平台用量（AI 告警）、治理（匯出／刪除完成）、渠道（權杖失效）、聯絡人與試用（共用 `email.service.ts` 寄信）。
- **依賴**：人員（`role`、`isActive`）、渠道（目前**沒有**套用可見範圍）。
- 改 `case.assigned`、`case.escalated`、`message.received`、`usage.quota.threshold` 的 payload 欄位前，先看 `apps/api/src/modules/notification/notification.worker.ts` 讀了哪些欄位。

## 回歸清單
改到本領域時，至少重走：
1. 用模擬器（`POST /simulator/send-message`）對未指派對話送一則 → 所有 ADMIN、SUPERVISOR 各一則 `new_message`；指派給客服後再送 → 只有那位客服收到。
2. 工單 `POST /cases/:id/assign` → 被指派人收到；升級對話框分別勾/不勾兩個通知對象 → 收件人正確、升級的人自己沒收到。
3. 開著另一個帳號的頁面，觸發通知 → 鈴鐺數字不重新整理就更新；點通知 → 變已讀並跳到 `clickUrl`。
4. 通知列表：全部/未讀/已讀切換、單筆已讀、全部已讀、翻頁；重新整理後狀態一致。
5. 錯誤案例：別人的通知 `PATCH /notifications/:id/read` → 404；`isRead=foo`、`limit=101` → 400；未登入 → 401。
- 自動測試：`pnpm --filter @open333crm/api test -- modules/notification usage-quota`、`pnpm --filter @open333crm/workers test -- notification automation-notify`、`pnpm --filter @open333crm/web test -- notifications-type-labels`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/case/case-escalate-notify-targets modules/trial/token-quota-alert`（要先搶鎖）。
- E2E：`apps/web/tests/e2e-uat/tenant-misc.spec.ts` 的 `@notifications`。

## 常見 bug 從哪裡查
- 「主管說沒收到新訊息通知」：先看對話是否已指派（已指派只通知負責人）；負責人是不是已停用（停用不會解除指派，通知只寫給停用的人，見健檢 HC-NOTIFICATIONS-02）；再看主管的 `Agent.role` 是不是 `SUPERVISOR`/`ADMIN`（自訂角色沿用原本的列舉，RBAC-03）。
- 「指派對話後對方沒收到通知」：設計上就沒有（CONV-02），不是佇列壞掉。
- 「建立工單時選了負責人，對方沒收到」：只有 `/cases/:id/assign` 發 `case.assigned`；升級時改派也一樣不通知（HC-NOTIFICATIONS-03、04）。
- 「通知點了找不到頁面」：查 `clickUrl` 是誰寫的（上表）。CSAT 到列表、資料匯出到不存在的頁面、權杖失效到渠道管理。
- 「通知類型顯示『通知』」：`apps/web/src/app/dashboard/notifications/page.tsx` 的 `TYPE_CONFIG` 沒有那個 type；鈴鐺的圖示表在 `NotificationBell.tsx`，兩份要一起改。
- 「通知寫進資料庫但沒即時跳」：Redis `socket:emit` → `apps/api/src/plugins/socket.plugin.ts` 的訂閱轉送；前端 `apps/web/src/hooks/useNotifications.ts` 監聽 `notification.new`。推播是盡力而為，60 秒輪詢會補上。
- 「AI 用量告警沒寄」：`USAGE_QUOTA_ALERTS_ENABLED`、Redis 旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}` 是否已存在（換方案後不重發，PLAN-13）、BYOK 不計、`usage-alert-email` 佇列失敗紀錄、`EMAIL_DELIVERY_MODE`（`apps/api/src/modules/email/email.service.ts`）。
