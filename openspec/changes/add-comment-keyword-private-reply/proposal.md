## Why

粉專與 IG 經營最常見的互動是「貼文留言」：活動貼文請粉絲留「+1」或關鍵字領優惠、領資料。目前系統只處理私訊
（webhook 只讀 `entry.messaging[]`），留言完全不進系統，客服只能到 Meta Business Suite 一則一則手動私訊。

Meta 的 Private Replies 允許商家對「留言者」主動送一則私訊（每則留言 1 次、留言後 7 天內），這也是 IG 少數合法的
主動觸及方式（`優惠券系統方案_20260911.md` 已把「FB/IG 留言觸發」列為優惠券的重點入口）。2026-10-21 已有一份初步
規劃（`~/.claude/plans/fb-mcp-po-calm-glacier.md`），本 change 以它為基礎，補齊 UI/UX、架構、資料庫與維運、QA 的規劃。

## What Changes

- **留言關鍵字規則**：租戶在後台建立規則：渠道（FB 粉專或 IG 帳號）、關鍵字與比對方式（任一／全部）、指定貼文
  （不填代表全部貼文）、要私訊的內容（素材或文字）、選填的公開回覆留言文字、啟用狀態與優先順序。
- **收留言事件**：FB 訂閱 Page webhook `feed`（`item=comment`、`verb=add`），IG 訂閱 `comments`。渠道外掛新增解析留言
  事件的能力；粉專或 IG 帳號自己的留言一律略過，避免迴圈。
- **自動私訊**：命中規則時，用 Send API 的 `recipient: { comment_id }` 私訊留言者；有設定時另外公開回覆留言。
  處理放在背景佇列，不在 webhook 請求內同步送出。
- **防重複與限制**：同一則留言最多私訊一次（Meta 重投、廣告貼文重複事件都不會重送）；超過 7 天的留言不送並記為過期。
- **觸發紀錄**：每則命中的留言都留紀錄（送出、失敗與原因、過期、略過），後台看得到。失敗不能只寫 log。
- **後續對話**：留言者回覆私訊後，照現有私訊流程進收件匣，與留言紀錄關聯。
- **Meta 連結流程**：新連結與重新連結時訂閱 `feed`／`comments` 並要求需要的權限；既有已連結的粉專要能補訂閱。

## Capabilities

### New Capabilities

- `comment-private-reply`：命中留言的收件與分派、同一則留言只一筆紀錄、背景送出與內容渲染、送出前重新檢查、7 天期限、
  重複執行與當機復原、每人一次、失敗原因、網路重試、限流排隊、公開回覆、觸發紀錄查詢與重試、遺失工作補回、留言刪除、個資不進日誌。
- `comment-reply-rules`：規則建立與驗證、私訊內容限制、素材選項、渠道不可改、貼文 ID 正規化、公開回覆設定、優先順序、
  關鍵字比對（NFKC）、試算、渠道可見範圍、軟刪除。
- `comment-reply-contact-linking`：命中就建立或沿用聯絡人、私訊成功後以 `recipient_id` 接上身分（必要時以合併引擎併入）、
  顧客第一次回覆時補入私訊並標記對話來源、收件匣「來自留言」、合併後紀錄顯示目前聯絡人。
- `comment-reply-meta-subscription`：前置條件查詢、開啟／關閉留言接收（完整欄位）、重新連結保留 `feed`、`returnTo`、
  最近貼文清單、網址找貼文、定期檢查訂閱。
- `comment-reply-platform-controls`：方案 feature、`/admin/plans` 兩個上限欄位、平台設定鍵型別檢查、能力開關、測試階段旗標、
  緊急停止、`/admin/comment-reply`、維運告警、保存期限。

### Modified Capabilities

- `channel-plugins`：MODIFIED「Unified channel plugin interface」（選用 `extensions.comments`）；ADDED「Facebook plugin parses page
  feed comments」「Comment extension normalizes Meta errors」「Facebook private reply targets the comment」「Comment post references
  are normalized offline」。
- `threads-channel`：ADDED「Instagram Comment Parsing」「Instagram Comment Private Reply」。
- `first-contact-greeting`：MODIFIED「首次進站時送出招呼語」（以未歸檔 `fix-line-follow-unfollow-events` 的版本為底，該 change 須先歸檔）、
  「聯絡人建立時發布 contact.created 事件」。
- `inbound-contact-resolution`：MODIFIED「新 UID 首次進站必須建立聯絡人並落地訊息」（先查留言者對應）。
- `contact-management`：MODIFIED「Contact Merging」「Merge Reversal Moves Records Back」（搬留言者對應、來源 `COMMENT_REPLY`）。
- `tenant-data-erasure`：MODIFIED「匿名化聯絡人」「硬刪除聯絡人」。
- `tenant-data-export`：MODIFIED「產生匯出檔」。
- `queue-monitoring`：MODIFIED「列出所有佇列」（`comment-reply`）。
- `tenant-audit-log`：MODIFIED「記錄租戶內的敏感操作」。
- `plan-limits-core`：ADDED「留言規則啟用數硬擋」「每月留言私訊數於送出前檢查」。
- 與未歸檔 change 的關係：`fix-meta-webhook-page-routing` 新增的 `meta-page-connect` 尚未進主規格，所以「重新連結粉專時保留留言欄位」
  暫放在 `comment-reply-meta-subscription`（ADDED）；它先歸檔時，本 change 歸檔前改寫為 `meta-page-connect` 的 MODIFIED。
  留言事件沿用它的「Meta webhook events are routed by account ID」分派規則，不改其文字。
