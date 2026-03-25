## Why

新系統的 Channel Plugin 架構（`03_CHANNEL_PLUGIN.md`）定義了統一的訊息收發介面，但尚未有任何渠道的具體實作。LINE OA 是本 CRM 的核心渠道，也是功能最複雜的一個——除了基本訊息之外，還涉及 Rich Menu UI 管理、Narrowcast 精準受眾、Insight 數據回流、LIFF 整合及 Account Link。需要先完整實作 LINE OA Plugin 並建立 Extension 機制，作為其他渠道（WhatsApp, FB）的實作範本。

## What Changes

- 新增 `packages/plugins/line` — LINE OA Plugin 套件，實作完整的 `ChannelPlugin` 介面
- 新增 `ChannelPlugin` 的 Plugin Extension 機制：`RichMenuExtension`, `AudienceExtension`, `AnalyticsExtension`
- 補齊 `packages/types` 中 LINE 相關的訊息類型（Flex, Imagemap, Quick Reply, 所有 Action 類型）
- 新增 LINE Webhook 事件完整解析（含 `unsend`, `memberJoined`, `videoPlayComplete`, `accountLink`）
- 新增 Rich Menu CRUD + 批次用戶綁定 + Alias API
- 新增 Narrowcast 發送策略 + Audience Group 管理
- 新增 Insight 數據定時同步 Worker
- 新增 LIFF App 管理 API
- `docs/03_CHANNEL_PLUGIN.md` 補充 Extension 介面定義

## Capabilities

### New Capabilities

- `line-messaging`: LINE 訊息收發核心，含 Reply / Push / Multicast / Broadcast / Narrowcast 五種策略
- `line-webhook-events`: 完整 Webhook 事件解析與路由，含媒體即時下載
- `line-rich-menu`: Rich Menu CRUD、批次用戶綁定、Alias 切換，對應 `ChannelUiExtension`
- `line-audience`: Audience Group 管理，配合 Narrowcast 的受眾同步，對應 `ChannelAudienceExtension`
- `line-analytics`: Insight API 定時同步（好友數、人口統計、推播互動率），對應 `ChannelAnalyticsExtension`
- `line-liff`: LIFF App 的建立、更新、刪除管理
- `line-account-link`: Issue Link Token → Account Link Webhook 完成後合併 Contact 身份

### Modified Capabilities

- `telegram-channel`: Plugin Extension 機制的基礎介面（`ChannelPlugin.extensions`）會影響現有 Telegram plugin 結構，須同步更新型別匯出

## Impact

- **新套件**：`packages/plugins/line`（Node.js / TypeScript）
- **型別擴充**：`packages/types` — `ChannelPlugin`, `UniversalMessage`, LINE 訊息物件型別
- **後端路由**：`POST /webhooks/line/:channelId` 已規劃，確認 Gateway 服務接入
- **Workers**：新增 `worker-insight-sync`（每日定時），`worker-rich-menu-batch`（Rate Limit Queue）
- **DB Schema**：新增 `RichMenu` / `RichMenuUserBinding` / `AudienceGroup` / `InsightSnapshot` 資料表
- **依賴**：`@line/bot-sdk`（官方 Node.js SDK）
