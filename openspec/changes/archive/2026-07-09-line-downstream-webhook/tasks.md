## 1. 設定 schema 與驗證

- [x] 1.1 定義 `downstreamWebhook` 的 Zod schema（`downstreamWebhookConfigSchema`：`enabled`、`url` https、`mode` enum、可選 `timeoutMs`）—— 單一下游、任一 channel（無 `secret`/`forwardHeaders`，原封不加工）
- [x] 1.2 於 `channel.routes.ts` create 與 update 路徑以 `validateDownstreamWebhookSettings` 驗證 `settings.downstreamWebhook`；非法時回傳驗證錯誤且不寫入（已測）
- [x] 1.3 `getDownstreamWebhookConfig(settings)` helper：安全解析 typed config，缺省/停用/非法皆回 null（fail-safe，已測）

## 2. 下游轉發模組（含 SSRF 防護）

- [x] 2.1 新增 `apps/api/src/modules/webhook/downstream-forwarder.ts`，以原生 `fetch` **單次送出** + `AbortController` 逾時（預設 10s）；**不重試、不讀取下游回應/狀態**
- [x] 2.2 **原封轉發**原始 rawBody bytes 與原始 request 標頭：不新增自訂標頭、不加簽、不改寫 content-type；僅移除 `host`/`content-length`（由傳輸層重設）（已測：原始 header 透傳、無 X-Open333-*）
- [x] 2.3 加入 SSRF 防護：要求 https，DNS 解析主機並封鎖 loopback／私有／link-local／保留位址（IPv4+IPv6）；被封鎖時記錄並不送出（已測）
- [x] 2.4 函式對呼叫端為 best-effort fire-and-forget（內部 `.catch` 吞掉錯誤，**不追蹤/不理會下游結果**）；輕量日誌不含 body（已測 best-effort 不 throw）

## 3. webhook.service.ts 整合模式邏輯

- [x] 3.1 於 `processWebhookEvent` 簽章驗證通過後，讀取 `downstreamWebhook`（**任一 channel，不判斷 channelType**）
- [x] 3.2 `mode==='immediate'`：先 `void forwardToDownstream(...)` 再 `return`，短路 `parseWebhook` 與 `processInboundMessage`
- [x] 3.3 `mode==='after'`：維持既有 `parseWebhook`＋逐則 `processInboundMessage`（0 則不再提早 return），於流程尾端 `void forwardToDownstream(...)`
- [x] 3.4 轉發為 `void`（fire-and-forget）不阻塞、不影響 route 既有立即回 200；`after` 轉發失敗由 forwarder 內部吞掉不影響已完成處理

## 4. 驗證與收尾

- [x] 4.3 測試：原封轉發原始 body bytes 與原始標頭（`x-line-signature` 透傳、content-type 保留、`host`/`content-length` 剝除、**無任何 X-Open333-* 或簽章**）（`downstream-forwarder.test.ts` 已通過）
- [x] 4.4 測試：SSRF 封鎖 loopback/私有/link-local/ipv6 loopback 與非 https，公網 IP 放行；被封鎖不呼叫 fetch（已通過）
- [x] 4.1 `immediate` 模式僅轉發、`return` 短路 `parseWebhook`/`processInboundMessage`（由 3.2 程式結構保證；未加 pipeline 整合測試）
- [x] 4.2 `after` 模式照常處理後再轉發、失敗被忽略（結構保證 + forwarder best-effort 已測）
- [x] 4.5 簽章驗證失敗於 forward 前即 `throw`（步驟 3 早於 3b），故不會轉發（由程式順序保證）
- [x] 4.6 前端**獨立入口**：`ChannelManagement.tsx` 於**每個渠道列**加 🪝 按鈕開啟專屬 `DownstreamWebhookDialog.tsx`；enabled 開關 + 單一 URL + 模式（after/immediate）；文案泛用（不寫死 LINE、無簽章密鑰欄）；清空 URL 儲存即移除，合併寫回 `settings.downstreamWebhook`（web tsc 通過）

## 5. 迴圈防護（避免下游回送造成無限轉發）

- [x] 5.1 新增 `apps/api/src/modules/webhook/downstream-loop-guard.ts`：`extractEventIds` 從 raw body 取每事件 `webhookEventId`（退回 `replyToken`）；**非 LINE／無事件者退回 body SHA-256 雜湊**（適用所有 channel）
- [x] 5.2 `claimForForward(channelId, rawBody)`：以 Redis `SET NX EX`（**TTL 一天**、key 前綴 `downstream-webhook:seen`）記錄冪等鍵；所有鍵皆已見→回 false（回送），至少一新鍵→true；Redis 故障 fail-open（已測，含注入式 store）
- [x] 5.3 於 `processWebhookEvent` 的 immediate 與 after 轉發前套用 `claimForForward`，判定回送即不轉發並記 loopback 日誌
- [x] 5.4 測試：首次→轉發、相同 payload 回送→不轉發、新事件→轉發、混合→轉發、跨 channel 隔離、**event-less payload 以 body 雜湊擋回送**（`downstream-forwarder.test.ts` 已通過）
