## 1. 插入券連結佔位字

- [x] 1.1 在 `apps/web/tests/unit/components/materials/coupon-url-insert.test.tsx` 寫失敗測試：「插在游標位置」「取代選取文字」「沒有游標時加在結尾」「其他版型沒有插入按鈕」，確認失敗在斷言上。「其他版型沒有插入按鈕」寫下時即通過（現有行為），以突變驗證：在 `FbButtonEditor` 改用 `CouponUrlTextField` 後測試失敗，還原後通過。「沒有游標時加在結尾」另以突變驗證：拿掉「曾取得焦點」判斷後測試失敗
- [x] 1.2 新增 `apps/web/src/components/materials/CouponUrlTextField.tsx`，`LineTextEditor`、`FbTextEditor` 改用它，讓 1.1 通過

## 2. 說明文字

- [x] 2.1 在同一測試檔寫失敗測試：「顯示說明文字」（LINE、FB 各一）
- [x] 2.2 在 `CouponUrlTextField` 加上說明文字，讓 2.1 通過

## 3. 字數上限

- [x] 3.1 在同一測試檔寫失敗測試：「超過上限時擋下並提示」「剛好等於上限時允許插入」「內容變動後提示消失」
- [x] 3.2 在 `CouponUrlTextField` 加上上限檢查與 `role="alert"` 提示，讓 3.1 通過

## 4. 完成定義

- [x] 4.1 `pnpm --filter @open333crm/web test` 全過、web `tsc --noEmit` 通過、`pnpm --filter @open333crm/web build` 通過
- [x] 4.2 `CHANGELOG.md` 在 `## [2026-10-27]` 加 Added 條目
- [x] 4.3 `node scripts/validate-openspec.mjs add-material-coupon-url-insert` 通過
