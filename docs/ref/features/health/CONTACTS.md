# 聯絡人與標籤 健檢

- 核對日期：2026-10-29
- 程式版本：5fa12f0f
- 環境：本機（獨立資料庫 `open333crm_advisor`，web 為 production build）／ UAT Demo 租戶（`a0000000-0000-0000-0000-000000000001`，登入前後都以 `/auth/me` 確認）
- 規格：`docs/ref/features/feature-map.json` 的 `contacts`；功能文件 `docs/ref/features/tenant/CONTACTS.md`

## 摘要

| 層 | 結果 |
| --- | --- |
| 完備度 | 11 份 spec、229 個 scenario。以 scenario 名稱比對測試名稱，95 個找不到同名測試（多數集中在 `contact-management` 25、`tag-management` 20、`cross-channel-binding-code` 27、`material-action-tagging` 10，這些測試存在但沒有照 scenario 命名）。確定缺實作 3 個（見[完備度對照](#完備度對照)）。缺前端入口 6 項（見下方） |
| 自動測試 | unit：api 21 檔 161 通過、web 11 檔 62 通過、workers 2 檔 11 通過，無失敗、無 skip。feature：全套 99 檔 920 通過（見下方「feature 測試的過濾」），另以正確寫法單跑 contact + tag 8 檔 44 通過 |
| 實際操作 | 13 條流程。正常 6，異常 5，待真機驗或未驗 2（另有 1 條部分未驗） |

**feature 測試的過濾。** `pnpm --filter @open333crm/api test:feature -- <過濾>` 會把 `--` 原樣傳給 vitest（`vitest run --project feature "--" "modules/contact"`），結果不過濾、跑全套。`test` 沒有這個問題（pnpm 對內建的 `test` 會吃掉 `--`）。要過濾 feature 測試，寫成 `pnpm --filter @open333crm/api test:feature modules/contact`。`.claude/agents/feature-health-checker.md` 與 AGENTS.md 的寫法都會跑全套，建議修正。

## 問題清單（依嚴重度）

P0、P1：無。

| 編號 | 嚴重度 | 問題 | 重現步驟 | 位置（file:line） | AUDIT |
| --- | --- | --- | --- | --- | --- |
| HC-CONTACTS-02 | P2 | 合併預覽以 `channelType` 判斷「新增」的渠道身分。對方的身分在另一個同類型渠道（第二個 LINE OA、第二個粉專）時顯示「（無新增）」，實際合併會把它搬過來 | 本機：聯絡人 A 只有 LINE-A、B 只有 LINE-B → `GET /contacts/merge-preview?primaryId=A&secondaryId=B`，`diff.newChannelIdentities` 為 `[]`；執行合併後 A 有 LINE-A、LINE-B 兩個身分 | `apps/api/src/modules/contact/contact.service.ts:602` | IDENT-07 |
| HC-CONTACTS-03 | P2 | 合併預覽不檢查「同一渠道都有身分」。客服走完三步、勾選確認後才收到 409 `SAME_CHANNEL_CONFLICT` | 本機與 UAT：兩個都只有同一 WebChat 渠道身分的聯絡人，預覽 200，第 3 步按「確認合併」才顯示「兩位聯絡人在同一個渠道（tatung）都有帳號…」 | `apps/api/src/modules/contact/contact.service.ts:570`（`getMergePreview`）；拒絕在 `contact-merge.service.ts` 的 `assertNoSharedChannel` | IDENT-07（與 IDENT-03 相關） |
| HC-CONTACTS-04 | P2 | 已封存（被併入）的聯絡人：頁首沒有標示、仍有「合併聯絡人」按鈕，仍可改資料與貼標。以它當主要聯絡人時預覽成功，執行才 400「目標聯絡人已被封存或合併」。只有「合併紀錄」卡寫「已被併入 另一位聯絡人」 | 本機：B 併入 A → 開 `/dashboard/contacts/B` → 合併按鈕可按；`merge-preview?primaryId=B&secondaryId=C` 回 200；`POST /contacts/merge` 回 400；`PATCH /contacts/B` 回 200；`POST /contacts/B/tags` 回 201 並寫出 `contact.tagged`（contactId 為封存的 B） | `apps/web/src/app/dashboard/contacts/[contactId]/page.tsx:89-106`；`contact.service.ts:599`（預覽只檢查 secondary）；`tagging.service.ts:137`（貼標不檢查 `isArchived`） | CONTACT-02 |
| HC-CONTACTS-05 | P2 | 合併完成後「合併紀錄」卡不更新，看不到剛剛那次合併，也找不到「解除合併」鈕，要重新整理頁面 | 本機：詳情頁合併精靈把 FB 聯絡人併入 → 渠道身分卡已出現 FB，合併紀錄卡仍只有舊紀錄；重新整理後才出現新紀錄與「解除合併」 | `apps/web/src/components/contact/ContactMergeHistory.tsx:54-56`（只在 `contactId` 變動時讀取）；`[contactId]/page.tsx` 的 `onMergeComplete` 沒有通知它 | CONTACT-03 |
| HC-CONTACTS-06 | P2 | 沒有 `contact.merge` 的成員仍看到「合併聯絡人」按鈕，能開精靈、搜尋對象，到第 2 步預覽才顯示「權限不足」 | 本機：自訂角色只有 `contact.view, tag.view, inbox.view, case.view` → 詳情頁按鈕可見 → 第 2 步顯示 403 訊息。後端 `merge-preview`、`merge` 都回 403 `requiredPermission: contact.merge` | `apps/web/src/app/dashboard/contacts/[contactId]/page.tsx:97-104` | RBAC-11 |
| HC-CONTACTS-07 | P2 | 標籤操作不依權限隱藏：詳情頁 TagManager 的移除鈕與新增選單不看 `contact.update`；標籤管理頁的新增、編輯、刪除不看 `tag.manage`。按下後才 403（貼標以 alert 顯示，標籤管理在對話框內顯示） | 同上唯讀角色：詳情頁有 1 個「移除標籤」鈕與標籤選單；按移除跳出 alert「權限不足」；`/dashboard/settings/tags` 有「新增標籤」，送出後對話框顯示「權限不足」 | `apps/web/src/components/contact/TagManager.tsx:90-96, 107-123`；`apps/web/src/components/settings/TagManagement.tsx:162-165, 209-219`；`apps/web/src/app/dashboard/settings/page.tsx:60` | RBAC-11 |
| HC-CONTACTS-08 | P2 | 時間軸查詢沒有上限：一次取出該聯絡人全部對話、工單、工單事件與標籤，前端全部渲染 | 本機：替一位聯絡人插入 20,000 筆對話 → `GET /contacts/:id/timeline` 回 3.78 MB、0.36 秒；詳情頁 60 秒以上才出現、DOM 約 16 萬個節點。`/contacts/:id/conversations` 有分頁，0.02 秒 | `apps/api/src/modules/contact/contact.service.ts:459-500`（三個 `findMany` 沒有 `take`） | CONTACT-04 |
| HC-CONTACTS-09 | P2 | 重複貼同一個標籤時，`addTagToTarget` 以 upsert 回 201，並再寫一筆 `contact.tagged` 到 outbox；以「被貼標」觸發的自動化會再跑一次 | 本機：`POST /contacts/A/tags {tagId}` 兩次 → 兩次 201，`outbox` 多兩筆 `contact.tagged`。前端選單不列已貼的標籤，所以主要來自 API、自動化與短連結 | `apps/api/src/modules/tag/tag.flow.ts:36-43`；`tagging.service.ts:146` | AUTO-08 |
| HC-CONTACTS-10 | P2 | `PATCH /contacts/:id` 的回應帶回所有渠道身分（含 uid、暱稱），不依渠道可見範圍過濾；`GET /contacts/:id` 已依 CM-173 過濾。`merge-preview` 也回傳雙方全部身分 | 本機：agent 帳號沒有任何渠道授權 → `GET /contacts/LI` 的 `channelIdentities` 為 `[]`；`PATCH /contacts/LI {phone}` 回應的 `channelIdentities` 有 `uid: Uaaa0002` | `apps/api/src/modules/contact/contact.service.ts:236-244`；`getMergePreview` 的 include（`contact.service.ts:570-590`） | RBAC-04（已補列 PATCH 回應與合併預覽） |
| AUTO-05 | P2 | `contact.updated` 是自動化觸發器，但沒有任何程式發布它。編輯器已依契約的 `dispatched: false` 標示「目前不會觸發」 | `grep -rn "contact.updated"` 只出現在契約定義與測試 | `packages/automation/src/contracts/events.ts:118-122`；`packages/core/src/outbox/events.ts:19` | AUTO-05（已記錄） |
| RBAC-04 | P2 | 沒有任何渠道授權的成員，在聯絡人清單仍看到全部聯絡人的名稱、email、標籤（只有渠道欄被清空） | 本機 agent 帳號（無 `channel.view_all`、無直綁渠道）：清單列出 5 位聯絡人與 `ming2@example.com` | `contact.service.ts` 的 `listContacts` | RBAC-04（已記錄，嚴重度依 AUDIT） |
| HC-CONTACTS-11 | P3 | 詳情讀取失敗一律顯示「找不到聯絡人」，403 也一樣；清單在 403 時顯示「找不到聯絡人／建立後聯絡人將顯示在這裡」，看起來像沒有資料 | 本機：只有 `inbox.view` 的角色開 `/dashboard/contacts` 與詳情頁 | `apps/web/src/app/dashboard/contacts/[contactId]/page.tsx:39-46, 76-84`；`apps/web/src/components/contact/ContactList.tsx:82` | 新 |
| HC-CONTACTS-12 | P3 | 合併精靈文案與實際行為不符：第 3 步寫「將永久封存，此操作無法復原」，第 1 步寫「合併來源（資料保留，ID 刪除）」；實際不刪除 ID，可從合併紀錄解除。第 3 步也沒提「解除後標籤與自訂屬性不搬回」 | 本機與 UAT 走到第 3 步 | `apps/web/src/components/contact/ContactMergeModal.tsx:300, 563` | 新 |
| HC-CONTACTS-13 | P3 | 非 UUID 的聯絡人 id（`GET/PATCH /contacts/abc`、`/abc/timeline`、`/abc/tags`、`/abc/conversations`）回 400 `DATABASE_ERROR`「資料處理失敗」，不是欄位驗證錯誤。`/abc/merge-logs` 有 Zod 驗證、訊息正確 | 本機與 UAT：`GET /contacts/abc` | `apps/api/src/modules/contact/contact.routes.ts:306, 318` 及 `/:id/conversations`、`/:id/cases`、`/:id/tags`、`/:id/timeline` | 新 |
| HC-CONTACTS-14 | P3 | `TAG_SCOPE_MISMATCH` 的訊息是英文「Tag scope CASE cannot be assigned to CONTACT」 | 本機：把 CASE 標籤貼到聯絡人 | `apps/api/src/modules/tag/tagging.service.ts:127` | 新 |
| HC-CONTACTS-15 | P3 | 標籤 `color` 接受任意字串（例如 `red;background:url(x)`），沒有色碼驗證 | 本機：`POST /tags {color: "red;background:url(x)"}` 回 201 | `apps/api/src/modules/tag/tag.routes.ts:10, 19` | 新 |
| HC-CONTACTS-16 | P3 | 詳情頁 email 格式錯誤時只顯示「輸入內容有誤，請檢查後重新送出」，沒有用回應 `details.issues` 的「電子郵件格式不正確」 | 本機：鉛筆 → 填 `not-an-email` → 儲存 | `apps/web/src/components/contact/ContactEmailField.tsx:57` | 新 |
| HC-CONTACTS-17 | P3 | email 登記頁沒寄過驗證碼就送 `/verify` 時，回 410「驗證碼已過期，請重新送出 email」，訊息不符實際狀況 | 本機：有效 token、未送 email → `POST /public/email-registration/:token/verify {code:"123456"}` | `apps/api/src/modules/identity-binding/registration-routes.ts:163-166` | 新 |
| HC-CONTACTS-18 | P3 | 分頁 `page=0` 回 400，訊息卻是「不可小於 0」 | `GET /contacts?page=0` | 全域 Zod 錯誤訊息（`positive()` 的對應文字） | 新 |
| HC-CONTACTS-01 | P3 | 功能文件過時：`docs/ref/features/tenant/CONTACTS.md` 第 96 行寫「系統不寄驗證信（2026-10-07 決定）」、第 157 行寫「Email 登記不驗證 email」。主規格 `email-identity-merge`（「Email 登記須驗證信箱擁有權」）與程式都已改成先寄 6 位數驗證碼，驗證通過才寫入與合併 | 讀 `openspec/specs/email-identity-merge/spec.md:207`、`apps/api/src/modules/identity-binding/ownership-code.ts`、`registration-routes.ts:133-175` | `docs/ref/features/tenant/CONTACTS.md:96, 157` | 新（文件） |

### 已知疑點的結論

| # | 疑點 | 結論 |
| --- | --- | --- |
| 1 | CONTACTS.md 寫 email 登記不寄驗證信 | **確認**。文件過時，HC-CONTACTS-01。手機登記仍不驗證，那兩段文字正確 |
| 2 | 合併按鈕不依 `contact.merge` 隱藏 | **確認**。HC-CONTACTS-06 |
| 3 | 清單寫死排除 WEBCHAT，合併精靈搜尋看得到 | **確認行為存在，但符合規格**。主規格 `contact-management` 的「Contact List WebChat Channel Visibility」明文要求清單排除只有 WebChat 身分的聯絡人，沒有身分的聯絡人也因「至少一個非 WebChat 身分」而被排除。合併精靈不帶篩選，看得到這些聯絡人。影響很大：UAT Demo 租戶共 170 位聯絡人，清單只顯示 27 位（84% 只能從收件匣或合併精靈找到）。屬於產品決策，建議請產品確認是否加一個「顯示網站訪客」開關，不列為程式缺陷 |
| 4 | 第 3 步文案寫永久封存、無法復原、ID 刪除 | **確認**。HC-CONTACTS-12 |
| 5 | 已封存聯絡人無標示、仍有合併鈕、預覽成功執行才 400 | **確認，部分修正描述**：「合併紀錄」卡有寫「已被併入 另一位聯絡人」，但頁首沒有標示。另發現封存的聯絡人仍可編輯與貼標。HC-CONTACTS-04 |
| 6 | 標籤管理與 TagManager 不依權限隱藏 | **確認**。HC-CONTACTS-07 |
| 7 | `contact.updated` 定義成觸發器但沒人發布 | **確認，已是 AUDIT 的 AUTO-05**，編輯器已標示「目前不會觸發」 |
| 8 | `channelType` 非法值可能 500 | **否定**。`channelType=FOO`、`excludeChannelType=FOO` 都回 400 `VALIDATION_ERROR`（全域錯誤處理把 Prisma 驗證錯誤轉成 400）。另發現非 UUID id 回 400 `DATABASE_ERROR`，HC-CONTACTS-13 |
| 9 | 兩個不同 LINE OA 顯示「（無新增）」 | **確認**。HC-CONTACTS-02 |
| 10 | 時間軸沒有上限 | **確認**，並量測 20,000 筆對話時前端 60 秒以上才出現。HC-CONTACTS-08 |
| 11 | 詳情讀取失敗（含 403）只顯示「找不到聯絡人」 | **確認**，清單頁也一樣。HC-CONTACTS-11 |

## 流程逐條結果

| 流程 | 環境 | 正向 | 錯誤案例 | 權限 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 1 列表、搜尋 | 本機、UAT | 正常：本機 7 位聯絡人列出 5 位（排除 2 位只有 WebChat 的），搜尋「李大」只剩 1 筆，點列進詳情；UAT 顯示「共 27 筆」 | `channelType=FOO` 400；`page=0` 400（訊息見 HC-CONTACTS-18） | 無 `contact.view` 時後端 403，前端顯示成「找不到聯絡人」（HC-CONTACTS-11）；無渠道授權仍看得到全部聯絡人（RBAC-04） | 疑點 3 |
| 2 詳情 | 本機、UAT | 正常：名稱、渠道名稱、WebChat 身分（UAT 的 tatung）都顯示 | 非 UUID 400 `DATABASE_ERROR`（HC-CONTACTS-13）；不存在的 UUID 404 | 403 顯示「找不到聯絡人」 | 封存的聯絡人無標示（HC-CONTACTS-04） |
| 3 改 email | 本機、UAT | 正常：存 `ming2@example.com`，重新整理後一致；UAT 寫入後已還原為 null | 格式錯 400，前端只顯示通用訊息（HC-CONTACTS-16）；空字串 400（前端送 `trim() \|\| null` 不會觸發） | 唯讀角色看不到鉛筆，後端 403 `contact.update`。正常 | |
| 4 email 衝突對話框 | 本機、UAT | 正常：大小寫不同也判定重複，出現「與「…」合併／仍要儲存／取消」；`allowDuplicateEmail` 可存 | — | 看不到對方渠道的成員收到 409 不帶 `details`，對話框改為兩選一。正常 | |
| 5 貼標、移除 | 本機、UAT | 正常：貼上後重新整理仍在，移除後消失；本機確認寫出 `contact.tagged` | scope 不符 400（英文訊息，HC-CONTACTS-14）；移除不存在的貼標 404 | **異常**：無 `contact.update` 仍看到移除鈕與選單（HC-CONTACTS-07）；後端 403 正常 | 重複貼標再發事件（HC-CONTACTS-09）；封存聯絡人可貼標（HC-CONTACTS-04） |
| 6 標籤管理 | 本機、UAT | 正常：新增後重新整理仍在；UAT 從頁面刪除，`GET /tags` 確認不存在 | 同範圍重名 409，對話框顯示「這個範圍內已有同名標籤」；空白名稱 400；不同範圍同名可建立 | **異常**：無 `tag.manage` 仍有新增、編輯、刪除鈕（HC-CONTACTS-07） | 色碼不驗證（HC-CONTACTS-15） |
| 7 手動合併 | 本機（正向）、UAT（錯誤） | 本機正常：FB 聯絡人併入 LINE 聯絡人，身分、對話搬到主要聯絡人 | **異常**：同渠道衝突到第 3 步才擋（HC-CONTACTS-03，UAT 也重現）；第二個 LINE OA 顯示「（無新增）」（HC-CONTACTS-02）；以封存聯絡人為主要時預覽成功、執行 400 | **異常**：無 `contact.merge` 仍看到按鈕，第 2 步才 403（HC-CONTACTS-06） | 文案不符（HC-CONTACTS-12）。UAT 只有自建的 WebChat 測試聯絡人可用，它們同渠道，正向合併只在本機驗 |
| 8 合併紀錄、解除合併 | 本機 | 正常：解除後 FB 身分與對話搬回原聯絡人、取消封存（重新整理前後都正確） | 重複解除 409「此合併已經解除過了」；非 UUID logId 400 | 前端依 `contact.merge` 隱藏解除鈕（程式已讀；唯讀角色沒有可解除的紀錄可看） | **異常**：合併後紀錄卡不更新（HC-CONTACTS-05） |
| 9 跨渠道對話紀錄 | UAT | 正常：「對話紀錄」分頁顯示測試聯絡人的訊息 | — | — | 只讀 |
| 10 代發綁定代碼 | — | 未驗 | — | — | 本機渠道是假憑證，投遞必失敗；UAT 要開啟 Demo 租戶的綁定設定（屬設定變更，不在可做範圍）且會推真實訊息。見待真機驗 |
| 11 代發 email／手機登記連結 | 本機（API） | 部分：渠道投遞失敗時回 `delivery_failed` 並作廢 token，符合「不可顯示成功」的設計 | — | — | 收件匣按鈕 UI 未驗（需要能投遞的渠道） |
| 12 顧客登記頁 | 本機 | 手機正常：`+886 912 345 678` 登記後，WebChat 聯絡人自動併入電話相同的 LINE 聯絡人，來源 `PHONE`，畫面顯示「已完成帳號整合」 | 手機 `02-2345-6789` 顯示「請輸入台灣手機號碼」；用過的連結 410；email `abc@` 顯示「email 格式不正確」；未寄碼先驗證回 410（HC-CONTACTS-17） | 公開頁，以 token 為憑證 | **email 驗證碼正向未驗**：本機 `EMAIL_DELIVERY_MODE=smtp`，寄件帳號是真實的公司 Gmail，驗證碼只存雜湊、log 不印，拿不到碼又不能寄真實信。token 以 Redis 直接寫入（本機投遞失敗會作廢 token） |
| 13 收訊建立聯絡人 | — | 未驗 | — | — | 本機以 simulator 建立聯絡人，simulator 自行建立 Contact，不走 `resolveInboundContact`；以 unit 測試（`inbound-contact-resolution`、`inbound-first-contact-resolver`）為準。真實收訊待真機驗 |

權限測試用的角色：admin、seed 的 agent（預設權限含 `contact.merge`、`tag.manage`，沒有渠道授權）、本機自建「健檢唯讀」（`contact.view, tag.view, inbox.view, case.view`）、本機自建「健檢無聯絡人」（只有 `inbox.view`）。三個系統角色預設都有 `contact.update`、`contact.merge`、`tag.manage`，所以「按鈕不隱藏」只在自訂角色上看得到。supervisor 與 admin 的相關權限相同，沒有另外走一次。

## 完備度對照

以 scenario 名稱在 `apps/*/tests`、`packages/*/tests` 搜尋同名測試；「找不到同名測試」不等於沒有測試（例如 `tag-management` 的行為在 `tests/feature/modules/tag/` 有測，只是名稱不同）。AGENTS.md 要求測試以 scenario 命名，這些 spec 尚未對齊。

| Spec | Requirement 數 | Scenario 數 | 找不到同名測試 | 缺實作 | 前端入口 |
| --- | --- | --- | --- | --- | --- |
| contact-management | 11 | 34 | 25 | 1：「Identity Resolution／Linking LINE user via Phone」（依 lead form 電話自動連結 LINE 身分，沒有實作） | 清單、詳情、合併、解除都有 |
| tag-management | 4 | 20 | 20 | 0 | 有 |
| email-identity-merge | 15 | 47 | 0 | 0 | 有（收件匣代發、公開頁） |
| phone-identity-merge | 16 | 34 | 0 | 0 | 有 |
| cross-channel-binding-code | 11 | 38 | 27 | 未逐條核 | 收件匣「傳送跨渠道綁定連結」 |
| cross-channel-conversation-view | 3 | 7 | 0 | 0 | 有 |
| identity-stitching-engine | 4 | 5 | 5 | 2：「LIFF 身分碰撞／自動綁定 LINE 與 Email」、「AI 合併建議／提示管理員合併」（建議沒有產生端，IDENT-01） | 合併建議沒有頁面 |
| inbound-contact-resolution | 4 | 13 | 6 | 未逐條核 | 系統流程 |
| line-contact-profile-sync | 3 | 12 | 0 | 0 | `sync-profile` 沒有頁面 |
| ai-cross-channel-context | 4 | 9 | 2 | 未逐條核 | 系統流程 |
| material-action-tagging | 3 | 10 | 10 | 未逐條核 | 素材編輯頁 |

**有後端、沒有前端入口**（與 Skill 一致，本次確認）：`GET /contacts/:id/cases`；`PATCH /contacts/:id` 的 displayName／phone／language／isBlocked；清單的 `tagId`、`channelType` 篩選；`/identity/suggestions*`；LINE `sync-profile`；前端不監聽 socket `contact.merged`、`contact.merge_reverted`（所以另一位客服合併後，已開著的詳情頁不會更新）。

**前端送出的值與後端 Zod**：標籤 scope `CONTACT|CONVERSATION|CASE|MATERIAL`、type `MANUAL`，後端接受；email 送 `trim() || null`，後端接受 null、拒絕空字串，前端不會送空字串；合併 body 兩個 UUID，後端接受。沒有發現前端送出、後端拒絕的值。

## 待真機驗

- 代發跨渠道綁定代碼（流程 10）與顧客在另一渠道回覆代碼後的合併：要有能投遞的 LINE／FB 渠道。
- 收件匣「傳送 email／手機登記連結」按鈕的 UI 與成功訊息（流程 11）。
- email 登記驗證碼的正向案例：收碼、驗證成功、寫入與自動合併；錯碼 5 次鎖定、重寄 3 次上限（流程 12）。需要不會寄到真實地址的寄信設定（例如本機改用 log 模式），或 UAT 上可收信的測試信箱。
- 收訊建立聯絡人與 `contact.created` 進自動化（流程 13）、背景抓頭像。
- 跨 LINE OA 的合併預覽（HC-CONTACTS-02）在 UAT 重現：Demo 租戶有兩個 LINE 渠道，但沒有可合併的自建測試聯絡人。

## UAT 操作紀錄

全部記在 `docs/ref/features/health/uat-ledger.md`。建立 2 位 WebChat 測試聯絡人（各觸發 AI 自動回覆一則）與 1 個標籤；修改 1 筆 email。標籤已刪除、email 已還原。兩位測試聯絡人因系統沒有刪除聯絡人的 API 而保留，名稱帶 `健檢-2026-10-29-` 前綴；合併嘗試被拒絕，沒有改變資料。

## 建議新增到 AUDIT.md 的項目

- HC-CONTACTS-02：合併預覽以渠道類型比對身分，多個同類型渠道時顯示錯誤。
- HC-CONTACTS-03：合併預覽不檢查同渠道衝突。
- HC-CONTACTS-04：已封存聯絡人仍可合併、編輯、貼標，且畫面沒有標示。
- HC-CONTACTS-05：合併後合併紀錄卡不更新。
- HC-CONTACTS-06、HC-CONTACTS-07：合併與標籤操作不依權限隱藏。
- HC-CONTACTS-08：時間軸沒有上限。
- HC-CONTACTS-09：重複貼標重發 `contact.tagged`。
- HC-CONTACTS-10：`PATCH /contacts/:id` 回應不依渠道可見範圍過濾身分（可併入 RBAC-04 的表格）。
- HC-CONTACTS-01：更新 `docs/ref/features/tenant/CONTACTS.md` 的 email 登記段落與「目前的限制」表（文件修正，不必進 AUDIT）。
