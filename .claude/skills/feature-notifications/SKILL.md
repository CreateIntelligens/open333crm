---
name: feature-notifications
description: >
  open333CRM「通知」功能顧問：鈴鐺與通知列表、即時推播、通知收件人怎麼算、AI 用量告警信、系統信寄送。改到 notification 模組、/dashboard/notifications，或改工單指派／升級、收訊流程、自動化通知動作之前使用。
---

# 通知

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。通知的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

右上角鈴鐺、通知列表（全部／未讀／已讀）、標記已讀與全部已讀、`notification.new` 即時推播。
通知收件人怎麼算：新訊息、轉接真人、工單指派與升級（`notifyTargets`）、CSAT 低分、SLA、自動化「傳送通知」「通知主管」。
AI 用量 80%／100% 告警信、FB／IG 權杖失效通知、系統信的寄送模式（`EMAIL_DELIVERY_MODE`）。
相關的程式與資料：notification 模組、`Notification` 表、`createAndDispatch`、`enqueueNotification`、`usage.quota.threshold`、`/dashboard/notifications`、`NotificationBell`。
「沒收到通知」「通知太多」「通知點了跳錯頁」「通知偏好／靜音」也使用。改工單指派與升級、收訊流程、成員停用、渠道可見範圍、自動化通知動作之前也使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/NOTIFICATIONS.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `NOTIFICATIONS.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式、寫入通知的函式 | 程式的入口 |
| 佇列、job id 去重、重試、推播、停用成員、寄信備援 | 一則通知怎麼送到 |
| 某個事件通知誰、通知類型、連結 | 哪些事件通知誰 |
| AI 額度告警與告警信 | AI 額度告警 |
| 通知的 API、查詢參數、保留期限 | 讀取與保留 |
| 鈴鐺、通知列表、類型名稱、升級對話框送的值 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的通知測試在 `apps/api/tests/unit/modules/notification/`、`apps/workers/tests/unit/handlers/`（`notification.handler.test.ts`）、`apps/web/tests/unit/app/`（`notifications-type-labels.test.tsx`），寫法可以照著參考。

`NOTIFICATIONS.md` 裡標 `HC-NOTIFICATIONS-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/NOTIFICATIONS.md`
- 規格：`openspec/specs/usage-quota-alerts/spec.md`、`openspec/specs/standalone-worker-runtime/spec.md`（Notification Job Consumer／Handling／Retry、同一個事件不重複建立站內通知）、`openspec/specs/email-delivery/spec.md`
- 收件人與角色的關係：`docs/ref/system/AUDIT.md` 的 RBAC-03
- 注意：`docs/20_NOTIFICATION.md` 是早期設計稿，裡面的 Web Push、靜音設定、工單事件寄信都沒有實作，不要照它回答。
- 影響分析：`node scripts/feature-impact.mjs --domain notifications`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `NOTIFICATIONS.md` 括號內的章節。

- 站內通知的寫入只在 workers（`apps/workers/src/handlers/notification.handler.ts`）。API 的 `notification.worker.ts` 只送 job。`createAndDispatch()` 的現存寫入點是例外，不要再新增。（一則通知怎麼送到）
- 同一個事件不重複通知：job id 一律 `<事件 id>__<成員 id>`。新增收件人邏輯時沿用 `enqueueDispatch`，不要自己 `add` 沒有 jobId 的 job。（一則通知怎麼送到）
- 推播失敗只記 log，job 照常完成。寫入失敗要丟錯，讓 BullMQ 重試。不要吞掉寫入失敗。（一則通知怎麼送到）
- 每個寫入 `notifications` 的地方都用 `createNotificationForActiveAgent()`。不要改回「先查再 `notification.create`」，也不要 catch P2003。（一則通知怎麼送到）
- 用量告警不可阻擋 AI 回覆。告警信一定經佇列，不在訂閱者內直接寄。（AI 額度告警）
- 告警信與權杖失效信的使用者輸入要 HTML 轉義。（AI 額度告警）
- 收件人看 `Agent.role` 舊列舉（RBAC-03）。改成看權限時，六個地方要一起改。（哪些事件通知誰）
- worker 走 BYPASSRLS 連線（`app.prismaAdmin` 傳給 `setupNotificationWorker`），每個查詢都要自帶 `tenantId`。（程式的入口）
- 成員清除（`purgeAgent`）先刪他的通知。新增掛在 Agent 上的通知相關表也要加進去。（一則通知怎麼送到）
- 改事件 payload 欄位之前，先看 `notification.worker.ts` 讀了哪些欄位。（哪些事件通知誰）
- UI 不放 emoji 與 ✓。

## 回歸清單

改到本領域時，至少重走：

1. 用模擬器（`POST /simulator/send-message`）對未指派的對話送一則訊息：看得到該渠道的每位 ADMIN、SUPERVISOR 各收到一則 `new_message`。指派給客服後再送一則：只有那位客服收到。
2. 工單：
   - `POST /cases/:id/assign`：被指派人收到通知。
   - 升級對話框分別勾與不勾兩個通知對象：收件人正確，升級的人自己沒收到。
3. 開著另一個帳號的頁面，觸發通知：鈴鐺數字不重新整理就更新。點通知：變成已讀，並跳到 `clickUrl`。
4. 通知列表：全部、未讀、已讀切換，單筆已讀，全部已讀，翻頁。重新整理後狀態一致。
5. 錯誤案例：
   - 別人的通知 `PATCH /notifications/:id/read`：404。
   - `isRead=foo`、`limit=101`：400。
   - 未登入：401。

自動測試：

- `pnpm --filter @open333crm/api test -- modules/notification usage-quota`
- `pnpm --filter @open333crm/workers test -- notification automation-notify`
- `pnpm --filter @open333crm/web test -- notifications-type-labels`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/case/case-escalate-notify-targets modules/trial/token-quota-alert`
- E2E：`apps/web/tests/e2e-uat/tenant-misc.spec.ts` 的 `@notifications`

