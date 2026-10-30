# 會員入口（Fan Portal）健檢

- 核對日期：2026-10-30
- 程式版本：5c81102e（本機 API、web 與自動測試都是這個版本）。`origin/main`（0a49a1dc）在當天 09:16–11:54 另有 10 個 portal 修正 commit，UAT 已部署；每個問題另標「main 狀態」
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入後以 `/auth/me` 確認）
- 範圍：`docs/ref/features/feature-map.json` 的 `portal`；功能文件 `docs/ref/features/tenant/PORTAL.md`；手冊 `apps/web/public/manual/ch11-portal.html`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 本版本 portal 沒有主規格（main 已新增 portal-activity，8 條需求、25 個 scenario，本 worktree 沒有）。`member-binding` 5 條需求、9 個 scenario：缺實作 2（圖文選單、關鍵字入口）、找不到同名測試 6、缺前端入口 9（沒有任何頁面，HC-MARKETING-13 已記錄）。粉絲端 `/api/v1/fan` 6 條路由都沒有前端 |
| 自動測試 | unit：api 6 檔 62 通過（portal 3 檔、member-binding 2 檔、numeric-bounds）、web 4 檔 16 通過。feature：member-binding 1 檔 11 通過（portal 在本版本沒有 feature 測試）。無失敗、無 skip、無 `test.fail` |
| 實際操作 | 14 條流程。正常 6，異常 7，待真機驗 1 |

## 問題清單（依嚴重度）