- 不需要修改：`channel-management`（「有資料的渠道改用停用」已涵蓋有紀錄的渠道）、`permission-model`／`rbac`（權限碼由註冊表產生）、
  `granular-plan-entitlement`（feature 清單已動態化）。

## Platform layer

- **新增權限點**（`comment_reply.view`、`comment_reply.manage`）：在 `packages/shared/src/rbac/permissions.ts` 指定
  `feature: 'comment_reply'`，路由用 `requirePermission()`；`manage` 只 `implies channel.view`（design D20）。部署後跑 reconcile。
- **新的功能區塊**：`comment_reply` 加進 `packages/core/src/rbac/features.ts`。依決定 6，既有方案預設不含，由平台在 `/admin/plans`
  勾選；既有方案現況就不含，所以不寫方案資料 migration（design D23）。背景收件與送出另查方案 feature。
- **方案上限**：`maxCommentReplyRules`（建立／啟用規則時檢查）、`monthlyCommentReplies`（送出前原子扣減）加進 `plan-limits.service.ts`
  與 `/admin/plans` 的 `LIMIT_KEYS`；null＝無上限。
- **新的 BullMQ 佇列** `comment-reply`（API 行程）：加進 `monitored-queues.ts` 的 `API_QUEUES`。補回、健康檢查、保存期限三個排程掛在
  既有 `api-scheduler`，不新增佇列（design D2）。
- **平台要看到與控制的狀態**：平台設定鍵 `commentReply.capabilities`、`testPhase`、`emergencyStop`、`rateLimits`、`logRetentionDays`
  （沿用 `PUT /platform/settings/:key`，加型別檢查）；新頁 `/admin/comment-reply` 與 `GET /api/v1/platform/comment-reply/health`
  顯示各租戶渠道的訂閱健康與失敗統計（design D21）。
- **平台稽核**：設定寫入沿用 `setting.update`，不新增平台稽核動作與標籤。
- 不呼叫 AI、不新增渠道類型；租戶與平台之間沒有新的申請流程（達上限走既有方案升級申請）。

## 決定（2026-11-13 使用者）

1. **FB 與 IG 同一版一起做。**
2. **公開回覆留言這一版就做**（預設關閉；需要 `pages_manage_engagement`，送審時程由 SRE 規劃評估）。
3. **做成方案可開關的獨立功能，並設數量上限**：新增 feature（`packages/core/src/rbac/features.ts`），決定哪些方案包含；
   上限鍵與檢查點由架構與 SRE 規劃提出（例如啟用中規則數、每月私訊數），每個上限都要有實際檢查。
4. **留言者沒有對應聯絡人時建立聯絡人**（只有留言者 ID 與名稱），顧客之後回覆私訊時要對到同一位聯絡人，不可重複建立。
5. **聯絡人在留言命中規則時就建立**（不論私訊是否成功）。FB 留言者 ID 不一定等於 Messenger 的 PSID，私訊成功後要以
   Send API 回傳的 `recipient_id` 把同一人接起來，不可留下重複聯絡人。
6. **方案由平台層設定**：不預設哪些方案包含；平台在 `/admin/plans` 勾選哪個方案可以使用、設定兩個上限的數值。
   既有方案預設不含（一次性 migration 只加 feature 定義，不替任何方案打開）。
7. **上線節奏：FB 私訊先上**。程式 FB＋IG＋公開回覆一次做完；FB 私訊用已核准權限先開放（指定貼文先手動貼 ID），
   「從貼文清單挑」、公開回覆、IG 等 Meta 審核通過後由平台開關打開。
8. **平台後台專頁 `/admin/comment-reply` 這一版就做**：測試階段旗標、緊急停止、各能力開關、限速、各租戶 Meta 訂閱
   健康狀態與失敗統計。

## 仍待決定

9. Meta App Review 時程與審核前的使用限制（Standard Access 只對 App 上有角色的帳號生效）；審核前的「測試階段」提示由平台層控制。
10. UX 規劃提出的細節：收件匣「來自留言」標籤顯示期間、觸發紀錄是否匯出 CSV、規則是否加活動期間、側欄位置（見 `planning/01-ux.md`）。

## Impact

- `packages/channel-plugins`（facebook、threads）、`apps/api`（webhook、meta-connect、新模組 comment-reply、權限）、
  `apps/workers`（新 handler）、`apps/web`（新頁面）、`packages/database`（新資料表與 RLS migration）。
- 外部：創造智能 Meta App（671495162407854）要加訂 `feed`／`comments`，部分權限可能要送審；這些動作執行前會先問使用者。
