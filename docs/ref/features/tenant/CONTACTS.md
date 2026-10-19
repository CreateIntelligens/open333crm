# 聯絡人與標籤

聯絡人是「客人是誰」。同一個人可能從 LINE、Facebook、網站聊天室各進來一次，系統一開始會把他當成不同的聯絡人，之後可以合併。標籤是貼在聯絡人、對話、工單與素材上的分類，自動化規則與群發都靠它挑對象。

- **資料來源**：`apps/api/src/modules/contact/*`、`apps/api/src/modules/tag/*`、`apps/api/src/modules/webhook/inbound-contact-resolver.ts`、`apps/api/src/modules/identity-binding/email-registration.*`、`apps/api/src/modules/identity-binding/phone-registration.*`、`apps/api/src/modules/identity-binding/identifier-registration.ts`、`apps/api/src/modules/ai/other-channel-context.ts`、`apps/api/src/modules/line/line-profile.*`、`packages/core/src/identity/*`、`apps/workers/src/lib/automation-actions.ts`
- **核對日期**：2026-10-07

## 負責的模組

| 模組 | 負責什麼 |
| --- | --- |
| `contact` | 聯絡人清單與搜尋、資料編輯、歷史對話與工單、時間軸、跨渠道訊息、手動合併 |
| `tag` | 標籤的 CRUD，以及對聯絡人、對話、工單貼標與移除（`tagging.service.ts`） |
| `webhook` 的 `inbound-contact-resolver.ts` | 訊息進站時找出或建立聯絡人 |
| `identity-binding` | 跨渠道綁定代碼，以及 email 與手機登記：客人在登記頁填入 email 或手機，並依相同的值自動合併 |
| `canvas` 的 identity 部分 | 審核系統產生的合併建議。沒有頁面 |
| `line` 的 line-profile 部分 | 重新向 LINE 抓取聯絡人的名稱與頭像。沒有頁面 |

## 聯絡人與渠道身分

一個聯絡人（`Contact`）可以有多個渠道身分（`ChannelIdentity`）。渠道身分以 `(channelId, uid)` 唯一，`uid` 是渠道給的使用者 ID，例如 LINE 的 userId、Facebook 的 PSID。

訊息進站時，`resolveInboundContact()` 依下列順序找聯絡人：

1. 查 `ChannelIdentity`，看這個渠道與 uid 是否已有身分。有就用它的聯絡人。
2. 沒有的話，查 `IdentityMap`，看這個渠道類型與 uid 是否已經對應到某個聯絡人。這張表由綁定代碼與 email、手機登記的合併寫入。有的話，為那個聯絡人建立這個渠道的身分。
3. 都找不到就建立新的聯絡人與渠道身分。

