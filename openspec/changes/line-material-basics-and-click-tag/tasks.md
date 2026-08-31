## 1. 前置：確認執行路徑

- [ ] 1.1 Trace 一條 automation 規則的實際執行路徑：add_tag 到底跑 API in-process 執行器(action-executor.ts 已有)還是 worker(automation-actions.ts 缺)？確認要補哪端
- [ ] 1.2 確認 shortlink.service.ts trackClick 發的 link.clicked eventBus payload 帶哪些欄位（shortLinkId/slug/contactId 是否齊）

## 2. link.clicked 事件定義（automation 合約）

- [ ] 2.1 `packages/automation/src/contracts/events.ts`：加 `LINK_CLICKED: 'link.clicked'` 事件名 + AUTOMATION_EVENT_DEFINITIONS 定義（label「短連結被點擊」、category、provides: tenant+contact）
- [ ] 2.2 確認 composer.ts / validation.ts 讀 events.ts 清單後自動放行 link.clicked（不用改，驗證即可）
- [ ] 2.3 build @open333crm/automation（合約改動要 build 否則 api/worker 讀不到）

## 3. worker add_tag 動作

- [ ] 3.1 `apps/workers/src/lib/automation-actions.ts`：加 `action.type === 'add_tag'` 分支，讀 config.tagId/tagName，對 context.contactId upsert contactTag
- [ ] 3.2 冪等：已有該 tag 不重複插入（findFirst 或 unique 判斷）
- [ ] 3.3 缺 contactId 時 log skip 不報錯（比照現有 caseId 缺失模式）
- [ ] 3.4 走 worker 租戶綁定連線寫入（不繞過 RLS，比照 send_material）

## 4. facts 補齊

- [ ] 4.1 `apps/workers/src/lib/automation-facts.ts`：link.clicked 的 facts 補 shortLinkId / slug（供規則條件比對）
- [ ] 4.2 確認 shortlink.service.ts 發事件時 payload 帶足這些欄位（否則補上）

## 5. 前端 automation 編輯器

- [ ] 5.1 觸發器下拉多「短連結被點擊」（讀 events.ts 定義應自動出現，確認）
- [ ] 5.2 動作下拉多「加標籤」+ 標籤選擇器 UI
- [ ] 5.3 （若做）條件可選「短連結 slug 等於 X」

## 6. 素材收邊（第 1 塊）

- [ ] 6.1 imagemap 編輯器 UI 標示「postback 不支援（僅 uri/message/clipboard）」，不再默默降級
- [ ] 6.2 line_video endCard 補註解：說明是 best-effort 包裝、非 LINE 原生 video CTA

## 7. 驗證與收尾

- [ ] 7.1 端到端測試：建規則(trigger link.clicked + action add_tag) → 模擬點擊短連結 → 確認 contact 被貼標
- [ ] 7.2 冪等測試：直接路徑(tagOnClick) + 規則路徑同時作用 → tag 不重複
- [ ] 7.3 匿名點擊測試：無 contactId 的點擊 → 規則不報錯、contact 動作 skip
- [ ] 7.4 跨租戶：add_tag 不繞過 RLS（貼到別租戶 contact 應失敗/隔離）
- [ ] 7.5 `openspec validate --strict` 通過
- [ ] 7.6 更新 CHANGELOG.md（Added：短連結點擊自動貼標正規路徑 + add_tag worker 動作）
