## 1. 含「.」的自訂發放方式

- [x] 1.1 測試 `packages/shared/tests/unit/coupon/issued-via.test.ts`：「含點的自訂代碼可以使用，只有舊的觸發事件名稱是保留」「整合程式自訂、含點的代碼不是舊事件名稱，不顯示成自動化」在現有程式上斷言失敗；「workers 曾寫入的每個觸發事件名稱都是保留」
- [x] 1.2 測試 `apps/api/tests/feature/modules/coupon/coupon-routes-validation.test.ts`：情境「含點的自訂發放方式」（`partner.sync` 回 200 並記下發放方式）在現有程式上回 400；情境「冒用舊的觸發事件名稱」（`message.received` 等回 400）
- [x] 1.3 `issued-via.ts` 以凍結的舊事件名稱清單取代 `includes('.')`
- [x] 1.4 情境「舊資料的觸發事件名稱」是既有行為，突變驗證：清單拿掉 `message.received` 時 `issued-via.test.ts` 失敗

## 2. 完成定義

- [x] 2.1 `pnpm test`（shared、core、workers、api、web unit）
- [x] 2.2 api feature：coupon、rls-isolation、marketing 相關檔案以獨立測試庫執行
- [x] 2.3 `check-tenant-scoping`、`check-prisma-admin-usage` 加 `--strict`
- [x] 2.4 `node scripts/validate-openspec.mjs fix-coupon-issued-via-reserved-names` 與 `--specs`
- [x] 2.5 `CHANGELOG.md` 條目（這次的 agent 不改 CHANGELOG，由合併的人補）
- [ ] 2.6 歸檔
