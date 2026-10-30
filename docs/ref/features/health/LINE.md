# LINE 專屬功能 健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build；自建假憑證 LINE 渠道，以自己計算簽章的假 webhook 驗後端）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認，只讀）
- 範圍：`docs/ref/features/feature-map.json` 的 `line`；功能文件 `docs/ref/features/tenant/LINE.md`；Skill `.claude/skills/feature-line/SKILL.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 6 份 spec、89 個 scenario。缺實作 13 個、部分實作或行為不同 9 個（見[完備度對照](#完備度對照)）。71 個 scenario 找不到同名測試（`line-rich-menu` 39、`line-downstream-webhook` 14、`line-webhook-events` 7、`line-messaging` 6、`line-safe-reply` 5），多數行為有測試，只是名稱沒對齊 scenario。缺前端入口 4 項 |
| 自動測試 | unit：channel-plugins 12 檔 63 通過、api 15 檔 74 通過、workers 2 檔 6 通過、shared 2 檔 6 通過、web 5 檔 31 通過。feature：6 檔 46 通過（`modules/line`、`modules/webhook/`、`channel-liff-id`、`coupon-line-login`）。無失敗、無 skip、無 `test.fail` |
| 實際操作 | 11 條流程。正常 4，異常 5，待真機驗 2（另有多條的真機部分待驗） |

## 問題清單（依嚴重度）

P0：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-LINE-01 | P1 | **LINE 的滿意度調查送不出去，而且沒有任何地方看得到失敗。** `sendCsatSurvey` 以 `contentType: 'flex'` 呼叫 LINE 外掛，但 `buildLineMessage` 沒有 `'flex'` 分支，落到 `default` 變成 `{"type":"text","text":""}`。LINE 拒收空白文字；`sendMessage` 回 `{success:false}` 不拋錯，`sendCsatSurvey` 不檢查回傳值，`csatSentAt` 已寫入，不會再寄。`'flex'` 分支是 `3a19c457`（2026-05-20，新增素材系統）刪掉的，之後沒有測試涵蓋 LINE 這條路徑。AUDIT CASE-02 寫「LINE 能回覆」，與現況不符 | **實測（函式層）**：以 tsx 呼叫 `buildLineMessage('flex', {type:'flex',altText,contents})` 得到 `{"type":"text","text":""}`。**讀程式**：`csat.service.ts` 的 LINE 分支與回傳值處理。LINE 端拒收（空白 text 回 400）依 API 規格判斷，**待真機驗**：UAT Demo 租戶的 LINE 對話結案後看客人有沒有收到問卷 | `packages/channel-plugins/src/line/index.ts:134`（沒有 `'flex'` case，`:246` default）；`apps/api/src/modules/csat/csat.service.ts:25, 166` | CASE-03（CASE-02 的 LINE 列已更正） |
| HC-LINE-02 | P2 | LINE 重送事件（`deliveryContext.isRedelivery`）時，沒有訊息 id 的事件被重複處理：postback 存兩則、再跑一次攔截（貼標、轉真人、CSAT）與 AI／自動化；follow 存兩則、`followCount` 加兩次。去重只看 `message.id`，LINE 文件建議以 `webhookEventId` 去重，程式只有下游轉發的迴圈防護用它 | 本機：同一個 postback 事件（`webhookEventId` 相同）先送 `isRedelivery:false` 再送 `true` → 兩次 200，收件匣出現兩則「menu=main」；follow 同樣兩則，`followCount` 從 0 變 2 | `apps/api/src/modules/webhook/inbound-message-writer.ts:26`；`packages/channel-plugins/src/line/index.ts:376` | CHAN-07 |
| HC-LINE-03 | P2 | 客人收回訊息（`unsend`）時，原訊息照常顯示，另外多一則「[不支援的訊息類型]」並加未讀數。規格 `line-webhook-events` 要求把原訊息標成 `recalled`；LINE 開發準則也要求尊重收回、之後不能被看到或使用 | 本機：先送 text `hcmsg0001`，再送 `{"type":"unsend","unsend":{"messageId":"hcmsg0001"}}` → 收件匣兩則都在，原文未變 | `packages/channel-plugins/src/line/index.ts:402`；進站管線沒有任何 `unsend` 處理 | CHAN-08 |
| HC-LINE-04 | P2 | 圖文選單發布時，伺服器直接 `fetch(imageUrl)`，網址只驗 `z.string().url()`，不擋內網。有 `richmenu.manage`（主管預設就有）的人可以讓 API 去打內網位址，錯誤訊息回傳對方的 Content-Type 或「無法取得」，可用來探測內網服務與連接埠。專案已有 `isBlockedUrl`（下游轉發在用） | 本機：建草稿 `imageUrl: http://localhost:3001/health` → 發布回「背景圖格式必須是 JPEG 或 PNG（實際：application/json; charset=utf-8）」；`http://localhost:3000/` 回 `text/html`；`http://localhost:5433/` 回「無法取得背景圖」。整個過程在 LINE API 之前，不需要有效的 Access Token | `apps/api/src/modules/line/rich-menu.service.ts:346`；建立與修改的 schema 在 `rich-menu.routes.ts` | SEC-08 |
| HC-LINE-05 | P2 | 下游轉發設為 `immediate` 時，目標網址被 SSRF 防護擋下（內網、DNS 失敗）就不轉發，CRM 也不處理，**訊息完全消失**，只寫一行 warn log。存設定時只檢查 https，不檢查會不會被擋；錯誤訊息是英文「url must use https」 | 本機：自建渠道設 `{"enabled":true,"url":"https://localhost/hc-line-hook","mode":"immediate"}`（存檔 200）→ 送一則文字訊息 → 200，`messages` 查無該 `channelMsgId`，log 只有 `[DownstreamWebhook] Blocked SSRF target`。測完已把 settings 改回 `{}` | `apps/api/src/modules/webhook/webhook.service.ts:207-213`；`apps/api/src/modules/channel/channel.routes.ts:43`；`apps/api/src/modules/webhook/downstream-forwarder.ts` | CHAN-09 |
| HC-LINE-06 | P2 | 綁定受眾只回「已送出綁定給 N 位」，背景工作失敗（權杖失效、LINE 限流、使用者已封鎖）時不重試、不通知，畫面與渠道都沒有紀錄，只有平台的佇列監控看得到 | 本機：把自建選單設成已發布（假 `lineRichMenuId`）→ 綁定含 1 位 LINE 聯絡人的標籤 → API 回 `{queued:1}`；Redis `bull:rich-menu-bind:1` 的 `failedReason` 是 LINE 401，`attempts:0`；workers log 只有「Processing job」 | `apps/api/src/modules/line/rich-menu.service.ts:643`；`apps/workers/src/handlers/rich-menu-bind.handler.ts` | CHAN-10 |
| HC-LINE-07 | P2 | 區域動作切成「日期時間選擇」時，模式下拉**顯示**「日期 + 時間」，但沒有寫入 `mode`。按「儲存草稿」回 400「日期選擇器必須指定模式」，要把下拉改成別的再改回來才存得了 | 本機 UI：建立 → 選「上下 2 條」→ 區域 1 動作類型選「日期時間選擇」→ 填 Data → 上傳背景圖 → 儲存草稿 → 錯誤；把模式改成「日期」再改回「日期 + 時間」→ 儲存成功 | `apps/web/src/components/line/rich-menu/AreaActionEditor.tsx:36, 113` | CHAN-11 |
| HC-LINE-08 | P3 | 群組訊息被當成發話者的一對一對話：客服回覆會私訊給這個人，不是回到群組。機器人加入群組（`join`）時，以 groupId 建一個聯絡人，預設名稱與真人同格式（「LINE User 000001」）。`room` 來源不處理 | 本機：送 `source:{type:"group",groupId,userId}` 的文字 → 建立 userId 的聯絡人與一般對話；送 `join` → 建立 uid 為 groupId 的聯絡人 | `packages/channel-plugins/src/line/index.ts:301` | 新 |
| HC-LINE-09 | P3 | 「發布失敗」的選單：列表卡片只有「編輯」，「⋯ › 刪除」可按但後端回「已發布的 Rich Menu 不能直接刪除」；編輯頁欄位可以改，按「儲存草稿」回「已發布的 Rich Menu 不能直接修改」（狀態其實是 error）。後端允許 `unpublish` 把它轉回草稿，但沒有按鈕。手冊已寫「到編輯頁按發布到 LINE 重試，或複製」，所以有出路，但失敗的選單永遠刪不掉 | 本機：假權杖發布 → 狀態「發布失敗」→ 卡片按鈕只有「編輯」；刪除跳 alert；編輯頁儲存顯示上述錯誤；`POST /:id/unpublish` 回 200 並變回草稿 | `apps/web/src/app/dashboard/line/rich-menus/page.tsx:197, 225`；`apps/api/src/modules/line/rich-menu.service.ts:237, 274` | 新 |
| HC-LINE-10 | P3 | follow、unfollow、join、unsend 等事件在收件匣都顯示「[不支援的訊息類型]」並加未讀數；客人封鎖（unfollow）這種有用的資訊看不出來 | 本機：送 unfollow、follow、unsend → 收件匣出現 4 則「[不支援的訊息類型]」，對話未讀數增加 | 收件匣訊息元件不認得這些 `contentType`；存法在 `packages/channel-plugins/src/line/index.ts` 的 `parseWebhook` | 新 |
| HC-LINE-11 | P3 | postback 在收件匣顯示原始資料（例如 `tag:86c64f45-…`、`menu=main`），不是客人看到的 `displayText`；日期選擇器選的值（`postback.params`）被丟掉，只剩 Data | 本機：送 `postback.data = "booking"`、`params.datetime = "2026-11-01T10:00"` → 訊息內容只有「booking」 | `packages/channel-plugins/src/line/index.ts:376-384` | 新 |
| HC-LINE-12 | P3 | LINE webhook 回 500 的兩種情況：網址的 channelId 不是 UUID（Prisma 錯誤）；渠道憑證解不開（金鑰不同或資料壞掉）。LINE 會重試並在後台顯示錯誤，後台沒有任何提示 | 本機與 UAT：`POST /api/v1/webhooks/line/abc` 回 500；本機 seed 的「健檢 LINE-A」（憑證是假字串）回 500 | `apps/api/src/modules/webhook/webhook.routes.ts:49`；`apps/api/src/modules/webhook/webhook.service.ts:107` | 新 |
| HC-LINE-13 | P3 | 錯誤訊息是英文：`INVALID_LAYOUT`「Invalid layout size; must be 2500×1686 or 2500×843」、「Area #1 exceeds image size」「Area #1 bounds malformed」、`Unsupported action type`、下游網址「url must use https」 | 本機 API：size 1000×500、區域超出圖片 | `apps/api/src/modules/line/rich-menu.service.ts`（`validateAreas`、`createRichMenu`）；`downstream-forwarder.ts` | 新 |
| HC-LINE-14 | P3 | 發布失敗時畫面只顯示「LINE 無法建立圖文選單，請確認版型與渠道設定後重試」。Access Token 失效（LINE 401）也是這句，真正原因在回應的 `details.upstream`，畫面沒有顯示 | 本機 UI：假權杖按「發布」→ alert 只有上述文字；回應 `details.status` 為 401 | `apps/api/src/modules/line/rich-menu.service.ts`（`publishRichMenu`）；`apps/web/src/app/dashboard/line/rich-menus/page.tsx` 的 `handlePublish` | 新 |
| HC-LINE-15 | P3 | 權限不足時的畫面：agent 直接開 `/dashboard/line/rich-menus` 看到「尚未建立任何 Rich Menu」與「建立第一個 Rich Menu」（實際是 `/channels` 與 `/line/rich-menus` 都 403）；快速回覆頁的「建立預設組」不依 `quickreply.manage` 隱藏，送出才 403 | 本機：agent 帳號開兩頁 | `apps/web/src/app/dashboard/line/rich-menus/page.tsx`；`apps/web/src/app/dashboard/line/quick-replies/page.tsx` | 新 |
| HC-LINE-16 | P3 | 快速回覆頁的範例按鈕用了 emoji（「😍 非常滿意」「🙂 還可以」），違反後台 UI 不放 emoji 的規則 | 本機與 UAT 開頁即見 | `apps/web/src/app/dashboard/line/quick-replies/page.tsx:98-100` | 新 |
| HC-LINE-17 | P3 | 沒有呼叫端的 LINE 程式：`line-media.service.ts`（進站下載實際走外掛 `resolveInboundMedia`）；外掛的 `setWebhook` 送 `{webhook: url}`，LINE API 要的是 `{endpoint: url}`，現在沒人呼叫，接上就會壞；LIFF App 管理、`issueAccountLinkToken`、`createMenuAlias` 都沒有呼叫端 | `grep` 呼叫端 | `apps/api/src/modules/storage/line-media.service.ts`；`packages/channel-plugins/src/line/index.ts`（`setWebhook`） | PKG-06（補充） |
| HOOK-01 | P2 | `message.received` 仍把 LINE 的 `replyToken` 放進 payload，對外 webhook 訂閱會收到 | 讀程式 | `apps/api/src/modules/webhook/inbound-side-effects.ts:122-138` | HOOK-01（已記錄，仍未修） |

