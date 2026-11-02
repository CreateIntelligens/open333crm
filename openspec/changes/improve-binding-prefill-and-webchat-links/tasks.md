## 1. LINE 預填短句

- [x] 1.1 先寫測試：`apps/api/tests/unit/modules/identity-binding/identity-binding-unit.test.ts`，情境「LINE 預填文字是短句」
- [x] 1.2 修改 `binding-links.ts` 的 `linePrefillText()`
- [x] 1.3 以新的預填文字跑 feature 測試 `inbound-identity-binding.test.ts`（情境「LINE 預填訊息兌換」、「顧客改動預填文字」）

## 2. WebChat 文字中的網址可點

- [x] 2.1 先寫測試：`packages/shared/tests/unit/linkify.test.ts`，涵蓋網址、結尾標點、其他 scheme
- [x] 2.2 新增 `packages/shared/src/utils/linkify.ts` 的 `splitTextLinks()` 並匯出
- [x] 2.3 先寫測試：`apps/widget/tests/unit/widget.test.ts`，情境「Agent reply with an address」、「Other schemes stay text」
- [x] 2.4 `apps/widget/src/ui.ts` 以 DOM 節點產生連結（不用 `innerHTML`）
- [x] 2.5 先寫測試：`apps/web/tests/unit/components/chatbox/linkified-text.test.tsx`，情境「Chatbox message with an address」、「Other schemes stay text」
- [x] 2.6 新增 `LinkifiedText` 元件，`apps/web/src/app/chatbox/page.tsx` 改用它

## 3. CodeQL 回報（PR #430）

CodeQL 回報 `apps/widget/src/ui.ts`「DOM text reinterpreted as HTML」：訪客在輸入框打的文字流進連結的 `href`。`splitTextLinks()` 只產出 http(s) 網址，實際上進不來 `javascript:`，但訪客自己的輸入本來就不需要變成連結。

- [x] 3.1 先寫測試：`apps/widget/tests/unit/widget.test.ts` 與 `apps/web/tests/unit/components/chatbox/message-bubble.test.tsx`，情境「Visitor's own address stays text」，先在斷言上失敗
- [x] 3.2 widget 的訪客文字改由 `appendVisitorText()` 以 `textContent` 顯示，不經過連結轉換；建立連結前再以 `new URL()` 確認協定是 http/https。突變：讓 `appendVisitorText()` 改走連結轉換，測試失敗
- [x] 3.3 `/chatbox` 的訊息泡泡移到 `components/chatbox/MessageBubble.tsx`，訪客自己的訊息（`INBOUND`）維持純文字

## 4. 完成檢查

- [x] 4.1 `pnpm test` 通過
- [x] 4.2 `CHANGELOG.md` 加條目
- [x] 4.3 `node scripts/validate-openspec.mjs improve-binding-prefill-and-webchat-links` 通過

## 突變驗證

「Other schemes stay text」在改動前就通過（原本以 `textContent` 或 React 文字輸出），以突變驗證：

- widget：把 `appendTextWithLinks(el, text)` 改成 `el.innerHTML = text`，`widget.test.ts` 的兩個情境都失敗。
- chatbox：把 `LinkifiedText` 改成 `dangerouslySetInnerHTML` 並以正規式包 `<a>`，`linkified-text.test.tsx` 的兩個情境都失敗。

