## 1. 測試

這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。

| 需求 | 情境 | 測試 |
| --- | --- | --- |
| 沒有聯絡人 UID 的進站事件直接略過 | 進站事件沒有聯絡人 UID | 既有：`apps/api/tests/unit/modules/webhook/inbound-message-refactor.test.ts`，改名並補上 EventBus 的檢查 |
| 一般進站訊息的保存與通知 | 一般進站訊息 | 新增：`apps/api/tests/feature/modules/webhook/inbound-message-processing.test.ts` |
| CSAT 回覆的攔截 | 同租戶、同聯絡人的工單寫入評分 | 既有：`apps/api/tests/feature/modules/csat/csat-record-scope.test.ts`，改名。新增：`inbound-message-processing.test.ts`，經過進站管線，檢查不發布 `message.received` |
| CSAT 回覆的攔截 | 其他租戶的工單 | 既有：`csat-record-scope.test.ts` 與 `inbound-message-refactor.test.ts`，改名 |
| CSAT 回覆的攔截 | 同租戶其他聯絡人的工單 | 既有：`csat-record-scope.test.ts`，改名 |
| CSAT 回覆的攔截 | 不存在的工單 | 既有：`csat-record-scope.test.ts` 與 `inbound-message-refactor.test.ts`，改名 |
| KB 回饋的攔截 | KB 回饋寫入收訊租戶的文章 | 新增：`inbound-message-processing.test.ts` |
| KB 回饋的攔截 | KB 回饋引用其他租戶的文章 | 新增：`inbound-message-processing.test.ts` |
| KB 回饋的攔截 | KB 回饋沒有對應的文章 | 新增：`inbound-message-processing.test.ts` |
| `core-inbox`：Real-time WebSocket Broadcasting | Pushing to online agent | 新增：`inbound-message-processing.test.ts` 的「一般進站訊息」 |

CSAT 的既有測試是 #199（AUDIT RLS-06）先寫的失敗測試，修正後通過。這裡只改名稱。

- [x] 1.1 寫上表標「新增」的測試
- [x] 1.2 既有測試改用新的 Scenario 名稱

## 2. 突變驗證

每個突變都讓對應的測試失敗，還原後全部通過。

| 突變 | 失敗的測試 |
| --- | --- |
| `inbound-message.types.ts`：只在 `contactUid` 是 `undefined` 時略過 | 進站事件沒有聯絡人 UID |
| `inbound-message-writer.ts`：`unreadCount` 加 0 | 一般進站訊息 |
| `inbound-socket-presenter.ts`：`emitToConversationAndTenant()` 不推送到租戶的房間 | 一般進站訊息 |
| `webhook.service.ts`：不呼叫 `publishMessageReceived()` | 一般進站訊息 |
| `inbound-side-effects.ts`：不推送 `conversation.updated` | 一般進站訊息 |
| `inbound-side-effects.ts`：事件名稱 `message.new` 改成 `message.created` | 一般進站訊息 |
| `inbound-postback-interceptors.ts`：`handleKbFeedback()` 處理後回傳 `false`（不攔截） | KB 回饋的 3 個測試 |
| `inbound-postback-interceptors.ts`：不送出感謝訊息 | KB 回饋的 3 個測試 |
| `kb-feedback.service.ts`：查詢文章時不限租戶 | KB 回饋引用其他租戶的文章 |
| `kb-feedback.service.ts`：文章 ID 是 `none` 時不提早結束 | KB 回饋沒有對應的文章 |
| `inbound-postback-interceptors.ts`：`handleCsatResponse()` 寫入評分後回傳 `false`（不攔截） | 同租戶、同聯絡人的工單寫入評分 |

- [x] 2.1 執行上表的突變並還原

## 3. 完成檢查

- [x] 3.1 `pnpm test` 與 `pnpm test:feature` 通過
- [x] 3.2 `node scripts/validate-openspec.mjs retire-inbound-refactor-specs` 與 `--specs` 通過
- [x] 3.3 在同一個 PR 以 `pnpm exec openspec archive retire-inbound-refactor-specs` 歸檔，並改寫 `inbound-message-processing` 的 Purpose。歸檔前後比較 `validate-openspec.mjs --specs` 的「略過 N 則」