### AUDIT 項目的現況

| AUDIT | 結論 |
| --- | --- |
| CASE-02 | 表格寫 LINE「能」回覆滿意度。實際上 LINE 問卷根本送不出去（HC-LINE-01），加上 CASE-02 原本的非 LINE 渠道，目前沒有任何渠道的客人能自己回覆滿意度（只剩客服手動記分）。建議把 LINE 那一列改掉 |
| HOOK-01 | `replyToken` 仍在 `message.received`，未修 |
| PKG-06 | 確認仍成立，另補 `line-media.service.ts` 與 `setWebhook` 欄位錯誤（HC-LINE-17） |
| ARCH-01 | 表格列的 `line-login/line-login.routes.ts` 已不存在（`apps/api/src/modules/` 沒有 `line-login`），表格過時 |
| CHAN-03（程式註解引用，摘要表已無此項） | 已修好並確認：本機與 UAT 錯簽章、無簽章都回 403，回應前驗簽 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 選官方帳號 | 本機、UAT | 正常：網址帶 `channelId` 時下拉自動選中，清單只列啟用中的 LINE 渠道 | — | agent 沒有 `channel.view`，下拉是空的 | |
| 2 建立草稿 | 本機（UI、API）、UAT（只開頁） | 正常：選版型、上傳 2500×1686 圖、存檔、重新整理讀回 | **異常**：日期選擇器模式（HC-LINE-07）；尺寸 1000×500 回 `INVALID_LAYOUT`（英文，HC-LINE-13）；postback Data 空白 400 但不說第幾區；`javascript:` 網址 400「連結只允許 http、https、line 或 tel」；聊天列 15 字 400；上傳比例不符時前端擋下 | supervisor 200、agent 403；agent 開頁顯示空狀態（HC-LINE-15） | |
| 3 編輯草稿 | 本機 | 正常：改名、存檔、重新整理一致 | `error` 狀態存檔訊息錯誤（HC-LINE-09） | 同上 | |
| 4 發布 | 本機（假權杖） | 無法驗證成功路徑（假權杖） | LINE 401 → 狀態變「發布失敗」，訊息看不出是權杖問題（HC-LINE-14）；**SSRF**（HC-LINE-04） | 同上 | 成功發布、預設選單切換待真機驗 |
| 5 取消發布 | 本機（API） | `error` → `draft` 正常 | `draft` 取消發布 400「此 Rich Menu 尚未發布」 | 同上 | 列表沒有 `error` 的取消發布鈕 |
| 6 綁定受眾 | 本機 | 部分：回 `{queued:1}` | 草稿 400 `NOT_PUBLISHED`；沒帶受眾 400；不存在的標籤回 `{queued:0}`；**背景失敗看不到**（HC-LINE-06） | 同上 | 對話框只能選分群，標籤綁定與解除綁定沒有 UI |
| 7 複製、刪除 | 本機 | 正常：草稿刪除 200 | 發布失敗的選單刪不掉（HC-LINE-09） | 同上 | |
| 8 快速回覆預設組 | 本機（UI、API）、UAT（只讀） | 正常：建立、重新整理讀回、刪除；UAT 有 1 組 | 標籤 21 字、14 顆按鈕、空白名稱都 400；空名稱在對話框顯示「請輸入名稱」 | supervisor 可寫；agent 讀 200、寫 403，但建立鈕不隱藏（HC-LINE-15） | emoji（HC-LINE-16） |
| 9 收 LINE 訊息 | 本機（假 webhook）、UAT（只送錯簽章） | 正常：文字、圖片（假權杖下載失敗寫 `mediaError`「LINE 內容下載失敗（404）」）、超過 25 MB 檔案不下載、同一 `message.id` 只存一則、postback `tag:` 貼標成功、空 events 200 | 錯簽章、無簽章、FB 渠道走 LINE 網址都 403；不存在的渠道 200；非 UUID 與憑證解不開 500（HC-LINE-12） | 公開端點 | **異常**：重送重複（HC-LINE-02）、unsend（HC-LINE-03）、群組（HC-LINE-08）、事件顯示（HC-LINE-10、11）。並發重送時另建一位已封存的空聯絡人（設計如此，聯絡人領域） |
| 10 LIFF／Login 設定 | 本機（API）、UAT（只讀） | 正常：`1234567890-AbcdEfgh`、10 位數字存檔並去頭尾空白 | `abc`、`123` 都 400 並給中文說明 | `channel.update` | UAT Demo 的「LINE OA」有 LIFF ID、沒有 Login Channel ID，所以 LINE 顧客開票券不會走 LINE 驗證。LIFF 實際登入待真機驗 |
| 11 下游轉發 | 本機（API） | — | `http://` 網址 400（英文訊息）；**immediate 模式目標被擋時訊息消失**（HC-LINE-05） | `channel.update` | 實際轉發到外部網址未測（本機的 SSRF 防護擋 localhost） |

