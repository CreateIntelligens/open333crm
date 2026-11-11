## Why

2026-10-13 UAT 素材庫全型別 E2E 發現：FB 9 種版型的內容後端完全不檢查（`material.routes.ts` 的 body 是 `z.record(z.unknown())`，`validateLineMaterialWithLineApi()` 只處理 `line_*`），前端也幾乎沒擋。實測存檔回 200、讀回原樣：

- 標了必填的欄位可以空著存：優惠券標題、收據的收件人與訂單編號、按鈕選單的主要訊息
- 6 個網址欄位可以存 `javascript:alert(1)`：fb_image、fb_video、fb_generic 的圖片、fb_button 的網址按鈕、fb_media、fb_coupon 的圖片
- 數值與列舉沒有限制：收據總金額可以是負數、幣別可以填 `XYZ1`、滿意度調查有效天數可以是 -1 或 9999、大圖廣告的媒體類型可以填 `abc`
- 按鈕數量、卡片數量沒有上限，超過時 FB 外掛送出前會默默截斷

## What Changes

- 新增 `fb-material-validation.ts`：依 contentType 檢查 FB 版型內容，不通過時回 400，`details.issues` 指出欄位（例如 `body.elements.0.title`）。
- `createMaterial()` 與 `updateMaterial()`（有送 body 時）在 LINE 驗證之外，對 `fb_*` 版型呼叫這個檢查。
- 網址：接受 `http://`、`https://`，以及站內路徑 `/...`（沿用 LINE 的「先存草稿、發送前換成公開網址」：預設的示範圖是 `/material-samples/...`）；其他 scheme（`javascript:`、`data:` 等）擋下。
- 只檢查實際會送給 FB 的欄位；沒寫進規則的欄位維持原樣。

## Capabilities

### Modified Capabilities

- `material-system`：新增 FB 版型內容的必填與長度、網址、數值與列舉三條需求。

## Impact

- API：`apps/api/src/modules/marketing/fb-material-validation.ts`（新）、`material.service.ts`
- UAT E2E：欄位探測檔中 FB 的 `test.fail` 改為一般測試
- 文件：`CHANGELOG.md`、`docs/ref/features/tenant/MARKETING.md`（素材段落）
- 既有素材：不回頭檢查；之後修改內容再存檔時才套用
