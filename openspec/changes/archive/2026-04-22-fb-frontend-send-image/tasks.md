## 1. 前端 MessageInput 解鎖 FB 傳送

- [x] 1.1 在 `handleFileSelect` 中將 `channelType === 'LINE'` 改為 `['LINE', 'FACEBOOK'].includes(channelType)`，使 FB 聊天室可呼叫 `send-image` API
- [x] 1.2 將 else 分支的提示文字更新為「目前僅支援 LINE / Facebook 聊天室傳送圖片」（或排除已支援類型）

## 2. 驗證

- [x] 2.1 在 FB 聊天室點擊附件按鈕，選擇 PNG/JPEG，確認圖片成功傳送並在聊天室顯示
- [x] 2.2 確認非 LINE/FB 渠道仍顯示不支援提示，且不呼叫 API