P0：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT | main 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| HC-PORTAL-01 | P1 | 編輯草稿活動時，對話框沒有帶出原本的選項與欄位；只改標題就按「儲存」，所有選項（含競猜的正確答案）或表單欄位被刪光 | **本機 UI 實測**：建立投票「紅茶」「綠茶」→ 卡片「編輯」→ 選項欄只有一個空白「選項 1」→ 改標題 → 儲存 → `GET /portal/activities/:id` 的 `options` 為 `[]`。**UAT API 實測**：建立 QUIZ 草稿兩個選項 → 清單項沒有 `options` 欄位 → 以前端相同的 body（`options: []`）PATCH → 回應 `options: []` | `apps/web/src/app/dashboard/portal/page.tsx:182`（把清單項當 `editData`）；`apps/api/src/modules/portal/portal.service.ts:44-54`（`listActivities` 不 include options/fields）；`apps/web/src/components/portal/ActivityFormDialog.tsx:62-71, 99-104`；`portal.service.ts:131-156`（收到空陣列就 `deleteMany`） | 新 | 仍存在（UAT 重現） |
| PORTAL-01 | P2（AUDIT 為 P3） | 結果端點回傳 `isCorrect`，粉絲作答前就讀得到競猜答案；草稿活動的結果也讀得到。AUDIT 以「fanToken 沒有簽發端、端點無法進入」標 P3，**這個前提已不成立**（HC-PORTAL-02） | 本機：以 `signFanToken` 相同格式的 fanToken → `GET /fan/activities/<QUIZ>/result`，作答前回 `isCorrect: true`；`GET /fan/activities/<草稿>/result` 回 200（詳情端點對同一草稿回 404） | `apps/api/src/modules/portal/portal.service.ts:369-414`；`portal-public.routes.ts:112-118` | PORTAL-01 | 仍存在（main 補記了詳情端點不看開放時間） |
| PORTAL-02 | P2（AUDIT 為 P3） | 粉絲送出一律回 400：「您已參加過這個活動」（409）、草稿與已結束（404）都變 400 `BAD_REQUEST`；Prisma 錯誤原文（含伺服器檔案路徑與程式碼片段）直接回給公開端 | 本機：同一活動送出兩次，第二次 400；活動 `settings.pointsPerSubmit` 為 `"abc"` 時送出回 400，`message` 開頭是 `Invalid prisma.portalSubmission.create() invocation in /Users/.../portal.service.ts:301:52` | `apps/api/src/modules/portal/portal-public.routes.ts:104-109` | PORTAL-02 | 仍存在（main 把輸入解析移到 try 之外，業務錯誤仍轉 400） |
| HC-PORTAL-03 | P2 | 積分並行寫入會遺失：`addPointTransaction` 先讀最新餘額再寫入，沒有鎖。同一毫秒的多筆紀錄 `createdAt` 相同，「最新一筆」也不確定 | **本機實測**：對同一位聯絡人並行 10 次 `POST /portal/points/adjust {amount: 1}`，全部 200，餘額 45 → 47（應為 55）；資料庫 `sum(amount)=55`、最新一筆 `balance=47`，有 4 筆 `createdAt` 相同 | `apps/api/src/modules/portal/points.service.ts:18-62` | 新 | main 已修（`ac945b86`、`0a49a1dc`，讀程式） |
| HC-PORTAL-04 | P2 | 不允許重複參加的活動，同一位粉絲並行送出可以成功多次，每次都加點 | **本機實測**：同一 fanToken 並行送出 5 次 → `[200, 200, 400, 400, 400]`；資料庫該聯絡人 2 筆提交、20 點 | `apps/api/src/modules/portal/portal.service.ts:281-289` | 新（功能文件「目前的限制」有寫） | main 已修（`ac945b86`，advisory lock，讀程式） |
| HC-PORTAL-05 | P2 | `settings` 完全不驗證（`z.record(z.unknown())`）：`pointsPerSubmit: "abc"` 讓該活動的每一次送出都失敗；`-5` 讓提交記 `pointsEarned: -5`，但沒有寫積分交易，兩邊不一致。前端 `min={0}` 擋不住手動輸入負數 | 本機：建立 `settings: {pointsPerSubmit: -5}` 的活動 → 發布 → 粉絲送出 200，`pointsEarned: -5`，`/fan/me/points` 沒有對應交易 | `apps/api/src/modules/portal/portal.routes.ts:71`；`portal.service.ts:299-322`；`apps/web/src/components/portal/ActivityFormDialog.tsx:169` | 新 | main 已修（`0a78fad5`；UAT 實測 `"abc"` 回 400「每次參加的積分必須是數字」） |
| HC-PORTAL-06 | P2 | 送出的答案不驗證：不屬於該活動、甚至不是 UUID 的 `optionIds` 照收並給點；表單必填欄位空白也收；投票不限選幾個；競猜全選即滿分（功能文件已寫） | 本機：對投票送 `optionIds: ["0000…", "zzz"]` → 200、+10 點；對有必填「姓名」的表單送 `fields: {}` → 200；競猜三選項全選 → `score: 1`（滿分） | `apps/api/src/modules/portal/portal.service.ts:263-333` | 新 | 仍存在（讀程式） |
| HC-PORTAL-07 | P2 | 前端不依 `portal.manage` 隱藏操作：只有 `portal.view` 的成員仍看到「建立活動」「發布」「編輯」「刪除」「結束」「封存」「抽獎」「手動調整」，按下才收到權限不足 | **本機 UI 實測**：自訂角色 `portal.view, contact.view` → 活動頁 1 個「建立活動」、2 個「發布」、2 個「刪除」；按發布跳出 alert「權限不足…」；積分頁「手動調整」可開，送出後紅字顯示權限不足。後端都回 403 `requiredPermission: portal.manage` | `apps/web/src/app/dashboard/portal/page.tsx:125-208`；`apps/web/src/components/portal/SubmissionsView.tsx:60-64`；`apps/web/src/components/portal/PointsTab.tsx:157-159` | 新 | 仍存在 |
| HC-PORTAL-08 | P3 | 後台 PATCH、DELETE、publish、end 以 try/catch 把 409 `INVALID_ACTIVITY_STATUS` 改成 400 `BAD_REQUEST`，非 AppError 的原文也照回；archive、unarchive 正確回 409。與 PORTAL-02 同一種寫法，在後台 | 本機與 UAT：對已發布活動再按發布 → 400「僅草稿狀態的活動可以發布」；封存已封存的活動 → 409 | `apps/api/src/modules/portal/portal.routes.ts:137-181` | 新（PORTAL-02 的後台版） | 仍存在（讀程式） |
| HC-PORTAL-09 | P3 | 封存草稿後取消封存，活動變成 ENDED：從未發布的活動變成「已結束」，不能再編輯、發布或刪除 | 本機：草稿 → `POST /archive` 200 → `POST /unarchive` 回 `status: ENDED`、`publishedAt: null` | `apps/api/src/modules/portal/portal.service.ts:212-238` | 新 | 仍存在（讀程式） |
| HC-PORTAL-10 | P3 | 抽獎：草稿與進行中的活動都能抽；所有提交都已中獎時回空陣列，視窗沒有任何提示。本版本 `count` 沒有 Zod（`"abc"` 回 200 `[]`、`0` 回英文「count is required」） | 本機 UI：已全部中獎的活動按「抽獎」→ 中獎名單不出現、沒有訊息；API：`count: "abc"` 200 | `apps/api/src/modules/portal/portal.routes.ts:212-218`；`portal.service.ts:337-365`；`apps/web/src/components/portal/SubmissionsView.tsx:29-42` | 新 | `count` 驗證 main 已修（UAT 實測 `"abc"` 回 400）；狀態不限與空結果無提示仍存在 |
| HC-PORTAL-11 | P3 | 非 UUID 的活動 id、聯絡人 id 回 400 `DATABASE_ERROR`「資料處理失敗」；調整不存在的聯絡人也回 `DATABASE_ERROR`（外鍵錯誤） | 本機：`GET /portal/activities/abc`、`GET /portal/points/balance/abc`、`POST /portal/points/adjust {contactId: 0000…}` | `apps/api/src/modules/portal/portal.routes.ts` 各 `request.params as` | 新（與 HC-CONTACTS-13 同型） | main 已修（`7bd3ebd0`、`8990b049`；UAT 實測回「活動識別格式不正確」、404 `CONTACT_NOT_FOUND`） |
| HC-PORTAL-12 | P3 | 沒有 `portal.view` 的成員直接開 `/dashboard/portal/activities`，畫面顯示「尚無活動，點擊「建立活動」開始」與「建立活動」按鈕，看起來像沒有資料 | 本機 UI：seed agent 開網址；側欄已正確隱藏「粉絲活動」 | `apps/web/src/hooks/usePortal.ts:21-35`（不處理 error）；`apps/web/src/app/dashboard/portal/page.tsx:214-218` | 新（與 HC-CONTACTS-11 同型） | 仍存在 |
| HC-PORTAL-13 | P3 | 建立或編輯活動失敗時只顯示「輸入內容有誤，請檢查後重新送出」，沒有用回應 `details.issues` 的「結束時間必須晚於開始時間」 | 本機 UI：開始 12/31、結束 12/01 → 建立 | `apps/web/src/components/portal/ActivityFormDialog.tsx:115` | 新 | 仍存在 |
| HC-PORTAL-14 | P3 | 積分頁交易類型只翻譯 `activity_submit`、`admin_adjust`、`reward_redeem`；聯絡人合併與解除合併寫的 `merge_transfer_in/out`、`revert_transfer_in/out` 顯示英文代碼 | 讀程式：`contact-merge.service.ts` 的 `transferPoints` 寫 `${reason}_transfer_out` | `apps/web/src/components/portal/PointsTab.tsx:109-113` | 新 | 仍存在 |
| HC-PORTAL-15 | P3 | 會員綁定設定可以存私有位址（`http://127.0.0.1:5433/...`），存檔回 200，到連線測試或綁定才 502 `PRIVATE_ADDRESS`。路由註解寫「網址的 SSRF 檢查在 saveBindingConfig」，實際沒有。外呼時有擋，沒有實際的 SSRF | 本機：`PUT /member-binding {enabled: true, endpoint: "http://127.0.0.1:5433/x?id={{memberNo}}"}` 200 → `POST /member-binding/contacts/:id` 502，`detail: 端點不被允許（PRIVATE_ADDRESS）`。測完已把 `memberBinding` 改回 `{}` | `apps/api/src/modules/member-binding/member-binding.routes.ts:24, 54-64`；`member-binding.service.ts:61-78` | 新 | 讀程式未見修改 |
| HC-PORTAL-16 | P3 | 手動調整可以把積分扣成負數（本機扣到 -9990），`amount: 0` 也會寫一筆紀錄（前端按鈕停用，只有 API 會發生） | 本機 API | `apps/api/src/modules/portal/portal.routes.ts:34-38` | 新（產品決策） | 仍存在 |
| HC-PORTAL-02 | P3（文件） | 功能文件與 AUDIT 寫「系統目前不簽發粉絲 token，粉絲端無法使用」「`signFanToken()` 沒有呼叫端」。2026-10-22 的優惠券系統（`5234b9b6`）起，票券夾開啟成功就簽發 24 小時的 fanToken，存在顧客瀏覽器的 sessionStorage（`fanCouponToken`），可以打 `/api/v1/fan/activities*`、`/fan/me/*`、`/fan/member-binding*`。PORTAL-01、PORTAL-02 因此已可觸發。目前沒有粉絲活動的前端，所以一般顧客不會碰到，但拿到 token 的人可以直接呼叫 | 讀程式：`coupon-wallet.service.ts:104-122` 的 `grantWalletSession` 呼叫 `signFanToken`；`apps/web/src/lib/fan-api.ts` 存 token。本機以相同格式簽發的 token 實測 `/fan/*` 全部可用（真實票券夾流程待真機驗） | `docs/ref/features/tenant/PORTAL.md:21, 46, 91`；`docs/ref/system/AUDIT.md` PORTAL-01 末段 | PORTAL-01（前提過時） | 仍過時（main 的 PORTAL.md、AUDIT.md 仍寫不簽發） |

