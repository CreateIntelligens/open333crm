## Why

素材編輯器的「插入券連結」按鈕（PR #370）插入 `{{coupon.url}}`，只有附券廣播會發券並換成每位收件人自己的票券連結。使用者看不懂按鈕旁的說明，也容易和券詳情「領券連結」分頁建立的公開網址（`/coupon/claim/{代碼}`）混淆。含佔位字的素材被用在關鍵字回覆或沒附券的廣播時，顧客拿不到券，系統卻沒有任何提醒，後端也照存。

## What Changes

- 按鈕改名「插入顧客專屬券連結」，說明預設只顯示一行「只能用在附券廣播。」，「怎麼用？」可展開／收合（`aria-expanded`、可用鍵盤操作）。
- 素材即時預覽（LINE、FB 純文字與 FB 按鈕選單的文字）把 `{{coupon.url}}` 顯示成看起來像連結的標籤「顧客專屬券連結」；編輯框與儲存的值不變。
- 含佔位字的素材：
  - 關鍵字回覆對話框選到時顯示提醒並擋下存檔；自動化規則編輯器選到時顯示提醒。
  - 建立廣播選到但「不附券」時顯示提醒，建立按鈕停用並說明原因。
  - 後端在建立／更新自動化規則（含關鍵字回覆、加好友禮）的 `send_material` 動作、建立沒附券的廣播時回 400。
- 「插入顧客專屬券連結」旁加「插入領券連結」：列出租戶內可用的領券連結，選一條就把公開網址插在游標位置。後端新增 `GET /api/v1/coupons/claim-links`（需 `coupon.view` 或 `marketing.manage` 其中一個；可用 `channelType` 只列同渠道的連結）。
- 操作手冊第 10、18 章與 `docs/ref/` 的相關段落改用新名稱，並修正「關鍵字回覆會看到原字」的錯誤說明（workers 會把未代入的佔位字拿掉）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `material-system`：插入按鈕的名稱與說明、字數上限的提示；新增預覽標籤與「插入領券連結」。
- `coupon-management`：新增沒附券的廣播不可使用含顧客專屬券連結的素材、列出租戶全部可用領券連結的 API。
- `automation-engine`：新增傳送素材動作不可使用含顧客專屬券連結的素材。

## Impact

- API：`apps/api/src/modules/marketing/marketing.service.ts`（`createBroadcast`）、`apps/api/src/modules/automation/automation.service.ts`（`assertSendMaterialReferences`）、`apps/api/src/modules/marketing/template-renderer.ts`（偵測函式）、`apps/api/src/modules/coupon/coupon-claim-link.{routes,flow,service}.ts`（新 API）。
- Web：`CouponUrlTextField.tsx`、`MaterialPreview.tsx`、`KeywordReplyEditDialog.tsx`、`marketing/page.tsx`、`broadcast-form.ts`、`ActionEditor.tsx`、新 hook `useAvailableClaimLinks`、新 `lib/marketing/coupon-url.ts`。
- 不需要 migration。既有資料不會被修改，見 design D5。
