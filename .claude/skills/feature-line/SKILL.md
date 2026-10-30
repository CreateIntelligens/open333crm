---
name: feature-line
description: >
  open333CRM「LINE 專屬功能」功能顧問：LINE webhook 收訊（驗簽、事件解析、follow／unfollow／unsend／postback、
  媒體下載、群組訊息、下游轉發 downstreamWebhook）、圖文選單 Rich Menu（草稿、發布、預設選單、綁定受眾、
  /dashboard/line/rich-menus）、LINE 快速回覆預設組（/dashboard/line/quick-replies）、LINE 訊息格式
  （buildLineMessage、Flex、imagemap 多尺寸圖端 /line-imagemap、safe reply 與 reply token）、LIFF 與
  LINE Login（liffConfig、ID token 驗證）、頭像補存、postback 攔截（tag:、csat:、kb_feedback:、handoff_request）、
  渠道憑證加解密 CREDENTIAL_ENCRYPTION_KEY。當需求、bug 或新功能碰到 line、rich-menu、quick-reply-preset、
  channel-plugins/line、webhook/line、liff、line-imagemap、downstream-forwarder 時使用。
  也在改 LINE 素材、群發、加好友禮、關鍵字回覆、滿意度調查、短連結 LIFF 前使用。
  口語觸發：「LINE 收不到訊息」「圖文選單發布失敗」「LINE 滿意度沒回」「客人收回訊息」「LINE 重複訊息」「LIFF 設定」。
---

# LINE 專屬功能

## 先讀
- 功能現況：`docs/ref/features/tenant/LINE.md`（只寫了圖文選單與快速回覆；webhook、LIFF、Flex、憑證寫在本 Skill 與健檢報告）
- 健檢結果與已知問題：`docs/ref/features/health/LINE.md`
- 規格：`openspec/specs/line-webhook-events/spec.md`、`openspec/specs/line-messaging/spec.md`、`openspec/specs/line-safe-reply/spec.md`、`openspec/specs/line-rich-menu/spec.md`、`openspec/specs/line-downstream-webhook/spec.md`、`openspec/specs/credential-encryption/spec.md`
  - 注意：規格有多項沒有實作（unsend 標記收回、follow 更新 `channelStatus`、Flex `content.flexJson`、Rich Menu Alias、群發額度檢查），見健檢「完備度對照」，不要以為規格寫了就有。
- LINE 官方文件（本機）：`/Users/danielyang/Documents/line-developers-docs-source/docs/en/`（底下的 docs/messaging-api 是教學，reference/messaging-api 是 API 規格；重送去重與 unsend 的建議在 `/Users/danielyang/Documents/line-developers-docs-source/docs/en/docs/messaging-api/development-guidelines/index.html.md`）
- 手冊：`apps/web/public/manual/ch10-line.html`（圖文選單、關鍵字回覆、快速回覆）、`apps/web/public/manual/ch15-channels.html`（LINE 渠道設定）
- 影響分析：`node scripts/feature-impact.mjs --domain line`

路由：`/api/v1/webhooks/line/:channelId`（公開，`apps/api/src/modules/webhook/webhook.routes.ts`）、
`/api/v1/line/rich-menus`、`/api/v1/line/quick-reply-presets`、`/line-imagemap/:tenantId/:imageId/:width`（公開，不在 `/api` 底下）、
`/api/v1/fan/coupons/liff-session`（優惠券，行銷領域）。

