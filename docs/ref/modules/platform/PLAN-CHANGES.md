# 方案異動審核

租戶提出升級或加購申請，平台在此審核。

- **資料來源**：`apps/api/src/modules/platform/plan-change.service.ts`
- **核對日期**：2026-09-23

租戶在租戶後台的 `/api/v1/plan-change` 提出申請，需要 `settings.manage` 權限。平台在這個領域審核。兩種申請型別的核准行為不同：

| 型別 | 核准後的動作 |
| --- | --- |
| `upgrade` | 改 `tenant.planId` |
| `token_topup` | 把加購量加進 `tenant.limitOverrides.monthlyTokens`，疊在方案額度之上 |

`token_topup` 有一道保護：目前有效額度已經是無上限時，核准會被擋下並回 400 `TOPUP_UNLIMITED`。若不擋，管理員會以為加購生效，實際上沒有任何效果。

申請狀態不是 `pending` 時，核准與駁回都回 400。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
