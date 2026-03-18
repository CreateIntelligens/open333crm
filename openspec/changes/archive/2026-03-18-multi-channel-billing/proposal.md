## Why

現有系統已支援 LINE OA、Facebook Messenger、Web Chat 等渠道，但隨著客戶需求增加，需要擴充更多渠道（Telegram、Threads）並解決多部門授權與額外訊息費用的計費問題。目前缺乏對新渠道的支援機制，且現有授權方案無法靈活控制各渠道的開通與計費方式。

## What Changes

- 新增 Telegram、Threads 渠道插件支援
- 擴展授權系統的渠道控制機制，支援按渠道收費與數量限制
- 支援多部門（Team）維度的授權管理
- 建立渠道額外訊息費用的計費與分攤機制
- 提供渠道使用量統計與費用分攤報表

## Capabilities

### New Capabilities

- `telegram-channel`: Telegram 渠道插件，支援文字、圖片、貼紙、位置等訊息收發
- `threads-channel`: Threads 渠道插件，支援 IG/Threads 訊息統一收發
- `channel-billing`: 渠道維度的計費機制，支援按渠道開通與使用量計費
- `team-license`: 多部門/團隊維度的授權控制，支援 teamId 匹配與獨立額度管理
- `channel-team-access`: Channel 多部門共用授權，透過 ChannelTeamAccess（多對多）管理渠道歸屬，支援 full / read_only 存取層級與訊息費用歸部門
- `channel-usage-report`: 渠道使用量與費用分攤報表

### Modified Capabilities

- `license-features`: 擴展現有授權的 channels 設定，加入數量限制與額外費用參數
- `credits-system`: 擴展 Credits 系統支援訊息發送數量的追蹤與計費（team-aware 版本）

## Impact

- 需要在 `packages/channel-plugins/` 新增 Telegram、Threads 插件
- 需要修改 `packages/types/` 的 ChannelType 枚舉（新增 TELEGRAM、THREADS）
- 需要擴展 `docs/14_BILLING_AND_LICENSE.md` 的 License JSON 結構
- 需要在資料庫 Schema 新增：`ChannelTeamAccess`（channel 多部門授權）、`ChannelUsage`（計費記錄）
- 需要修改現有 `Team` 表：新增 `licenseTeamId` 對應 License JSON teamId
- 需要在後台新增渠道管理（含多部門授權 UI）、費用報表 UI

