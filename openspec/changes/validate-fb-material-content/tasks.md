## 1. FB 版型內容檢查（material-system）

- [x] 1.1 測試先行：`apps/api/tests/unit/modules/marketing/fb-material-validation.test.ts`：「Empty required field」「Too many buttons」「No cards」「Valid default content」（9 種版型的編輯器預設內容都通過）、「javascript scheme」「Sample image path」「Negative total」「Feedback expiry out of range」「Free-text media type」，以及其餘必填、長度、網址欄位與列舉
- [x] 1.2 實作：`apps/api/src/modules/marketing/fb-material-validation.ts` 的 `validateFbMaterialBody(contentType, body)`
- [x] 1.3 測試先行：`apps/api/tests/unit/modules/marketing/material-fb-validation-wiring.test.ts`：`createMaterial()` 與 `updateMaterial()`（送 body 時）遇到不合法的 FB 內容回 400 且不寫入；`updateMaterial()` 沒送 body 時不檢查；`restoreMaterialVersion()` 還原成不合法的舊版回 400
- [x] 1.4 實作：`material.service.ts` 的 `createMaterial()`、`updateMaterial()`、`restoreMaterialVersion()` 呼叫 `validateFbMaterialBody()`

## 2. UAT E2E 與完成檢查

- [ ] 2.1 欄位探測 E2E 中 FB 的 `test.fail` 改為一般測試（合併部署後在 UAT 執行）
- [x] 2.2 `CHANGELOG.md` 新增 Fixed 條目；更新 `docs/ref/features/tenant/MARKETING.md`
- [x] 2.3 `pnpm test`、`pnpm test:feature` 通過
- [x] 2.4 `check-tenant-scoping.mjs --strict`、`check-prisma-admin-usage.mjs --strict` 沒有新增違規
- [x] 2.5 `node scripts/validate-openspec.mjs validate-fb-material-content` 通過

## 備註

- 1.1 的「Valid default content」直接 import `apps/web/src/components/materials/default-bodies.ts`，前後端的預設內容不會漂移。
- 實作時確認前端實際送出的值：編輯器在 `media_type`、`currency`、`question_type`、`expires_in_days` 沒有值時顯示預設值，這四個欄位改為有值才檢查（先寫失敗的測試）。
- 還原版本也會寫回內容，一併檢查（先寫失敗的測試）；複製素材沿用既有內容，不檢查。
