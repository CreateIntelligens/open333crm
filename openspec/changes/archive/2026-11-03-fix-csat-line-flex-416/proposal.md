## Why

工單解決後，系統對 LINE 客人寄滿意度問卷時以 `contentType: 'flex'` 呼叫 LINE 外掛，但 `buildLineMessage()` 沒有 `flex` 分支（`3a19c457` 新增素材系統時刪掉），落到 `default` 變成空白文字 `{"type":"text","text":""}`，LINE 拒收。外掛回 `{ success: false }` 不拋錯，`sendCsatSurvey()` 不檢查回傳值，`csatSentAt` 已寫入，失敗沒有任何地方看得到（issue #416，AUDIT CASE-03，健檢 HC-LINE-01）。

## What Changes

- LINE 外掛補回 `flex`：content 是一則 Flex message，取 `altText` 與 `contents` 送出；缺少 `altText` 或 `contents` 不送，回失敗並帶原因。舊模板的 `flexJson`／`text` 寫法仍接受。
- LINE 外掛明確支援 `text` 與 `quick_reply`（以前靠 `default` 送成文字）；不認得的 `contentType` 不再悄悄變成空白文字，`sendMessage()` 回 `{ success: false, error }` 並且不呼叫 LINE。同次推送的附加訊息有一則不認得，整批不送。
- `sendCsatSurvey()` 檢查送出結果。送不出時（渠道停用、找不到客人在該渠道的帳號、渠道拒收、送出出錯），問卷訊息的 `metadata` 標 `deliveryFailed` 與 `deliveryError` 並再推一次 `message.new`，工單時間軸寫一筆 `csat_send_failed`。收件匣的問卷卡片顯示「這份問卷沒有送出」與原因，工單時間軸顯示「滿意度問卷沒有送出」。
- 不自動重寄：`csatSentAt` 保留，與既有「每張工單最多寄出一份」一致。重寄的產品決定屬於 #339。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `csat-survey`：送不出的問卷留下客服看得到的紀錄；LINE 客人收到 Flex 問卷。
- `line-messaging`：outbound 訊息類型改為明列，`flex` 的內容格式更新，不認得的類型不送並回原因。

## Impact

- `packages/channel-plugins/src/line/index.ts`（`buildLineMessage()`、`sendMessage()`、新增 `LineMessageBuildError`）
- `apps/api/src/modules/csat/csat.service.ts`（`sendCsatSurvey()`、新增 `recordCsatDeliveryFailure(ctx: TenantCtx, …)`）
- `apps/web/src/components/inbox/CsatMessage.tsx`、`ChatWindow.tsx`、`apps/web/src/components/case/CaseTimeline.tsx`
- 呼叫 LINE 外掛的地方（收件匣、AI 回覆、自動化、發券、群發、Canvas、MCP）實際送的 contentType 都已涵蓋：`text`、`image`、`video`、`audio`、`file`、`flex`、`quick_reply`（非 LINE 才用）、素材的 `line_*`。群發與自動化送素材前已檢查素材渠道與對話渠道一致。只有已停用的舊模板（`message_templates`，目前沒有寫入端）若存著 `imagemap`、`template` 等舊類型，群發會改為失敗並記錄原因，以前是送出空白文字。
