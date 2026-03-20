## 1. 套件與基礎建設 (Package Setup)

- [x] 1.1 建立 `packages/plugins/line` 套件，初始化 `package.json` + `tsconfig.json`
- [x] 1.2 安裝 `@line/bot-sdk`（官方 Node.js SDK）作為依賴
- [x] 1.3 在 `packages/types` 擴充 `ChannelPlugin.extensions` 的型別定義（`RichMenuExtension`, `AudienceExtension`, `AnalyticsExtension`）
- [x] 1.4 在 `packages/types` 補齊 LINE 訊息型別（`FlexMessage`, `ImagemapMessage`, `QuickReply`, 所有 `Action` 類型）
- [x] 1.5 新增 DB Migration：`rich_menus`, `rich_menu_user_bindings`, `audience_groups`, `insight_snapshots` 資料表

## 2. Webhook 核心 (Webhook Core)

- [x] 2.1 實作 `LinePlugin.verifySignature()` — HMAC-SHA256 + `X-Line-Signature` 驗證
- [x] 2.2 實作 `LinePlugin.parseWebhook()` — 解析所有 Webhook 事件類型為 `UniversalMessage` 或 System Event
- [x] 2.3 實作 `follow` / `unfollow` 事件 → 更新 `Contact.channelStatus`
- [x] 2.4 實作 `unsend` 事件 → 標記 `Message.recalled = true`
- [x] 2.5 實作 `videoPlayComplete` 事件 → 發布 Automation 觸發事件
- [x] 2.6 實作 `memberJoined` / `memberLeft` 事件 → System Event

## 3. 媒體即時下載 (Media Download)

- [x] 3.1 在 `parseWebhook` 中，收到 image/video/audio/file 訊息時，立即推送 BullMQ job
- [x] 3.2 實作 `media-download` BullMQ Worker：呼叫 `GET /v2/bot/message/{messageId}/content`，上傳至 Storage Layer
- [x] 3.3 下載完成後更新 `Message.mediaUrl` 為 Storage Layer 永久 URL

## 4. 訊息發送 (Outbound Messaging)

- [x] 4.1 實作 `LinePlugin.sendMessage()` — 依 `strategy` (reply/push/multicast/broadcast/narrowcast) 路由至對應 API
- [x] 4.2 實作 `TextMessage`, `ImageMessage`, `VideoMessage`, `FlexMessage`, `StickerMessage`, `LocationMessage` 組裝
- [x] 4.3 實作 `Quick Reply` 掛載邏輯（`content.quickReplies` → `quickReply.items`）
- [x] 4.4 實作 Multicast 批次切割（每批 500 個 userId）
- [x] 4.5 實作發送前配額檢查（`GET /v2/bot/message/quota/consumption`）

## 5. Rich Menu (`ChannelUiExtension`)

- [x] 5.1 實作 `extensions.ui.upsertMenu()` — `POST /v2/bot/richmenu` 建立 + 上傳背景圖
- [x] 5.2 實作 Rich Menu 刪除、取得單一、取得列表 API
- [x] 5.3 實作設定/取消/查詢預設 Rich Menu
- [x] 5.4 實作 `extensions.ui.linkMenuToUser()` — 單一用戶綁定
- [x] 5.5 實作 `extensions.ui.linkMenuToUsers()` — 批次綁定，進入 `rich-menu-batch` Queue（Rate Limit: 3次/小時）
- [x] 5.6 實作 Rich Menu Alias CRUD（建立/更新/取得/刪除）

## 6. 受眾管理 (`ChannelAudienceExtension`)

- [x] 6.1 實作 `extensions.audience.syncAudience()` — `POST /v2/bot/audienceGroup/upload`（或更新現有受眾包）
- [x] 6.2 實作 `extensions.audience.createInteractionAudience()` — click / impression 受眾建立
- [x] 6.3 實作 Narrowcast 進度輪詢 Worker（每 5 分鐘 `GET .../progress/narrowcast?requestId=`）
- [x] 6.4 實作取消 Narrowcast 功能（`DELETE /v2/bot/message/narrowcast?requestId=`）

## 7. Insight 分析 (`ChannelAnalyticsExtension`)

- [x] 7.1 實作 `extensions.analytics.getFollowerStats()` — `GET /v2/bot/insight/followers`
- [x] 7.2 實作 `extensions.analytics.getDeliveryStats()` — `GET /v2/bot/insight/message/event?requestId=`
- [x] 7.3 實作 Demographics 同步（`GET /v2/bot/insight/demographic`）
- [x] 7.4 建立 `worker-insight-sync` 定時 Worker（每日 UTC 00:30 執行，結果存入 `insight_snapshots`）

## 8. LIFF 管理

- [x] 8.1 實作 LIFF App 列表 API（`GET /liff/v1/apps`）
- [x] 8.2 實作 LIFF App 建立（`POST /liff/v1/apps`）
- [x] 8.3 實作 LIFF App 更新（`PUT /liff/v1/apps/{liffId}`）
- [x] 8.4 實作 LIFF App 刪除（`DELETE /liff/v1/apps/{liffId}`）

## 9. Account Link

- [x] 9.1 實作 Issue Link Token API（`POST /v2/bot/user/{userId}/linkToken`）並儲存待驗 nonce
- [x] 9.2 實作 `accountLink` Webhook 事件處理：nonce 比對 → Contact 身份合併
- [x] 9.3 實作 Account Link 失敗通知（`result: 'failed'` 情境）

## 10. Plugin 註冊與整合

- [x] 10.1 在 Plugin Registry 中 `registerPlugin(new LinePlugin())`
- [x] 10.2 確認 `/webhooks/line/:channelId` 路由正確路由到 `LinePlugin`
- [x] 10.3 實作 `LinePlugin.setWebhook()` — `PUT /v2/bot/channel/webhook/endpoint`（Channel 綁定時自動呼叫）
- [x] 10.4 實作 `LinePlugin.getProfile()` — `GET /v2/bot/profile/{userId}`

## 11. 驗證與測試

- [ ] 11.1 單元測試：`verifySignature()`（有效簽名 / 無效簽名）
- [ ] 11.2 單元測試：`parseWebhook()` — 所有事件類型的解析正確性
- [ ] 11.3 整合測試：模擬 Webhook → Multicast 完整流程
- [ ] 11.4 整合測試：Rich Menu 建立 → 批次綁定用戶 → Alias 切換
- [ ] 11.5 整合測試：Narrowcast 發送 → 受眾同步 → 進度輪詢
