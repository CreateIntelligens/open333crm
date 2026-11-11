## Why

LINE 在聊天列表、手機通知和引用訊息裡，用訊息的 `altText` 當預覽文字。Flex 的兩個編輯器都有「替代文字」欄位，但卡片訊息（carousel）和圖文訊息（imagemap）的編輯器沒有這個欄位。這兩種訊息送出時一律用「多頁訊息」或「圖文訊息」，收到的人在聊天列表看不出訊息內容。

## What Changes

- 卡片訊息和圖文訊息的編輯器加「預覽文字」欄位，存在 body 的 `altText`，最多 400 字（和 Flex 編輯器一樣）。
- 送出時用填的預覽文字。沒填或只有空白時，照舊用「多頁訊息」或「圖文訊息」。原本空字串會原樣送出，LINE 不接受空的 `altText`。
- 卡片訊息切換頁面類型時，保留預覽文字和結尾頁。原本切換會把 body 換成只剩 `pageType` 和 `pages`。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `material-system`：新增「卡片訊息與圖文訊息的預覽文字」。

## Impact

- `packages/channel-plugins/src/line/builders.ts`
- `apps/web/src/components/materials/line/LineCarouselEditor.tsx`、`LineImagemapEditor.tsx`
- 已存的素材沒有 `altText`，送出時照舊用預設文字。
