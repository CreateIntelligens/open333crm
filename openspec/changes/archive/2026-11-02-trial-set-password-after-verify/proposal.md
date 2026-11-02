# Proposal

## Why

試用申請在送出時就收密碼，開通時沿用 `trial_signups.passwordHash`。同一 email 待驗證時再送一次申請，會覆寫密碼與站台名稱並寄新信，所以知道對方 email 的人可以覆寫對方的申請，或搶先替對方申請；對方點信後，站台以攻擊者的密碼開通（AUDIT TRIAL-05，P1）。同一段程式每次都換 token 寄信，繞過 `/resend` 的節流（AUDIT TRIAL-06）。UAT（即正式環境）的 `trial.enabled` 是 `true`。

## What Changes

- **BREAKING**（API 合約）：`POST /api/v1/trial/signups` 只收 `email` 與 `siteName`。請求帶 `password` 時忽略，不儲存（相容舊頁面的快取）。
- 待驗證的申請再送一次：不改任何申請資料，只依重寄節流（間隔 60 秒、累計 5 次）重寄驗證信。防枚舉的 202 回應不變。
- **BREAKING**：`GET /api/v1/trial/verify?token=` 改為只確認連結：回傳站台名稱、email 與狀態，不消耗 token、不開通。
- 新增 `POST /api/v1/trial/verify`（`token`、`password`、`siteName`）：在同一個 transaction 內消耗 token、建立租戶與管理員帳號，管理員密碼用這次送出的密碼。同一 token 只開通一次。
- 前端：申請頁拿掉密碼欄位；驗證頁改成「確認連結 → 設定密碼（可修改站台名稱）→ 開通」。
- 驗證信與開通信的文案改成「驗證後設定密碼」。
- 資料庫：移除 `trial_signups.passwordHash`（migration）。改版前寄出、仍在效期的連結照常可用，打開後改成設定密碼。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `trial-application`：申請入口不收密碼；防枚舉回應的待驗證分支不覆寫、受節流；驗證拆成「確認連結」與「設定密碼並開通」兩步。

## Impact

- API：`apps/api/src/modules/trial/trial.service.ts`、`trial.routes.ts`、`trial-emails.ts`。
- Web：`apps/web/src/app/trial/page.tsx`、`apps/web/src/app/trial/verify/page.tsx`。
- DB：`packages/database/prisma/schema.prisma`、新 migration 移除 `trial_signups.passwordHash`。
- 文件：`docs/ref/system/AUDIT.md`（TRIAL-05、TRIAL-06）、`docs/ref/features/platform/TRIALS.md`、健檢報告。
