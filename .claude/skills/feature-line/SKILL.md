---
name: feature-line
description: >
  open333CRM「LINE 專屬功能」功能顧問：LINE webhook 收訊、圖文選單、快速回覆預設組、LINE 訊息格式、LIFF 與 LINE Login、postback 攔截。改到 line 模組、channel-plugins/line、webhook/line，或改 LINE 素材、群發、滿意度調查之前使用。
---

# LINE 專屬功能

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。LINE 功能的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

LINE webhook 收訊（驗簽、事件解析、follow、unfollow、unsend、postback、媒體下載、群組訊息、下游轉發 `downstreamWebhook`）、
圖文選單 Rich Menu（草稿、發布、預設選單、綁定受眾、`/dashboard/line/rich-menus`）、快速回覆預設組（`/dashboard/line/quick-replies`）、
LINE 訊息格式（`buildLineMessage`、Flex、imagemap 多尺寸圖端 `/line-imagemap`、safe reply 與 reply token）、
LIFF 與 LINE Login（`liffConfig`、ID token 驗證）、頭像補存、postback 攔截（`tag:`、`csat:`、`kb_feedback:`、`handoff_request`）、
渠道憑證加解密 `CREDENTIAL_ENCRYPTION_KEY`。
相關的程式：line、rich-menu、quick-reply-preset、channel-plugins/line、webhook/line、liff、line-imagemap、downstream-forwarder。
改 LINE 素材、群發、加好友禮、關鍵字回覆、滿意度調查、短連結 LIFF 之前也使用。
問題像「LINE 收不到訊息」「圖文選單發布失敗」「LINE 滿意度沒回」「客人收回訊息」「LINE 重複訊息」「LIFF 設定」時使用。

## 先讀

