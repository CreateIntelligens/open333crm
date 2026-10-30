---
name: feature-contacts
description: >
  open333CRM「聯絡人與標籤」功能顧問：聯絡人列表/搜尋/詳情、email 編輯與 EMAIL_IN_USE、標籤貼標與標籤管理、
  聯絡人合併與解除合併（One ID、歸戶、跨渠道綁定代碼、email/手機登記 /bind/email、/bind/phone）、
  合併建議、收訊建立聯絡人、LINE 頭像重抓。當需求、bug 或新功能碰到 contact、tag、identity-binding、
  merge、ChannelIdentity、IdentityMap、/dashboard/contacts、/dashboard/settings/tags 時使用。
  也在改群發分眾、優惠券登記、自動化貼標、短連結點擊貼標前使用，確認不破壞聯絡人。
---

# 聯絡人與標籤

## 先讀
- 功能現況（以它為準）：`docs/ref/features/tenant/CONTACTS.md`
  - 注意：其中「email 登記不寄驗證信」已過時，程式目前會寄 6 位數驗證碼（`apps/api/src/modules/identity-binding/ownership-code.ts`），見健檢 HC-CONTACTS-01。
- 健檢結果與已知問題：`docs/ref/features/health/CONTACTS.md`
- 規格：`openspec/specs/contact-management/spec.md`、`openspec/specs/email-identity-merge/spec.md`、`openspec/specs/phone-identity-merge/spec.md`、`openspec/specs/cross-channel-binding-code/spec.md`、`openspec/specs/tag-management/spec.md`（完整清單見 `docs/ref/features/feature-map.json`）
- 影響分析：`node scripts/feature-impact.mjs --domain contacts`

## 前端操作流程

格式：入口 → 操作 → API → 後端 → 副作用 → 權限（後端 / 前端是否隱藏）

