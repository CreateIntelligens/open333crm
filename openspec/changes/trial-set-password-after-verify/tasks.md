# Tasks

## 1. 先寫會失敗的測試

- [x] 1.1 `apps/api/tests/feature/modules/trial/trial-signup-verify.test.ts`：「搶先申請的人無法決定管理員密碼」「待驗證時以不同站台名稱再申請」（重現 TRIAL-05）。驗證：跑 `pnpm --filter @open333crm/api test:feature modules/trial`，在改程式前以 assertion 失敗
- [x] 1.2 同檔：「待驗證時連續再申請受重寄節流」（重現 TRIAL-06）。驗證：改程式前寄信次數的 assertion 失敗
- [x] 1.3 同檔：「查詢連結不消耗 token」「同一 token 送出兩次」「驗證頁修改站台名稱」「改版前寄出的驗證連結」「開通成功」。驗證：改程式前失敗
- [x] 1.4 同檔：「過期 token」「重寄後舊連結失效」「無效 token」「關閉後既有驗證信仍可完成開通」「總開關關閉」「已開通過的 email 再申請」「gmail 別名重複申請」對新的查詢與送出端點。驗證：改程式前因新函式不存在或行為不同而 assertion 失敗
- [x] 1.5 `apps/api/tests/unit/modules/trial/trial-routes.test.ts`：「申請時送出的密碼被忽略」（路由不把 password 交給 service）、「密碼太短」（400、service 未被呼叫）。驗證：改程式前失敗

## 2. 實作

- [x] 2.1 migration 移除 `trial_signups.passwordHash`，更新 `schema.prisma`。驗證：feature 測試的 global setup 套用全部 migration 成功
- [x] 2.2 `trial.service.ts`：`requestTrial()` 不收密碼、待驗證時改呼叫 `resendTrial()`；新增 `getVerifyStatus()`；`verifyAndProvision()` 收 `password`、`siteName`，搶佔條件加上 token。驗證：1.1–1.4 通過
- [x] 2.3 `trial.routes.ts`：`signupSchema` 拿掉 password；`GET /verify` 改為查詢；新增 `POST /verify`（Zod 驗證密碼與站台名稱）。驗證：1.5 通過
- [x] 2.4 `trial-emails.ts`：驗證信按鈕與開通信改成「驗證後設定密碼」的文案。驗證：讀信件模板
- [x] 2.5 前端 `apps/web/src/app/trial/page.tsx` 拿掉密碼欄位；`apps/web/src/app/trial/verify/page.tsx` 改成查詢 → 設定密碼表單 → 開通，錯誤顯示在畫面上。驗證：`pnpm --filter @open333crm/web build` 與型別檢查通過

## 3. 完成的定義

- [x] 3.1 `pnpm --filter @open333crm/api test`、`pnpm --filter @open333crm/web test` 通過
- [x] 3.2 `pnpm --filter @open333crm/api test:feature modules/trial` 通過
- [x] 3.3 `node scripts/check-tenant-scoping.mjs --strict`、`node scripts/check-prisma-admin-usage.mjs --strict`、`node scripts/check-tenant-ctx.mjs --strict`、`node scripts/feature-impact.mjs --check` 沒有新增違規
- [x] 3.4 `CHANGELOG.md` 加 `Fixed` 條目
- [ ] 3.5 更新 `docs/ref/system/AUDIT.md`（TRIAL-05、TRIAL-06）、`docs/ref/system/AUDIT-REVIEWS.md`、`docs/ref/features/platform/TRIALS.md`、`.claude/skills/feature-platform-trials/SKILL.md`、`docs/ref/features/health/PLATFORM-TRIALS.md`、`docs/ref/features/health/README.md`
- [ ] 3.6 `node scripts/validate-openspec.mjs trial-set-password-after-verify` 通過

## Workflow follow-up

- 以 `pnpm exec openspec archive trial-set-password-after-verify` 歸檔，之後 `node scripts/validate-openspec.mjs --specs` 通過。
