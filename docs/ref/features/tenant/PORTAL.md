# 粉絲活動

粉絲活動讓租戶在 LINE 裡辦投票、表單與問答。管理員在後台建立活動、發布、查看提交紀錄並抽獎；粉絲在 LINE 內開啟活動頁參加，參加後可以累積積分。

- **資料來源**：`apps/api/src/modules/portal/*`、`apps/api/src/plugins/auth.plugin.ts`、`packages/database/prisma/schema.prisma`、`apps/api/src/modules/member-binding/*`、`apps/web/src/app/dashboard/portal/*`、`apps/web/src/components/portal/*`
- **核對日期**：2026-11-19

## 負責的程式

`portal` 模組有兩組路由，服務兩群使用者：

| 部分 | 路由檔 | 前綴 | 使用者 | 認證 |
| --- | --- | --- | --- | --- |
| 後台 | `portal.routes.ts` | `/api/v1/portal` | 客服與管理員 | 客服登入，整個 plugin 要求 `portal.view` |
| 粉絲端 | `portal-public.routes.ts` | `/api/v1/fan` | 粉絲 | 粉絲 token（`authenticateFan`） |
| 會員綁定的後台 | `member-binding/member-binding.routes.ts` | `/api/v1/member-binding` | 管理員 | 客服登入。設定要 `settings.manage`，代顧客綁定要 `contact.update` |
| 會員綁定的粉絲端 | `member-binding/member-binding-fan.routes.ts` | `/api/v1/fan/member-binding` | 粉絲 | 粉絲 token。送出綁定每個 IP 每分鐘 10 次 |

四組路由都在 `apps/api/src/index.ts` 註冊。

兩組路由都呼叫 `portal.flow.ts`，由 flow 以請求的租戶開一個交易（`inTenant()`），再呼叫服務。送出、積分帳本、抽獎與狀態轉換在同時操作時的保證，見主規格 `portal-activity`。服務分成 `portal.service.ts`（活動、提交、抽獎、結果）、`points.service.ts`（積分）與 `portal-auth.service.ts`（粉絲 token）。

租戶後台的前端頁面有活動管理、提交紀錄與積分管理。粉絲端沒有參加活動的前端頁面；這個 repo 的粉絲端頁面只有優惠券票券夾，呼叫 `/api/v1/fan/coupons*`。

## 程式的入口

| 操作 | 路由 | flow 函式（`portal.flow.ts`） |
| --- | --- | --- |
| 活動列表、單筆 | `GET /portal/activities`、`GET /portal/activities/:id` | `listActivitiesFlow()`、`getActivityFlow()` |
| 建立、編輯、刪除 | `POST /portal/activities`、`PATCH`、`DELETE /portal/activities/:id` | `createActivityFlow()`、`updateActivityFlow()`、`deleteActivityFlow()` |
| 發布、結束、封存、取消封存 | `POST /portal/activities/:id/{publish,end,archive,unarchive}` | `publishActivityFlow()`、`endActivityFlow()`、`archiveActivityFlow()`、`unarchiveActivityFlow()` |
| 提交紀錄、抽獎 | `GET /portal/activities/:id/submissions`、`POST /portal/activities/:id/draw` | `listSubmissionsFlow()`、`drawWinnersFlow()` |
| 積分紀錄、餘額、調整 | `GET /portal/points?contactId`、`GET /portal/points/balance/:contactId`、`POST /portal/points/adjust` | `listPointTransactionsFlow()`、`getPointBalanceFlow()`、`adjustPointsFlow()` → `points.service.ts` 的 `addPointTransaction()` |
| 粉絲：活動列表、單筆、結果 | `GET /fan/activities`、`GET /fan/activities/:id`、`GET /fan/activities/:id/result` | `listOpenActivitiesForFanFlow()`、`getActivityForFanFlow()`、`getActivityResultFlow()` |
| 粉絲：送出 | `POST /fan/activities/:id/submit` | `submitActivityFlow()` → `submitActivity()` |
| 粉絲：自己的紀錄與積分 | `GET /fan/me/activities`、`GET /fan/me/points` | `listContactSubmissionsFlow()`、`getFanPointsFlow()` |
| 會員綁定的設定 | `GET`、`PUT /member-binding`、`POST /member-binding/test` | `member-binding.flow.ts` |
| 代顧客綁定、解除綁定 | `POST`、`DELETE /member-binding/contacts/:contactId` | `member-binding.flow.ts` |
| 粉絲：綁定欄位、狀態、送出綁定 | `GET /fan/member-binding/fields`、`GET /fan/member-binding`、`POST /fan/member-binding` | `member-binding.flow.ts` |