權限測試用的角色：admin、supervisor（預設有 `richmenu.manage`、`quickreply.manage`、`channel.view`）、agent（都沒有）。沒有另外建自訂角色：本領域只有兩個權限碼，系統角色已涵蓋「有」與「沒有」兩種情況。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試；「找不到同名測試」不等於沒有測試。

| Spec | Scenario 數 | 找不到同名測試 | 缺實作 | 部分或行為不同 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| line-webhook-events | 13 | 7 | 2：「Follow event updates contact」（沒有 `Contact.channelStatus` 欄位，follow 只記 `ChannelIdentity.firstFollowedAt` 等）、「Unsend event marks message」（HC-LINE-03） | 1：「Invalid signature rejected」回 403 正確，但非 UUID 與憑證解不開回 500 | 系統流程 |
| line-messaging | 6 | 6 | 4：「Flex message sent」（`content.flexJson` 不支援，`'flex'` 變空白文字，HC-LINE-01）、「Multicast batching」（不是 BullMQ，群發在請求內同步每批 499）、「Narrowcast with audience」（沒有呼叫端）、「Quota exceeded」（沒有 Broadcast／Narrowcast 的呼叫端，也沒有額度檢查） | — | 無 |
| line-safe-reply | 5 | 5 | 0 | — | 系統流程（`safe-reply.test.ts` 有測） |
| line-rich-menu | 47 | 39 | 6：「Delete Rich Menu」呼叫 LINE 刪除（只能刪草稿，且與同規格「刪除限制」矛盾）、「List … reflecting current state on LINE」（不同步 LINE）、「Bind single user」（`CHANNEL_UI_SWITCH` 自動化動作不存在）、「Create alias」「Switch alias target」（沒有 Alias API，`richmenuswitch` 實際無法使用）、「提示 richmenuswitch 需先 publish 目標」（API 不回 warning，只有前端文字） | 7：「Batch bind」佇列名與限流不同（`rich-menu-bind`、無 3 次／小時限制）；「拒絕不指定 channelId」回 `VALIDATION_ERROR` 不是 `CHANNEL_ID_REQUIRED`；「拒絕非 LINE 渠道」訊息用語不同；背景圖的格式、尺寸、大小（3 個 scenario）只在前端檢查，後端沒有 `INVALID_IMAGE_FORMAT`、`IMAGE_SIZE_MISMATCH`；「取消編輯」新建頁的「取消」鈕不確認；側欄群組名稱是「渠道」不是「LINE 管理」 | 有（列表、新建、編輯、綁定） |
| line-downstream-webhook | 14 | 14 | 0 | 1：「封鎖內網目標」符合規格，但 immediate 模式下訊息因此消失（HC-LINE-05） | 渠道設定的 `DownstreamWebhookDialog` |
| credential-encryption | 4 | 0 | 0 | — | 無（環境變數） |

