## 1. 收件匣文字訊息的網址

- [x] 1.1 先寫測試（`apps/web/tests/unit/components/inbox/message-bubble-links.test.tsx`）：「Customer message with an address」「Bot reply with an address」「Other schemes and HTML stay text」「System notice stays text」，在斷言上失敗
- [x] 1.2 `LinkifiedText` 加 `className`；`MessageBubble` 的文字訊息改用 `LinkifiedText`

## 2. 完成檢查

- [x] 2.1 `pnpm --filter @open333crm/web test`、`pnpm --filter @open333crm/web build` 通過
- [x] 2.2 `CHANGELOG.md` 加條目
- [x] 2.3 `node scripts/validate-openspec.mjs inbox-message-links` 通過

## 突變驗證

「Other schemes and HTML stay text」與「System notice stays text」在改動前就通過（原本就是純文字），以突變驗證：文字訊息改成 `dangerouslySetInnerHTML`、系統訊息改用 `LinkifiedText`，兩個情境都失敗。另外兩個情境先在斷言上失敗後才實作。
