## Context

`03_CHANNEL_PLUGIN.md` 定義了 `ChannelPlugin` 介面（5個核心方法），但目前沒有任何具體實作。LINE OA 是本系統最重要的渠道，也是功能複雜度最高的——除核心訊息之外，還需要管理 Rich Menu UI、Audience 受眾包、Insight 數據回流、LIFF 應用及 Account Link。本設計同時建立 Plugin Extension 機制，讓渠道特有的進階功能可以以統一方式暴露給系統的其他服務（Marketing, Automation）。

## Goals / Non-Goals

**Goals:**
- 在 `packages/plugins/line` 實作完整的 `LinePlugin` 類別
- 定義並實作 `ChannelPlugin.extensions` 機制：`RichMenuExtension`, `AudienceExtension`, `AnalyticsExtension`
- 完整解析所有 LINE Webhook 事件為 `UniversalMessage` 或 System Event
- 接收媒體時立即下載並存入 Storage Layer
- 建立 Rich Menu 管理服務（CRUD + Batch Binding + Alias）
- 建立 Audience Group 管理服務（配合 Narrowcast）
- 建立 Insight 定時同步 Worker
- 新增 LIFF App 管理 API
- 實作 Account Link 完整流程

**Non-Goals:**
- LINE Bot SDK 以外的 LINE 產品（LINE Pay, LINE Shopping）
- LINE OA Live 直播（無 API 支援）
- PNP（手機號碼直發，需原廠申請）
- FB / WhatsApp / Threads Plugin（本次不做）

## Decisions

### D1：套件結構 — 獨立 `packages/plugins/line`

**選擇**：每個渠道 plugin 為獨立 npm 套件。

**理由**：
- 各渠道依賴不同（LINE SDK vs. FB SDK vs. Telegram Bot API），避免污染 core
- 可依需求選擇性安裝
- 測試隔離，mock 容易

**替代方案考慮**：全部放在 `packages/core` → 拒絕，因為 core 不應知道渠道細節（已在 `03_CHANNEL_PLUGIN.md` 明定原則）。

---

### D2：Extension 機制——可選屬性 vs. 獨立 Interface Mixin

**選擇**：在 `ChannelPlugin` 中加入 `readonly extensions?` 屬性，包含 `ui?`, `audience?`, `analytics?`。

**理由**：
- 不破壞現有 Plugin 實作（optional）
- 系統服務（Marketing, Automation）可用 type narrowing 判斷渠道是否支援該功能
- 符合 `03_CHANNEL_PLUGIN.md` 已加入的介面定義

**替代方案**：繼承多個 Interface（`LinePlugin implements ChannelPlugin, RichMenuCapable`）→ 較難做動態 capability 查詢。

---

### D3：媒體下載策略——Webhook 收到時立即下載

**選擇**：`parseWebhook` 內對每一個 media message 同步呼叫 LINE Content API 並上傳 Storage Layer，再將 Storage URL 寫入 `UniversalMessage.content.mediaUrl`。

**理由**：
- LINE 臨時 URL 數小時後失效，延遲下載風險高
- Webhook Handler 必須在 30 秒內回 200，下載需非同步（但可用 BullMQ job 非同步上傳）

**實作細節**：
```
Webhook 到達
  → 立即呼叫 Content API 下載 buffer
  → 推送到 BullMQ job: { buffer, messageId, channelId }
  → 立即回 200 OK
  → BullMQ job 上傳至 Storage Layer
  → 更新 Message.mediaUrl
```

---

### D4：Rich Menu Batch Rate Limit——BullMQ Delayed Queue

**選擇**：批次 Rich Menu 操作（bulk link/unlink）進入專用的 `rich-menu-batch` Queue，強制每小時最多 3 次，多餘的 job 延遲到下一個時間窗口。

**理由**：LINE API 明確限制 3 req/hr，違反會返回 429，且可能影響帳號狀態。

---

### D5：Insight 同步——每日定時 Worker

**選擇**：新增 `worker-insight-sync` 服務，每日 UTC 00:30 定時執行（offset 避開 LINE 伺服器整點負載），拉取前一日數據存入 `InsightSnapshot` 資料表。

**理由**：Insight 數據保留 14 天，必須主動持久化；定時同步優於按需拉取（避免 Dashboard 查詢時 API 延遲）。

---

### D6：Narrowcast 狀態追蹤——requestId 輪詢

**選擇**：發送 Narrowcast 後，將 LINE 返回的 `requestId` 存入 `Broadcast` 記錄，由 Worker 每 5 分鐘輪詢進度直到 `sendingComplete`。

**替代方案**：Webhook `messageDelivery` 事件（LINE 不提供此類 Webhook）→ 無此選項，只能輪詢。

## Risks / Trade-offs

| 風險 | 緩解 |
|------|------|
| Rich Menu Batch 超頻 → 429 | BullMQ Rate Limit Middleware，每小時 3 次硬限制 |
| Webhook 媒體下載超時 → 30s 回應失敗 | 先回 200，再以 BullMQ job 非同步下載上傳 |
| LINE Insight 資料 14 天後消失 | 定時 Worker 每日持久化，並設 監控告警 |
| `@line/bot-sdk` 版本升級 Breaking Change | 固定 major 版本，封裝 client 層屏蔽 SDK |
| Narrowcast 受眾包同步失敗 | 失敗重試 3 次，逾時標記 Campaign 為 `audience_sync_failed` |

## Migration Plan

1. 部署新 `packages/plugins/line` 套件，不影響現有渠道（如 Telegram），因 Plugin Registry 按需載入
2. DB Migration：新增 `rich_menus`, `rich_menu_user_bindings`, `audience_groups`, `insight_snapshots` 資料表
3. 管理員在後台重新綁定 LINE OA Credentials → 系統自動 setWebhook，舊有 Webhook 設定失效
4. 啟動 `worker-insight-sync` 服務容器
5. Rich Menu 資料從 LINE 平台側拉取初始化（GET /v2/bot/richmenu/list）