## 前端操作流程

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限（後端 / 前端隱藏） |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 選 LINE 官方帳號 | `/dashboard/line/rich-menus?channelId=`，`OaSwitcher` 列出啟用中的 LINE 渠道 | `GET /channels` | 網址帶 channelId 會自動選中 | `channel.view`；側欄「渠道」群組依 `richmenu.manage` 隱藏 |
| 2 | 建立圖文選單草稿 | 「建立 Rich Menu」→ 10 種版型 → `RichMenuEditor` | 背景圖 `POST /files/upload`（前端檢查比例、1MB、像素）；`POST /line/rich-menus` → `rich-menu.service.ts` `createRichMenu` | 只寫 DB，status `draft` | `richmenu.manage` / 頁面不擋，403 時顯示成「尚未建立任何 Rich Menu」 |
| 3 | 編輯草稿 | 卡片「編輯」→ `rich-menus/[id]` | `PATCH /line/rich-menus/:id`；只有 `draft` 能改 | — | 同上 |
| 4 | 發布 | 卡片「發布」或編輯頁「發布到 LINE」（發布的是**已存檔**內容） | `POST /:id/publish`：伺服器抓 `imageUrl` → LINE 建選單 → 上傳圖 → `selected` 時設預設 | 失敗變 `error`；設預設失敗只記 log | 同上；確認視窗依 `selected` 換文字（`apps/web/src/lib/rich-menu-confirm.ts`） |
| 5 | 取消發布 | 已發布卡片「取消發布」 | `POST /:id/unpublish`：預設選單先 `DELETE /user/all/richmenu`，再刪 LINE 選單；LINE 404 視為已刪 | 回 `draft` | 同上 |
| 6 | 綁定受眾 | 已發布卡片「綁定受眾」→ `RichMenuBindDialog`（只能選分群） | `POST /:id/bind-audience {segmentId}` → 解析 LINE uid → `rich-menu-bind` 佇列 → workers `rich-menu-bind.handler.ts` 每 500 人 bulk link | 回 `{queued}`；**失敗只在佇列**，不重試、畫面看不到 | 同上；分群清單要 `marketing.view` |
| 7 | 複製、刪除 | 卡片「⋯」 | `POST /:id/duplicate`、`DELETE /:id`（只限 draft，硬刪） | 複製連 `selected` 一起複製 | 同上 |
| 8 | 快速回覆預設組 | `/dashboard/line/quick-replies` → `PresetEditDialog` | `GET/POST/PATCH/DELETE /line/quick-reply-presets`；最多 13 顆、標籤 20 字、文字 300 字 | 收件匣 `MessageInput` 套用後附在訊息的 `quickReplies` | 讀取只驗登入；寫入 `quickreply.manage` / **建立鈕不隱藏** |
| 9 | 收 LINE 訊息（系統） | LINE → `/api/v1/webhooks/line/:channelId` | 先驗簽（缺或錯 403、渠道類型不符 403、渠道不存在 200、憑證解不開 500）→ 回 200 → 背景 `processWebhookEvent` → `LinePlugin.parseWebhook` → `processInboundMessage` | 見下方「進站事件怎麼存」 | 公開，以 channelSecret HMAC 驗簽 |
| 10 | LIFF／LINE Login 設定 | 渠道設定 `BotConfigForm`（渠道領域）填 LIFF ID、Login Channel ID | `PATCH /channels/:id {settings.liffConfig}`，格式 `1234567890-AbcdEfgh`、10 位數字 | 短連結在 LINE 內走 `/liff/redirect` 取 uid；優惠券以 ID token 驗身分（`apps/api/src/modules/coupon/line-id-token.ts`） | `channel.update` |
| 11 | 下游轉發 | 渠道設定 `DownstreamWebhookDialog` | `settings.downstreamWebhook {enabled,url(https),mode}` | `immediate`：只轉發、CRM 不處理；`after`：處理後轉發；目標被 SSRF 擋或 DNS 失敗時只寫 log | `channel.update` |

**進站事件怎麼存**（`packages/channel-plugins/src/line/index.ts` `parseWebhook`）：
- `message`：text／image／video／audio／file／location／sticker；LINE 代管的媒體存 `contentId`，背景下載到物件儲存，失敗寫 `content.mediaError`（25 MB 上限）。
- `postback`：存成 `contentType: 'postback'`、`content.text = postback.data`（收件匣直接顯示原始資料，例如 `tag:<uuid>`、`menu=main`）；`postback.params`（日期選擇器選的值）**丟掉**。
- `follow`／`unfollow`／`join`／`leave`／`memberJoined`／`memberLeft`／`unsend`／`videoPlayComplete`／`accountLink`／`beacon`：都存成一則進站訊息，收件匣顯示「[不支援的訊息類型]」並加未讀數。`unsend` **不會**隱藏原訊息。
- 來源 `userId ?? groupId`：群組訊息掛在發話者的一對一對話；`join` 事件以 groupId 建一個聯絡人。`roomId` 不處理。
- 去重只看 `message.id`（`channelMsgId`）。postback、follow 等沒有訊息 id 的事件，LINE 重送（`deliveryContext.isRedelivery`）會重複處理；`webhookEventId` 只有下游轉發的迴圈防護在用。

