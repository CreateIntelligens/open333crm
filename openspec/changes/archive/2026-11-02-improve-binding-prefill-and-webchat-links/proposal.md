## Why

issue #253 列出跨渠道 One ID 在 UAT 測試時發現的兩個體驗問題：

- LINE「送出代碼」連結預填「我要綁定帳號，代碼 …（請直接送出）」。LINE 把預填文字放在網址裡，每個中文字都被編碼成 `%E6%88%91…`，網址很長，顧客可能不敢點。
- 網站客服（WebChat）把網址顯示成純文字。綁定邀請會送出連結，但 WebChat 的訪客點不了。

## What Changes

- LINE 預填改成短句「綁定 {代碼}」。兌換不受影響：系統本來就在整段文字中搜尋代碼。
- 嵌入式 widget 與 `/chatbox` 頁面把文字訊息中的 `http://`、`https://` 網址顯示成連結。拆分規則放在 `@open333crm/shared` 的同一個函式，兩個前端共用。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `cross-channel-binding-code`：LINE 預填文字改為短句。
- `webchat-widget`：文字訊息中的網址顯示成連結。

## Impact

- `apps/api/src/modules/identity-binding/binding-links.ts`
- `packages/shared/src/utils/linkify.ts`（新增）
- `apps/widget/src/ui.ts`、`apps/web/src/app/chatbox/page.tsx`
- 優惠券領券連結的預填文字屬於 `coupon-management`，這個 change 不改。
