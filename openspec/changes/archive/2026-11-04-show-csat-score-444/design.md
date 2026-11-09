## Context

`recordCsatScore()` 有兩個入口：進站管線攔截 `csat:<分數>:<工單 ID>`（`prismaAdmin`，以查詢條件限制租戶與聯絡人），以及 `POST /cases/:id/csat`（客服代評，`request.tenantPrisma`）。這個函式仍是舊寫法（收 `TenantDb`），新加的資料寫入照 #416 的 `recordCsatDeliveryFailure()`，寫成收 `TenantCtx` 的函式，由 `recordCsatScore()` 以 `{ tx, tenantId }` 呼叫。

## Decisions

1. **問卷卡片的分數存在問卷訊息的 metadata。** 卡片已經讀 `metadata.csatScore`，`metadata.deliveryFailed` 也是同一種寫法。查詢條件：`contentType: 'csat'`、`metadata.caseId` 等於工單、所在對話屬於該租戶並連結這張工單（先以對話縮小範圍，走索引）。另加 `csatRatedBy` 讓卡片分辨客人評分與客服代評。
2. **推送沿用 `message.new`。** 系統沒有 `message.updated`。收件匣收到 `message.new` 會重新抓訊息，#416 已用同樣方式更新卡片。問卷訊息的推送放在感謝訊息之前，對話列表的最後一則仍是感謝訊息。
3. **評分訊息在後端改寫，不在前端辨識。** 前端辨識只修收件匣，匯出、對話列表的最後一則、AI 讀取的歷史仍是代碼；後端改寫一次，所有讀取端一致。改寫在攔截器判斷之後才做，`ctx.textContent`／`ctx.postbackData` 不變，攔截順序不受影響。改寫內容是程式固定的文字，用 `fixedSystemMessageContent()`：原本有遮罩副本（租戶啟用去識別化）時，遮罩副本同步改成同一段文字，不呼叫 2md。只要格式與分數有效就改寫，不論分數是否寫入（客人在 LINE 上看到的就是這段文字）。
4. **時間軸用既有事件類型的寫法。** 評分是新的 `csat_rated`；自動關閉用既有的 `status_changed`，`payload.reason` 標 `csat_rated`，時間軸顯示「（評分後自動關閉）」。工單原本就是 `CLOSED` 時不寫狀態事件。
