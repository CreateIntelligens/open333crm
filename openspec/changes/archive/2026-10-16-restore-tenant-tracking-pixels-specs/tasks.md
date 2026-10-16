## 1. 測試

這些情境描述現行行為，測試寫好時就通過，所以改以突變驗證（第 2 節）。測試都走真實的路由與測試資料庫。

| 需求 | 情境 | 測試檔 |
| --- | --- | --- |
| 讀取追蹤設定 | 讀取已設定的 ID | `tests/feature/modules/settings/tracking-settings-route.test.ts` |
| 讀取追蹤設定 | 沒有 settings.manage 不能讀取 | 同上 |
| 更新追蹤設定 | 沒有送的欄位被清除 | 同上 |
| 更新追蹤設定 | 稽核不記錄 ID 的值 | 同上 |
| 更新追蹤設定 | 沒有 settings.manage 不能更新 | 同上 |
| 中轉頁放入租戶的追蹤碼 | 一般瀏覽器的中轉頁含追蹤碼 | `tests/feature/modules/shortlink/shortlink-tracking-injection.test.ts` |
| 中轉頁放入租戶的追蹤碼 | Facebook 內建瀏覽器的中轉頁含追蹤碼 | 同上 |
| 中轉頁放入租戶的追蹤碼 | LIFF 中轉頁含追蹤碼 | 同上 |
| 中轉頁放入租戶的追蹤碼 | 沒有設定的 ID 不放入 script | 同上 |

測試檔的路徑相對於 `apps/api`。

- [x] 1.1 寫上表的測試

## 2. 突變驗證

每個突變都讓對應的測試失敗，還原後全部通過。

| 突變 | 失敗的測試 |
| --- | --- |
| `tracking-settings.service.ts` 的 `getTrackingSettings()` 讀取時只選 `gaId` | 讀取已設定的 ID |
| `settings.routes.ts` 的 `PUT /tracking` 把沒送的 `metaPixelId` 當成不修改 | 沒有送的欄位被清除；讀取已設定的 ID |
| `settings.routes.ts` 的稽核 payload 加入 `gaId` 的值 | 稽核不記錄 ID 的值 |
| `settings.routes.ts` 拿掉 `requirePermission("settings.manage")` 的 hook | 沒有 settings.manage 不能讀取；沒有 settings.manage 不能更新 |
| `shortlink-redirect.routes.ts` 傳給策略的 `gaId` 固定為 `null` | 一般瀏覽器、Facebook 內建瀏覽器、LIFF 三個中轉頁的測試 |
| `strategies/index.ts` 的 `getStrategy()` 把 `FB_WEBVIEW` 交給 BOT 策略 | Facebook 內建瀏覽器的中轉頁含追蹤碼 |
| `line-webview.strategy.ts` 的 LIFF 中轉頁不放追蹤碼 | LIFF 中轉頁含追蹤碼 |
| `tracking-snippet.ts` 的 `buildGa4Snippet()` 沒有設定 `gaId` 時仍輸出 script | 沒有設定的 ID 不放入 script |
| `shortlink-redirect.routes.ts` 一律讀租戶 A 的追蹤設定，不讀短連結所屬的租戶 | 沒有設定的 ID 不放入 script |

- [x] 2.1 執行上表的突變並還原

## 3. 文件

- [x] 3.1 `SETTINGS.md`：改正「先載入追蹤碼再轉址」，補上 GA ID 只接受大寫
- [x] 3.2 `SHORTLINKS.md`：補上 LIFF 中轉頁也放入追蹤碼，以及追蹤事件不保證送出

## 4. 完成檢查

- [x] 4.1 `pnpm test` 與 `pnpm test:feature` 通過
- [x] 4.2 `node scripts/validate-openspec.mjs restore-tenant-tracking-pixels-specs` 與 `--specs` 通過
- [x] 4.3 在同一個 PR 以 `pnpm exec openspec archive restore-tenant-tracking-pixels-specs` 歸檔，並更新 `tracking-settings` 的 `## Purpose`
