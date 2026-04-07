## Context

`InboxPage`（`apps/web/src/app/dashboard/inbox/page.tsx`）目前透過 `useEffect + api.get()` 取得並儲存選中的對話資料於 React state（`selectedConversation`）。`ChatWindow` 在執行 handoff、狀態變更、指派對象變更後，呼叫 `globalMutate('/conversations/:id')`，但由於父層不是透過 SWR 取得資料，此 mutate 呼叫對父層的 state 無效，導致 `ChatWindow` 收到的 `conversation` prop 仍為舊資料，三個 bug 均源自此根本原因。

## Goals / Non-Goals

**Goals:**
- 將 `InboxPage` 的對話詳情取得改為 `useSWR`，使 `ChatWindow` 的 `globalMutate` 能夠驅動父層重新渲染
- 修復 handoff 後訊息輸入匡仍鎖住的問題
- 修復 statusOptions 及 agentOptions Select 在變更後不即時反映新值的問題

**Non-Goals:**
- 不修改後端 API
- 不引入 WebSocket / optimistic update 機制（SWR revalidation 已足夠）
- 不重構 `ChatWindow` 內部的資料取得邏輯

## Decisions

### Decision 1：改用 `useSWR` 取得對話詳情

**選擇**：在 `InboxPage` 以 `useSWR('/conversations/${convId}')` 取代 `useEffect + api.get()`。

**理由**：`ChatWindow` 已呼叫 `globalMutate('/conversations/:id')`，若父層使用相同 key 的 SWR，mutation 後 SWR 會自動 revalidate，父層 state 即時更新，三個 bug 一次解決，修改範圍最小。

**替代方案考量**：
- **傳遞 `onRefresh` callback prop 給 ChatWindow**：需要在每個 handler 呼叫後手動呼叫，易遺漏，且需修改 ChatWindow props 介面。
- **ChatWindow 內部自行 useSWR 取得對話**：造成重複取得，且需調整 prop 介面設計。

### Decision 2：保留 `refreshConversation` 用於 HandoffModal

`HandoffModal` 的 `onConfirm` 目前傳入 `refreshConversation`（手動 api.get）。改為 SWR 後，改傳 `() => mutate()` (SWR mutate)，行為一致。

## Risks / Trade-offs

- [Risk] SWR revalidation 產生額外 API 請求 → 可接受，次數與原本 useEffect 相同，僅在 mutation 時觸發
- [Risk] `convId` 為 null 時 SWR key 需處理 → 以條件式 key `convId ? '/conversations/${convId}' : null` 解決（SWR 原生支援 null key 不發請求）