已在其他報告記錄、這裡只引用：會員綁定沒有任何前端入口（HC-MARKETING-13）；`portal.activity.submitted` 不在自動化契約（AUTO-05）；資料刪除 `anonymize` 保留活動提交與積分（ERASE-01）。

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 活動列表 | 本機、UAT | 正常：本機列出全部活動；「查看已封存」只列封存的。UAT Demo 21 筆（19 ENDED、2 DRAFT），封存 0 筆 | `status=FOO`、`type=FOO` 本機 400 `VALIDATION_ERROR` | 無 `portal.view`：後端 403，畫面顯示成空清單（HC-PORTAL-12）；側欄正確隱藏 | |
| 2 建立活動 | 本機 | 正常：UI 建立投票（兩選項、`2026-12-01T09:00`～`2026-12-31T23:59`、每次 3 點），重新整理後一致，DB 存 UTC（01:00Z、15:59Z） | 標題空白時「建立」停用；API 空白標題、錯類型、`abc` 日期、結束早於開始都 400；UI 只顯示通用訊息（HC-PORTAL-13） | 唯讀角色看得到按鈕（HC-PORTAL-07） | `datetime-local` 原字串（無時區）後端也接受，以伺服器時區解讀 |
| 3 編輯草稿 | 本機、UAT | **異常**：選項被清空（HC-PORTAL-01） | 只改 `endsAt` 早於 DB 的 `startsAt` → 400；已發布 → 400（應為 409，HC-PORTAL-08） | 唯讀角色看得到「編輯」 | P1 |
| 4 發布、結束 | 本機 | 正常：UI 發布 → 「進行中」→ 結束 → 只剩「封存」 | 重複發布、重複結束 400（HC-PORTAL-08） | 唯讀角色按發布：alert「權限不足」 | 不再確認，與手冊一致 |
| 5 封存、取消封存 | 本機 | 正常：封存有 confirm，列表消失，「查看已封存」看得到，取消封存回到 ENDED | 已封存再封存 409；進行中封存 409。**異常**：封存的草稿取消封存變 ENDED（HC-PORTAL-09） | — | |
| 6 刪除草稿 | 本機、UAT | 正常：DELETE 200，之後 GET 404 | 已發布刪除 400 | — | |
| 7 提交紀錄 | 本機 | 正常：選活動後列出 3 筆提交（聯絡人、時間、選項數、中獎、積分） | 非 UUID id 400 `DATABASE_ERROR`（HC-PORTAL-11） | 唯讀角色可看 | 下拉不含已封存的活動（手冊有寫） |
| 8 抽獎 | 本機 | 部分：API 抽出 1 位與 99 位（取全部）正常 | **異常**：全部已中獎時 UI 無提示；草稿也能抽；`count: "abc"` 200（HC-PORTAL-10） | 唯讀角色後端 403 | |
| 9 積分查詢 | 本機 | 正常：搜「hc-portal-客」列出 2 位候選並附電話、email；選定後顯示餘額與交易 | 查無時「找不到符合的聯絡人」；`page=0` 被夾成第 1 頁 | 唯讀角色可查 | 合併轉移的交易類型顯示英文（HC-PORTAL-14） |
| 10 手動調整 | 本機 | 正常：UI +5，餘額 47 → 52，第一列「人工調整 +5 52 hc-portal UI 加點」 | 1.5、3e9、非 UUID、備註 600 字 400；不存在的聯絡人 400 `DATABASE_ERROR`；可扣成負數（HC-PORTAL-16）。**異常**：並行寫入遺失（HC-PORTAL-03） | **異常**：唯讀角色看得到「手動調整」，送出後才紅字 403（HC-PORTAL-07） | UI 輸入 1.7 變 1（手冊有寫） |
| 11 粉絲瀏覽與送出 | 本機（API） | 列表只含已發布、選項不帶 `isCorrect`；送出加點、寫提交 | 無 token、裝置憑證、客服 token 都 401；草稿、已結束送出 400；**異常**：重複送出 400 而非 409、Prisma 原文外洩（PORTAL-02）、並行重複成功（HC-PORTAL-04）、答案不驗證（HC-PORTAL-06）、負積分（HC-PORTAL-05） | fanToken 只看得到自己租戶 | token 以 `signFanToken` 相同格式自行簽發；真實取得流程見待真機驗 |
| 12 粉絲結果與我的紀錄 | 本機（API） | `/fan/me/points` 餘額與交易、`/fan/me/activities` 正確 | **異常**：結果端點回 `isCorrect`、草稿可讀（PORTAL-01） | — | |
| 13 會員綁定設定 | 本機（API）、UAT（唯讀） | `GET` 未設定回 `null`；未設定時 `/test` 400 `NOT_CONFIGURED`；啟用但缺端點、缺 `memberId` 對應 400 | **異常**：私有位址可存檔（HC-PORTAL-15） | `settings.manage`：唯讀角色 403 | 沒有前端（HC-MARKETING-13）。UAT Demo 未設定。本機測完已改回 `{}` |
| 14 顧客綁定會員 | 本機（API） | 未開放時 `POST /fan/member-binding` 回 `NOT_CONFIGURED`「尚未開放會員綁定」；`/fields` 回 `enabled: false`；`GET` 回 `bound: false` | 端點為私有位址時顧客端 502 不帶 detail、後台帶 detail | — | **待真機驗**：成功綁定需要可呼叫的外部會員 API（feature 測試以 mock server 覆蓋） |

