## 1. 後端搜尋參數

- [x] 1.1 測試 `apps/api/tests/feature/modules/conversation/list-conversations-search.test.ts`：「依聯絡人名稱搜尋」「依訊息內容搜尋」「不分大小寫」「看不到的渠道」「其他租戶的資料」「關鍵字太長」「只有空白」，在現有程式上斷言失敗
- [x] 1.2 同檔「後端只回未讀的對話」：既有行為，寫好就通過；突變驗證：拿掉 `listConversations()` 的 `unread` 條件時失敗。「只有空白」修正前也通過（未知參數被略過），突變驗證：拿掉 `search` 的 `.trim()` 時失敗
- [x] 1.3 `listQuerySchema` 改用既有的 `paginationSchema.extend()`（分頁行為不變）並加 `search`（去頭尾空白、最多 100 字）；`listConversations()` 加聯絡人名稱或訊息文字的條件（design D3）

## 2. 前端多頁載入與後端篩選

- [x] 2.1 測試 `apps/web/tests/unit/hooks/use-conversations-pagination.test.tsx`：「還有下一頁」「已是最後一頁」「下一頁有重複的對話」「Conversation on a later loaded page receives new message」，在現有程式上斷言失敗
- [x] 2.2 同檔「Existing conversation receives new message」「Existing conversation receives update」「Missing conversation cannot be built from socket payload」：既有行為，改寫成多頁後仍要通過；突變驗證：拿掉衍生資料的排序時前兩個失敗、拿掉找不到時的 `mutate()` 時第三個失敗
- [x] 2.3 測試 `apps/web/tests/unit/components/inbox/conversation-list-server-filters.test.tsx`：「切到未讀」「切到我的」「收件匣搜尋框」「載入失敗」「結果數量」，在現有程式上斷言失敗
- [x] 2.4 `useConversations()` 改用 `useSWRInfinite`，回傳 `loadMore`、`hasMore`、`total`；socket 更新合併到各頁（design D1、D2）
- [x] 2.5 `ConversationList` 改送 `unread`、`assigneeId`、`search`；「載入更多對話」；錯誤與重試；結果數量用 `meta.total`（design D4）
- [x] 2.6 「Selected conversation receives inbound message」：既有行為，於 2.1 檔案補測；突變驗證：拿掉 `selected ? 0` 時失敗
- [x] 2.7 「下一頁載入失敗」（`conversation-list-server-filters.test.tsx`）：下一頁失敗時 `isLoadingMore` 不可卡住，重試請求同一頁
- [x] 2.8 `apps/api/tests/unit/modules/conversation/inbox-realtime-source.test.ts` 原本比對 `sortByUpdatedAtDesc`、`updateRows` 函式名稱；本 change 刻意改為 `mergePages`／`updatePages`，移除這兩個名稱斷言，行為改由 2.1、2.2 的測試涵蓋

## 3. 文件

- [x] 3.1 `docs/ref/system/AUDIT.md` CONV-04 改為已修正、`AUDIT-REVIEWS.md` 新增紀錄
- [x] 3.2 `docs/ref/features/health/INBOX.md`（HC-INBOX-01）、`docs/ref/features/tenant/INBOX.md`、`.claude/skills/feature-inbox/SKILL.md`
- [x] 3.3 操作手冊 `apps/web/public/manual/ch01-inbox.html` 改寫 50 段限制的說明
- [x] 3.4 `CHANGELOG.md` 的 `## [2026-11-04]` Fixed 加條目

## 4. 完成定義

- [x] 4.1 `pnpm test`
- [x] 4.2 受影響的 feature 測試（獨立測試庫 `open333crm_test_p3_422`）
- [x] 4.3 `pnpm --filter @open333crm/web build`
- [x] 4.4 `check-tenant-scoping`、`check-prisma-admin-usage`、`check-tenant-ctx` 加 `--strict`
- [x] 4.5 `node scripts/validate-openspec.mjs fix-inbox-conversation-pagination` 與 `--specs`
- [x] 4.6 以 `pnpm exec openspec archive` 歸檔
