## Why

AI 月額度無上限的租戶（例如企業版沒有設 `monthlyTokens`、或沒有指定方案）仍能在 `/dashboard/plan` 送出加購 token 申請。平台核准時後端以 400 `TOPUP_UNLIMITED` 拒絕，這筆申請只能駁回；在它被處理前，租戶也不能再送其他申請（一次一筆）。2026-11-11 在 UAT 審核頁實際遇到兩筆這樣的申請。

## What Changes

- `POST /api/v1/plan-change` 送出 `token_topup` 時，若租戶的 AI 月額度基礎上限是無上限，回 400 `TOPUP_UNLIMITED`，不建立申請。
- 新增 `GET /api/v1/plan-change/topup-eligibility`，回傳租戶目前能不能申請加購與本月上限，供租戶頁面判斷。
- `/dashboard/plan`：無上限時「加購 Token」選項停用，並說明「目前方案的 AI 額度已無上限，不需要加購」。

## Capabilities

### Modified Capabilities

- `plan-change-request`：租戶送出申請的拒絕條件多一項；新增租戶查詢能否加購。

## Impact

- `apps/api/src/modules/platform/plan-change.service.ts`、`plan-change.routes.ts`
- `apps/web/src/app/dashboard/plan/page.tsx`
- 平台層：`/admin/plan-changes` 已在 `fix/plan-change-approve-feedback` 停用無上限租戶的核准按鈕，本 change 從源頭擋下這種申請。
- 已存在的待審申請不受影響，平台照常可以駁回。
