## Why

`MessageInput.tsx` 的 `handleFileSelect` 對非 LINE 聊天室一律顯示「目前僅支援 LINE 聊天室傳送圖片」。後端 `send-image` 端點已在上一個 PR 中支援 Facebook Messenger，前端卻未同步開放，造成 FB 聊天室無法傳送圖片。

## What Changes

- 移除 `MessageInput.tsx` 中只允許 `LINE` 的 channelType 判斷
- 改為允許 `LINE` 和 `FACEBOOK` 皆可呼叫 `/conversations/:id/send-image`
- 非支援的渠道類型仍顯示提示

## Capabilities

### New Capabilities

（無需新增 spec — 此為對現有 `fb-chat-media` capability 的前端實作補齊）

### Modified Capabilities

- `fb-chat-media`: 前端 MessageInput 現在支援 FB 聊天室傳送圖片（補齊原 spec 中已定義的前端 send-image 路徑）

## Impact

- **前端**：`apps/web/src/components/inbox/MessageInput.tsx` — `handleFileSelect` 邏輯
- **後端**：無需修改（`send-image` 已支援 FB）
- **API**：無需修改
