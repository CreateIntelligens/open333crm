## 1. 後端：postback 貼標攔截器

- [x] 1.1 `inbound-postback-interceptors.ts` 加 `handleTagOnClick`：regex `/^tag:([0-9a-f-]{36})$/i` 比對 `ctx.postbackData || ctx.textContent`
- [x] 1.2 命中 → `addTagToTarget(ctx.prisma, { tenantId, targetType:'CONTACT', targetId: contactId, tagId, addedBy:'system' })`，缺 contactId/tag 不存在/scope 不符 → 靜默略過（catch 吞）
- [x] 1.3 不短路（handleTagOnClick 回 void，貼完標繼續走 csat/kb/handoff 與正常訊息流程）
- [x] 1.4 掛進 `runInboundPostbackInterceptors` 最前面（與既有 interceptor 不衝突）

## 2. 後端：uri 短連結帶 tagId

- [x] 2.1 `findOrCreateMaterialShortLink` 加選填 `tagOnClick`，寫入 `ShortLink.tagOnClick`（複用既有短連結時也更新）
- [x] 2.2 `convertBodyUrlsToShortLinks` 換 uri/linkUri 時把該 action 的 `tagOnClick` 傳入，並從 body `delete obj.tagOnClick`（避免流進 LINE payload）
- [x] 2.3 既有 `trackClick` 貼標路徑對這些短連結生效（沿用，不需改）

## 3. 前端：ActionConfigEditor 貼標下拉

- [x] 3.1 新增 `useContactTags` hook（SWR 快取 `/tags` filter scope=CONTACT，多 action editor 共用）
- [x] 3.2 `ActionConfigEditor` 加「點擊後貼標」下拉；postback → data=`tag:<tagId>`（附「接管回傳資料」提示），開啟時從 data 反解還原
- [x] 3.3 uri → 寫 `action.tagOnClick`，開啟時讀 tagOnClick 還原
- [x] 3.4 message 型不顯示貼標下拉（`cur.type !== 'message'`）；imagemap message area 自然不顯示
- [x] 3.5 各版型（carousel / imagemap / flex showcase / video / quick reply）共用 ActionConfigEditor，皆帶得到 tagId

## 4. 型別 / 資料模型

- [x] 4.1 `ActionConfig`（前端 + builders）uri 分支加選填 `tagOnClick?: string`
- [x] 4.2 builders `actionToLine` 只挑 type/label/uri，不帶 tagOnClick（不進 LINE payload）
- [x] 4.3 flex button 的 uri action tagOnClick 由 convertBodyUrls delete 掉，不流進 LINE

## 5. 驗證與收尾

- [x] 5.1 端到端：模擬 LINE postback（tag:VIP，正確 HMAC 簽章）→ Daniel 被貼 VIP（addedBy=system，實測 0→1）
- [x] 5.2 uri 短連結帶 tagOnClick 邏輯已接（findOrCreate 帶入 + convertBodyUrls 傳入 + delete）；沿用既有 trackClick
- [x] 5.3 冪等：重複點 tag:VIP → count 仍 1
- [x] 5.4 貼標發 contact.tagged（tagging.service 內建）→ 既有 automation 訂閱自動觸發（架構已驗）
- [x] 5.5 無效標籤（tag:不存在uuid）→ webhook 仍 200、靜默略過不貼不報錯
- [x] 5.6 未設貼標的 action 行為不變（純附加，data/uri 不受影響）
- [x] 5.7 api/web typecheck 0 error、channel-plugins rebuild
- [x] 5.8 `openspec validate --strict` 通過
- [x] 5.9 更新 CHANGELOG（Added：LINE 素材可點擊 action 點擊後貼標）