**有後端、沒有前端入口**：`unbind-audience`；綁定受眾的 `tagId`；`error` 選單的 `unpublish`；LINE 外掛的分眾、洞察、LIFF App 管理、Account Link（沒有呼叫端）。

**前端送出的值與後端 Zod**：區域動作類型、uri scheme、chatBarText 長度、快速回覆的長度與數量，前後端一致。不一致只有日期選擇器的 `mode`（HC-LINE-07）。`label: ""` 後端接受，UAT 已發布的選單每一區都是 `label:""`，LINE 也接受。

## 待真機驗

- LINE 滿意度調查：客人是否收到問卷（預期收不到，HC-LINE-01）。驗證前要先修，或在 UAT Demo 的 LINE 對話結案一張工單觀察。
- 圖文選單成功發布、設為預設、取消預設、綁定受眾後客人看到的選單（本機只有假權杖）。
- 客人真的收回訊息、封鎖再加入、在群組裡傳訊息時，收件匣的呈現。
- LINE 實際重送事件的頻率（LINE 後台開啟「Webhook redelivery」時才會重送）。
- LIFF 開票券（LINE Login ID token 驗證）與短連結的 LIFF 轉址。UAT Demo 渠道沒有設 Login Channel ID。
- 下游轉發到真實的外部網址（`after`、`immediate` 兩種模式）。
- 進站圖片、影片、語音、檔案的實際下載與在收件匣播放。

