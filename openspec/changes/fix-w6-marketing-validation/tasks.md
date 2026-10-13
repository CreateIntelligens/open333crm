## 1. 行銷活動期間（marketing-scheduling）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/marketing/campaign-dates.test.ts`「Create with reversed dates」「Update only the end date」「Same day」與無法解析的日期
- [x] 1.2 實作：`campaign.service.ts` 的 `createCampaign()`、`updateCampaign()` 比對起訖（更新時用更新後的值），錯誤以 `VALIDATION_ERROR` 400 回傳並指出 `endDate`

## 2. 廣播排程時間（marketing-scheduling）

- [x] 2.1 測試先行：`apps/api/tests/unit/modules/marketing/broadcast-schedule.test.ts`「Schedule in the past」「Schedule in the future」「No schedule」
- [x] 2.2 實作：`marketing.service.ts` 的 `createBroadcast()` 在查資料庫前檢查 `scheduledAt`

## 3. 傳送素材動作（automation-engine）

- [x] 3.1 測試先行：`apps/api/tests/unit/modules/automation/send-material-reference.test.ts`「Material ID is not a UUID」「Material does not exist」「Material of another tenant」「Existing active material」，以及更新動作時同樣檢查
- [x] 3.2 實作：`automation.service.ts` 的 `createRule()`、`updateRule()`（動作有變時）檢查 `send_material` 的 `materialId`

## 4. UAT E2E 與完成檢查

- [x] 4.1 UAT E2E：`tenant-fields-marketing-line.spec.ts` 的 CM-W6-01、CM-W6-02、CM-W6-04 改為一般測試
- [x] 4.2 `CHANGELOG.md` 新增 Fixed 條目；更新 `docs/ref/features/tenant/MARKETING.md`
- [x] 4.3 `pnpm test`、`pnpm test:feature` 通過
- [x] 4.4 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 4.5 `node scripts/validate-openspec.mjs fix-w6-marketing-validation` 通過
- [ ] 4.6 合併部署後在 UAT 重跑行銷 LINE 的 E2E

## 備註

- 每個測試都先確認因斷言失敗（`Missing expected rejection`）再實作。
- 3.1 調查時發現：CM-W6-04 的關鍵字驗證已在 `7a4e655c`（2026-09-22）修好，E2E 仍失敗是因為同一個測試的 `materialId` 兩個案例（非 UUID、不存在的 UUID）還會被接受。
