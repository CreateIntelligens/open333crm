## Why

客服接手（`POST /conversations/:id/handoff`）後，對話就停在客服處理，後台沒有辦法交回 Bot。狀態下拉選單只有「進行中」「已處理」「已關閉」；API 雖然接受 `PATCH status: BOT_HANDLED`，但不會把 bot 回覆次數歸零，曾因次數到上限自動轉真人的對話，下一則訊息又會馬上轉回真人。目前只能結案，等顧客再傳訊息開新對話。

2026-10-14 測試創造智能的 IG 渠道時，客服手動回覆後想讓 bot 繼續回，找不到方法。

## What Changes

- 新增 `POST /conversations/:id/return-to-bot`：把客服處理中或進行中的對話交回 Bot。狀態改為 `BOT_HANDLED`，bot 回覆次數歸零、清除轉真人原因，保留指派的客服。對話寫入一則只給客服看的系統訊息，不送給顧客。
- 已結案、已經是 Bot 處理、或渠道的 bot 模式為關閉時，回 400 並說明原因。
- 權限與接管對話相同：`inbox.manage`，且要能完整存取該渠道。
- 收件匣對話上方新增「交回 Bot」按鈕，在客服處理中或進行中的對話顯示。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `core-inbox`：新增「客服把對話交回 Bot」需求。

## Impact

- `apps/api/src/modules/conversation/conversation.service.ts`、`conversation.routes.ts`
- `apps/web/src/components/inbox/ChatWindow.tsx`，新元件 `ReturnToBotButton.tsx`
- 不需要 migration，不新增權限點。