## 本機與 UAT 操作紀錄

- 本機建立：LINE 渠道「hc-line-測試 OA」（假憑證，已停用；有對話所以刪不掉，回 409）、4 位聯絡人（含並發重送產生的 1 位已封存空聯絡人與 groupId 聯絡人）、3 段對話與其訊息、標籤「hc-line-點擊標籤」（已刪）、4 張圖文選單（已全部刪除）、3 組快速回覆（已刪）、上傳 1 張背景圖到 MinIO。渠道 settings 測完改回 `{}`。沒有改租戶設定、seed 帳號或系統角色。
- 本機對 `api.line.me` 的呼叫都用假權杖（發布選單、綁定、取頭像、下載媒體），LINE 回 401／404，沒有送出任何訊息。
- UAT：只讀（渠道清單、圖文選單、快速回覆、四個頁面開頁），另外對 Demo 的「LINE OA」webhook 送了錯簽章與無簽章的請求各 1 次（皆 403，不處理），對非 UUID 網址送 1 次（500）。**沒有建立資料**，不需要 ledger。

## 建議新增到 AUDIT.md 的項目

- HC-LINE-01（P1）：LINE 滿意度調查送出空白訊息、失敗無紀錄；同時更正 CASE-02 的 LINE 那一列。
- HC-LINE-02：LINE 重送事件未以 `webhookEventId` 去重。
- HC-LINE-03：收回訊息（unsend）沒有隱藏原訊息。
- HC-LINE-04：圖文選單背景圖網址可打內網（SSRF）。
- HC-LINE-05：下游轉發 immediate 模式在目標被擋時訊息消失；存設定時不檢查。
- HC-LINE-06：綁定受眾的背景失敗看不到、不重試。
- HC-LINE-07：日期選擇器模式下拉顯示值與實際值不同。
- HC-LINE-17：補進 PKG-06。
- ARCH-01：刪掉不存在的 `line-login/line-login.routes.ts`。

