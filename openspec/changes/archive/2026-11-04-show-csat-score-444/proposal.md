## Why

2026-11-04 在 UAT 實測 LINE 滿意度問卷（issue #444）：客人評 2 分後，工單有分數、低分通知與自動關閉都正常，但客服在後台看不到結果：

- 收件匣的問卷卡片仍是五顆空星，看起來像客人還沒評；客服再點星星，API 回 400「已評分過」。原因：`recordCsatScore()` 沒有更新問卷訊息（`contentType: 'csat'`）的 `metadata.csatScore`，卡片只讀這個欄位。
- 對話裡客人的評分顯示成 `csat:2:<工單 ID>`。原因：LINE webhook 不送按鈕的 `displayText`，進站管線把 postback 資料原文存成訊息。
- 工單時間軸沒有評分，也沒有評分後自動關閉的紀錄；工單詳情頁沒有分數欄位。

## What Changes

- 記錄分數時（客人回覆或客服代評），系統在同一工單的問卷訊息 `metadata` 寫入 `csatScore` 與 `csatRatedBy`（`customer` 或 `agent`），並對每則更新的問卷訊息再推一次 `message.new`（沿用 #416 的寫法；目前沒有 `message.updated` 事件）。收件匣的問卷卡片有分數時唯讀，標題顯示「客人評 N 分」或「客服代評 N 分」。
- 進站的評分 postback 被攔截後，系統把這則客人訊息的內容改寫成「我的評分：N 分」（與 LINE 按鈕的 `displayText` 同一份文字），原始 postback 存在 `metadata.postbackData`。攔截順序與判斷不變。
- 記錄分數時寫一筆 `csat_rated` 工單事件（客人評分 `actorType: 'contact'`，客服代評 `actorType: 'agent'` 並記錄客服），評分後自動關閉寫一筆 `status_changed`（`actorType: 'system'`，`payload.reason: 'csat_rated'`）。工單時間軸顯示這兩筆，工單詳情頁顯示滿意度分數。

不在範圍：非 LINE 渠道的客人無法回覆問卷（AUDIT CASE-02）、客服代評的去留、低分通知的收件人（#339）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `csat-survey`：新增「評分後收件匣的問卷卡片顯示分數」與「評分寫入工單時間軸」兩條需求。
- `inbound-message-processing`：「CSAT 回覆的攔截」加上評分訊息改寫成可讀文字。

## Impact

- `apps/api/src/modules/csat/csat.service.ts`（`recordCsatScore()`、新增 `recordCsatRating()`、`relabelCsatReplyMessage()`、`csatReplyDisplayText()`）
- `apps/api/src/modules/webhook/inbound-postback-interceptors.ts`（攔截後改寫訊息內容）
- `apps/api/src/modules/case/case.routes.ts`（客服代評傳入評分的客服）
- `apps/web/src/components/inbox/CsatMessage.tsx`、`ChatWindow.tsx`、`apps/web/src/components/case/CaseTimeline.tsx`、`CaseDetail.tsx`
- 沒有 schema 變更、沒有 migration。