| # | 流程 | 入口 | API → 後端 | 副作用 | 權限 |
| - | ---- | ---- | ---------- | ------ | ---- |
| 1 | 列表、搜尋 | `/dashboard/contacts`，Topbar 搜尋（debounce 300ms） | `GET /contacts?q&excludeChannelType=WEBCHAT&page&limit=20` → `listContacts` | 無。排除只有 WebChat 身分**與沒有任何身分**的聯絡人，這是主規格 `contact-management`「Contact List WebChat Channel Visibility」的要求（UAT Demo 170 位只列 27 位） | `contact.view` / 不隱藏；403 時畫面顯示成「找不到聯絡人」 |
| 2 | 詳情 | 點列表列；收件匣 ContactInfoPanel 連結 | `GET /contacts/:id`、`GET /contacts/:id/timeline` → `getContact`、`getContactTimeline` | 無 | `contact.view` |
| 3 | 改 email | 詳情頁資訊卡鉛筆 | `PATCH /contacts/:id {email}` → `updateContact`；重複時 409 `EMAIL_IN_USE` | 無事件 | `contact.update` / 鉛筆有隱藏 |
| 4 | email 衝突對話框 | 409 後跳出 | 合併（開合併精靈並預選對方）/ 仍要儲存（`allowDuplicateEmail:true`）/ 取消 | 合併後再 PATCH email | 合併鈕依 `contact.merge` 隱藏 |
| 5 | 貼標/移除標籤 | 詳情頁「標籤」卡（TagManager，收件匣與工單共用） | `POST /contacts/:id/tags {tagId}`、`DELETE /contacts/:id/tags/:tagId` → `tag.flow.ts` → `tagging.service.ts` | 貼標寫 outbox `contact.tagged` → event-automation、event-webhook 佇列；移除不發事件。重複貼同一個標籤仍回 201 並再發一次事件（upsert）；封存的聯絡人也能貼 | `contact.update` / **不隱藏** |
| 6 | 標籤管理 | `/dashboard/settings/tags` | `GET/POST/PATCH/DELETE /tags` | 刪除 cascade 貼標；MATERIAL 標籤改名會改 `Material.tags` 字串 | `tag.view`、`tag.manage` / **不隱藏** |
| 7 | 手動合併 | 詳情頁「合併聯絡人」三步精靈 | `GET /contacts?q&limit=10` → `GET /contacts/merge-preview` → `POST /contacts/merge` → `contact.flow.ts` `mergeContactsFlow` → `contact-merge.service.ts` `mergeContacts` | 搬 15 種關聯資料、ContactMergeLog、稽核 `contact.merge`、socket `contact.merged`。預覽以 `channelType` 判斷「新增」身分（第二個 LINE OA 顯示「（無新增）」），不檢查同渠道衝突、不檢查主要聯絡人是否已封存，這些到執行才 409／400 | `contact.merge` / **按鈕不隱藏**，第 2 步預覽才 403 |
| 8 | 合併紀錄、解除合併 | 詳情頁「合併紀錄」卡 | `GET /contacts/:id/merge-logs`、`POST /contacts/merge-logs/:logId/revert` → `revertMerge` | 稽核、socket `contact.merge_reverted`；合併後掛上的身分連同對話與工單搬回；標籤與屬性不搬回。合併紀錄卡只在進頁時讀取，合併後要重新整理才看得到新紀錄 | 解除鈕依 `contact.merge` 隱藏 |
| 9 | 跨渠道對話紀錄 | 詳情頁「對話紀錄」tab | `GET /contacts/:id/messages?limit=50&before=` | 無 | `contact.view` + `inbox.view` |
| 10 | 代發綁定代碼 | 收件匣 ContactInfoPanel「傳送跨渠道綁定連結」 | `POST /contacts/:id/binding-link {conversationId}` → `identity-binding.service.ts` `issueBindingCode` | Redis 代碼 30 分鐘、每小時 5 個；推訊息給顧客；顧客回代碼後合併（BINDING_CODE） | `inbox.reply`，且設定已啟用 |
| 11 | 代發 email/手機登記連結 | ContactInfoPanel 兩顆按鈕 | `POST /contacts/:id/{email,phone}-registration-link` → `identifier-registration.ts` `issueRegistrationLink` | 推訊息給顧客；稽核。推送失敗時作廢 token、回 `delivery_failed` | `inbox.reply`，且設定已啟用 |
| 12 | 顧客登記頁（公開） | `/bind/email/[token]`、`/bind/phone/[token]`，可帶 `?next=/coupon/open/...` | `GET`、`POST /public/{email,phone}-registration/:token`；email 再 `POST .../verify {code}` | 相同值自動合併（EMAIL/PHONE）、寫 IdentityMap、寄驗證信、雙方對話推通知 | 無，以 token 為憑證；每 IP 每分鐘 20 次 |
| 13 | 收訊建立聯絡人（系統） | 渠道 webhook | `resolveInboundContact`：ChannelIdentity → IdentityMap → 新建 | 新建時 `contact.created` 進自動化；背景抓頭像 | — |

**有後端、沒有前端入口**：`GET /contacts/:id/cases`；`PATCH /contacts/:id` 的 displayName/phone/language/isBlocked；列表的 `tagId`、`channelType` 篩選；`/identity/suggestions*`（合併建議審核，`identity.review`）；LINE `sync-profile`；前端不監聽 socket `contact.merged`、`contact.merge_reverted`。

**前端實際送出的值**：標籤範圍 `CONTACT|CONVERSATION|CASE|MATERIAL`（篩選另有 `ALL`）、`type` 固定 `MANUAL`；合併 `{primaryContactId, secondaryContactId}`；email 送 `value.trim() || null`。

