---
name: feature-comment-reply
description: >
  open333CRM「留言自動私訊」功能顧問：FB／IG 貼文留言命中關鍵字時自動私訊、規則、觸發紀錄、comment-reply 佇列。改到 comment-reply 模組、/dashboard/comment-replies、/admin/comment-reply，或改 Meta 連結、FB／IG 外掛、webhook 分派之前使用。
---

# 留言自動私訊

本 skill 只列出改程式前要讀的章節、不可破壞的規則、回歸清單與查 bug 的起點。留言自動私訊的行為寫在功能文件，本 skill 不重寫。本 skill 與功能文件不一致時，以功能文件為準，並修正本 skill。

## 涵蓋範圍

Facebook／Instagram 貼文留言命中關鍵字時自動私訊留言者（Private Replies）、選填的公開回覆、關鍵字規則（比對方式、NFKC、指定貼文、每人一次、排序、啟用、
方案上限 `maxCommentReplyRules`）、試算 `/rules/test`、觸發紀錄與手動重試、前置條件卡 readiness、開啟留言接收（`subscribe-comments`、`subscribed_apps` 的 `feed`／`comments`）、
留言收件（webhook 的留言分支、`cr:rules-ver` 規則快取）、背景送出（`comment-reply` 佇列、限流、每月私訊數 `monthlyCommentReplies`、7 天期限、`dedupeKey`）、
留言建立的聯絡人（`comment_authors`、`recipient_id` 接上身分）、收件匣「來自留言」、平台三層開關、`/admin/comment-reply` 健康頁、補訂閱腳本 `comment-reply-subscriptions.ts`。
相關的程式與資料：comment-reply 模組、`/dashboard/comment-replies`、`/admin/comment-reply`、`comment_reply_*` 資料表。
常見的問題描述：「留言沒有私訊」「同一人收到兩次私訊」「私訊沒進收件匣」「粉專私訊突然收不到（訂閱欄位被蓋掉）」。
改 Meta 連結、FB／IG 外掛、webhook 帳號分派、入站建立聯絡人、招呼語之前也使用，確認不破壞留言自動私訊。

## 先讀

先讀功能文件 `docs/ref/features/platform/COMMENT-REPLY.md`。依要改的地方，至少讀下表的章節：

| 要改的地方 | `COMMENT-REPLY.md` 的章節 |
| --- | --- |
| 找路由對應的 flow、系統端的入口 | 程式的入口 |
| 規則、試算、規則快取、方案上限、素材選項 | 規則 |
| 訂閱欄位、收件、排入送出工作、送出、重試、每人一次、收件匣關聯、個資 | 一則留言怎麼處理 |
| 租戶頁與平台頁的按鈕 | 畫面怎麼呼叫 API |
| 方案功能、平台能力、緊急停止 | 三層開關；5 個平台設定鍵 |
| 排程、告警、健康頁 | `/admin/comment-reply` 頁；背景工作與告警 |
| 出事時的處理步驟 | Runbook |

寫測試之前，先讀 `docs/ref/system/TESTING.md`。現有的測試在 `apps/api/tests/unit/modules/comment-reply/`、`apps/api/tests/feature/modules/comment-reply/`、`apps/web/tests/unit/components/comment-replies/`、`packages/channel-plugins/tests/unit/`，寫法可以照著參考。

本領域沒有健檢報告，`COMMENT-REPLY.md` 目前沒有標 `HC-` 編號的句子。

其他來源：

- 規格與設計：change 還沒有歸檔，都在 `openspec/changes/add-comment-keyword-private-reply/`。
  - `design.md`：決策 D1～D28、資料流、資料模型、API。`tasks.md`：任務與突變驗證。QA 計畫：`planning/05-qa.md`。
  - 規格在 `specs/`：`comment-private-reply`、`comment-reply-rules`、`comment-reply-contact-linking`、`comment-reply-meta-subscription`、`comment-reply-platform-controls`。
- 外掛的留言擴充、兩處建立聯絡人的邏輯：`docs/ref/modules/CHANNEL-PLUGINS.md`
- 資料表：`docs/ref/DATABASE-ERD.md` 的 N 節、`docs/16_DB_SCHEMA.md` 的決策 8
- 權限：`docs/ref/modules/PERMISSIONS.md`（`comment_reply.view`、`comment_reply.manage`、`PLAN_FEATURE_NOT_INCLUDED`）
- 手冊：還沒有寫。
- 影響分析：`node scripts/feature-impact.mjs --domain comment-reply`。依賴與被依賴的領域以這個指令的輸出為準。

## 不可破壞的規則

每條規則的細節在 `COMMENT-REPLY.md` 括號內的章節。