因此同一個人從 LINE 與 Facebook 進來，一開始是兩個聯絡人。要變成一個，只能經過[合併](#合併)。

聯絡人的名稱與頭像取自渠道。系統只在第一次建立聯絡人時向渠道抓取一次，之後不會自動更新。

平台給的頭像網址會失效（FB 的 `profile_pic` 一段時間後回 404），所以收訊時系統在背景把頭像下載到物件儲存的 `avatars` 目錄，改存自己的網址（`inbound-avatar-refresh.ts`）。聯絡人的頭像只在和渠道身分的頭像相同時才一起換，客服改過的不覆蓋。已存著平台網址的舊身分在顧客下次進站時補存，原網址失效就重新向平台取一次；失敗後一小時內同一身分不重試。下載只接受檔案內容（不看回應標頭）是 JPEG、PNG、WebP、GIF 的圖片。LINE 另有 `PATCH /api/v1/channels/:channelId/contacts/:lineUid/sync-profile` 可以重新抓取，目前沒有頁面呼叫它。這個端點：

- 要求 `contact.update` 權限，渠道也要在成員的可見範圍內。
- 只接受自己租戶、啟用中的 LINE 渠道；其他情況一律回 404。
- 只寫入 `ChannelIdentity` 的 `profileName` 與 `profilePic`，不改 `Contact` 的名稱與頭像，以保留客服的修改。

## 清單與編輯

`GET /contacts` 只列出沒有被封存的聯絡人。支援的篩選：

| 參數 | 作用 |
| --- | --- |
| `q` | 在名稱、電話、email 中做不分大小寫的部分比對 |
| `tagId` | 只列出貼了這個標籤的聯絡人 |
| `channelType` | 只列出在這個渠道類型有身分的聯絡人 |
| `excludeChannelType` | 排除這些渠道類型的身分 |

`PATCH /contacts/:id` 可以改名稱、電話、email、語言與 `isBlocked`。電話去頭尾空白後最多 30 字，只能有數字、空白與 `+ - ( ) #`（台灣與國際號碼、分機都能存，不判斷國碼或位數），純空白視為清除；不符時回 400 並指出 `phone`。email 改成同租戶另一位未封存聯絡人已使用的 email 時，回 409 `EMAIL_IN_USE`，`details` 帶對方的 `contactId` 與 `displayName`，不更改資料；對方只在成員看不到的渠道有身分時不帶 `details`，聯絡人頁只提供仍要儲存或取消。email 沒有改變（不分大小寫）時不檢查。聯絡人頁據此讓客服選擇：合併（要 `contact.merge`，經合併預覽，來源 `MANUAL`，合併後再寫入 email）、仍要儲存（帶 `allowDuplicateEmail: true` 重送，不合併）或取消。`isBlocked` 沒有任何程式讀取，設成 `true` 不會擋下訊息、機器人或群發，見 `../../system/AUDIT.md` 的 DB-04。

聯絡人詳情頁另外提供該聯絡人的對話、工單與時間軸。時間軸合併了對話、工單與標籤的紀錄。

**跨渠道訊息。** 詳情頁的「對話紀錄」分頁呼叫 `GET /contacts/:id/messages`，把這位聯絡人在所有可見渠道的訊息依時間排成一條，每則標示渠道與發話方。每頁預設 50 則，以 `before`（上一頁回傳的 `nextCursor`）往前翻。看不到的渠道只回傳 `hiddenConversationCount`，不回傳內容或渠道名稱。`GET /contacts/:id/conversations` 的 `meta.hiddenCount` 也是看不到的對話數量，收件匣的「其他渠道的對話」用它顯示。

## 合併

所有合併都經過同一個函式：`contact-merge.service.ts` 的 `mergeContacts()`。觸發來源有四種：

| 來源 | 觸發 | 人工確認 |
| --- | --- | --- |
| `MANUAL` | 客服在後台操作，`POST /contacts/merge` | 有，前端先呼叫 `GET /contacts/merge-preview` 預覽 |
| `SUGGESTION` | 管理員在 `/api/v1/identity` 核准合併建議 | 有 |
| `EMAIL` | 客人在 email 登記頁填入 email，同租戶已有另一位未封存聯絡人使用同一個 email（不分大小寫），見 [Email 登記](#email-登記) | 沒有；合併後雙邊通知，7 天內客人可自行解除 |
| `PHONE` | 客人在手機登記頁填入手機，同租戶已有另一位未封存聯絡人使用同一支手機（統一格式後比對），見 [手機登記](#手機登記) | 沒有；合併後雙邊通知，7 天內客人可自行解除 |
| `BINDING_CODE` | 客人在另一個渠道送回跨渠道綁定代碼 | 客人自己確認 |

合併的結果不分來源：

- 被合併的聯絡人改為封存（`isArchived`），`mergedIntoId` 指向主要聯絡人，不刪除。
- 搬到主要聯絡人的資料：渠道身分、對話、工單、標籤、屬性、長期記憶、活動提交、積分、`IdentityMap`、點擊紀錄、互動流程執行、知識庫回饋、群發收件紀錄，以及聯絡人關係。主要聯絡人空白的基本欄位，以被合併者的值補上。
- 兩位聯絡人在同一個渠道都有身分時，合併被拒絕，回 409 `SAME_CHANNEL_CONFLICT`，`details.channels` 列出衝突的渠道，資料不變。檢查在鎖定雙方之後執行，兩個合併同時併入同一位聯絡人時也擋得住。合併後同一個渠道有兩個身分，回覆會送錯人，見 `../../system/AUDIT.md` 的 IDENT-03。email、手機登記與綁定代碼遇到這種情況時回覆客人「同一渠道只能綁定一個帳號」。
- 每次合併寫一筆 `ContactMergeLog`，記錄搬了哪些資料。客服可以從 `GET /contacts/:id/merge-logs` 查看，以 `POST /contacts/merge-logs/:logId/revert` 解除合併，資料會搬回去。
- 合併之後，被合併方從同一平台的另一個渠道進站時，收訊依 `IdentityMap` 把新的渠道身分直接掛到合併後的聯絡人，並把這筆身分記進把這個 uid 帶進來、且資料目前由這位聯絡人持有的每一筆未解除合併紀錄（`recordStitchedIdentity()`；連環合併時可能不只一筆）。解除合併時它跟著搬回，連同它在合併後開的對話與工單；顧客在這個渠道回覆「解除綁定」也找得到綁定。這筆身分的名稱與頭像向該平台讀取，讀不到就留空，不沿用聯絡人的資料。

手動合併另外寫一筆 `contact.merge` 租戶稽核紀錄。

`LINE_LOGIN`、`FB_LOGIN` 是舊的 LINE／Facebook 登入補 email 流程留下的來源值。該流程已在 change `add-email-identity-merge` 移除，不再產生新紀錄；合併紀錄頁仍能顯示舊值。

**合併建議。** `packages/core/src/identity/` 設計了依電話號碼找出重複聯絡人、產生合併建議（`MergeSuggestion`）、再由人工在 `/api/v1/identity` 核准的流程。唯一會建立建議的函式 `detectPhoneDuplicates()` 沒有呼叫端，因此目前不會有任何建議產生，見 `../../system/AUDIT.md` 的 IDENT-01。

## Email 登記

客人把 email 當作跨渠道的 One ID：在任一渠道登記同一個 email，各渠道的聯絡人就合併成一位。租戶在「設定」的跨渠道綁定頁開啟（`identityBinding.emailEnabled`，預設關閉），與綁定代碼分開啟用，解除關鍵字共用。

1. 客人傳送 email 登記關鍵字（預設「登記email」，整句相符），或客服在收件匣按「傳送 email 登記連結」（`POST /contacts/:id/email-registration-link`，要 `inbox.reply` 與該渠道的回覆層級）。系統在同一個對話回覆登記頁連結 `${WEB_BASE_URL}/bind/email/<token>`。
2. token 存在 Redis，綁定租戶、渠道身分與對話，30 分鐘有效，成功送出一次後失效。每個渠道身分每小時最多 5 個連結，客服代發另外計算。
3. 登記頁（`GET /api/v1/public/email-registration/:token`）只顯示渠道與客人在該渠道的名稱。客人送出 email（`POST` 同一網址），格式錯誤回 400、連結仍有效；連結不存在、過期、已使用或租戶已關閉功能都回 410。公開端點每個 IP 每分鐘 20 次。查詢以 `withTenant` 綁定 token 的租戶，不使用 `prismaAdmin`。
4. email 去除空白、轉小寫後，先以租戶與 email 取得交易層級的鎖（`pg_advisory_xact_lock`），同一個 email 的登記依序處理，再比對同租戶未封存的其他聯絡人：
   - 沒有：寫到這位聯絡人（覆蓋原值），對話回覆已登記。
   - 有：不經人工確認，把這位聯絡人併入使用這個 email、最早建立的一位（最早的就是登記者自己時不合併），來源 `EMAIL`，並寫入 `IdentityMap`（`EMAIL_MATCH`）。登記的對話，以及對方最近一段對話，各收到一則整合通知。
   - 雙方在同一個渠道都有身分：不合併、不寫入 email，對話回覆無法自動整合。比對時沒有衝突、合併時才被合併引擎拒絕（另一個合併同時併入對方）時也一樣。
   - 雙方都有電話、且統一格式後不同（`identity_conflict`）：不合併、不寫入 email，對話回覆需要客服確認是否為同一人。可能是不同的人，也可能是同一人有兩支手機；客服看到這則回覆後手動合併或處理。一方沒有電話時照常合併。手機登記反過來比對 email，見[手機登記](#手機登記)。
5. 合併後 7 天內，登記方或收到通知的對方傳送解除關鍵字，即解除這次合併。客服可以隨時從合併紀錄解除。

系統不寄驗證信（2026-10-07 決定），知道別人 email 的人也能登記並合併。以雙邊通知、自助解除與同渠道檢查降低影響。

## 手機登記

與 [Email 登記](#email-登記) 流程相同、各自啟用，以台灣手機號碼當作 One ID（`identityBinding.phoneEnabled`，預設關閉；關鍵字預設「登記手機」）。兩者共用 `identifier-registration.ts` 的流程，差異如下：

- 連結為 `${WEB_BASE_URL}/bind/phone/<token>`，公開端點 `/api/v1/public/phone-registration/:token`，客服代發 `POST /contacts/:id/phone-registration-link`。
- 只接受台灣手機：去掉空白、`-`、`(`、`)` 後為 `09` 加 8 碼，或 `+886`／`886` 接 `9` 或 `09` 開頭的同一支手機，統一存成 `09xxxxxxxx`（覆蓋原值）。其他號碼回 400 `INVALID_PHONE`，連結仍有效。
- 比對既有聯絡人時，在 SQL 對 `contacts.phone` 去掉非數字、`886` 換成 `0` 後比較，客服或匯入存的 `0912-345-678`、`+886 912 345 678` 也算相同；含分機的電話位數不符，不列入比對。鎖以統一格式後的號碼為 key。
- 合併來源 `PHONE`，`IdentityMap` 來源 `PHONE_MATCH`。
- 合併前比對雙方的 email：都有且不同（不分大小寫）時不合併、不寫入電話，結果為 `identity_conflict`，對話回覆需要客服確認。email 與手機登記可以同時開啟，這條規則避免兩組各自歸戶過的資料被連鎖併成一位；合併只補空欄，若照樣合併，其中一個 email 只會留在封存的聯絡人上，之後用它登記也比對不到。
- 登記方收到的整合通知只寫對方的渠道，不寫對方的名稱：手機號碼容易取得也猜得到，否則輸入號碼就能查出號碼主人。被併入的一方仍看得到登記方的渠道與名稱。

系統不發簡訊驗證（2026-10-14 決定），知道別人手機的人也能登記並合併，風險比 email 高。

歸戶之後，AI 回覆會讀這位聯絡人在其他渠道最近 30 天、最多 10 則的訊息，見[收件匣](./INBOX.md)。

## 標籤

標籤有兩個分類維度：

| 維度 | 值 | 作用 |
| --- | --- | --- |
| `scope` | `CONTACT`、`CONVERSATION`、`CASE`、`MATERIAL` | 標籤能貼在哪種對象上。`tagging.service.ts` 的 `assertTagScope()` 在貼標時拒絕 scope 不符的組合 |
| `type` | `MANUAL`、`AUTO`、`SYSTEM`、`CHANNEL` | 標籤的來源分類。由建立者在建立時選擇，程式不依這個值改變行為 |

同一個租戶內，名稱加 scope 不能重複。因此可以同時有一個 `CONTACT` 的「VIP」和一個 `CASE` 的「VIP」。

**素材標籤存的是字串。** `MATERIAL` scope 的標籤在素材上存成 `Material.tags` 字串陣列，不是關聯表。改名與刪除時，`tagging.service.ts` 會逐一掃過素材替換或移除這個字串。

**標籤怎麼被貼上：**

| 來源 | 程式 | `addedBy` |
| --- | --- | --- |
| 客服手動 | `addTagToTarget()` | `agent` |
| 點擊短連結或素材按鈕 | 短連結轉址與進站攔截器 | `system` |
| 自動化規則 | workers 的 `executeWorkerAutomationActions()` | `automation` |

對聯絡人貼標會發布 `contact.tagged`，事件帶著 `addedBy` 作為來源。自動化規則據此避免「自動化貼標 → 觸發自動化 → 再貼標」的迴圈。workers 貼標後透過 Redis 的 `domain:event` 頻道把事件送回 API 行程的 eventBus，由 `socket.plugin.ts` 轉發。

**自動化以名稱找標籤。** 規則的「貼標」動作存的是標籤名稱。workers 依名稱找標籤時不限 scope，找不到就用這個名稱建立一個新標籤。因此標籤被刪除或改名後，規則會默默重建舊名稱的標籤，見 `../../system/AUDIT.md` 的 AUTO-03。

**刪除標籤。** 刪除時，所有對象上的這個標籤一併移除（外鍵 `Cascade`）。短連結的 `tagOnClick` 以 ID 指向標籤。標籤刪除後，點擊時貼標失敗，只記一行 warning log，轉址照常進行。

**標籤數量沒有上限。** 方案的 `maxTags` 沒有任何檢查點，見 `../../system/AUDIT.md` 的 PLAN-04。

## 誰能做什麼

聯絡人的路由以權限碼守門：讀取要 `contact.view`，修改與貼標要 `contact.update`，合併與解除合併要 `contact.merge`。查看聯絡人的對話與跨渠道訊息另外要 `inbox.view`，查看聯絡人的工單另外要 `case.view`。

標籤的路由（`/api/v1/tags`）讀取要 `tag.view`，建立、修改與刪除要 `tag.manage`。

聯絡人的對話、工單與時間軸依渠道可見範圍過濾，清單與詳情也只回傳看得到的渠道身分。但聯絡人本身不過濾：只能看到某些渠道的成員，仍然看得到其他渠道聯絡人的姓名、電話與 email；合併也不檢查兩個聯絡人的渠道。見 `../../system/AUDIT.md` 的 RBAC-04。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **聯絡人清單與合併不套用渠道可見範圍** | 詳見 `../../system/AUDIT.md` 的 RBAC-04 |
| 自動化貼標不限 scope，會重建已刪除的標籤 | 詳見 `../../system/AUDIT.md` 的 AUTO-03 |
| Email 登記不驗證 email | 知道別人 email 的人可以登記並觸發合併。合併後雙邊通知，7 天內可自助解除，見 [Email 登記](#email-登記) |
| 手機登記不驗證手機 | 知道別人手機的人可以登記並觸發合併；共用號碼與門號回收也會併錯人。合併後雙邊通知，7 天內可自助解除，見 [手機登記](#手機登記) |
| 合併建議沒有產生端 | 詳見 `../../system/AUDIT.md` 的 IDENT-01 |
| 資料庫不擋一位聯絡人在同一個渠道有兩個身分，有的話收發訊息會對錯人 | 現在的合併會拒絕同一個渠道的兩個身分；UAT 只查到 8 位修正前 E2E 測試合併產生的 WebChat 測試聯絡人。詳見 `../../system/AUDIT.md` 的 IDENT-03 |
| `isBlocked` 與 `ContactTag.expiresAt` 沒有作用 | 詳見 `../../system/AUDIT.md` 的 DB-04 與 DB-02 |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
