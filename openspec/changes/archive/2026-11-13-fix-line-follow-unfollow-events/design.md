## Context

LINE 外掛（`packages/channel-plugins/src/line/index.ts`）把 `follow`、`unfollow`、`join`、`leave`、`memberJoined`、`memberLeft`、
`unsend`、`videoPlayComplete`、`accountLink`、`beacon` 解析成 `contentType` 等於事件名稱、`content.systemEvent` 有值的進站訊息。
`processInboundMessage()`（`apps/api/src/modules/webhook/webhook.service.ts`）對它們走和一般訊息相同的管線：解析聯絡人、建對話、
存訊息、招呼語、postback 攔截、socket、`message.received`、Canvas、非營業時間自動回覆。四個問題（見 proposal）的根源相同：
管線沒有分流系統事件。

既有可沿用的部分：

- `inbound-follow-tracking.ts` 的 `recordInboundFollow()` 已經在渠道身分記錄 `firstFollowedAt`、`lastFollowedAt`、`followCount`。
- `deliverToChannel()`（`conversation.service.ts`）已經支援 `delivery: { replyToken, receivedAt }`：LINE 渠道在 30 秒內用 reply，
  reply 失敗補一次 push（規格 line-safe-reply）。

## Goals / Non-Goals

**Goals**

- 系統事件依外掛正規化後的 `contentType` 分流，不依 `channelType` 分支（AGENTS.md 結構規則 5）。
- unfollow 不建立新聯絡人；系統事件不觸發非營業時間自動回覆；follow 的招呼語用 reply；Canvas 依真正的事件類型比對。
- 記錄每個渠道身分目前是否封鎖，並顯示在聯絡人詳情。

**Non-Goals**

- 不改發送路徑：群發、自動化、招呼語、Canvas 照常送給已封鎖的人，送不出照舊記錄失敗（使用者決定：只記錄、不排除）。
- 不改系統事件存成收件匣訊息、增加未讀數的既有行為；不處理 `unsend` 標記收回（HC-LINE-03）與事件重送去重（HC-LINE-02）。
- 不改 `Contact.isBlocked`。

## Decisions

### D1 系統事件的判斷集中在 `inbound-system-events.ts`

新增 `apps/api/src/modules/webhook/inbound-system-events.ts`，匯出：

- `isSystemEventContentType(contentType)`：上列十種 `contentType`。
- `isUnfollowFromUnknownIdentity(ctx)`：`contentType === 'unfollow'` 且這個渠道沒有該 uid 的渠道身分。
- `canvasEventTypeOf(contentType)`：Canvas 比對用的事件類型（D5）；unfollow 回傳 `null`，表示不觸發。

`processInboundMessage()`、`sendOutsideHoursAutoReply()`、`triggerWebhookFlow()` 都呼叫這裡，不各自寫一份清單。
判斷只看 `contentType`，FB／IG 之後若也解析出同名事件，行為一致。

### D2 unfollow 遇到查不到的渠道身分時整筆略過

在 `resolveInboundContact()` 之前檢查。查不到渠道身分時，不呼叫 `resolveInboundContact()`（它會建立聯絡人、或在合併的聯絡人下
新建渠道身分），寫一筆 info log 後結束，不存訊息、不送任何東西。沒有聯絡人就沒有對話可以存訊息；對已封鎖的人也沒有可以送的東西。

替代方案：照常建聯絡人但不送招呼語。否決：會留下一位沒有任何互動、也聯絡不到的空聯絡人，群發分眾還會算進去。

### D3 封鎖狀態記在渠道身分的 `blockedAt`

`ChannelIdentity.blockedAt DateTime?`：收到 unfollow 時設為處理時間，收到 follow 時清空（與 `lastFollowedAt` 同一次更新）。
放在渠道身分而不是聯絡人：聯絡人可能合併了多個渠道，封鎖的是某一個官方帳號；解除合併時渠道身分搬回原聯絡人，封鎖狀態跟著走。

不用 `Contact.isBlocked`：那是客服手動設定的「封鎖這位客人」，語意與方向都不同，混用會讓客服的手動設定被 webhook 覆蓋。

寫入沿用 `inbound-follow-tracking.ts`：`recordInboundFollow()` 的兩個更新加上 `blockedAt: null`；新增 `recordInboundUnfollow()`，
以 `channelId + uid + contact.tenantId` 條件更新。失敗只影響封鎖顯示，記錯誤後繼續（與 `recordInboundFollow()` 相同）。

事件順序：LINE 依序投遞同一位使用者的事件，這裡不比對事件時間；同一位使用者短時間內封鎖又加入、且事件亂序抵達時，
顯示可能暫時不正確，下一次 follow 或 unfollow 就會更正。

### D4 招呼語只在 follow 事件用 reply

`sendFirstContactGreeting()` 在 `contentType === 'follow'` 且 `rawPayload.replyToken` 是字串時，以
`{ contentType: 'text', content: { text }, delivery: { replyToken, receivedAt: ctx.now } }` 呼叫 `deliverToChannel()`；
其他情況照舊傳純字串（push）。超過 30 秒或 reply 失敗由 `deliverToChannel()` 退回 push，這裡不另外處理。

只用在 follow：一般訊息的 replyToken 要留給關鍵字回覆、KB 自動回覆等真正回答問題的回覆。
replyToken 只能用一次：follow 的招呼語用掉後，同一個 follow 觸發的「加入好友」自動化若也要用 reply，會失敗並由
`deliverToChannel()` 退回 push，訊息仍會送到。

### D5 Canvas 事件類型由 `contentType` 推導

| `contentType` | Canvas 事件類型 |
| --- | --- |
| `follow` 等系統事件（unfollow 除外） | 與 `contentType` 相同 |
| `unfollow` | 不觸發 |
| `postback` | `postback` |
| 其他（一般訊息） | `message` |

unfollow 不觸發：對方已封鎖，流程送出的訊息一定失敗；沒有設定事件類型的流程以前會被 unfollow 觸發，這是錯的。

### D6 資料匯出與刪除

資料匯出 `collectTenantData()` 以 `channelIdentities: true` 整列匯出，`blockedAt` 自動包含；資料刪除的匿名化刪除聯絡人的
渠道身分、硬刪除連鎖刪除，都不需要修改。

## Risks / Trade-offs

- [招呼語用掉 replyToken] →「加入好友」自動化的 reply 退回 push，多用一則額度；比起每位新好友的招呼語都用 push，總額度仍減少。
- [unfollow 的訊息仍進收件匣] → 客服看到「已封鎖」事件仍會增加未讀數，與修改前相同；是否隱藏留給之後的收件匣需求。
- [migration] 只新增一個可為 null 的欄位，不回填（既有的封鎖狀態不明），套用不鎖表。

## Migration Plan

`20261113100000_add_channel_identity_blocked_at`：`ALTER TABLE "channel_identities" ADD COLUMN "blockedAt" TIMESTAMP(3);`。
回復時刪除該欄位即可，程式不讀取時沒有其他依賴。