**粉絲 token 由優惠券票券夾簽發。** 顧客開啟票券夾、驗證成功時，`coupon-wallet.service.ts` 的 `grantWalletSession()` 以 `signFanToken()` 簽發 24 小時有效的粉絲 token，存在顧客瀏覽器的 sessionStorage。這顆 token 可以呼叫 `/api/v1/fan/*` 的每一條路由，包括粉絲活動、積分與會員綁定，不限優惠券。見健檢 HC-PORTAL-02。票券夾與聯絡人的登記頁另外以 `signFanDeviceToken()` 簽發裝置憑證（`typ: 'fan-device'`），裝置憑證只用來判斷開啟票券連結時要不要再驗證，不能當粉絲 token。改 `portal-auth.service.ts` 會同時影響票券夾、登記頁與粉絲活動。

## 活動

活動有三種類型：

| 類型 | 粉絲做什麼 | 結果怎麼算 |
| --- | --- | --- |
| `POLL` 投票 | 選一個或多個選項 | 各選項的票數 |
| `FORM` 表單 | 填寫欄位（`PortalField`） | 只記錄內容，不計分 |
| `QUIZ` 問答 | 選答案 | 選中的正確選項數，另算平均分數 |

活動的狀態：

| 狀態 | 意思 | 怎麼進入 |
| --- | --- | --- |
| `DRAFT` | 草稿，只有草稿能編輯 | 建立 |
| `PUBLISHED` | 開放參加 | `POST /activities/:id/publish` |
| `ENDED` | 已結束，不再接受提交 | `POST /activities/:id/end` |
| `ARCHIVED` | 封存，不在清單顯示 | `POST /activities/:id/archive`，可以用 `/unarchive` 還原 |

編輯、刪除與每一種狀態轉換，都先鎖住活動列，再檢查狀態。兩個操作同時進行時，後一個等前一個 commit 之後才檢查。例如發布還沒 commit 時開始編輯，編輯會在發布 commit 之後被拒（service 丟 409 `INVALID_ACTIVITY_STATUS`），不會換掉已發布活動的選項。後台的 PATCH、DELETE、publish、end 四條路由以 try/catch 把所有錯誤改成 400 `BAD_REQUEST`，`message` 是原始訊息（HC-PORTAL-08）。archive 與 unarchive 保留 service 的狀態碼。

| 操作 | 允許的狀態 |
| --- | --- |
| 編輯、刪除、發布 | `DRAFT` |
| 結束 | `PUBLISHED` |
| 封存 | `DRAFT`、`ENDED`。進行中的活動要先結束 |
| 取消封存 | `ARCHIVED`。一律回到 `ENDED`，草稿封存後取消封存也變成 `ENDED`，之後不能再編輯、發布或刪除（HC-PORTAL-09） |

刪除是硬刪除，選項與欄位隨之刪除。提交紀錄對活動是 `onDelete: Cascade`，所以只開放刪除草稿；已有提交的活動用封存，封存保留提交紀錄。發布時寫入 `publishedAt`。建立、編輯與狀態轉換都不發事件，也不寫稽核。

建立與編輯的檢查（`portal.routes.ts`）：