**postback 攔截順序**（`apps/api/src/modules/webhook/webhook.service.ts` `processInboundMessage`）：跨渠道綁定 → 傳訊領券 → 招呼語 → `inbound-postback-interceptors.ts`：`tag:<uuid>` 貼標（不短路）→ `csat:<1-5>:<caseId>` → `kb_feedback:<good|bad>:<articleId|none>:<messageId>` → `handoff_request`。文字訊息打出同樣字串也會命中。

**有後端、沒有前端入口**：`POST /line/rich-menus/:id/unbind-audience`；綁定受眾用 `tagId`；`error` 狀態的 `unpublish`（列表與編輯頁都沒有按鈕，`error` 選單因此不能刪除也不能修改）；LINE 外掛的 `extensions.audience`、`extensions.analytics`、LIFF App 管理、`issueAccountLinkToken`、`createMenuAlias`（都沒有呼叫端，AUDIT PKG-06）；`apps/api/src/modules/storage/line-media.service.ts` 沒有呼叫端（實際下載走外掛的 `resolveInboundMedia`）。

**前端實際送出的值**：圖文選單 size 只有 `2500×1686`、`2500×843`；區域動作 `postback|message|uri|datetimepicker|richmenuswitch`，新草稿每區預設 `{type:'postback',data:'',label:''}`（`label:""` LINE 接受，UAT 已發布的選單就是這樣）；切成日期選擇器時下拉**顯示**「日期 + 時間」但沒有寫入 `mode`，存檔 400「日期選擇器必須指定模式」，要手動改一次下拉。uri 只允許 `http|https|line|tel`（`lineUriSchema`）。

## 不可破壞的規則
- **驗簽在回應前**：LINE 路由先 `verifyWebhookRequest` 再回 200，簽章錯回 403（規格 line-webhook-events）；事件處理在回應後背景執行。webhook 的 content-type parser 保留原始 body（`__rawBody`），改 body 解析會讓驗簽全失敗。
- LINE 驗簽用 `channelSecret`；FB／IG 用 `appSecret`。驗簽字串比較用 `signaturesMatch`（固定時間）。
- **租戶由 channelId 反查**，webhook 一律 `prismaAdmin`（無 RLS），每個查詢都要自帶 `tenantId` 或渠道條件。
- `buildLineMessage` 不認得的 `contentType` 會**靜默變成空白文字訊息**（LINE 拒收）。新增要送到 LINE 的訊息型別，一定要加 case 並寫測試；目前滿意度調查用的 `'flex'` 就沒有 case（健檢 HC-LINE-01）。
- `LinePlugin.sendMessage` 失敗回 `{success:false}` 不拋錯；呼叫端要檢查回傳值，否則失敗只剩 log（記憶規則「失敗不可以只寫 log」）。
- LINE 一次最多 5 則訊息、multicast 每批 ≤ 500（群發用 499）、快速回覆最多 13 顆、標籤 20 字。
- reply token：`selectSafeLineStrategy` 只在收到後 30 秒內用 reply，否則 push；reply 失敗補一次 push（規格 line-safe-reply）。`message.received` 事件帶 `replyToken`，對外 webhook 也會收到（AUDIT HOOK-01）。
- 憑證：AES-256-GCM，金鑰 `CREDENTIAL_ENCRYPTION_KEY`（至少 32 字），API `apps/api/src/modules/channel/channel.service.ts` 與 workers `apps/workers/src/lib/credentials.ts` 各一份實作，**要一起改**；BYOK AI 金鑰共用同一把（AUDIT AI-01）。沒有金鑰輪替機制，換金鑰後所有渠道要重填憑證。本機從 UAT 同步的渠道憑證解不開是正常的。
- 多個 LINE OA 要在同一個 provider，userId 才相同；LIFF 的 Login channel 也要在同一個 provider。
- 圖文選單：只有 `draft` 能改、能刪；預設選單 LINE 一個 OA 只有一張，發布 `selected` 選單會先取消別張；綁定是快照，系統不記錄誰綁了哪張。
- 下游轉發 `immediate` 模式會讓 CRM 完全不處理該 webhook；目標網址被擋時訊息就消失。改轉發邏輯不要拿掉 `claimForForward` 迴圈防護與 `isBlockedUrl`。
- `/line-imagemap/*` 必須公開（LINE 匿名抓圖），寬度只允許 240／300／460／700／1040，baseUrl 不含副檔名。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain line` 看最新版本。重點：
- **依賴**：渠道（憑證、settings、加解密函式）、收件匣（共用進站管線、客服回覆）、聯絡人（ChannelIdentity、頭像、貼標）、行銷（分群、LIFF 開票券）、工單（滿意度調查）、知識庫（KB 回饋 postback）、平台佇列監控（`rich-menu-bind`）。
- **被依賴**：行銷（LINE 素材格式、multicast、LINE Login）、收件匣（safe reply、快速回覆、媒體）、自動化（`contact.followed`、關鍵字回覆 reply token）、工單（LINE 滿意度）、短連結（LIFF）、聯絡人（頭像補存）。

## 回歸清單
改到本領域時，至少重走：
1. 本機假 webhook（自己算簽章）：正確簽章 200 並存訊息；錯簽章、無簽章 403；同一 `message.id` 送兩次只存一則。腳本範例：以 `crypto.createHmac('sha256', channelSecret).update(body).digest('base64')` 填 `x-line-signature`，POST 到 `/api/v1/webhooks/line/<channelId>`。測試渠道要自己用 `POST /channels` 建（憑證用假的），seed 的「健檢 LINE-A/B」憑證解不開會回 500。
2. postback `tag:<uuid>` 會貼標；`handoff_request` 讓對話轉 AGENT_HANDLED。
3. image（LINE 代管）在假權杖下要出現 `mediaError`；`fileSize` 超過 25 MB 不下載。
4. 圖文選單：建立 → 編輯 → 發布（假權杖會變「發布失敗」）→ 綁定受眾 → 取消發布；supervisor 可、agent 403。
5. 快速回覆預設組：建立、重新整理讀回、刪除；agent 寫入 403。
6. 真機（UAT 正式環境，需使用者同意）：圖文選單發布與預設、綁定受眾、LINE 滿意度調查、收回訊息、LIFF 開票券。
- 自動測試：`pnpm --filter @open333crm/channel-plugins test`；`pnpm --filter @open333crm/api test -- rich-menu webhook-signature downstream-forwarder inbound-media tag-on-click line-id-token channel-credential-security line-imagemap`；`pnpm --filter @open333crm/workers test -- rich-menu-bind credentials`；`pnpm --filter @open333crm/web test -- rich-menu imagemap-url bot-config-form-line-login`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/webhook/ channel-liff-id coupon-line-login`。
- E2E：`apps/web/tests/e2e-uat/tenant-line-materials.spec.ts`。

