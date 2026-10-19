## Why

嵌入式 widget（`apps/widget`）的訊息左右顛倒：訪客自己送出的訊息顯示在左邊、灰底，客服、Bot 的回覆與問候語顯示在右邊、藍底。一般聊天介面是自己的訊息在右邊，訪客看起來像是在讀別人的對話。後台渠道設定的 WebChat 預覽載入的也是這個 widget（#319）。

原因是 `appendMessage()` 的布林參數用 CRM 的方向（`isOutbound`）決定左右：客服回覆對 CRM 是 OUTBOUND，所以靠右。但 widget 是訪客看的畫面。

## What Changes

- `appendMessage()` 的參數改為 `fromVisitor`：訪客自己送出的文字、圖片與影片靠右（藍底），客服、Bot 的回覆與問候語靠左（灰底）。
- 圖片與影片上傳中的佔位訊息也改為靠右，與上傳完成後的訊息同一邊。
- 後台的 Chatbox 頁面（`apps/web/src/app/chatbox/page.tsx`）原本就是訪客訊息靠右，不改。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `webchat-widget`：新增訊息依發送者決定左右的需求。

## Impact

- `apps/widget/src/ui.ts`、`apps/widget/src/index.ts`。
- 嵌入 widget 的網站要重新載入 `widget.js` 才會套用（`apps/web` build 時由 `sync:widget` 複製）。
