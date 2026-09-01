## Context

探勘確認：貼標核心基建全部現成——`addTagToTarget`（tenant-scoped、冪等 upsert、發 `contact.tagged`、迴圈防護）、標籤來源 API `GET /tags`、webhook postback 攔截器 pattern（`inbound-postback-interceptors.ts`，既有 CSAT/KB/handoff 三個 interceptor 都靠 regex 比對 `postbackData`/`textContent`）、短連結 `tagOnClick`→`trackClick`→貼標鏈路（100% 運作）。automation 早已訂閱 `contact.tagged`。

LINE action 三型別點擊回站能力：postback（LINE 送 postback event，data 任意可帶 tagId，**最適合**）；uri（LINE 不通知，須短連結中轉）；message（使用者發訊息回站，text 人可讀易撞、無法穩定帶 tagId）。imagemap 官方不支援 postback（builders 會降級成 message）。

## Goals / Non-Goals

**Goals:**
- LINE 素材每個可點擊 action 能設「點擊後對聯絡人貼標」，標籤選自既有 CONTACT-scope 標籤。
- 涵蓋 postback（按鈕/carousel/flex button/quick reply）與 uri（含 imagemap 區域改走 uri）。
- 幾乎不新增基建：貼標走既有 `addTagToTarget`，自動觸發既有 `contact.tagged`→automation。
- action 未設標籤時行為完全不變（純附加）。

**Non-Goals:**
- 不新增自動化 trigger（沿用 `contact.tagged`）。
- 不做 message 型 action 的關鍵字表對應（imagemap 導引改 uri）。
- 不動 automation worker 的 `message.postback` 死路。
- 非 LINE 渠道不涵蓋。

## Decisions

### D1. postback 統一 `tag:<tagId>` 前綴 + webhook 攔截器貼標
- 編輯器選標籤 → action data 設 `tag:<tagId>`（沿用既有 postback data 冒號前綴慣例，如 csat:/kb_feedback:）。
- `inbound-postback-interceptors.ts` 加 `handleTagOnClick`：regex `/^tag:([0-9a-f-]{36})$/i` 比對 `ctx.postbackData || ctx.textContent` → `addTagToTarget(ctx.prisma, {tenantId, targetType:'CONTACT', targetId: ctx.contactId, tagId, addedBy:'system'})`。
- **短路決策**：貼標 interceptor 回 `false`（不短路），讓該 postback 仍照常存進對話 + 走後續（與 CSAT 短路不同——貼標是「附加」語意，不該吃掉訊息）。若 tagId 無效/tag 不存在，靜默略過不報錯（catch 吞，比照 shortlink trackClick 的 fire-and-forget）。

### D2. uri 走既有素材短連結 tagOnClick
- 編輯器對 uri action 選標籤 → 把 tagId 記在該 action（body 裡新增選填欄位，如 `action.tagOnClick`）。
- 送素材時 `convertBodyUrlsToShortLinks` 已把 uri 換短連結；擴充 `findOrCreateMaterialShortLink` 收 tagId 參數 → 寫入 `ShortLink.tagOnClick`。點擊 → `trackClick` → 既有貼標。
- imagemap 區域：官方不支援 postback（降級 message），故 imagemap 的「點擊貼標」一律走 uri+短連結（若 area 是 message 型則不提供貼標，UI 提示改用網址）。

### D3. 標籤選擇 UI 集中在 ActionConfigEditor
- `ActionConfigEditor`（carousel/flex/imagemap 共用的 action 編輯器）加一個「點擊後貼標籤」下拉，選項來自 `GET /tags` filter `scope==='CONTACT'`。
- postback 型：選標籤自動寫 `data='tag:<tagId>'`（且鎖定或提示 data 由貼標控制，避免使用者手打衝突）。
- uri 型：選標籤寫 `action.tagOnClick`（不影響 uri 本身）。
- 資料模型：action 存 tagId 的形式——postback 靠 data 前綴（無需新欄位）；uri 用 `action.tagOnClick`（選填）。編輯器讀取時：postback 從 data 反解 tag:、uri 讀 tagOnClick，還原下拉選中值。

### D4. 標籤 scope 限制
- 只列 `scope==='CONTACT'` 的標籤（貼在聯絡人上）。`addTagToTarget` 對非 CONTACT scope 會丟 `TAG_SCOPE_MISMATCH`，故前端先 filter 避免使用者選到無效標籤。

## Risks / Trade-offs

- **postback data 衝突**：使用者若已用 postback 做別的事（如 add_cart:demo），選了貼標會覆蓋 data。→ UI 明確：選貼標即接管 data，或分開「動作類型」與「貼標」兩個設定（貼標優先寫 tag:，原 data 語意由使用者取捨）。設計採「選貼標 = data 設 tag:<tagId>」，並在 UI 說明。
- **imagemap 只能走 uri**：area 若是 message 型無法貼標。→ UI 對 imagemap message area 不顯示貼標選項，或提示「改用網址類型才能貼標」。
- **uri 貼標依賴短連結送達路徑**：只有經廣播（executeBroadcast→convertBodyUrlsToShortLinks）送出的素材才會包短連結；直接手動發或其他路徑可能不包。→ 本次以廣播路徑為主，其餘路徑標註限制。
- **標籤被刪**：action 存的 tagId 若標籤已刪，postback 貼標時 `getTenantTag` 找不到 → 靜默略過（fire-and-forget），不報錯、不影響其他流程。
