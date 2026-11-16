## Why

Issue #520：工單寄過問卷、客人還沒評分時被重新開啟（改回開啟或處理中），客人之後點**舊的**問卷卡片，
`recordCsatScore()` 只檢查 `csatScore` 是空值、不看工單狀態，於是記下分數、把客服正在處理的工單直接改成已關閉、
關閉對話，低分時還發低分通知。72 小時逾時結案後才點舊問卷，也會把分數記進已關閉的工單。

2026-11-12 使用者在 #520 決定方案 A：**只有狀態是「已解決」的工單才收客人評分**。

## What Changes

- 客人評分（不帶 `agentId` 的 `recordCsatScore()`，來源是 LINE postback 與客人手打的 `csat:N:<工單 ID>`）只在工單狀態是
  `RESOLVED` 時記錄。其他狀態一律不記分、不送感謝訊息、不發低分通知、不改工單與對話，回傳 `false`；進站管線照常攔截這則訊息，
  不交給 AI 與自動化（與「已評分」「別人的工單」相同處理）。
- 條件更新的 `where` 加上 `status: 'RESOLVED'`：讀取之後工單才被重開時同樣不寫入。
- 客服代評（`POST /cases/:id/csat`，帶 `agentId`）不受影響：#339 決定客服可以在任何狀態代評。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `csat-survey`：新增「客人只能替已解決的工單評分」。

## Impact

- `apps/api/src/modules/csat/csat.service.ts` 的 `recordCsatScore()`。
- 被拒絕的評分沒有回覆客人，只寫 warn log（與已評分時相同）；客人在 LINE 上看到自己點的「我的評分：N 分」，沒有感謝訊息。
