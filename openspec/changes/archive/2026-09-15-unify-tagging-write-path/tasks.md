## 1. addTagToTarget 支援來源（D1）

- [x] 1.1 AddTagInput 加 `addedBy?: 'agent'|'system'|'automation'`（預設 'agent'）、agentId 改選填
- [x] 1.2 CONTACT 分支 create 用該 addedBy；`contact.tagged` payload 加 `source`
- [x] 1.3 確認既有人工呼叫者不受影響（預設 agent）

## 2. API 端 trackClick 收斂（D2）

- [x] 2.1 shortlink.service trackClick 直接貼標改呼叫 addTagToTarget({ ..., addedBy:'system' })
- [x] 2.2 移除自寫 findFirst→create
- [x] 2.3 仍在 fire-and-forget（catch 吞錯不阻斷點擊追蹤）

## 3. worker add_tag 跨 process 橋（D3）

- [x] 3.1 api 端：新增 redis domain-event channel subscriber → 收到後轉成 in-process `contact.tagged` eventBus 事件（automation.worker 才收得到）
- [x] 3.2 worker：add_tag 貼標後（自寫 upsert，跨 process 無法 import service），透過 redis 發 domain-event（payload: tenantId/contactId/tagId/tagName/source:'automation'）
- [x] 3.3 worker upsert 改用 contactTag.upsert（冪等，對齊 service 語意）

## 4. 迴圈防護（D4）

- [x] 4.1 contact.tagged 事件帶 source
- [x] 4.2 automation.worker 的 contact.tagged subscriber：source==='automation' 不再觸發（斷自我觸發）
- [x] 4.3 human('agent')/click('system') 貼標仍可觸發

## 5. 驗證與收尾

- [x] 5.1 端到端：點擊短連結貼標 → 發 contact.tagged(source system) → 觸發 contact.tagged 規則
- [x] 5.2 automation add_tag → 橋接 → contact.tagged(source automation) → **不**再觸發 add_tag（迴圈防護）
- [x] 5.3 人工貼標 → 仍發 contact.tagged(source agent)，行為不變
- [x] 5.4 冪等：重複貼同 tag 不重複
- [x] 5.5 跨租戶：貼標/事件帶 tenantId 不洩漏
- [x] 5.6 api/workers typecheck 0 error
- [x] 5.7 `openspec validate --strict` 通過
- [x] 5.8 CHANGELOG（Fixed：貼標寫入路徑統一、補發 contact.tagged、迴圈防護；⚠️行為變更：點擊貼標現在會觸發 contact.tagged 規則）
