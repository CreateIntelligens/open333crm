## 1. 測試

測試名稱以情境名稱開頭。外部服務（Graph API、AI、資料庫）都換成假的，測試不需要網路或資料庫。

情境都描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。

| 主規格 | 需求 | 測試檔 |
| --- | --- | --- |
| `threads-channel` | Message Parsing、Message Sending、Profile Retrieval | `packages/channel-plugins/tests/unit/threads-plugin.test.ts` |
| `threads-channel` | Webhook Verification | `apps/api/tests/unit/modules/webhook/threads-webhook.test.ts` |
| `threads-channel` | 驗證 Instagram 渠道的權杖、後台建立 Instagram 渠道、後台顯示 Instagram 渠道的驗證權杖 | `apps/api/tests/unit/modules/channel/channel-instagram.test.ts` |
| `threads-channel` | 收件匣以 Instagram 顯示 IG 對話 | `apps/web/tests/unit/components/inbox/instagram-inbox.test.tsx` |
| `core-inbox` | 無法解析的訊息顯示佔位文字 | `apps/web/tests/unit/components/inbox/instagram-inbox.test.tsx` |
| `inbound-message-processing` | 以平台訊息 ID 去重 | `apps/api/tests/unit/modules/webhook/inbound-channel-msg-dedup.test.ts` |
| `automation-engine` | 非文字訊息不做 AI 自動回覆 | `apps/api/tests/unit/modules/automation/non-text-no-ai-reply.test.ts` |

- [x] 1.1 寫上表的測試

## 2. 突變驗證

每個突變改壞一處程式，執行該情境的測試檔，確認測試失敗，再還原程式。

41 個突變全部讓測試失敗。其中 4 個是 #279 合併後補的，見本節最後。

| 情境 | 突變 | 結果 |
| --- | --- | --- |
| Text Message | `channelMsgId` 不帶 `message.mid` | 失敗 |
| Image Message | 圖片只帶 `mediaUrl`，不帶 `url` | 失敗 |
| Story Reply | 限時動態的回覆不加「[Story reply] 」 | 失敗 |
| Like (Heart) Reaction | 愛心解析成 `text` | 失敗 |
| 沒有 mid 的事件 | 不檢查 `message.mid` | 失敗 |
| 商業帳號自己送出的 echo | 不檢查 `is_echo` | 失敗 |
| 商業帳號自己送出的 echo | 不檢查 `sender.id` 是否等於 `entry.id` | 失敗 |
| （Message Parsing 的需求本文） | 不檢查 `object` 是否為 `instagram` | 失敗 |
| Send Text Reply | 文字訊息不帶文字 | 失敗 |
| Send Image Reply | 圖片改成以文字送出 URL | 失敗 |
| Send Quick Reply Button | quick reply 的 `payload` 改用 `label` | 失敗 |
| Graph API 回傳錯誤 | 不檢查回應的 `error` | 失敗 |
| Get Profile | `displayName` 不用 `name` | 失敗 |
| Get Profile | 不帶 `avatarUrl` | 失敗 |
| 取得個人資料失敗 | 失敗時拋出錯誤 | 失敗 |
| Valid Verification Request、驗證權杖不符 | 不比對 `hub.verify_token` | 失敗 |
| （Webhook Verification 的需求本文） | 不看驗簽的結果 | 失敗 |
| 驗證的渠道不存在 | 找不到渠道時回 403 | 失敗 |
| Webhook Message | Instagram 驗簽改用 `channelSecret` | 失敗 |
| 處理事件失敗仍回 200 | 等事件處理完才回應 | 失敗 |
| 權杖有效 | 驗證改打 `graph.facebook.com` | 失敗 |
| 權杖無效 | Instagram 不檢查 Graph API 的回應狀態 | 失敗 |
| 權杖有效、權杖無效 | 拿掉 Instagram 的驗證分支 | 失敗 |
| 讀取 Instagram 渠道的憑證 | `verifyToken` 也遮罩 | 失敗 |
| 讀取 Instagram 渠道的憑證 | `appId` 也遮罩 | 失敗 |
| 讀取 Instagram 渠道的憑證 | `pageId` 也遮罩 | 失敗 |
| 只更新部分憑證 | 不合併既有的憑證 | 失敗 |
| 缺少 appSecret | `appSecret` 改成選填 | 失敗 |
| 缺少 appSecret | Instagram 渠道不驗證憑證 | 失敗 |
| 建立 Instagram 渠道 | `webhookUrl` 的路徑一律用 `fb` | 失敗 |
| 平台重送同一則訊息 | 不以 `channelMsgId` 查重 | 失敗 |
| 兩個相同的請求同時寫入 | 不處理 P2002 | 失敗 |
| 兩個相同的請求同時寫入 | 撞到唯一限制後繼續處理 | 失敗 |
| 客人傳帶文字的貼圖 | 不檢查是不是文字訊息 | 失敗 |
| 客人傳圖片 | 圖片不轉真人 | 失敗 |
| 客人傳文字 | 文字訊息也不執行 AI 自動回覆 | 失敗 |
| （非文字訊息不做 AI 自動回覆的需求本文） | 沒有 `contentType` 的事件視為非文字訊息 | 失敗 |
| 以 Instagram 篩選收件匣 | 篩選的渠道名稱沒有 `THREADS` | 失敗 |
| 渠道標示顯示 Instagram | 渠道名稱沒有 `THREADS` | 失敗 |
| Instagram 對話傳送圖片 | `THREADS` 不在傳圖的白名單 | 失敗 |
| 無法解析的訊息 | 拿掉「[不支援的訊息類型]」 | 失敗 |

「權杖無效」的突變第一次沒有讓測試失敗。Graph API 回傳錯誤時，不檢查回應狀態的話，下一步會因為回應沒有 `user_id` 拋出同一個 400 `CHANNEL_VERIFY_FAILED`。測試改成也斷言 `details.upstream`：只有第一道檢查會帶 Meta 的錯誤訊息。需求也寫明了這個欄位。

「客人傳帶文字的貼圖」用貼圖，不用圖片。圖片會先轉給真人，對話不再是機器人處理中，所以即使拿掉「只對文字訊息」的檢查，圖片也不會觸發 AI 回覆，測不出這個檢查。

#279 的審查指出需求本文有 3 處沒有測試涵蓋，合併後補上測試與突變：

- 「後台顯示 Instagram 渠道的驗證權杖」寫 `appId`、`pageId` 完整回傳，原本的測試資料沒有這兩個欄位。
- 「非文字訊息不做 AI 自動回覆」寫沒有 `contentType` 的事件視為文字訊息，原本的測試都帶 `contentType`。
- 「Webhook Verification」寫以 `appSecret` 驗證簽章，原本只測了用對 secret，沒有測簽章不符時不交給外掛解析。

- [x] 2.1 執行上表的突變
- [x] 2.2 補上 #279 審查指出的 3 處測試，並執行對應的突變

## 3. 文件

- [x] 3.1 `docs/ref/features/tenant/CHANNELS.md`：限制表的 CHAN-02 改成只有網站聊天室送不出訊息

## 4. 歸檔

- [x] 4.1 `node scripts/validate-openspec.mjs restore-instagram-channel-spec` 通過
- [x] 4.2 以 `pnpm exec openspec archive` 歸檔
- [x] 4.3 `node scripts/validate-openspec.mjs --specs` 通過，略過的超長需求數量與歸檔前相同