## 常見 bug 從哪裡查
- 「LINE 完全收不到訊息」：先看 API log 的 `[Webhook] Signature verification failed`（Channel Secret 填錯；手冊說測試連線只驗 Access Token）、`Channel not found or inactive`、`Tenant is disabled`；渠道有沒有設 `downstreamWebhook` 的 `immediate` 模式（`[DownstreamWebhook] Blocked SSRF target`）。
- 「LINE 滿意度調查客人沒收到」：`apps/api/src/modules/csat/csat.service.ts` 送 `contentType:'flex'`，`buildLineMessage` 沒有這個 case，變成空白文字被 LINE 拒收，結果沒人檢查（HC-LINE-01）。
- 「同一個點擊出現兩次」：LINE 重送事件，postback 沒有訊息 id 不去重（HC-LINE-02）。
- 「客人收回的訊息還在」：`unsend` 只存成一則「[不支援的訊息類型]」（HC-LINE-03）。
- 「圖文選單發布失敗」：錯誤詳情在回應的 `details.upstream`（畫面只顯示「請確認版型與渠道設定」）；401 是 Access Token 錯，400 多半是圖片尺寸或區域動作。`error` 狀態的選單到編輯頁按「發布到 LINE」重試，或複製一份改。
- 「綁定受眾按了沒反應」：看平台佇列監控的 `rich-menu-bind` 失敗工作（`failedReason`），API 只回 queued。
- 「圖片／影片沒出現在收件匣」：訊息 `content.mediaError`；下載走 `LinePlugin.resolveInboundMedia`，不是 `line-media.service.ts`。
- 「imagemap 圖裂」：baseUrl 要是 `{API_PUBLIC_URL}/line-imagemap/{tenantId}/{imageId}`，LINE 自己接 `/{寬度}`；預覽用 `imagemapPreviewSrc`（`apps/web/src/lib/imagemap-url.ts`）。
- 「本機 LINE 素材或渠道操作 500」：憑證是 UAT 金鑰加密的，本機解不開，到渠道設定重填 Secret 與 Token。
