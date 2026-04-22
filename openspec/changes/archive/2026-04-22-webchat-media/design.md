## Context

Widget 目前只支援文字。後端 `webchat.routes.ts` 的 messages endpoint 用 `z.object({ text: z.string().min(1) })` 強制要求文字，`appendMessage` 只渲染 `msg.content.text`。Inbox `send-image`/`send-video` 的 `allowedChannelTypes` 不含 `WEBCHAT`，送出會回傳 501。

## Goals / Non-Goals

**Goals:**
- 訪客可在 widget 上傳圖片/影片，透過新的 media endpoint 存入 MinIO，以 `image/video` contentType 傳送訊息
- 客服可在 inbox 透過 send-image / send-video 傳送媒體給 webchat 訪客
- Widget 渲染 `<img>` 與 `<video>` 訊息泡泡
- Inbox MessageInput 附件按鈕支援 WEBCHAT 頻道

**Non-Goals:**
- 音訊傳送
- 上傳進度條（此版本用 `sending...` 文字佔位即可）
- 客服端媒體 preview（已有 bubble 實作）

## Decisions

**獨立 media upload endpoint (`/webchat/:channelId/media`)**：訪客先上傳，取得 URL 後再呼叫 messages，與現有文字流程解耦，不污染 messages endpoint 的 multipart vs JSON 邏輯。

**WEBCHAT outbound 不呼叫外部 API**：`sendMessage` 在 WEBCHAT 頻道只需存 DB + emit Socket，ChannelPlugin 不需實作 `pushMessage`。後端 `send-image` 呼叫 `sendMessage` 已有 Socket emit，直接加 `WEBCHAT` 到 allowedChannelTypes 即可。

**`appendMessage` 依 `contentType` 分支**：現有函式以 `msg.content.text` 渲染，新增 `image` 分支（`<img>`）與 `video` 分支（`<video controls>`），其他類型 fallback 到 `[unsupported]` 文字。

## Risks / Trade-offs

- [Risk] 大型影片佔用 widget 空間 → `<video>` 設定 `max-width: 100%; max-height: 200px`
- [Risk] 訪客上傳不驗證 auth → media endpoint 為公開 endpoint，以 `visitorToken` + `channelId` 確認合法性（同現有 messages）
