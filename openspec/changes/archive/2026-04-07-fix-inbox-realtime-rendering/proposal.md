## Why

收件匣的 `InboxPage` 使用 `useEffect + api.get()` 取得對話資料，而非 SWR，導致 `ChatWindow` 執行的 `globalMutate('/conversations/:id')` 無法更新父層的 `selectedConversation` 狀態。因此，無論是轉接人工客服、更改狀態、或更改指派對象，畫面都不會即時反映，訊息輸入匡也無法解鎖。

## What Changes

- 將 `InboxPage` 對話詳情的取得方式從 `useEffect + api.get()` 改為 `useSWR('/conversations/:id')`，使 `ChatWindow` 的 `globalMutate` 呼叫能正確觸發父層重新取得最新資料
- 確保轉接人工客服（handoff）後，`isBotHandled` 立即變為 `false`，訊息輸入匡解鎖
- 確保 `statusOptions` 的 `Select` 在狀態變更後即時顯示新值
- 確保 `agentOptions` 的 `Select` 在指派對象變更後即時顯示新值

## Capabilities

### New Capabilities

- （無新增 capability）

### Modified Capabilities

- `core-inbox`: 收件匣對話詳情的資料取得改為 SWR 驅動，使 mutation 後能即時反映於 UI

## Impact

- `apps/web/src/app/dashboard/inbox/page.tsx`：移除 `useEffect` 取得對話資料，改用 `useSWR`
- `apps/web/src/components/inbox/ChatWindow.tsx`：`globalMutate` 行為不變，依賴父層 SWR 更新即可正確運作
- 不影響後端 API；不涉及其他元件
