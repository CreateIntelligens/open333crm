# Design：接上 Instagram（Threads）渠道

## 背景

`threads.ts` plugin 由 2026-03 的 multi-channel-billing 建立，實作完整但從未接線。本變更不重寫 plugin，只補「接線」與一處去重修補。系統的 plugin registry + 渠道無關處理管線設計良好，故新渠道改動集中在「一個 plugin export + 幾處註冊/路由/前端」，不擴散到業務邏輯。

## 關鍵決策

### 決策 1：走 IG Login 路線（graph.instagram.com），沿用 plugin 現況
IG DM 整合有兩條路線：
- **IG Login**（plugin 現況）：`graph.instagram.com` + `/me/messages`，憑證用 IG 帳號自身的 pageAccessToken，**不需連結 FB 粉專**。
- **FB Login**：`graph.facebook.com/{PAGE_ID}/messages`，IG 帳號須連結 FB 粉專，走 Page token。

`threads.ts` 現況即 IG Login 路線（`GRAPH_URL = graph.instagram.com/v21.0`、send 打 `/me/messages`）。**沿用現況**，不改路線——改路線等於重寫 plugin，且 IG Login 對客戶設定較單純（免連粉專）。權限對應 `instagram_business_manage_messages`。

### 決策 2：驗簽 secret 用 App Secret（與 FB 同機制）
IG webhook 與 FB 相同，用 `X-Hub-Signature-256`（App Secret 的 HMAC-SHA256）。plugin 的 `verifySignature` 已如此實作。但 `webhook.service.ts` 目前 secret 對應是「FB → appSecret，其餘 → channelSecret」，THREADS 會錯拿 `channelSecret` → 驗簽必失敗。**必須把 THREADS 併入 appSecret 分支**。這是接線的隱藏 bug 點，非顯而易見。

### 決策 3：parseWebhook 補 channelMsgId（去重）
現況 `parseWebhook` push 訊息時未帶 `channelMsgId`。inbound 管線用 `channelMsgId` 去重（Meta 可能重送同一事件）。FB plugin 有帶、threads 漏了。補 `channelMsgId: messaging.message?.mid`。不補的後果：Meta 重送時會產生重複訊息。

### 決策 4：inbound 路由照 FB 的「早回 200 + fire-and-forget」
webhook route 對 inbound 一律先 `reply.status(200)` 再非同步 `processWebhookEvent`。IG 照此模式——確保 Meta 端即時拿到 200，不觸發重試 / webhook 自動停用（見 [[reference_facebook_developers_skill]]）。GET challenge 則同步比對 verifyToken 回 challenge。

## 可複用（零改動）

inbound 後的 contact/conversation/message resolver、所有發送出口（`deliverToChannel` / kb-autoreply / csat / marketing / canvas）、botMode、憑證加密、動態 webhookUrl 組法——全部渠道無關。IG plugin 只要正確吐 `ParsedWebhookMessage`、正確 sendMessage，就自動獲得收發 + AI 回覆 + 行銷等全部能力。

## 不在範圍

- IG 用量計費（整體計費仍 mock）
- IG 進階訊息（圖片/影片發送、story mention）
- per-tenant IG token 過期監控（屬 SaaS 營運層，見 [[project_saas_master_plan]]）
- WhatsApp 渠道（另開變更；plugin 需從零寫、有 24h 視窗限制）

## Meta 端前提（非程式）

IG 專業帳號、`instagram_business_manage_messages` 權限 + App Review、Meta App 訂閱 `messages` webhook 欄位、callback URL 設為 `https://<host>/api/v1/webhooks/threads/{channelId}`。這些在 Meta 後台完成，程式無法代勞。
