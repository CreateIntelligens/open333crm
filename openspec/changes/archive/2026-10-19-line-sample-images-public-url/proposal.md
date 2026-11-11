## Why

LINE 素材編輯器預設帶入的示範圖是站內路徑（`/material-samples/cafe.jpeg` 等）：圖片的 `mediaUrl`、影片的預覽圖、卡片訊息每一頁的圖片。有 LINE 渠道的租戶保留示範圖儲存時，LINE 驗證回「網址必須是 https:// 開頭的公開網址」，素材存不了。`material.service.ts` 的註解寫著「這類 URL 錯誤在儲存時不強制」，但沒有實作。

## What Changes

- LINE 素材在儲存（建立、更新 body）前，把 body 裡以 `/material-samples/` 開頭的網址換成 `{WEB_BASE_URL}/material-samples/...`，再送 LINE 驗證並存檔。示範圖本來就由 web 公開提供。
- 圖文訊息的底圖若還是舊的示範圖（`/material-samples/promo-banner.jpeg`，或換成完整網址後的同一張），換成 `{API 公開網址}/line-imagemap/demo`，因為 imagemap 需要 `baseUrl/{寬度}`。
- 其他網址不變：使用者自己的 https 網址、不是示範圖的站內路徑都照原樣，LINE 不接受時照樣擋。
- `apiPublicUrl()` 從 `storage.routes.ts` 移到 `storage.service.ts`（`getApiPublicUrl()`），上傳底圖與示範底圖共用。
- 卡片訊息切換頁面類型時，完整網址的示範圖也算示範圖，仍會換成新類型的示範圖。

FB 素材不在這次範圍：spec 允許 FB 素材存站內路徑。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `material-system`：新增「LINE 素材儲存時把示範圖換成公開網址」。

## Impact

- `apps/api/src/modules/marketing/material-sample-urls.ts`（新）、`material.service.ts`
- `apps/api/src/modules/storage/storage.service.ts`、`storage.routes.ts`
- `apps/web/src/components/materials/line/carousel-page-types.ts`
- 已存檔的舊素材在下次儲存時一併換成公開網址；沒有再儲存的舊素材不變。
