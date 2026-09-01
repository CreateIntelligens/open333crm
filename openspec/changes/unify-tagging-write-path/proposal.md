## Why

架構檢視發現兩個同源的技術債:貼標(對 contact 加 tag)的寫入邏輯散落三處,語意不一致——
- `tag/tagging.service.ts` 的 `addTagToTarget`(line 107):upsert 冪等 + **發 `contact.tagged` 事件**（會觸發下游自動化）。這是「正規」路徑。
- `shortlink/shortlink.service.ts` 的 `trackClick`(直接貼標路徑,line 381-390):自己 findFirst→create,**不發 `contact.tagged`**。
- `workers` 的 `add_tag` 動作(automation-actions.ts:76-116):自己 findFirst→create,**不發 `contact.tagged`**。

後果:(1) **事件鏈斷點**——用「貼標」當觸發的下游自動化(`contact.tagged` trigger),不會被短連結點擊貼標 / 自動化 add_tag 這兩條路徑喚起;(2) **邏輯重複**——三處各寫一份貼標,日後語意要改(如加稽核)得改多處。

## What Changes

- **API 端貼標收斂**：`shortlink.service.ts` 的 `trackClick` 直接貼標改呼叫 `tagging.service.addTagToTarget`(同 process 可 import),取得冪等 + `contact.tagged` 一致行為。
- **`addTagToTarget` 支援貼標來源**：目前 `addedBy` 寫死 `'agent'` + 需 `agentId`。擴充成可帶 `addedBy`('agent'|'system'|'automation') 與選填 agentId,讓非人工路徑(點擊/自動化)也能用同一函式。
- **worker 端貼標一致化(跨 process 限制下)**：`workers` 無法 import api 的 `tagging.service`(獨立 process)。改為 worker 貼標後,**透過既有 redis 橋發一則事件回 api**,由 api 端轉成 `contact.tagged` eventBus 事件——讓 worker 的 add_tag 也能觸發下游自動化。**同時加迴圈防護**(見 design)。
- **迴圈防護**：貼標發 `contact.tagged` → 可能觸發規則 → 規則又 add_tag,恐無限迴圈。加防護(來源標記 / 深度限制)。

不在本 change 範圍:CASE/CONVERSATION 貼標(本次只碰 CONTACT 貼標的斷鏈);remove_tag 的對稱處理(可後續)。

## Capabilities

### Modified Capabilities
- `automation-engine`: 貼標寫入路徑統一——短連結點擊貼標與 worker add_tag 都會發 `contact.tagged`,使「以貼標為觸發」的自動化規則能被這些路徑喚起;含迴圈防護。

## Impact

- **API (`apps/api/src/modules/tag/tagging.service.ts`)**：`addTagToTarget` 的 `AddTagInput` 加 `addedBy?`('agent'|'system'|'automation',預設 'agent')、`agentId` 改選填。CONTACT 分支的 create 用該來源。
- **API (`apps/api/src/modules/shortlink/shortlink.service.ts`)**：`trackClick` 內的直接貼標改呼叫 `addTagToTarget({ ..., addedBy:'system' })`。移除重複的 findFirst→create。
- **Workers (`apps/workers/src/lib/automation-actions.ts`)**：`add_tag` 貼標後,透過 redis 發一則 `contact.tagged` 橋接事件(payload: tenantId/contactId/tagId)。
- **API (`apps/api/src/events` 或 socket bridge 訂閱端)**：新增訂閱該 redis 橋接 channel → 轉發成 in-process `contact.tagged` eventBus 事件(automation.worker 才收得到)。
- **迴圈防護**：`contact.tagged` 觸發的規則若又 add_tag,需標記來源避免無限循環（design 定細節）。
- **相容性**：`addTagToTarget` 既有呼叫者(人工貼標 route)不受影響(addedBy 預設 'agent')。
- **RLS**：貼標仍走既有租戶連線;worker 橋接事件帶 tenantId。
