## Why

目前只有「短連結被點擊」能自動貼標（`ShortLink.tagOnClick`）。但 LINE 素材裡有大量其他可點擊處——carousel 按鈕、flex button、quick reply、imagemap 區域、影片結束畫面 CTA——點了都無法貼標。行銷人若想「點了某按鈕就貼上某標籤、再據以分眾」，現在辦不到。

這對應差異化定位「幫你證明哪則訊息有效、把互動者分眾」的核心：**讓素材裡每個互動點都能成為貼標的觸發**，而非只有短連結。且貼標會發 `contact.tagged`，automation 早已訂閱——點擊貼標自動就能串起後續分眾/自動化，零額外接線。

## What Changes

- LINE 素材編輯器：每個可點擊 action 旁新增「點擊後貼標籤」選項，下拉選既有標籤（來源設定/標籤管理，scope=CONTACT）。
- postback 型 action：選了標籤即自動把 action data 設為 `tag:<tagId>`（使用者不需手打 postback data）。
- uri 型 action：選了標籤即把 tagId 寫進該 action 對應的素材短連結（`tagOnClick`）。
- 後端 webhook：新增 postback 攔截器 `handleTagOnClick`，收到 `tag:<tagId>` 就對點擊者（contact）貼標。
- 短連結：`findOrCreateMaterialShortLink` 支援帶入 per-action 的 tagId。

不在本次範圍：新的自動化 trigger（沿用既有 `contact.tagged`）、非 LINE 渠道、message 型 action 的關鍵字對應（imagemap 區域改導引走 uri+短連結）。

## Capabilities

### New Capabilities
- `material-action-tagging`: LINE 素材可點擊 action 設定「點擊後對聯絡人貼標」，涵蓋 postback（data tag: 前綴 + webhook 攔截器貼標）與 uri（素材短連結 tagOnClick）兩條路徑；標籤來源為既有 CONTACT-scope 標籤。

### Modified Capabilities
<!-- 無 spec 層需求變更（既有 material-system / shortlink 的行為以新 capability 擴充，不改其既有需求） -->

## Impact

- **前端**：`ActionConfigEditor`（共用 action 編輯元件）加「點擊後貼標」下拉；各版型編輯器（carousel / imagemap / flex showcase / video）的 action 帶入 tagId。標籤清單複用 `GET /tags`（filter scope=CONTACT）。
- **後端 webhook**：`apps/api/src/modules/webhook/inbound-postback-interceptors.ts` 新增 `handleTagOnClick`（regex `tag:<tagId>` → `addTagToTarget(targetType:CONTACT, addedBy:system)`）。
- **短連結**：`shortlink.service.ts` 的 `findOrCreateMaterialShortLink` 加 tagId 參數，寫入 `ShortLink.tagOnClick`；`marketing.service` 送素材時把 per-action tagId 傳入。
- **複用（不新增）**：`addTagToTarget`、`contact.tagged` 事件、冪等 upsert、迴圈防護、tenant scope、automation 對 `contact.tagged` 的既有訂閱。
- **相容性**：action 無設標籤時行為完全不變；postback data 若已被使用者自訂（非 tag: 前綴）不受影響。
