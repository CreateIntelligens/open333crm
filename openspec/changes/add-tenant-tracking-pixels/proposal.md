## Why

短連結模組目前是封閉的追蹤系統——點擊數據只存在自家 DB，無法串接 Google Analytics、Meta Pixel 等外部追蹤服務。行銷團隊需要把短連結的流量數據匯入 GA4 和 Meta Business Suite，才能做全通路的轉換分析和再行銷受眾建構。

## What Changes

- 在 `TenantSettings` 新增租戶層級的追蹤設定欄位（GA4 Measurement ID、Meta Pixel ID）
- 新增 API 端點 `GET/PUT /api/v1/settings/tracking` 讀寫追蹤設定
- 在後台設定頁新增「追蹤設定」分頁，提供表單介面讓管理員設定追蹤 ID
- 修改短連結 redirect 策略頁面（EXTERNAL_BROWSER / FB_WEBVIEW），根據租戶設定動態注入 GA4 和 Meta Pixel 追蹤腳本
- BOT 策略不注入追蹤（爬蟲不執行 JS）

## Capabilities

### New Capabilities

- `tracking-settings`: 租戶層級的外部追蹤服務設定（GA4、Meta Pixel），包含 API 端點和後台管理介面
- `shortlink-tracking-injection`: 短連結 redirect 微頁面根據租戶追蹤設定動態注入外部追蹤腳本

### Modified Capabilities

## Impact

- **Database**: `tenant_settings` 表新增 2 個欄位（`gaId`, `metaPixelId`），需要 Prisma migration
- **API**: `apps/api/src/modules/settings/settings.routes.ts` 新增 2 個端點
- **Frontend**: `apps/web/src/app/dashboard/settings/page.tsx` 新增分頁，`apps/web/src/components/settings/` 新增元件
- **Shortlink strategies**: `apps/api/src/modules/shortlink/strategies/external-browser.strategy.ts` 和 `line-webview.strategy.ts` 需要注入追蹤腳本
- **No breaking changes**: 現有功能不受影響，新欄位皆可為 null
