## Context

LINE inbound webhook 現況（`apps/api/src/modules/webhook/`）：

- 路由 `POST /api/v1/webhooks/line/:channelId`（`webhook.routes.ts`）以自訂 content-type parser 保留原始 buffer 於 `body.__rawBody`，**先呼叫 `processWebhookEvent(...)`（fire-and-forget，`.catch` 記錄錯誤），再立即 `reply.status(200)`**。因此對 LINE 的 200 回應與後續處理天然是背景、非阻塞的。
- `processWebhookEvent`（`webhook.service.ts`）流程：1) 載入 channel、2) 取 plugin + 解密 credentials、3) `plugin.verifySignature(rawBody, headers, secret)`、4) `plugin.parseWebhook`、5) 逐則 `processInboundMessage`（聯絡人/對話/訊息、socket、eventBus、canvas、自動回覆）。
- `Channel` model 具 `settings Json @default("{}")`；`PATCH /api/v1/channels/:id`（`requireAdmin`）可合併更新 `settings`。
- 既有對外 HTTP + 重試樣板：`apps/api/src/modules/webhook-subscriptions/webhook-dispatcher.ts`（原生 `fetch`、`AbortController` 10s 逾時、3 次指數退避、HMAC 簽章標頭、delivery 記錄）。

本能力在**步驟 3 之後、步驟 4 之前**插入下游轉發判斷。

## Goals / Non-Goals

**Goals:**
- 讓 LINE channel 可設定把**原始** webhook（raw body + 原始標頭，含 `x-line-signature`）轉發到自訂下游 URL。
- 提供兩種模式：`immediate`（轉發後短路，CRM 不再處理）與 `after`（CRM 照常處理後再轉發）。
- 轉發為背景、非阻塞（best-effort、fire-and-forget），不影響對 LINE 立即回 200；**不追蹤、不理會下游回應與結果**。
- admin-only 設定 + SSRF 防護。

**Non-Goals:**
- 不改動對 LINE 的回應語意（仍立即 200；現況即如此）。
- 不追蹤下游轉發結果、不讀取下游回應、不因結果重試（best-effort fire-and-forget）；不新增 delivery 資料表。
- 不保證跨行程持久化（初版沿用現有「in-process fire-and-forget」架構，不引入 BullMQ 佇列）。
- 不轉發**未通過簽章驗證**的請求。
- 不對其他 channel（FB/Telegram/…）啟用（機制通用，但本次僅 LINE）。
- 不新增下游轉發的 delivery 資料表（初版以日誌為主）。

## Decisions

### D1. 設定形狀：`Channel.settings.downstreamWebhook`（單一下游）
```jsonc
{
  "downstreamWebhook": {
    "enabled": true,
    "url": "https://downstream.example.com/line-hook",  // 單一 https URL
    "mode": "immediate",        // "immediate" | "after"
    "forwardHeaders": true,     // 轉發原始 x-line-signature/content-type，預設 true
    "secret": "…",              // 可選：另加 X-Open333-Signature（HMAC-SHA256(rawBody)）
    "timeoutMs": 10000          // 可選，預設 10000
  }
}
```
沿用既有 `settings` JSON，**不新增欄位/資料表**。以 Zod 於 channel 更新路徑驗證形狀（url 必須 https）。
- **單一 URL**：每個 LINE channel 僅一個下游端點；前端清空 URL 並儲存即移除設定。
- **替代方案**：多個下游端點（CRUD 清單）→ 需求上僅需一個，捨棄。新增獨立資料表存下游設定 → 過度設計；`settings` JSON 已足夠。

### D2. 插入點與模式語意（webhook.service.ts）
於簽章驗證通過後：
```
const cfg = channel.channelType === LINE ? channel.settings?.downstreamWebhook : undefined;
if (cfg?.enabled) {
  if (cfg.mode === 'immediate') {
    void forwardDownstream(cfg, rawBody, headers, channel);  // fire-and-forget（含重試）
    return;                                                  // 短路：不 parse、不 processInboundMessage
  }
  // mode === 'after'：先跑既有處理，最後轉發
}
... 既有 parseWebhook + processInboundMessage ...
if (cfg?.enabled && cfg.mode === 'after') {
  void forwardDownstream(cfg, rawBody, headers, channel);
}
```
- `immediate`＝先轉發、後續不動作；`after`＝後續照常、最後轉發。兩者皆 fire-and-forget，內部自帶 `.catch`。
- **替代方案**：`after` 模式改為與處理**並行**轉發 → 但「最後發送」語意上為處理完成後送出，故置於流程尾端。

