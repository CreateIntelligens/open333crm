## Why

`docs/ref/system/AUDIT.md` 的 IDENT-03 與 IDENT-04（PR #252）：

- **IDENT-03**：`Conversation` 沒有記錄它屬於哪一個渠道身分，收發訊息以「聯絡人 + 渠道」查詢。一位聯絡人在同一個渠道有兩個身分時，回覆可能送給另一位客人，進站訊息可能放進另一段對話。合併引擎 `mergeContacts()` 不檢查同渠道，所以下列兩種情況都會產生這種聯絡人：
  - 客服手動合併與核准合併建議完全不檢查同渠道。
  - email 登記與綁定代碼在合併前檢查，但檢查在鎖定之前，兩個合併同時併入同一位聯絡人時都會通過。
- **IDENT-04**：兩位聯絡人幾乎同時登記同一個還沒有人用過的 email 時，兩邊都查不到使用者，都寫入 email 但不合併。

2026-10-12 決定（回覆在 #252）：**客服不可以合併同一個渠道的兩位聯絡人。** 同一個官方帳號底下的兩個帳號幾乎都是不同的人，產品也沒有「一位客人用兩個帳號加同一個官方帳號」的需求。

## What Changes

- 合併引擎在鎖定雙方之後檢查同渠道，雙方在同一個渠道都有身分時拒絕合併（409 `SAME_CHANNEL_CONFLICT`，details 列出衝突的渠道）。4 個合併入口都經過引擎，因此都會套用：email 登記、綁定代碼、客服手動合併、核准合併建議。
- email 登記與綁定代碼原本在合併前的檢查保留（負責在合併前回覆客人）。合併時才被引擎拒絕的情況（並行），一樣回覆客人「同一渠道只能綁定一個帳號」的說明，綁定代碼一樣放回剩餘效期。
- email 登記在查詢之前，以租戶與 email（不分大小寫）取得交易層級的鎖（`pg_advisory_xact_lock`），同一個 email 的登記依序處理。
- 前端合併視窗顯示後端回傳的錯誤訊息。目前視窗讀錯欄位（`response.data.message`），任何錯誤都只顯示「合併失敗」。

不做：`channel_identities` 加 `(contactId, channelId)` 唯一限制（要先查 UAT 是否已有重複資料）、`Conversation` 記錄渠道身分。已經存在的同渠道雙身分聯絡人不在本 change 處理。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `contact-management`：新增「合併拒絕同渠道雙身分」的需求。
- `email-identity-merge`：「同一渠道雙方都有身分時拒絕合併」加入並行情境；新增「同一個 email 的登記依序處理」。
- `cross-channel-binding-code`：新增「確認時合併被拒絕須回覆顧客」。

## Impact

- API：`contact-merge.service.ts`（`mergeContacts()`）、`email-registration.service.ts`、`identity-binding.service.ts`
- Web：`ContactMergeModal.tsx`
- 文件：`docs/ref/system/AUDIT.md`（IDENT-03、IDENT-04）、`AUDIT-REVIEWS.md`、`docs/ref/features/tenant/CONTACTS.md`、`CHANGELOG.md`
- 不需要 migration。