## 常見 bug 從哪裡查

- 「主管說沒收到新訊息通知」：
  - 先看對話是否已指派。已指派時只通知負責人；負責人已停用或看不到渠道時，改通知主管。
  - 再看主管看不看得到該渠道。
  - 再看主管的 `Agent.role` 是不是 `SUPERVISOR` 或 `ADMIN`。自訂角色沿用原本的列舉（RBAC-03）。
- 「指派對話後對方沒收到通知」：設計上就沒有（CONV-02），不是佇列壞掉。
- 「建立工單時選了負責人，對方沒收到」：只有 `/cases/:id/assign` 與自動指派發 `case.assigned`。升級時改派也不通知（HC-NOTIFICATIONS-03、HC-NOTIFICATIONS-04）。
- 「工單指派或 SLA 預警沒有人收到」：負責人已停用。這兩種通知不改發主管（CONV-06）。
- 「通知點了找不到頁面」：查 `clickUrl` 是誰寫的（功能文件的「哪些事件通知誰」）。CSAT 低分停在列表（HC-NOTIFICATIONS-05），資料匯出連到不存在的頁面（EXPORT-01）。
- 「成員說沒收到通知」：先查他是不是停用中（`isActive=false`）。停用期間的通知被略過，重新啟用也不補送。workers log 有「略過通知」。
- 「通知類型顯示『通知』」：`apps/web/src/app/dashboard/notifications/page.tsx` 的 `TYPE_CONFIG` 沒有那個 type（HC-NOTIFICATIONS-06）。鈴鐺的圖示表在 `NotificationBell.tsx`，兩份要一起改。
- 「通知寫進資料庫但沒即時跳」：
  - Redis `socket:emit` 由 `apps/api/src/plugins/socket.plugin.ts` 訂閱並轉送。
  - 前端 `apps/web/src/hooks/useNotifications.ts` 監聽 `notification.new`。
  - 推播是盡力而為，60 秒輪詢會補上。
- 「AI 用量告警沒寄」：
  - `USAGE_QUOTA_ALERTS_ENABLED` 是否開啟。
  - Redis 旗標 `aiquota-alert:{tenantId}:{YYYY-MM}:{level}` 是否已存在。
  - BYOK 的用量不計。
  - `usage-alert-email` 佇列的失敗紀錄。
  - `EMAIL_DELIVERY_MODE`（`apps/api/src/modules/email/email.service.ts`）。
