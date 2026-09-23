# 用量統計

跨租戶與單一租戶的 AI 用量與成本統計。

- **資料來源**：`apps/api/src/modules/platform/platform-usage.service.ts`
- **核對日期**：2026-09-23

資料來源是 `AiUsage`。三個規則：

- 只計 `success = true` 的呼叫。失敗的呼叫計入次數，但不計 token 與成本。
- `costUsd` 一律在後端以 Decimal 加總。前端只顯示，不對字串做加總。
- 單價來自 `ModelPricing`，該表有分級費率與生效日期。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