## 文件過時之處

- `docs/ref/features/tenant/LINE.md`：只寫圖文選單與快速回覆，沒有 webhook 收訊、事件存法、LIFF／LINE Login、Flex／imagemap、下游轉發、憑證加解密；核對日期 2026-09-30。「`error` 狀態不能修改，但可以重新發布」正確，但沒寫清楚只能從編輯頁重試、也不能刪除。
- `openspec/specs/line-webhook-events/spec.md`：`channelStatus`、`recalled` 兩個欄位不存在。
- `openspec/specs/line-messaging/spec.md`：`content.flexJson`、BullMQ multicast、Narrowcast、額度檢查都不是現況。
- `openspec/specs/line-rich-menu/spec.md`：「Delete Rich Menu」與「Rich Menu 刪除限制」互相矛盾；Alias、`CHANNEL_UI_SWITCH`、`rich-menu-batch` 3 次／小時、`CHANNEL_ID_REQUIRED`、背景圖後端錯誤碼、「LINE 管理」側欄群組都不是現況。
- `docs/ref/system/AUDIT.md`：CASE-02 的 LINE 列、ARCH-01 的 `line-login` 列。
- `apps/web/public/manual/ch10-line.html` 與現況一致（已寫明發布失敗的重試方式、日期選擇與切換選單不建議用、綁定沒有解除鈕）。
