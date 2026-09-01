## Context

三處貼標(見 proposal):
- `tagging.service.addTagToTarget`(api，line 107)：upsert + 發 in-process `contact.tagged` eventBus 事件。addedBy 寫死 'agent'、需 agentId。
- `shortlink.trackClick`(api，line 381-390)：自寫 findFirst→create，addedBy 'system'，不發事件。
- `workers add_tag`(automation-actions.ts)：自寫 findFirst→create，addedBy 'automation'，不發事件。

**關鍵架構限制**：
1. `contact.tagged` 是 **api 端 in-process eventBus**（`automation.worker.ts:488` subscribe）。**workers 是獨立 process，無法直接發到它**。worker 目前只有 `publishSocketEvent`（redis `socket:emit`，給前端 socket 用，非 automation eventBus）。
2. `trackClick` 與 `add_tag` 都是 fire-and-forget，不能因貼標發事件而阻斷主流程。

## Goals / Non-Goals

**Goals:**
- api 端 `trackClick` 貼標收斂到 `addTagToTarget`（消重複 + 補發 `contact.tagged`）。
- `addTagToTarget` 支援非人工來源（system/automation）。
- worker add_tag 也能讓 `contact.tagged` 下游規則被喚起（跨 process 橋）。
- 迴圈防護。

**Non-Goals:**
- CASE/CONVERSATION 貼標斷鏈（本次只 CONTACT）。
- remove_tag 對稱處理。
- 把整個 tagging 抽到 packages（過度工程；用事件橋即可）。

## Decisions

### D1. addTagToTarget 支援來源（小改）
- `AddTagInput` 加 `addedBy?: 'agent'|'system'|'automation'`（預設 'agent'）、`agentId` 改選填。
- CONTACT 分支 create 用該 addedBy；`contact.tagged` payload 加 `source`（供迴圈防護）。
- 既有人工呼叫不受影響（預設 agent）。

### D2. api 端 trackClick 收斂（小改）
- `trackClick` 的直接貼標（tagOnClick）改呼叫 `addTagToTarget({ tenantId, targetType:'CONTACT', targetId:contactId, tagId:link.tagOnClick, addedBy:'system' })`。
- 移除自寫 findFirst→create。取得冪等 + 自動發 `contact.tagged`。
- 仍在 fire-and-forget 區塊（catch 吞錯不阻斷點擊追蹤）。

### D3. worker add_tag 跨 process 橋（較大）
- worker 貼標後（自寫 upsert，因無法 import api service），透過既有 redis 機制發一則橋接訊息。
- **選項 A（建議）**：擴充 socket-bridge 的 redis channel 模式，另開一個 `domain-event` channel；api 端新增 subscriber → 轉成 in-process `contact.tagged` eventBus。
- **選項 B（更省）**：worker add_tag 直接入 automation queue 一則「contact.tagged 已發生」的評估 job？——不佳，繞過事件語意。用 A。
- worker upsert 貼標邏輯仍與 addTagToTarget 重複一份（跨 process 無法共用），但可接受（core 冪等邏輯簡單）；長期可抽 packages/shared 的純函式。

### D4. 迴圈防護（必要）
- `contact.tagged` 事件帶 `source`。automation 規則的 add_tag 動作發出的 `contact.tagged`，其 source 標為 'automation'。
- automation.worker 的 `contact.tagged` subscriber：**若事件 source==='automation'，不再觸發 add_tag 類動作**（或設遞迴深度上限 1）。避免 A 貼標→規則→B 貼標→規則…無限。
- 最簡穩妥：**contact.tagged 由 automation 貼標產生時，不再進 automation 評估**（斷開自我觸發），人工/點擊貼標才觸發。

## Risks / Trade-offs

- **範圍比「小重構」大**：D3 跨 process 橋 + D4 迴圈防護是真工程，非純收斂。若只想快解「重複」，可只做 D1+D2（api 端收斂），worker 端補發事件（D3）列為獨立後續。**建議與使用者確認要不要含 D3。**
- **迴圈防護的取捨**：「automation 貼標不再觸發 contact.tagged 規則」最簡單，但也擋掉了「合理的鏈式貼標」（VIP 標→自動加會員標→…）。MVP 先斷自我觸發，之後要鏈式再用深度限制放寬。
- **worker 仍重複一份 upsert**：跨 process 限制下難免。核心邏輯簡單、風險低；標註為已知。
- **既有 trackClick 行為改變**：原本點擊貼標不發事件，收斂後會發 `contact.tagged` → 可能觸發既有規則。**這是修復目的（斷鏈補上），但要確認既有租戶沒有非預期的 contact.tagged 規則會被新觸發**。屬行為變更,需在 CHANGELOG 標明。
