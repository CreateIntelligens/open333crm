## 1. Backend — Media Upload Endpoint

- [x] 1.1 在 `webchat.routes.ts` 新增 `POST /:channelId/media` (multipart)；驗證 `visitorToken` (UUID)、channelId、檔案型別（image/png, image/jpeg, video/mp4, video/quicktime）、檔案大小（圖片 ≤20MB、影片 ≤25MB）
- [x] 1.2 在 `webchat.service.ts` 實作 `uploadVisitorMedia`：呼叫 `uploadFile`，回傳 `{ url, contentType }`
- [x] 1.3 在 `webchat.routes.ts` 擴充 messages endpoint 的 Zod schema：`content` 改為 `z.object({ text: z.string().optional(), url: z.string().optional() }).passthrough()`，移除強制 `text.min(1)`（改在 service 層依 contentType 驗證）

## 2. Backend — Outbound WEBCHAT Support

- [x] 2.1 `SEND_IMAGE_CONFIG.allowedChannelTypes` 加入 `'WEBCHAT'`
- [x] 2.2 `SEND_VIDEO_CONFIG.allowedChannelTypes` 加入 `'WEBCHAT'`
- [x] 2.3 確認 `sendMessage` 在 WEBCHAT 頻道已有 `agent:message` socket emit（不需另加外部 API 呼叫）

## 3. Widget UI — 附件按鈕與上傳流程

- [x] 3.1 `ui.ts` 的 STYLES 加入附件按鈕 `#o333-attach` 與媒體氣泡 `.o333-msg-img` / `.o333-msg-video` 樣式
- [x] 3.2 `ui.ts` 的 `createPanel` 在 input row 加入 `<button id="o333-attach">📎</button>` 和隱藏的 `<input type="file">`，並更新回傳型別
- [x] 3.3 `ui.ts` 的 `appendMessage` 依 `contentType` 分支：`text` 保持現有、`image` 渲染 `<img>`、`video` 渲染 `<video controls>`、其他 fallback `[unsupported]`
- [x] 3.4 `index.ts` 實作 `sendMedia(file: File)`：先 POST multipart 到 `/webchat/:channelId/media`，取得 URL 後呼叫 messages API，optimistic UI 顯示 `[傳送中...]` 暫位
- [x] 3.5 `index.ts` 在 attach button click 觸發 file input，`change` 事件呼叫 `sendMedia`

## 4. Inbox Web App — MessageInput 解鎖 WEBCHAT

- [x] 4.1 `MessageInput.tsx` 的 `handleFileSelect` 中加入 `'WEBCHAT'` 到允許的 channelType 陣列
- [x] 4.2 更新 else 不支援的提示文字（含 WEBCHAT）

## 5. 驗證

- [x] 5.1 訪客在 widget 選擇圖片，確認圖片出現在 widget 與 inbox 聊天室
- [x] 5.2 訪客在 widget 選擇影片，確認影片出現在 widget 與 inbox 聊天室
- [x] 5.3 客服在 inbox WEBCHAT 對話點附件傳送圖片，確認訪客 widget 收到圖片
- [x] 5.4 超過大小限制時 widget 顯示提示，不呼叫 API