- `type` 只能是 `POLL`、`FORM`、`QUIZ`，建立之後不能改。
- 標題 1～200 字，說明最多 5000 字。選項內容 1～500 字。
- 表單欄位的 `fieldKey` 1～100 字，`label` 1～200 字。`fieldType` 只檢查最多 50 字，不檢查值。
- `startsAt`、`endsAt` 用 `z.coerce.date()`。兩者都有值時，結束要晚於開始，否則回 400「結束時間必須晚於開始時間」。

編輯草稿時，`PATCH /activities/:id` 沒帶 `options` 或 `fields` 就不動那一部分；有帶就整批取代。投票與競猜送空的 `options`、表單送空的 `fields` 回 400，不刪除既有內容。後台的編輯對話框打開時以 `GET /activities/:id` 取完整活動帶入選項與欄位，載入完成前與載入失敗時不能儲存。

建立草稿時可以沒有選項或欄位，草稿可以分次補內容。發布時才檢查：投票與競猜至少一個選項、表單至少一個欄位，不符合時 `POST /activities/:id/publish` 回 400，訊息為「投票與競猜活動至少要有一個選項」或「表單活動至少要有一個欄位」，活動維持草稿。編輯與發布用同一個檢查（`assertActivityAnswerable()`）。競猜另外要求至少一個選項標為正確答案，沒有時回 400「競猜活動至少要有一個正確答案」，活動維持草稿。正確答案只在發布時檢查，建立與編輯草稿時可以還沒勾；投票不要求正確答案。後台按「發布」失敗時以 alert 顯示這段訊息，活動表單的競猜選項區也提示「發布前至少勾選一個正確答案」。開獎不看分數，仍從全部未中獎的作答隨機抽出。

活動可以設定開始與結束時間。粉絲提交時，系統檢查活動是否已發布、是否已開始、是否已結束。時間到了狀態不會自動變成 `ENDED`，只是提交會被擋下。

## 粉絲怎麼參加