權限測試用的角色：admin；本機自建「hc-portal-唯讀」（`portal.view, contact.view`，成員 `hc-portal-ro@example.test`）；seed 的 supervisor 與 agent（預設都沒有 `portal.view`，`GET /portal/activities` 皆 403）。

## 完備度對照

本版本 portal 沒有主規格，以功能文件 `docs/ref/features/tenant/PORTAL.md` 與手冊對照，結果見上方流程。main 新增的主規格 portal-activity 涵蓋送出交易、重複參加、輸入驗證、設定驗證、積分帳本、跨租戶調整、抽獎與狀態轉換的並行；其中 HC-PORTAL-03、04、05、10（count）、11 在 main 已有對應修正與 feature 測試，要等本 worktree 更新到 main 才能實跑。

| Spec / Scenario | 實作 | 測試 | 前端入口 |
| --- | --- | --- | --- |
| member-binding／顧客完成綁定 | 有（`member-binding-fan.routes.ts`，fanToken 身分） | 找不到同名 | 無（沒有綁定頁） |
| member-binding／身分驗證失敗 | 有（401；本次實測無 token、裝置憑證皆 401） | 找不到同名 | 無 |
| member-binding／綁定成功後可查得會員識別 | 有（寫 `ContactAttribute`） | 有（「綁定成功寫入 ContactAttribute」「可查詢綁定狀態」） | 無 |
| member-binding／同一聯絡人重複綁定 | 未逐條核 | 找不到同名（現有測試是「同一會員編號不可綁到第二個聯絡人」） | 無 |
| member-binding／綁定後標籤生效 | 有（`bindTagId`） | 有（「貼標成功…」） | 無 |
| member-binding／以設定完成對接 | 有（設定驅動） | 有（lookup「查詢成功並依 fieldMapping 取值」） | 無（沒有設定頁） |
| member-binding／外部 API 呼叫失敗 | 有（`UPSTREAM_*`，不寫不完整綁定） | 有（lookup 多條） | 無 |
| member-binding／外部查無此會員 | 有（`MEMBER_NOT_FOUND`） | 有 | 無 |
| member-binding／由圖文選單進入綁定 | **缺** | 無 | 無 |
| member-binding／由關鍵字觸發綁定 | **缺** | 無 | 無 |