先讀功能文件 `docs/ref/features/tenant/LINE.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `LINE.md` 的章節 |
| --- | --- |
| 找路由對應的 flow 與 service 函式 | 程式的入口 |
| 圖文選單的狀態、發布、取消發布 | 圖文選單 |
| 綁定受眾 | 分眾綁定 |
| webhook 驗簽、事件怎麼存、去重、postback 攔截、下游轉發 | 收 LINE 訊息 |
| 訊息格式、imagemap、reply 與 push、上限 | 送 LINE 訊息 |
| LIFF ID、LINE Login | LIFF 與 LINE Login |
| 憑證加解密 | 渠道憑證 |
| 快速回覆預設組 | 快速回覆 |
| 前端頁面與元件、前端送出的值 | 畫面怎麼呼叫 API |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `packages/channel-plugins/tests/unit/line/`、`apps/api/tests/unit/modules/line/`、`apps/api/tests/unit/modules/webhook/`、`apps/api/tests/feature/modules/webhook/`、`apps/web/tests/unit/components/line/`，寫法可以照著參考。

`LINE.md` 裡標 `HC-LINE-NN` 的句子是還沒修的 bug，不是刻意的設計。修好之後依 `AGENTS.md` Step 4 更新。

其他來源：

- 健檢結果與已知問題：`docs/ref/features/health/LINE.md`
- 規格：`openspec/specs/line-webhook-events/spec.md`、`openspec/specs/line-messaging/spec.md`、`openspec/specs/line-safe-reply/spec.md`、`openspec/specs/line-rich-menu/spec.md`、`openspec/specs/line-downstream-webhook/spec.md`、`openspec/specs/credential-encryption/spec.md`
  - 注意：規格有多項沒有實作（unsend 標記收回、Flex `content.flexJson`、Rich Menu Alias、群發額度檢查），見健檢的「完備度對照」。不要以為規格寫了就有。
- LINE 官方文件（公開網址）：
  - Messaging API 教學：https://developers.line.biz/en/docs/messaging-api/
  - Messaging API 規格（端點、參數、webhook 事件）：https://developers.line.biz/en/reference/messaging-api/
  - 接收 webhook 與事件：https://developers.line.biz/en/docs/messaging-api/receiving-messages/
  - 重送去重與 unsend 的建議：https://developers.line.biz/en/docs/messaging-api/development-guidelines/
  - 圖文選單：https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/
  - LINE Login 與 LIFF：https://developers.line.biz/en/docs/line-login/ 、https://developers.line.biz/en/docs/liff/
- 本機文件副本（選用，只有作者本機有）：/Users/danielyang/Documents/line-developers-docs-source/docs/en/ （來源 https://github.com/line/line-developers-docs-source ；docs/messaging-api 是教學，reference/messaging-api 是 API 規格）
- 手冊：`apps/web/public/manual/ch10-line.html`（圖文選單、關鍵字回覆、快速回覆）、`apps/web/public/manual/ch15-channels.html`（LINE 渠道設定）
- 影響分析：`node scripts/feature-impact.mjs --domain line`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `LINE.md` 括號內的章節。

- 驗簽在回應之前：先 `verifyWebhookRequest`，再回 200；簽章錯回 403（規格 line-webhook-events）。事件在回應後背景處理。不要改掉 `__rawBody`，否則驗簽全部失敗。（收 LINE 訊息）
- LINE 驗簽用 `channelSecret`，FB、IG 用 `appSecret`。字串比較用 `signaturesMatch`。（收 LINE 訊息）
- 租戶由 `channelId` 反查，webhook 一律用 `prismaAdmin`，每個查詢都要自帶 `tenantId` 或渠道條件。（收 LINE 訊息）
- 新增要送到 LINE 的訊息型別時，在 `buildLineMessage` 加 case 並寫測試。不認得的型別丟 `LineMessageBuildError`。（送 LINE 訊息）
- 呼叫 `LinePlugin.sendMessage` 的地方要檢查回傳值，失敗不可以只寫 log。（送 LINE 訊息）
- LINE 一次最多 5 則訊息、multicast 每批 500 人以內（群發用 499）、快速回覆最多 13 顆、標籤 20 字。（送 LINE 訊息、快速回覆）
- reply token 只在 30 秒內用（`selectSafeLineStrategy`），reply 失敗補一次 push（規格 line-safe-reply）。（送 LINE 訊息）
- 憑證加解密在 API（`apps/api/src/modules/channel/channel.service.ts`）與 workers（`apps/workers/src/lib/credentials.ts`）各一份，要一起改。（渠道憑證）
- 多個 LINE 官方帳號要在同一個 provider，userId 才相同；LIFF 的 Login channel 也要在同一個 provider。（LIFF 與 LINE Login）
- 圖文選單：（圖文選單、分眾綁定）
  - 只有 `draft` 能改、能刪。
  - `isDefault` 與 `selected` 是兩個欄位，不要混用。
  - 一個官方帳號只有一張預設選單。設預設由 LINE 直接取代，不要先取消全體預設。
  - 同一個渠道同時只有一張選單在發布中。
  - 綁定是快照，系統不記錄誰綁了哪張。
- 改下游轉發時，不要拿掉 `claimForForward` 迴圈防護與 `isBlockedUrl`。（收 LINE 訊息）
- `/line-imagemap/*` 必須公開，寬度只允許 240、300、460、700、1040，baseUrl 不含副檔名。（送 LINE 訊息）
- 錯誤用 `AppError(訊息, code, status)`。前端讀錯誤用 `getApiErrorMessage`（`apps/web/src/lib/api-error.ts`）。UI 不放 emoji。

## 回歸清單

改到本領域時，至少重走：

1. 本機假 webhook（自己算簽章）：
   - 正確簽章回 200 並存訊息；錯簽章、無簽章回 403；同一個 `message.id` 送兩次只存一則。
   - 腳本範例：以 `crypto.createHmac('sha256', channelSecret).update(body).digest('base64')` 填 `x-line-signature`，POST 到 `/api/v1/webhooks/line/<channelId>`。
   - 測試渠道要自己用 `POST /channels` 建（憑證用假的）。seed 的「健檢 LINE-A/B」憑證解不開，會回 500。
2. postback `tag:<uuid>` 會貼標；`handoff_request` 讓對話轉 `AGENT_HANDLED`。
3. image（LINE 代管）在假權杖下要出現 `mediaError`；`fileSize` 超過 25 MB 不下載。
4. 圖文選單：建立 → 編輯 → 發布（假權杖會變「發布失敗」）→ 綁定受眾 → 取消發布。supervisor 可以，agent 回 403。
5. 快速回覆預設組：建立、重新整理讀回、刪除；agent 寫入回 403。
6. 真機（UAT 正式環境，需要使用者同意）：
   - 圖文選單發布與預設、綁定受眾。
   - LINE 滿意度調查：客人按分數後，收件匣卡片顯示「客人評 N 分」，客人訊息顯示「我的評分：N 分」。
   - 收回訊息、LIFF 開票券。

自動測試：

- `pnpm --filter @open333crm/channel-plugins test`
- `pnpm --filter @open333crm/api test -- rich-menu webhook-signature downstream-forwarder inbound-media tag-on-click line-id-token channel-credential-security line-imagemap`
- `pnpm --filter @open333crm/workers test -- rich-menu-bind credentials`
- `pnpm --filter @open333crm/web test -- rich-menu imagemap-url bot-config-form-line-login`
- feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/webhook/ channel-liff-id coupon-line-login`
- E2E：`apps/web/tests/e2e-uat/tenant-line-materials.spec.ts`

## 常見 bug 從哪裡查

- 「LINE 完全收不到訊息」：
  - 看 API log 的 `[Webhook] Signature verification failed`（Channel Secret 填錯；手冊說測試連線只驗 Access Token）、`Channel not found or inactive`、`Tenant is disabled`。
  - 渠道有沒有設 `downstreamWebhook` 的 `immediate` 模式（`[DownstreamWebhook] Blocked SSRF target`，HC-LINE-05）。
- 「LINE 滿意度調查客人沒收到」：
  - 看收件匣的問卷卡片有沒有「這份問卷沒有送出」與原因，或工單時間軸的「滿意度問卷沒有送出」（`case_events.eventType = 'csat_send_failed'`，原因在 `payload.reason`）。
  - 常見原因：渠道停用、找不到客人的 LINE 帳號、LINE API 拒收。系統不自動重寄（`csatSentAt` 保留）。
- 「同一個點擊出現兩次」：LINE 重送事件，postback 沒有訊息 id，不去重（HC-LINE-02）。
- 「客人收回的訊息還在」：`unsend` 只存成一則「[不支援的訊息類型]」（HC-LINE-03）。
- 「圖文選單發布失敗」：
  - 錯誤詳情在回應的 `details.upstream`（HC-LINE-14）。401 是 Access Token 錯，400 多半是圖片尺寸或區域動作。
  - `error` 狀態的選單到編輯頁按「發布到 LINE」重試，或複製一份再改。
- 「綁定受眾按了沒反應」：看平台佇列監控的 `rich-menu-bind` 失敗工作（`failedReason`），API 只回 queued（HC-LINE-06）。
- 「圖片、影片沒出現在收件匣」：看訊息的 `content.mediaError`。下載走 `LinePlugin.resolveInboundMedia`，不是 `line-media.service.ts`。
- 「imagemap 圖裂」：baseUrl 要是 `{API_PUBLIC_URL}/line-imagemap/{tenantId}/{imageId}`，LINE 自己接 `/{寬度}`；預覽用 `imagemapPreviewSrc`（`apps/web/src/lib/imagemap-url.ts`）。
- 「本機 LINE 素材或渠道操作 500」：憑證是 UAT 金鑰加密的，本機解不開。到渠道設定重填 Secret 與 Token。