## 不可破壞的規則
- 聯絡人與渠道身分：`ChannelIdentity` 以 `(channelId, uid)` 唯一；同一個人跨渠道一開始一定是兩個聯絡人，只能經合併變一個。
- 多個 LINE OA 要在同一個 provider 底下才有相同 userId；不同 provider 永遠認不出是同一人。
- 合併是「封存次要聯絡人」，不是刪除，可以解除。新增任何掛在 Contact 上的資料表，都要加進 `mergeContacts` 的搬移清單**與** `revertMerge` 的搬回邏輯，否則合併後資料留在封存的聯絡人身上。
- email 衝突只比對同租戶、未封存的聯絡人，不分大小寫；對方在成員看不到的渠道時，不能在 `details` 洩漏對方資料。
- 渠道身分、對話、時間軸都依渠道可見範圍過濾（CM-173）；聯絡人本身目前**沒有**過濾（RBAC-04）。改查詢時不要把已過濾的部分弄掉。
- 登記與合併用 `pg_advisory_xact_lock` 讓同一個值依序處理；改登記流程不要拿掉。
- 標籤刪除會 cascade；自動化會依名稱重建被刪的標籤（AUTO-03）。
- `isBlocked` 目前沒有任何程式讀取（DB-04），不要以為設了就會擋訊息。
- `contact.updated` 有定義成自動化觸發器，但程式沒有發布它（AUDIT AUTO-05；契約標 `dispatched: false`，編輯器顯示「目前不會觸發」）；新增「聯絡人更新」相關自動化前要先補發布端。

## 跨功能牽連
由 `docs/ref/features/feature-map.json` 產生，執行 `node scripts/feature-impact.mjs --domain contacts` 看最新版本。重點：
- **被依賴**：收件匣（ContactInfoPanel、對話標籤、代發連結）、自動化（`contact.created`、`contact.tagged`、貼標動作）、行銷（標籤分眾、優惠券、合併搬 BroadcastRecipient/CouponInstance、登記頁回到票券）、短連結（點擊貼標、ClickLog）、工單、會員入口（點數）、知識庫（KB 回饋、AI 跨渠道上下文）、數據分析（聯絡人總數）。
- **依賴**：收件匣、工單、渠道（可見範圍）、設定（綁定與登記開關）、LINE（頭像）、治理（稽核）、通知（驗證信）。

## 回歸清單
改到本領域時，至少重走：
1. 列表搜尋 → 進詳情 → 改 email 成功、改成重複 email 出現三選一對話框。
2. 貼標、移除標籤，確認自動化以標籤觸發的規則有跑（`contact.tagged`）。
3. 手動合併兩個聯絡人 → 檢查對話、工單、標籤、優惠券、點數都到主聯絡人 → 解除合併 → 資料回來。
4. 用 supervisor 與 agent 角色重走 1–3，確認 403 與按鈕顯示。
5. 公開登記頁：email 正向（收驗證碼、驗證成功、合併）與錯誤（錯碼、過期、重寄上限）。
- 自動測試：`pnpm --filter @open333crm/api test -- contact`、`-- tag`、`-- identity-binding`；`pnpm --filter @open333crm/web test -- contact`、`-- bind`。feature 測試**不要加 `--`**：`pnpm --filter @open333crm/api test:feature modules/contact modules/tag modules/identity-binding`（加了 `--` 會原樣傳給 vitest，變成跑全套）。
- E2E：`apps/web/tests/e2e-uat/tenant-contacts.spec.ts`。

## 常見 bug 從哪裡查
- 「客人在列表找不到」：列表排除 WEBCHAT，且只認有非 WebChat 身分的聯絡人（`apps/web/src/app/dashboard/contacts/page.tsx`，規格要求的行為）。只有 WebChat 身分的客人要從收件匣或合併精靈的搜尋找。
- 「合併後某些資料不見」：查 `apps/api/src/modules/contact/contact-merge.service.ts` 的搬移清單有沒有該表。
- 「跨渠道認不出同一人」：先查 IdentityMap，再查兩個 LINE OA 是否同 provider。
- 「登記頁一直失敗」：看回應 code（`INVALID_VERIFICATION_CODE`、`VERIFICATION_CODE_LOCKED`、410 連結失效），處理在 `apps/web/src/components/bind/RegistrationForm.tsx`。
- 「自動化貼標沒反應」：outbox → event-automation 佇列 → `apps/api/src/modules/automation/automation.worker.ts` 的訂閱者。