**有後端、沒有前端入口**：粉絲端 `/api/v1/fan` 的 6 條路由；會員綁定的後台 5 條、顧客端 3 條；`coverImage`、選項 `imageUrl`、`settings.allowMultiple`、表單「選單」型態的選項；提交的實際答案內容（後台只顯示數量）。

**前端送出的值與後端 Zod**：類型、日期（ISO，清除送 `null`）、選項、欄位、`pointsPerSubmit`（整數）、`count`、`amount` 都被後端接受；沒有發現前端送出、後端拒絕的值。反過來，後端在本版本接受前端不會送的值（`settings` 任意內容、`count` 字串），main 已收緊。

## 待真機驗

- 顧客以真實的票券夾流程（email 驗證碼或 LIFF ID token）取得 fanToken 後，打 `/fan/activities*` 與 `/fan/member-binding*`（本機以相同格式自簽 token 驗證）。
- 會員綁定對真實外部會員 API 的成功綁定、貼標、查無會員（需要客戶的會員 API）。
- 並行修正（HC-PORTAL-03、04）在 main 版本的實際行為：UAT 不宜對 Demo 聯絡人寫入無法刪除的積分紀錄，本機版本落後 main。

## UAT 操作紀錄

記在暫存 ledger `ledger/portal.md`（由主控合併到 `docs/ref/features/health/uat-ledger.md`）。建立 1 個 QUIZ 草稿活動 `健檢-2026-10-30-portal-編輯`（`ffc8a500-9710-4fcf-b37f-6a1f7c74faa7`），用來重現 HC-PORTAL-01，已刪除（之後 GET 404）。另有兩次被擋下、沒有寫入的請求（不合法的 `settings`、不存在的聯絡人）。其餘都是唯讀。