1. 粉絲端取得 24 小時有效的粉絲 token（`portal-auth.service.ts` 的 `signFanToken()`）。目前只有優惠券票券夾簽發，見[負責的程式](#負責的程式)。
2. 以 token 瀏覽活動（`GET /fan/activities`）並提交（`POST /fan/activities/:id/submit`）。
3. 查看結果（`/fan/activities/:id/result`）、自己參加過的活動（`/fan/me/activities`）與積分（`/fan/me/points`）。

粉絲端的每個查詢都以 token 裡的 `tenantId` 與 `contactId` 過濾，因此只看得到自己租戶的活動與自己的紀錄。這組路由的 flow 以 `fan.tenantId` 開交易，查詢走 RLS，查詢條件漏帶 `tenantId` 時仍有 RLS 兜底。結果端點會回傳測驗的正確答案，詳情端點不看活動的開始與結束時間，見 `../../system/AUDIT.md` 的 PORTAL-01。

**粉絲 token 不能通過客服認證。** 粉絲 token 與客服的 JWT 用同一把 `JWT_SECRET` 簽發，但驗證端會檢查用途：客服端的 `authenticate` 與 socket 只接受 `typ` 為 `access` 的 token（`apps/api/src/lib/agent-token.ts`），粉絲端的 `verifyFanToken()` 只接受 `sub` 為 `fan` 的 token。新增簽發入口時，要從驗證過的憑證（例如 LINE LIFF 的 ID token）推導出聯絡人，不可接受呼叫端指定的 `contactId`。

## 提交

`submitActivity()` 的規則：

- 活動設定的 `allowMultiple` 不是 `true` 時，同一個聯絡人只能提交一次。資料庫沒有唯一限制：系統先以 advisory lock 鎖住「活動＋聯絡人」，再檢查有沒有提交過。同一個人同時送出兩次時，第二次等第一次 commit 之後才檢查，回「您已參加過這個活動」。檢查時不鎖活動列，所以不同粉絲的提交不必排隊。
- 問答的分數是「選中的正確選項數」。選錯不扣分，因此全選的人會拿到滿分。
- 活動設定了 `pointsPerSubmit` 時，每次提交自動加積分。
- 送出的答案不驗證：不屬於該活動的 `optionIds` 照收並給積分，表單的必填欄位空白也收，投票不限選幾個（HC-PORTAL-06、PORTAL-04）。
- `settings` 裡的 `allowMultiple` 與 `pointsPerSubmit` 由 `portal-settings.ts` 定義：建立與編輯活動時，`allowMultiple` 要是布林值，`pointsPerSubmit` 要是 0 以上的整數，不合法回 400；其他欄位照舊儲存。資料庫裡已經存在的不合法值，提交時當成不允許重複參加、不給積分。
- 每次提交發布 `portal.activity.submitted`。事件與提交、積分在同一個交易寫進 outbox，commit 之後才送出；三者其中一項寫不進去時一起 rollback。這個事件有送進自動化的 queue，但不在自動化規則的契約裡，規則編輯器選不到，見[自動化](./AUTOMATION.md#哪些事件能觸發規則)。

正確答案（`PortalOption.isCorrect`）不會回給粉絲端的列表與詳情，結果端點例外（PORTAL-01）。

**粉絲端的狀態碼：**

| 情況 | 適用端點 | 狀態碼與代碼 |
| --- | --- | --- |
| 沒有 `Authorization: Bearer`、token 驗簽失敗或過期、不是 `sub: 'fan'` | 全部 `/fan/*`（`authenticateFan`） | 401 `UNAUTHORIZED` |
| `:id` 不是 UUID；body 不符 Zod（選項 id 格式、超過 100 個選項、欄位超過 5000 字） | 有 `:id` 的端點、送出 | 400 `VALIDATION_ERROR` |
| 活動不存在或不開放 | `GET /fan/activities/:id`、`/result` | 404 `NOT_FOUND` |
| 活動不存在或未開放（`ACTIVITY_NOT_AVAILABLE`）、未開始（`ACTIVITY_NOT_STARTED`）、已結束（`ACTIVITY_ENDED`）、已參加過（`ALREADY_SUBMITTED`）、其他非預期錯誤 | `POST /fan/activities/:id/submit` | 全部 400 `BAD_REQUEST`，`message` 是原始錯誤訊息（PORTAL-02）。service 丟出的 404 與 409 被路由的 `catch` 改成 400 |

輸入在 `try` 之外解析，所以 token 錯誤是 401，輸入錯誤是 400 `VALIDATION_ERROR`，不會進到 `catch`。

## 抽獎

`POST /activities/:id/draw` 從還沒中獎的提交中隨機抽出指定數量，標記為中獎（`isWinner`）。`count` 是正整數。中獎不能收回；再抽一次是加抽。任何狀態的活動都能抽獎，包括草稿與進行中（HC-PORTAL-10）。所有提交都已中獎時回空陣列，畫面沒有提示（HC-PORTAL-10）。抽的單位是提交，不是聯絡人：允許重複提交的活動，同一個人提交越多次，中獎機率越高，也可能中獎不只一次。

抽獎會鎖住活動列。兩次抽獎同時進行時，後一次等前一次 commit 之後才讀未中獎名單，不會抽到同一批人。

## 積分

積分以交易紀錄（`PointTransaction`）累加。帳本只新增、不修改。每筆紀錄存著寫入後的餘額（`balance`），目前餘額取 `createdAt` 最新的一筆（`points.service.ts` 的 `getLatestPointEntry()`），不是加總所有交易。所有寫入都經過 `addPointTransaction()`，合併轉移也一樣；不要直接 `pointTransaction.create`。

`points.service.ts` 的 `addPointTransaction()` 寫入前，會先以 advisory lock 鎖住這位聯絡人的帳本，再讀最新一筆。同時寫入同一位聯絡人時，後一筆以前一筆的餘額計算。寫入時間取「現在」與「最新一筆＋1 毫秒」中較晚的一個，所以同一毫秒內連續寫入時，最新一筆仍是後寫入的那筆。合併與解除合併轉移積分時，先依 id 排序鎖住雙方的帳本，再讀餘額。

| 來源 | 程式 |
| --- | --- |
| 提交活動 | `submitActivity()` 依 `pointsPerSubmit` 自動加 |
| 管理員調整 | `POST /portal/points/adjust`，需要 `portal.manage`，可以加也可以扣，類型 `admin_adjust`。`amount` 是 int4 整數，可以把餘額扣成負數，`0` 也寫一筆紀錄（HC-PORTAL-16）。備註最多 500 字。聯絡人不存在或屬於其他租戶時回 404 `CONTACT_NOT_FOUND` |
| 聯絡人合併、解除合併 | `contact-merge.service.ts` 的 `transferPoints()`，類型 `merge_transfer_in`、`merge_transfer_out`、`revert_transfer_in`、`revert_transfer_out` |

積分綁在聯絡人上。合併聯絡人時，被合併那一方的積分與活動提交會搬到主要聯絡人；解除合併時再搬回去，見[聯絡人](./CONTACTS.md#合併)。新增掛在聯絡人上的 portal 資料表，要同時加進 `apps/api/src/modules/contact/contact-merge.service.ts` 的搬移與搬回，以及資料刪除（`apps/workers/src/handlers/data-erasure.handler.ts`）。

## 會員綁定

會員綁定把顧客對接到租戶的外部會員系統，取得會員編號。設定存在 `TenantSettings.memberBinding`。

- 設定裡的憑證只存加密值。`GET /member-binding` 把憑證遮蔽成 `••••••••`。`PUT` 收到 `••` 開頭的憑證時沿用舊值（`member-binding.flow.ts`）。
- 對外部系統的呼叫一律經 `upstream-guard.ts`，擋下私有位址，不直接 `fetch`。設定可以存私有位址，存檔回 200，到連線測試或綁定時才回 502 `PRIVATE_ADDRESS`（HC-PORTAL-15）。
- 只有完整取得會員編號時才寫入。綁定結果寫進聯絡人的 `ContactAttribute`，設定了 `bindTagId` 時另外貼標。
- 外部系統出錯時回 502，`error.code` 是 `UPSTREAM_*`。後台代綁的回應有 `detail`（例如 `PRIVATE_ADDRESS`），粉絲端的回應沒有 `detail`。

## 權限

| 動作 | 權限 |
| --- | --- |
| 讀取活動、提交紀錄、結果、積分 | `portal.view` |
| 建立、修改、刪除、發布、結束、封存活動；抽獎；調整積分 | `portal.manage` |

`portal.view`、`portal.manage` 預設只有 `admin` 角色有（`packages/shared/src/rbac/default-roles.ts`），supervisor 與 agent 要另開自訂角色。方案也要開啟 feature `portal`。側欄「粉絲活動」依 `portal.view` 顯示（`apps/web/src/components/layout/Sidebar.tsx`）。

## 畫面怎麼呼叫 API

`/dashboard/portal/activities`、`/submissions`、`/points` 三個網址共用 `apps/web/src/app/dashboard/portal/page.tsx`，依網址最後一段切換分頁。

| 畫面與操作 | API | 畫面上要知道的事 |
| --- | --- | --- |
| 活動管理：狀態分頁「全部狀態／進行中／草稿／已結束／已封存」與類型篩選 | `GET /portal/activities`，以 `fetchAllPages` 逐頁取完 | 後端預設不回傳 `ARCHIVED`；「已封存」分頁另外帶 `status=ARCHIVED`。沒有 `portal.view` 的人直接開網址時，畫面顯示「尚無活動」與「建立活動」按鈕（HC-PORTAL-12） |
| 「建立活動」（`ActivityFormDialog`） | `POST /portal/activities` | 日期以 `toIsoForApi()` 轉成 ISO。失敗時只顯示「輸入內容有誤，請檢查後重新送出」，不顯示 `details.issues` 的原因（HC-PORTAL-13） |
| 草稿卡「編輯」 | `GET /portal/activities/:id`；`PATCH /portal/activities/:id` | 見[活動](#活動) |
| 卡片「發布」「結束」「封存」「取消封存」「刪除」 | 見[程式的入口](#程式的入口) | 「結束」「封存」「刪除」先以 `confirm` 確認，「發布」不確認。失敗時以 alert 顯示後端訊息 |
| 提交紀錄（`SubmissionsView`）：下拉選活動 | `GET /portal/activities/:id/submissions` | 下拉不含已封存的活動。答案摘要只顯示數量 |
| 提交紀錄的「抽獎」 | `POST /portal/activities/:id/draw` | 見[抽獎](#抽獎) |
| 積分管理（`PointsTab`）：以名稱、電話、email 搜尋 | `GET /contacts?q&limit=20`；`GET /portal/points?contactId`；`GET /portal/points/balance/:contactId` | 搜尋聯絡人要 `contact.view`。只有一筆結果時自動選取。交易類型只翻譯 `activity_submit`、`admin_adjust`、`reward_redeem`，合併轉移的類型顯示英文代碼（HC-PORTAL-14） |
| 積分管理的「手動調整」 | `POST /portal/points/adjust` | 沒有權限時，送出後對話框以紅字顯示 403 |

頁面上的操作按鈕不依 `portal.manage` 隱藏。只有 `portal.view` 的成員也看到「建立活動」「發布」「編輯」「刪除」「結束」「封存」「抽獎」「手動調整」，按下才收到權限不足（HC-PORTAL-07）。

畫面送出的值：

- `type`：`POLL`、`FORM`、`QUIZ`。
- `fieldType`：`text`、`textarea`、`email`、`phone`、`date`、`select`。
- `settings`：只送 `{ pointsPerSubmit }`，輸入框的值經 `parseInt`，不合法時是 0。
- `options`：`{ label, imageUrl, isCorrect, sortOrder }`。空白的選項在前端先濾掉。
- 編輯時清空日期送 `null`。
- 抽獎的 `count`：`parseInt`，不合法時是 1。
- 調整積分的 `amount`：`parseInt`，輸入 1.7 變成 1。值是 0 時按鈕停用。

下列功能沒有畫面入口：

- 粉絲端整組 `/fan/*`（活動、結果、我的積分）。
- 會員綁定的設定頁與顧客綁定頁。web 沒有任何地方呼叫 `/member-binding` 或 `/fan/member-binding`（HC-MARKETING-13）。
- 活動的 `coverImage`、選項的 `imageUrl`、`settings.allowMultiple`、表單「選單」欄位的 `options`。
- 提交的實際答案內容，畫面只顯示數量。
- `portal.activity.submitted` 不在自動化規則編輯器（AUTO-05）。

## 目前的限制

| 限制 | 說明 |
| --- | --- |
| **沒有參加活動的粉絲端頁面** | 後台可以建立與發布活動，但顧客沒有頁面可以參加。票券夾簽發的粉絲 token 能呼叫活動路由，見[負責的程式](#負責的程式) |
| 提交與結束活動同時進行時，提交可能成功 | 提交讀到活動已發布之後，結束才 commit。提交時不鎖活動列，所以會多一筆剛好在結束時送出的提交 |
| 問答錯選不扣分 | 全選即可拿滿分 |
| 抽獎以提交為單位 | 允許重複提交時，多提交的人中獎機率較高 |
| 活動結束時間到了不會自動改狀態 | 提交會被擋下，但狀態仍是 `PUBLISHED` |

模組之間怎麼接力、側欄與模組的對照，見[租戶後台](./README.md)。
