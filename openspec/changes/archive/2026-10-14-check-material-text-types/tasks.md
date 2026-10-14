## 1. LINE 純文字的型別（material-system）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/marketing/material-line-validation-wiring.test.ts`「Numeric text」「String text」
- [x] 1.2 實作：`material.service.ts` 在呼叫 LINE validate 前檢查 `line_text` 的 `text` 型別
- [x] 1.3 補測（PR #271 bot 建議）：「Numeric text：沒有啟用中的 LINE 渠道時也擋」。mutation：把型別檢查移到取得 LINE 渠道之後 → 只有這個測試失敗，還原後通過

## 2. FB 優惠碼（material-system）

- [x] 2.1 測試先行：`apps/api/tests/unit/modules/marketing/fb-material-validation.test.ts`「Coupon code with a space」「Coupon code without whitespace」「Empty coupon code」
- [x] 2.2 實作：`fb-material-validation.ts` 的 `fb_coupon` 檢查 `coupon_code`

## 3. 完成檢查

- [x] 3.1 `CHANGELOG.md` 新增 Fixed 條目；更新 `docs/ref/features/tenant/MARKETING.md`
- [x] 3.2 `pnpm test` 通過；`check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 3.3 `node scripts/validate-openspec.mjs check-material-text-types` 通過
- [x] 3.4 部署後在 UAT 重跑 `line_text`、`fb_coupon` 的素材欄位探測（2026-10-14 UAT：數字 text→400「訊息內容必須是文字」、"AB C"→400「折扣碼不可含空白」、空折扣碼→200，7 passed）
