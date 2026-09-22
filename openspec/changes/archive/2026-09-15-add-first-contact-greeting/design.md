## Context

`processInboundMessage`（`apps/api/src/modules/webhook/webhook.service.ts:133`）是所有渠道 inbound 訊息的共同入口，末端已有一串側效果：

```
resolveInboundContact → resolveInboundConversation → 去重 → createInboundMessage
  → updateConversationAfterInboundMessage
  → runInboundPostbackInterceptors
  → emitInboundSocketEvents / publishMessageReceived / triggerWebhookFlow
  → sendOutsideHoursAutoReply   ← 既有「自動送出一則訊息」的範本
```

`sendOutsideHoursAutoReply`（`inbound-side-effects.ts:136`）完整示範了所需的每一步：建 `message` → 更新 `conversation.lastMessageAt` → `emitToConversationAndTenant` → `deliverToChannel`。招呼語沿用同一模式。

LINE 的 `follow`（加好友）事件已被 plugin 解析為一筆 parsed message（`packages/channel-plugins/src/line/index.ts:259`，`contentType: 'follow'`），會正常流經 `processInboundMessage`，因此不需要為它另開路徑。

## Goals / Non-Goals

**Goals**
- 粉絲在某渠道首次建立聯絡人時，自動送出一則**真實訊息**（寫入 `messages`、進對話紀錄、推送到該渠道）。
- **只送一次** —— 在多實例部署與平台重複投遞下都成立。
- 招呼語送出失敗，**不得影響 inbound 訊息本身的落地**。
- 補上 `contact.created` 事件的發布點。

**Non-Goals**
- 不改 WEBCHAT 既有 `welcomeMessage`（前端顯示用 greeting，語意不同）。
- 不做多則序列、延遲發送、A/B 測試、Flex／圖文招呼。

## Decisions

### D1：「首次」由 `ChannelIdentity` 的唯一約束判定，不用快取

`ChannelIdentity` 已有 `@@unique([channelId, uid])`（`schema.prisma`）。在 `inbound-contact-resolver.ts` 中，**成功 `create` 該筆 identity 的那一次請求，就是這個 uid 在該渠道的首次出現**；併發下的另一請求會撞 P2002（該檔已有處理），不會被判為首次。

因此在 resolver 內把「本次是否新建 identity」記到 `ctx`（例如 `ctx.isFirstContact`），側效果據此判斷。

**替代方案（否決）**

- *比照 `outsideHoursReplyCache` 用記憶體 Map*：專案已知多實例部署（PR #157 修過水平擴展三卡點），記憶體快取在多實例下各自獨立 —— **每個實例會各送一次招呼語**。既有的 outside-hours 自動回覆用它是因為那是「30 分鐘內去重」的寬鬆語意，重複發一次可接受；招呼語是「一輩子只發一次」，不能用。
- *Redis `SET NX`*：可行，但多一個失敗模式（Redis 不可用時要決定 fail-open 還是 fail-closed），而 DB 唯一約束已經免費提供了正確語意。
- *查 `messages` 表看有沒有發過招呼語*：需額外查詢，且語意繞（招呼語被刪除或對話被清就會重發）。

### D2：招呼語存在 `channel.settings`，不新增資料表

沿用 WEBCHAT `welcomeMessage` 既有的存放慣例（`channel.settings` JSON），以新鍵 `firstContactGreeting` 區隔，避免與前端 greeting 混淆。

- 無 schema 變更、無 migration
- 未設定或空字串 → 不送，維持現狀（功能預設關閉）
- 每個渠道各自設定，天然支援「LINE 與 FB 講不同的話」

### D3：掛在 `sendOutsideHoursAutoReply` 之後，整段 try/catch 隔離

招呼語是側效果，**任何失敗都不得讓 inbound 訊息落地失敗**（CM-175 的教訓：一個側邊環節出錯就整條鏈路崩潰、訊息靜默掉失）。比照既有 outside-hours 的寫法，整段包 try/catch，失敗只記 log。

順序放在 outside-hours 之後：若非營業時間，粉絲會先收到招呼語再收到營業時間說明，語序合理。

### D4：變數替換沿用既有 template-renderer

招呼語支援 `{{displayName}}` 等聯絡人變數，沿用 `apps/api/src/modules/marketing/template-renderer.ts` 的既有機制，不自建一套。變數解析失敗時退回原字串，不擋發送。

### D5：`contact.created` 事件補發布，但招呼語不依賴它

`packages/automation` 已有該事件的完整支援（`contracts/events.ts:14`、`fact-builder/index.ts:193`、`listeners/index.ts:62`），只差 `apps/api` 從未 `eventBus.publish`。本 change 補上。

但**招呼語走直接實作而非自動化規則**，理由：

1. 招呼語是「開箱即用」的基本能力，不該要求商家先去建一條自動化規則。
2. 自動化引擎是非同步的（eventBus → BullMQ → workers），招呼語希望盡快送達。
3. 兩者並存：補上事件後，進階使用者仍可用自動化做更複雜的歡迎流程（例如貼標後再依標籤分流）。

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| 舊聯絡人被誤判為新而收到招呼語 | 判定依據是「本次是否新建 ChannelIdentity」，既有聯絡人走既有身分快路徑，`isFirstContact` 為 false |
| 招呼語與 outside-hours 同時觸發，粉絲一次收到兩則 | 屬預期行為（語序：先招呼、後說明營業時間）；若日後認為擾民可加設定 |
| `follow` 事件與緊接著的第一則訊息各觸發一次 | identity 在 `follow` 當下即建立，第二則訊息時 `isFirstContact` 已是 false，不會重複 |
| 併發／平台重複投遞 | 由 `ChannelIdentity` 唯一約束保證只有一個請求判為首次 |

## Migration Plan

無 schema 變更、無資料回填。功能預設關閉（未設定招呼語的渠道行為完全不變），商家逐一設定後生效。

## Open Questions

- WEBCHAT 是否也套用此機制？目前 `welcomeMessage`（前端顯示）與 `firstContactGreeting`（真實訊息）語意不同，本 change 先不動 WEBCHAT，待實際使用後再評估是否統一。
- 是否需要「招呼語送出後自動貼標」？可由補上的 `contact.created` 事件配自動化規則達成，本 change 不內建。
