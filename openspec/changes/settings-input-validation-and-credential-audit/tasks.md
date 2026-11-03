# Tasks

## 1. 營業時間的輸入檢查

- [ ] 1.1 在 `apps/api/tests/unit/modules/settings/office-hours-settings.test.ts` 寫「營業時間的輸入檢查」的 schema 測試：合法的邊界值、結束不晚於開始（跨午夜與相同時間）、時間超出範圍、不存在的日期、假日超過 366 筆、時區不合法、訊息空白或超過 1000 字。執行後確認因斷言失敗
- [ ] 1.2 在 `apps/api/tests/feature/modules/settings/office-hours-validation.test.ts` 寫路由測試：Scenario「合法的邊界值可以儲存」「結束時間不晚於開始時間」「時區不合法」各一項，檢查 400 的 `issues` 路徑與已存的設定不變。執行後確認因斷言失敗
- [ ] 1.3 新增 `apps/api/src/modules/settings/office-hours-settings.ts` 的 `officeHoursSettingsSchema`，路由改用它，移除 `as any`。1.1、1.2 通過

## 2. 已存的營業時間不合法時當作沒有設定

- [ ] 2.1 在 `office-hours-validation.test.ts` 寫 Scenario「設定是空物件時回傳預設值」與「已存的時區不合法時不自動回覆」：以資料庫直接寫入 `{}` 與 `Mars/Base`，檢查 `GET` 的回應、`getOutsideHoursMessage()` 回傳 `null`、資料庫的值不變。執行後確認因斷言失敗
- [ ] 2.2 新增 `readOfficeHoursSettings()`，`getOfficeHours()` 改用它解析已存的設定。2.1 通過，`settings-routes.test.ts` 仍然通過

## 3. 有效天數的上限

- [ ] 3.1 在 `apps/api/tests/feature/modules/settings/credential-expiry.test.ts` 寫 `partner-api-key` 的 Scenario「最大的有效天數可以建立」「沒有指定有效天數時永不過期」「有效天數超出範圍」，以及 `open333-cli-auth` 的 Scenario「Maximum expiry is accepted」「Expiry is not sent」「Expiry is out of range」。執行後確認超出範圍的項目因斷言失敗；其他項目是既有行為，以突變驗證（把上限改成 364 時「最大的有效天數」失敗，把 CLI 的預設改成 7 天時「Expiry is not sent」失敗）
- [ ] 3.2 兩個路由檔的 `expiresInDays` 改成 1～365 的整數。3.1 通過

## 4. 建立與撤銷憑證時寫稽核

- [ ] 4.1 在 `apps/api/tests/feature/modules/settings/credential-audit.test.ts` 寫 `tenant-audit-log` 的 Scenario「建立 API 金鑰時寫稽核」「撤銷 API 金鑰時寫稽核」「在設定頁建立 CLI token 時寫稽核」「在設定頁撤銷 CLI token 時寫稽核」「CLI 登入與登出時寫稽核」「撤銷不存在的憑證時不寫稽核」，並檢查 `payload` 不含明文。另寫一項：稽核寫入失敗時（成員不存在），金鑰與 token 都沒有建立。執行後確認因斷言失敗
- [ ] 4.2 `revokeCliSession()` 回傳更新的筆數。`partner-api-key.flow.ts` 與 `cli-session.flow.ts` 在交易內呼叫 `recordTenantAudit()`；CLI 登入與登出的 route 傳入 IP。4.1 通過
- [ ] 4.3 `cli-session-auth.test.ts` 的假資料庫補上稽核寫入需要的方法，`pnpm --filter @open333crm/api test -- cli-session-auth` 通過

## 5. 文件與完成檢查

- [ ] 5.1 更新 `docs/ref/features/tenant/SETTINGS.md`（營業時間的檢查規則、稽核的 `section`）、`docs/ref/system/AUDIT.md`（HOURS-01、HOURS-02、SEC-07 移除或改寫，AUD-01 移除長效憑證那一列）、`docs/ref/system/AUDIT-REVIEWS.md`、`docs/ref/features/health/SETTINGS.md`（HC-SETTINGS-01、03、04、06、12 註明已修正）、`.claude/skills/feature-settings/SKILL.md`。逐一確認文件中的路徑與連結存在
- [ ] 5.2 `CHANGELOG.md` 的 `## [2026-11-03]` 加上 Fixed 與 Changed 的條目
- [ ] 5.3 `pnpm test`、`pnpm test:feature` 通過
- [ ] 5.4 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict` 通過
- [ ] 5.5 `node scripts/feature-impact.mjs` 列出受影響的領域，走過 `feature-settings` 回歸清單的第 2、3、5 項（UI 部分以 API 代替）；`node scripts/feature-impact.mjs --check` 通過
- [ ] 5.6 `node scripts/validate-openspec.mjs settings-input-validation-and-credential-audit` 與 `node scripts/validate-openspec.mjs --specs` 通過

## Workflow follow-up

- 以 `pnpm exec openspec archive settings-input-validation-and-credential-audit` 歸檔。歸檔前後比較 `validate-openspec.mjs --specs` 的「略過 N 則」，數字變大時，拆短 `tenant-audit-log` 的「記錄租戶內的敏感操作」再歸檔。新的主規格 `partner-api-key` 的 Purpose 已寫好，歸檔後確認沒有「TBD」。
