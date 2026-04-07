## 1. 改用 SWR 取得對話詳情

- [x] 1.1 在 `apps/web/src/app/dashboard/inbox/page.tsx` 引入 `useSWR`
- [x] 1.2 以 `useSWR(convId ? \`/conversations/${convId}\` : null, fetcher)` 取代現有的 `useEffect + api.get()` 邏輯，並從 SWR data 派生 `selectedConversation`
- [x] 1.3 移除 `refreshConversation` callback 及其 `useCallback`，改以 SWR 的 `mutate` 函式傳給 `HandoffModal` 的 `onConfirm`

## 2. 驗證三個 Bug 修復

- [x] 2.1 手動測試：執行轉接人工客服，確認 handoff 後訊息輸入匡即時解鎖（`isBotHandled` 變為 false）
- [x] 2.2 手動測試：變更狀態 Select，確認 `conversation.status` 即時更新，Select 顯示新值
- [x] 2.3 手動測試：變更指派對象 Select，確認 `conversation.assignedToId` 即時更新，Select 顯示新值
