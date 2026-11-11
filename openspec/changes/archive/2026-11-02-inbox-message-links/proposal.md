## Why

#430 讓 WebChat 訪客端（widget、`/chatbox`）的網址可以點，但後台收件匣仍把網址顯示成純文字。客服要開顧客貼來的商品頁、或確認 Bot 回覆裡的網址時，只能手動複製貼上。2026-11-02 UAT 驗收時使用者要求收件匣也一樣可以點。

## What Changes

- 收件匣的文字訊息（顧客、客服、Bot 都算）把 `http://`、`https://` 網址顯示成另開分頁的連結（`rel="noopener noreferrer"`）。
- 拆分規則沿用 `@open333crm/shared` 的 `splitTextLinks()`（與 WebChat 相同）：網址後面緊接的標點不算進連結，其他協定與 HTML 標籤維持文字。
- 系統訊息（灰色置中的提示）不變。

收件匣只有客服看得到；顧客傳的網址變成連結，是讓客服方便開啟，與 WebChat 訪客端「訪客自己的網址不轉連結」的理由（不讓訪客輸入變成連結目標）不衝突。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `core-inbox`：新增「收件匣文字訊息中的網址是連結」。

## Impact

- `apps/web/src/components/inbox/MessageBubble.tsx`
- `apps/web/src/components/chatbox/LinkifiedText.tsx`：加 `className`，讓收件匣沿用
- 後端、API、資料不變