本機留下的測試資料（名稱都帶 `hc-portal-` 前綴）：2 位聯絡人、自訂角色 `hc-portal-唯讀` 與成員 `hc-portal-ro@example.test`、約 12 個活動、提交與積分紀錄。會員綁定設定已改回 `{}`。

## 建議新增到 AUDIT.md 的項目

- HC-PORTAL-01：編輯草稿活動會清空選項與欄位（P1）。
- PORTAL-01、PORTAL-02：更新「fanToken 沒有簽發端」的前提（HC-PORTAL-02），嚴重度建議升為 P2；PORTAL-02 補上 Prisma 原文含伺服器檔案路徑。
- HC-PORTAL-06：送出的答案不驗證選項歸屬與必填欄位。
- HC-PORTAL-07：後台操作不依 `portal.manage` 隱藏。
- HC-PORTAL-08：後台狀態錯誤 409 被改成 400（可併入 PORTAL-02）。
- HC-PORTAL-09：封存的草稿取消封存變成已結束。
- HC-PORTAL-15：會員綁定設定存檔不檢查私有位址，路由註解與實作不符。
- HC-PORTAL-03、04、05、11 在 main 已修，不必新增；若 AUDIT 要記錄，直接標「已修正」並引用 `ac945b86`、`0a78fad5`、`7bd3ebd0`、`8990b049`。

## 文件過時之處

- `docs/ref/features/tenant/PORTAL.md`：「粉絲端目前無法使用」「系統目前沒有簽發粉絲 token 的路徑」（第 21、46、91 行）已過時（HC-PORTAL-02）。「餘額是該聯絡人所有交易的總和」（第 71 行）不精確，實際取最新一筆的 `balance`（main 版已改寫）。
- `docs/ref/system/AUDIT.md` PORTAL-01：「目前 `signFanToken()` 沒有呼叫端…實際上無法進入」已過時（main 版仍是這段）。
- `docs/ref/system/AUDIT.md` PLAN-04 的路由覆蓋表：`portal` 寫「17 條中 8 條」。後台 `portal.routes.ts` 從 `723f6e14`（2026-08-25）起以 plugin hook 對每條路由要求 `portal.view`，14 條全部經過 `requirePermission`；另 6 條是粉絲端，不適用。方案關閉 `portal` 時後台路由應全部擋得住（本次未改方案實測）。
- 手冊 `apps/web/public/manual/ch11-portal.html` 第 3 節沒有提醒「編輯草稿會清空選項」（HC-PORTAL-01 修好前建議加警告，或修好後不必）；「客戶還沒有地方可以參加活動」仍正確（沒有粉絲端頁面）。
- `apps/api/src/modules/member-binding/member-binding.routes.ts:24` 的註解「網址的 SSRF 檢查在 saveBindingConfig」與實作不符（HC-PORTAL-15）。
