## Why

創造智能要求 AI 客服不轉接真人，訪客有進一步需求時一律引導填官網表單。但訪客在網頁聊天（WebChat）傳圖片或影片時，
系統一定轉接真人，這個行為不能從後台關閉。使用者決定所有租戶的網頁聊天都拿掉訪客傳圖片、影片與檔案的功能。

## What Changes

- **BREAKING** `/chatbox` 頁面與舊的網頁 widget 拿掉迴紋針按鈕與選檔，訪客只能傳文字。
- **BREAKING** `POST /api/v1/chatbox/media` 與 `POST /api/v1/webchat/:channelId/media` 一律回 410
  `WEBCHAT_VISITOR_MEDIA_DISABLED`，不驗證工作階段，不儲存檔案。
- **BREAKING** 訪客送出 `type` 為 `image`、`video`、`file` 的訊息時，API 回 400，不交給進站處理。
- 客服在收件匣傳圖片、影片給網頁聊天訪客的功能不變；訪客的聊天視窗照樣顯示這些訊息。
- LINE、Facebook、Instagram 的顧客傳圖片仍會轉接真人，不在這個 change 的範圍。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `webchat-widget`：移除「Visitor message sending」與「Widget shows each message on the side of its sender」，
  改為只能傳文字的需求；新增「訪客上傳路由停用」。
- `webchat-message-contract`：修改「Unified WebChat message input」（訪客的媒體訊息被拒絕）；
  移除「Media messages follow upload then message flow」。
- `webchat-secure-session`：修改「Chatbox active page uses a non-URL claim token」（claim token 不再用於上傳）。
- `webchat-public-abuse-controls`：移除「公開請求的大小限制」與「訊息與上傳請求的頻率限制」，改為不含上傳的「公開訊息請求的大小限制」與「訊息請求的頻率限制」。

## Impact

- API：`apps/api/src/modules/chatbox/`、`apps/api/src/modules/webchat/`（移除 `uploadChatboxMedia`、`uploadVisitorMedia`）。
- 前端：`apps/web/src/app/chatbox/page.tsx`、`apps/widget/src/`。
- 已嵌入網站的網頁聊天在部署後立即生效，不需要租戶改設定。過去訪客傳過的圖片與影片照樣顯示在收件匣。
