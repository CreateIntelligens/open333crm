## Why

粉絲第一次與品牌接觸時（加 LINE 好友、第一次在 FB/IG 私訊），系統目前**什麼都不會回**。商家必須自己在 LINE OA 後台另外設一組歡迎訊息，那套訊息與 CRM 完全脫鉤——不進對話紀錄、不計入成效、無法帶入聯絡人變數、也無法依渠道差異化。

現況盤點：

| 渠道 | 首次進站招呼 | 說明 |
|---|---|---|
| WEBCHAT / Chatbox | 部分 | `channel.settings.welcomeMessage` 僅回傳給前端當畫面上的 greeting 文字，**不寫入 messages、不算一則訊息**、無法帶變數 |
| LINE | 無 | plugin 已解析 `follow` 事件（`packages/channel-plugins/src/line/index.ts:259`），但 webhook 端無任何後續處理 |
| FB / IG | 無 | 無對應機制 |

同時，`contact.created` 這個自動化事件在 `packages/automation` 內有完整的型別、fact-builder（`fact-builder/index.ts:193`）與 listener（`listeners/index.ts:62`）支援，**但 `apps/api` 從未發布過它**——等於自動化規則永遠等不到這個觸發點。

這是客服系統的基本能力：新客第一次來訊，應該有人（或機器人）先說句話。

## What Changes

- **新增「首次進站招呼語」**：每個渠道可各自設定一段招呼語，在該渠道的**聯絡人首次建立時**自動送出一則真實訊息（寫入 `messages`、進對話紀錄、走既有發送管線推到該渠道）。
- **支援聯絡人變數**：招呼語可帶 `{{displayName}}` 等變數，沿用既有 template-renderer 的變數機制。
- **LINE 的 `follow` 事件納入觸發**：加好友當下即送出招呼語，不必等對方先開口。
- **發布 `contact.created` 事件**：補上 `apps/api` 缺失的發布點，讓既有自動化引擎能以此為觸發條件（招呼語本身不依賴自動化規則，但此事件補齊後進階使用者可做更複雜的歡迎流程）。
- **可關閉**：未設定招呼語的渠道維持現狀，不送出任何訊息。

### 明確不做（本 change 範圍外）

- **不改 WEBCHAT 既有的 `welcomeMessage` 行為**。那是前端顯示用的 greeting，與本功能語意不同；兩者並存，避免破壞既有嵌入頁面。是否統一留待後續評估。
- 不做多則訊息序列、不做延遲發送、不做 A/B 測試。
- 不做圖文／Flex 招呼（第一版僅純文字；素材型招呼可作為後續增強）。
- 不處理 FB/IG 在 Development Mode 下收不到一般使用者 webhook 的問題（屬 Meta 後台設定）。

## Capabilities

### New Capabilities
- `first-contact-greeting`: 定義渠道層級的首次進站招呼語——觸發時機（聯絡人於該渠道首次建立）、僅送一次的保證、變數替換、未設定時不送、以及送出失敗不得影響 inbound 訊息本身的落地。

### Modified Capabilities
<!-- 無：WEBCHAT 既有 welcomeMessage 行為維持不變；inbound 訊息處理的既有語意不改，僅在末端新增一個側效果。 -->

## Impact

- **資料模型**：招呼語存於 `channel.settings`（JSON），沿用既有 `welcomeMessage` 以外的新鍵（如 `firstContactGreeting`），**無 schema 變更、無 migration**。
- **`apps/api`**：
  - `src/modules/webhook/inbound-side-effects.ts` 新增 `sendFirstContactGreeting`，掛在 `processInboundMessage` 末端，緊鄰既有的 `sendOutsideHoursAutoReply`（同一模式：建 message → 更新 conversation → emit socket → `deliverToChannel`）。
  - `src/modules/webhook/inbound-contact-resolver.ts` 於新建聯絡人時標記「本次為首次建立」，供側效果判斷。
  - 發布 `contact.created` 事件（`eventBus.publish`）。
  - LINE `follow` 事件路徑確認能走到招呼語（該事件已被 plugin 解析為一筆 parsed message）。
- **`apps/web`**：渠道設定頁新增「首次進站招呼語」欄位（文字區塊 + 變數說明 + 可留空關閉）。
- **RBAC**：沿用既有渠道設定權限，不新增權限點（無需 reconcile）。
- **相依**：本功能的觸發時機是「聯絡人首次建立」，而該路徑在 CM-175 修復前是壞的。**本 change 必須排在 [PR #175](https://github.com/CreateIntelligens/open333crm/pull/175) 之後**。