- 訂閱欄位一律送完整清單。FB 一律經 `subscribedFieldsFor()`，IG 經 `comment-reply-channel.service.ts` 的欄位常數。不要在別處寫欄位清單。（一則留言怎麼處理）
- 試算與收件用同一份 `listActiveRulesForChannel()` 與 `matchCommentRule()`。（規則）
- 規則的每一種異動都在 commit 之後呼叫 `bumpCommentReplyRulesVersion()`。（規則）
- 送出工作只有一個排入點 `enqueueCommentReplyDelivery()`。job 與日誌不放留言內容與名稱。（一則留言怎麼處理）
- `settings.commentReply` 只經 `comment-reply-settings.ts` 讀寫。`subscribedAt` 是第一次訂閱成功的時間，不覆寫。（一則留言怎麼處理）
- Meta 呼叫不在交易內：讀紀錄與認領各一個短交易，外掛在交易外呼叫，再開交易寫結果。後台 API 呼叫 Meta 或使用 Redis 的函式放在 `comment-reply-meta.ts`，不放在 `.service.ts`。（程式的入口；一則留言怎麼處理）
- 冪等有三層：收件的 `(channelId, commentId)` 唯一加 `ON CONFLICT DO NOTHING`；認領以 `status='PENDING'` 條件更新；`dedupeKey` 部分唯一索引只在 `SENDING`、`SENT` 生效。改這三處要跑 `comment-reply-dedupe.test.ts` 與 `comment-reply-intake.test.ts` 的並行案例。（一則留言怎麼處理）
- 業務失敗不讓 job 失敗。限流延後用 `DelayedError`，不消耗 attempts。（一則留言怎麼處理）
- 背景工作自己查方案與開關（`comment-reply-entitlement.ts`、`isCommentReplyPlanEnabled()`）。（一則留言怎麼處理；三層開關）
- 兩處建立聯絡人要同步：留言收件（`resolveCommentAuthor()`、`linkRecipientIdentity()`）與私訊進站（`findCommentAuthorContact()`）。留言收件不建 `ChannelIdentity`、不發 `contact.created`、不送招呼語。（一則留言怎麼處理；`CHANNEL-PLUGINS.md`）
- 外掛差異只經 `extensions.comments`（結構規則 5），`comment-reply` 模組不比對 `channelType`。用 `commentExtensionOf()`、`commentChannelTypes()`、`commentAppModeOf()`。（一則留言怎麼處理）
- 留言內容、留言者名稱、PSID 是個資。新增欄位時，資料匯出、資料刪除與聯絡人合併一起改。（一則留言怎麼處理）

## 回歸清單

改到本領域時，至少重走：

自動測試：

- `pnpm --filter @open333crm/api test -- comment-reply`
- `pnpm --filter @open333crm/channel-plugins test -- comment`
- `pnpm --filter @open333crm/web test -- comment-replies`
- feature 測試用獨立的資料庫：`TEST_DATABASE_NAME=<自己的測試庫> pnpm --filter @open333crm/api test:feature modules/comment-reply modules/meta-connect modules/platform/platform-comment-reply modules/queue-monitoring`。
- 改 `webhook.service.ts`、`meta-connect.service.ts`、`inbound-contact-resolver.ts`、`first-contact-greeting`、`contact-merge.service.ts` 時，也要跑本領域的 feature 測試。

手動（UAT 是正式環境。任何寫入、改 Meta App、開能力，都要先取得使用者同意）：

1. 把測試租戶放進含 `comment_reply` 的方案。
2. 在平台打開 `fbPrivateReply`。
3. 開啟留言接收的前後各 `GET subscribed_apps` 一次，對照私訊欄位都還在。
4. 立刻傳一則私訊，確認仍進收件匣。
5. 留言命中規則，確認收到私訊。
6. 回覆這則私訊，確認進收件匣，而且有「來自留言」。

## 常見 bug 從哪裡查

- 「留言沒有私訊」：照 `COMMENT-REPLY.md` 的 Runbook。先看觸發紀錄有沒有這則留言：沒有紀錄，是收件的前置檢查擋下或沒有命中；有紀錄，看原因代碼。
- 「粉專私訊突然收不到」：某處送了不完整的訂閱欄位。
  - 查 `subscribeFields` 的呼叫端是否都經 `subscribedFieldsFor()`。
  - 補救用 `apps/api/src/scripts/comment-reply-subscriptions.ts --mode resubscribe`（預設 dry-run）。
- 「同一人收到兩次私訊」：查 `dedupePerCommenter`、`dedupeKey` 部分唯一索引。規則刪除再重建時，新規則會再私訊一次，這是預期的行為。
- 「改了規則，收件沒變」：查規則異動有沒有遞增 `cr:rules-ver:<channelId>`（`comment-reply.flow.ts` 的 `bumpRulesVersion`）。
- 「私訊沒進收件匣」：查 `comment-reply-inbox.service.ts` 的 `attachCommentOrigin`（30 天內、`recipientUid` 等於發送者 UID 的 SENT 紀錄）。
