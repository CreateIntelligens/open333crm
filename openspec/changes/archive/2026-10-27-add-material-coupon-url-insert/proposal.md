## Why

附券廣播發送時，系統會把素材裡的 `{{coupon.url}}` 換成每位收件人自己的票券連結。可是商家要自己記得這個佔位字、一字不差地打進素材，目前只有「建立廣播 → 附上優惠券」那一行說明提到它。打錯一個字元（例如 `{{coupon_url}}`）不會報錯，只會讓系統在素材後另送一則發券文字，商家看不出原因。

## What Changes

- LINE 純文字、FB 純文字素材的「訊息內容」欄位旁加「插入券連結」按鈕：把 `{{coupon.url}}` 插在游標位置（沒點過輸入框時加在結尾），插入後焦點留在輸入框、游標在插入文字之後。
- 按鈕下方顯示說明：發送附券廣播時才會換成每位顧客自己的券連結；發哪張券在建立廣播時選；用在關鍵字回覆或一般廣播時不會替換。
- 插入後會超過該欄位字數上限（LINE 5000、FB 2000）時不插入，並在欄位下方顯示看得到的提示。
- 按鈕只插入通用佔位字，不綁定特定優惠券；發哪張券仍由「建立廣播」的「附上優惠券」決定。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `material-system`：新增「文字素材可插入券連結佔位字」相關需求（ADDED，現有需求沒有涵蓋此行為）。

## Impact

- 前端：`apps/web/src/components/materials/editors.tsx`（`LineTextEditor`、`FbTextEditor`），新增共用元件 `apps/web/src/components/materials/CouponUrlTextField.tsx`。
- 測試：`apps/web/tests/unit/components/materials/coupon-url-insert.test.tsx`。
- 後端、資料庫：不變。個資遮罩的查證結果寫在 design.md。
