## Why

主規格 `inbound-message-processing` 的前 5 條需求，是重構 `processInboundMessage` 時寫的相容性需求，例如「Inbound message behavior remains unchanged」。#217 決定刪除這 5 條（Daniel，留言 6118718773），做法是另開 change，用 `## REMOVED Requirements` 列出並改寫 Purpose。

逐條對照之後，這 5 條不能整條刪除。其中有一部分是系統現在仍要維持的行為，而且其他主規格沒有涵蓋：

- CSAT 回覆只寫入同租戶、同聯絡人的工單。這是 #199 修正 AUDIT RLS-06 時加在「Postback intercept behavior remains unchanged」的安全規則，`csat-record-scope.test.ts` 的測試名稱也直接引用這裡的 Scenario。
- KB 回饋的攔截。
- 一般進站訊息的保存與通知：累加未讀數、推送 `message.new` 與 `conversation.updated`、發布 `message.received`。
- 沒有聯絡人 UID 的進站事件直接略過。

只用 REMOVED 刪除，這些行為就會失去規格依據。所以這個 change 刪除 5 條，同時把上面 4 項改寫成獨立的需求。

## What Changes

- `inbound-message-processing`：
  - REMOVED 5 條相容性需求。
  - ADDED 4 條需求：沒有聯絡人 UID 的進站事件直接略過、一般進站訊息的保存與通知、CSAT 回覆的攔截、KB 回饋的攔截。
  - 歸檔後改寫 Purpose。
- `core-inbox`：MODIFIED「Real-time WebSocket Broadcasting」。原文寫推送 `message.created`，但程式從來沒有發出這個事件，實際的事件是 `message.new`。不改的話，`core-inbox` 會和新的「一般進站訊息的保存與通知」互相矛盾。
- 新增測試 `apps/api/tests/feature/modules/webhook/inbound-message-processing.test.ts`，經過真實的進站管線檢查一般訊息、CSAT 與 KB 回饋。
- 既有測試改用新的 Scenario 名稱：`csat-record-scope.test.ts`、`inbound-message-refactor.test.ts`。`inbound-message-refactor.test.ts` 的「進站事件沒有聯絡人 UID」另外檢查不發布 EventBus 事件。

### 刪除的需求與去向

| 刪除的需求 | 去向 |
| --- | --- |
| Process inbound message facade remains compatible | 不保留。這是重構時的介面約束 |
| Inbound message behavior remains unchanged | 沒有聯絡人 UID → 新需求「沒有聯絡人 UID 的進站事件直接略過」；一般訊息 → 新需求「一般進站訊息的保存與通知」；新 UID 建立聯絡人 → `inbound-contact-resolution` 已涵蓋；`clientMessageId` 去重 → `webchat-message-contract` 已涵蓋 |
| Postback intercept behavior remains unchanged | CSAT → 新需求「CSAT 回覆的攔截」；KB 回饋 → 新需求「KB 回饋的攔截」；轉真人 → `bot-handoff-config` 的「Webhook intercepts handoff_request postback」已涵蓋 |
| Processing reuses caller-provided Prisma and per-message objects | 不保留。這是實作細節；不自行建立 Prisma client 已是 `AGENTS.md` 的結構規則 2 |
| Refactor does not alter external contracts | 不保留。「不需要 migration」只在重構當時有意義；socket 與事件的內容改由「一般進站訊息的保存與通知」規定 |

「Inbound message behavior remains unchanged」的一般訊息 Scenario 也寫了「觸發 canvas flow」。新需求沒有保留這一項：沒有租戶使用 Canvas（AUDIT RLS-01）。

`inbound-message-refactor.test.ts` 裡有 2 個讀原始碼的測試（「facade and caller contracts from source」「refactor structure from source」），原本對應被刪除的需求。這個 change 不刪除它們，它們仍然檢查呼叫端的參數與「不建立 Prisma client」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `inbound-message-processing`：刪除 5 條相容性需求，新增 4 條長期行為的需求。
- `core-inbox`：「Real-time WebSocket Broadcasting」的事件名稱改為 `message.new`。

## Impact

- `openspec/specs/inbound-message-processing/spec.md`、`openspec/specs/core-inbox/spec.md`（歸檔時套用）
- `apps/api/tests/feature/modules/webhook/inbound-message-processing.test.ts`（新增）
- `apps/api/tests/feature/modules/csat/csat-record-scope.test.ts`、`apps/api/tests/unit/modules/webhook/inbound-message-refactor.test.ts`（測試名稱）
