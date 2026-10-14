## Why

2026-10-14 創造智能在 UAT 接上 IG 渠道後，第一則私訊含「你好」，命中關鍵字規則「Hi」，AI 因此讓步不回；但這條規則送的是 LINE 素材，workers 判斷渠道不符就略過，只在 log 留一行。顧客什麼都沒收到，收件匣也看不出原因。

追查出兩個問題：

1. AI 只看訊息有沒有命中關鍵字就讓步，不看規則在這個渠道能不能回覆。LINE 用的規則會讓 IG、FB 的 AI 也不回；只加標籤、不回覆的關鍵字規則同樣會讓 AI 不回。
2. workers 的渠道外掛只註冊 LINE、FB。IG 對話裡，關鍵字與自動化規則的「傳送訊息」「傳送素材」都送不出去。

## What Changes

- AI（agent 與 KB 自動回覆）只在命中的關鍵字規則至少有一個能在這個渠道回覆的動作時讓步：`send_message`，或素材渠道與對話相同的 `send_material`。
- `send_material` 因素材渠道與對話不符而略過時，在對話留下一則標示「沒有送出」的系統訊息，說明原因。
- workers 註冊 IG（THREADS）外掛，規則可以回覆 IG 對話。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `automation-engine`：新增「AI 只在關鍵字規則能回覆時讓步」與「素材渠道不符時留下紀錄」兩個需求。
- `threads-channel`：外掛註冊改為 API 與 workers 都要註冊。

## Impact

- `apps/api/src/modules/automation/automation.worker.ts`（`hasMatchingKeywordRule` 多傳渠道）
- `apps/api/src/modules/ai/kb-autoreply.service.ts`（呼叫端傳渠道）
- `apps/workers/src/lib/automation-actions.ts`、`apps/workers/src/lib/channel-delivery.ts`
- `apps/workers/src/index.ts`（註冊 threadsPlugin）
- 不需要 migration，不新增權限點。
