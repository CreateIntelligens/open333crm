## 1. 後端

- [x] 1.1 測試：AI 月額度無上限時送出加購回 400 `TOPUP_UNLIMITED`、不建立申請；有月額度時照常建立
- [x] 1.2 `createPlanChangeRequest()` 在 `token_topup` 時檢查基礎上限
- [x] 1.3 測試：`GET /plan-change/topup-eligibility` 無上限回 `allowed=false`、有月額度回 `allowed=true` 與含本月加購的上限
- [x] 1.4 新增 `getTopupEligibility()` 與路由

## 2. 租戶頁面

- [x] 2.1 測試：`allowed=false` 時「加購 Token」選項停用並顯示說明
- [x] 2.2 `/dashboard/plan` 讀取 `topup-eligibility` 並停用選項

## 3. 收尾

- [x] 3.1 CHANGELOG、`docs/ref/features/platform/PLAN-CHANGES.md`
- [x] 3.2 `validate-openspec`、`pnpm test`、strict 檢查
- [x] 3.3 UAT 驗證後歸檔（排在 `make-token-topup-monthly` 之後）
