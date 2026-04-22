## Context

後端 `POST /api/v1/conversations/:id/send-image` 於上一個 PR 已支援 `FACEBOOK` channelType，但前端 `MessageInput.tsx` 的 `handleFileSelect` 仍以 `channelType === 'LINE'` 硬判斷，對 FB 聊天室顯示「目前僅支援 LINE 聊天室傳送圖片」，導致功能無法使用。

## Goals / Non-Goals

**Goals:**
- 讓 FB 聊天室的附件按鈕可以選擇並傳送圖片
- 與 LINE 使用相同的 `send-image` API 端點
- 未支援渠道維持現有提示訊息

**Non-Goals:**
- 影片傳送（前端尚未開放）
- 後端修改（已完成）
- 其他渠道（Telegram、WebChat 等）

## Decisions

**單一端點，依 channelType 判斷**：後端已統一使用 `send-image`，前端改為 `['LINE', 'FACEBOOK'].includes(channelType)` 即可，無需新增邏輯。

**ACCEPTED_TYPES 不需更動**：FB 同樣僅支援 PNG/JPEG，MAX_FILE_SIZE 20MB 亦相同。

## Risks / Trade-offs

- [Risk] FB Graph API 對檔案大小有額外限制 → 後端已處理錯誤回應，前端以 `alert(err.message)` 顯示
