## Why

Webchat 聊天室目前只支援純文字。訪客和客服代表無法傳送或接收圖片/影片，在視覺化溝通場景（商品詢問、問題截圖等）中形成功能缺口。

## What Changes

**Backend API**
- 新增 `POST /api/v1/webchat/:channelId/media` — 訪客上傳圖片/影片，回傳 URL
- 擴充 `POST /api/v1/webchat/:channelId/messages` — 允許 `contentType: image | video`，`content.url` 存入 DB
- `SEND_IMAGE_CONFIG` / `SEND_VIDEO_CONFIG` 的 `allowedChannelTypes` 加入 `WEBCHAT` — 讓客服可透過 inbox `send-image` / `send-video` 傳送媒體給訪客
- `handleVisitorMessage` / Socket 事件 `agent:message` 補充支援 image/video contentType 渲染

**Widget (`apps/widget`)**
- UI 加入附件按鈕（迴紋針圖示）
- 選擇圖片/影片後 `POST /webchat/:channelId/media` 上傳，取得 URL 後呼叫 messages API
- `appendMessage` 支援 `contentType: image` 渲染 `<img>`、`contentType: video` 渲染 `<video>`

**Inbox Web App (`apps/web`)**
- `MessageInput.tsx` 的 `handleFileSelect` 加入 `WEBCHAT` 允許類型

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `webchat-widget`: 新增媒體上傳 API、widget UI 附件按鈕、圖片/影片渲染需求

## Impact

- **`apps/api`**: `webchat.routes.ts`, `webchat.service.ts`, `conversation.routes.ts`（`SEND_IMAGE_CONFIG`, `SEND_VIDEO_CONFIG`）
- **`apps/widget`**: `ui.ts`, `index.ts`（全部 widget 相關邏輯）
- **`apps/web`**: `MessageInput.tsx`
- **`packages/channel-plugins`**: 無（WEBCHAT 不呼叫外部 API）
