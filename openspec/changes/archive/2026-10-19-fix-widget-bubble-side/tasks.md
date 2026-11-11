## 1. 測試

- [x] 1.1 `apps/widget/tests/unit/widget.test.ts` 新增「Visitor message is on the visitor's side」「Agent and bot messages are on the other side」「Visitor media placeholder is on the visitor's side」，在現行程式上失敗

## 2. 實作

- [x] 2.1 `appendMessage()` 參數改為 `fromVisitor`，呼叫端依發送者傳值；上傳中的佔位訊息改用訪客那一邊的樣式
- [x] 2.2 `CHANGELOG.md` 新增條目

## 3. 驗證

- [x] 3.1 `pnpm --filter @open333crm/widget test` 與 `typecheck` 通過
- [x] 3.2 突變：把訪客訊息改回 `fromVisitor: false`，「Visitor message is on the visitor's side」失敗；把佔位訊息改回 `o333-msg-in`，「Visitor media placeholder is on the visitor's side」失敗；把 agent:message 改為 `fromVisitor: true`，「Agent and bot messages are on the other side」失敗
