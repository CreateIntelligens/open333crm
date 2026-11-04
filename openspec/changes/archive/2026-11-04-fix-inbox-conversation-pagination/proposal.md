## Why

收件匣的對話列表只請求第一頁 50 段（`useConversations.ts` 寫死 `page=1&limit=50`），沒有「載入更多」。
「未讀」「我的」與搜尋都只在前端對這 50 段過濾，第 51 段以後的對話在收件匣找不到（issue #422、AUDIT CONV-04、
健檢 HC-INBOX-01）。手冊建議改到聯絡人頁找，但只有 WebChat 身分的聯絡人不在聯絡人清單，這個繞道對他們無效。

## What Changes

- 對話列表依 `meta.totalPages` 一頁一頁載入：列表底部顯示「載入更多對話」，按下取下一頁，沒有下一頁時不顯示；
  載入失敗時在列表上顯示錯誤與重試，不只寫 console。
- 已載入的多頁資料合併成一份列表：依 `id` 去重（翻頁期間有對話往前移時，下一頁可能重複出現），依 `updatedAt desc` 排序。
- socket 推來的 `message.new`、`conversation.updated` 合併進任一已載入頁中的那一列並重排；列表沒有那一段對話時重新載入已載入的頁。
- 「未讀」改送後端既有的 `unread=true`，「我的」改送 `assigneeId=<自己的 id>`，不再只過濾已載入的資料。
- `GET /api/v1/conversations` 新增 `search` 參數：去頭尾空白後 1–100 字，比對聯絡人名稱或對話中任一則文字訊息的內容
  （不分大小寫）；搜尋框改由後端執行。tenantId 與渠道可見範圍照舊套用。
- 篩選列的「N 筆結果」改用後端的 `meta.total`。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `core-inbox`：修改「Inbox socket updates reorder locally」（合併到所有已載入的頁）；新增「收件匣對話列表可以載入更多」、
  「收件匣的未讀與我的篩選由後端執行」、「對話列表依關鍵字搜尋」。

## Impact

- `apps/api/src/modules/conversation/conversation.routes.ts`（`listQuerySchema` 加 `search`）
- `apps/api/src/modules/conversation/conversation.service.ts`（`listConversations()` 的 `search` 條件）
- `apps/web/src/hooks/useConversations.ts`（改用 `useSWRInfinite`、多頁合併）
- `apps/web/src/components/inbox/ConversationList.tsx`（未讀、我的、搜尋改送參數；載入更多；錯誤顯示）
- 文件：`docs/ref/system/AUDIT.md`（CONV-04）、`AUDIT-REVIEWS.md`、`docs/ref/features/health/INBOX.md`、
  `docs/ref/features/tenant/INBOX.md`、`.claude/skills/feature-inbox/SKILL.md`、操作手冊 `ch01-inbox.html`、`CHANGELOG.md`
- 不在範圍：聊天視窗只載最近 50 則訊息（HC-INBOX-07）。