### D3. 轉發實作：single-shot、best-effort
新增 `apps/api/src/modules/webhook/downstream-forwarder.ts`：原生 `fetch` **單次送出**，僅用 `AbortController` 逾時（預設 10s）避免資源懸掛；**不重試、不讀取／不理會下游回應與狀態**。送出原始 `Content-Type` 與 `x-line-signature`（當 `forwardHeaders`），另加 `X-Open333-Channel-Id`、`X-Open333-Forward-Mode`；`secret` 存在時加 `X-Open333-Signature`。Body 為**原始 rawBody bytes**（維持下游可用 LINE 簽章驗證）。
- **替代方案**：重新序列化 parsed 訊息 → 會破壞 `x-line-signature` 對 body 的比對；必須原封轉發。

### D4. 初版採 in-process fire-and-forget，不引入佇列
現況連 inbound 訊息建立都是 in-process fire-and-forget（route 未 await），故轉發採相同架構最一致、最小改動。持久化重試（BullMQ）列為未來強化。
- **Trade-off**：行程重啟時在途轉發會遺失；與現有 inbound 一致，可接受。

### D6. 迴圈防護（loop guard）
轉發的是**原封 raw body + 有效 `x-line-signature`**，若下游把它回送到本 webhook 端點，會再次通過簽章驗證 → 再次轉發 → 無限迴圈與流量放大。新增 `downstream-loop-guard.ts`：從 raw body 解析每個事件的冪等鍵（`webhookEventId`，退回 `replyToken`），以 Redis `SET NX EX`（TTL 600s）記錄；當一個 payload 的**所有事件皆為已見**時判定為回送、不再轉發（`claimForForward` 回傳 false）。immediate 與 after 兩模式的轉發前都套用。
- Redis 沿用既有 `getConfig().REDIS_URL`，跨 API 副本共享；鍵 TTL 自動過期，不新增資料表。
- **失效策略**：Redis 不可用時 **fail-open**（仍轉發並記警告），避免儲存故障使功能整體停擺；代價是「Redis 故障 + 下游確實回送」的罕見組合下迴圈防護暫失效。（可改為 fail-closed，取捨為可用性 vs 迴圈安全。）
- **替代方案**：於本端點檢查自加的 `X-Open333-Forward-Mode` 標頭判斷回送 → 下游常會剝除自訂標頭，不可靠；改採內容式（事件鍵）去重。

### D5. SSRF 防護
下游 URL 僅 admin 可設；驗證時要求 `https`，並於送出前解析主機、封鎖 loopback／私有／link-local／保留位址（可加環境變數 allowlist）。
- **替代方案**：完全信任 admin 設定 → 伺服器端可被誘導打內網，風險過高。

## Risks / Trade-offs

- **[immediate 模式下游失敗 → 訊息遺失]** 下游是唯一處理者時，轉發失敗代表該事件無人處理。依需求採 best-effort、**不理會下游結果**，此風險為**已知且可接受**。→ 文件明示 `immediate` 為「交棒」語意、不 fallback、不保證送達。可於未來另案提供「失敗時 fallback 回 CRM 處理」開關。
- **[SSRF]** 伺服器對外打可設定 URL。→ Mitigation：D5（https + 內網封鎖 + admin-only）。
- **[持久性]** in-process fire-and-forget 於重啟時遺失在途轉發。→ 與現有架構一致；未來可移至 BullMQ。
- **[重複轉發]** `after` 模式若下游也寫回 LINE，可能與 CRM 動作重疊。→ 由使用者依情境選模式；文件說明。
- **[敏感資料外流]** 原始 payload 可能含個資。→ 僅轉發到 admin 設定之 https 端點；日誌不記錄 body 內容。
- **[無限迴圈／流量放大]** 下游若回送原封 payload（帶有效簽章）會再次被轉發。→ D6 事件冪等鍵（`webhookEventId`/`replyToken`）+ Redis TTL 去重，回送即中止；Redis 故障時 fail-open（罕見組合下防護暫失效）。

## Migration Plan

1. 新增 `downstream-forwarder.ts` 與 Zod 設定 schema。
2. 於 `processWebhookEvent` 插入 D2 邏輯（僅 LINE、僅簽章通過後）。
3. 於 channel 更新路徑驗證 `settings.downstreamWebhook`。
4. Rollout：預設 `enabled=false`（未設定即不啟用），零風險漸進開啟。Rollback：將設定 `enabled=false` 或移除。無 DB migration。

## Open Questions

- `immediate` 模式是否需要「轉發失敗時 fallback 回 CRM 處理」的開關？（初版不做，列為未來選項。）
- 是否要一併開放其他 channel（FB/Telegram）？（本次僅 LINE。）

（已定案：**不追蹤下游結果、不落地 delivery 資料表、不重試**。）
