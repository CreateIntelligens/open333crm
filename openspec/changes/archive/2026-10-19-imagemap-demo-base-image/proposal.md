## Why

新建「圖文訊息（imagemap）」素材時，編輯器預設帶入示範底圖 `/material-samples/promo-banner.jpeg`。這是站內路徑，不是 https 公開網址，也不是 LINE imagemap 要的格式（LINE 依 `baseUrl/{寬度}` 抓 240、300、460、700、1040 五種寬度）。有 LINE 渠道的租戶保留示範底圖儲存時，LINE 驗證回「底圖網址必須是 https:// 開頭的公開網址」，素材存不了。示範圖是 1024×558，與預設版型 1040×700 的比例也不同，點擊區對不上圖。

## What Changes

- API 新增公開端點 `GET /line-imagemap/demo/:width`，回傳內建示範底圖的對應寬度（五種寬度，比例 1040:700）。圖檔放在 `apps/api/assets/imagemap-demo/`。
- 編輯器的圖文訊息預設底圖改為 `{API 來源}/line-imagemap/demo`，與上傳底圖相同格式，LINE 抓得到、也通過儲存時的驗證。
- 預覽把示範底圖當成 baseUrl 處理，加上 `/1040` 顯示。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `material-system`：新增「圖文訊息的示範底圖符合 LINE imagemap 規格」。

## Impact

- `apps/api/src/modules/storage/line-imagemap.routes.ts`、`apps/api/assets/imagemap-demo/`
- `apps/web/src/lib/imagemap-url.ts`、`apps/web/src/components/materials/default-bodies.ts`
- 已存檔、底圖仍是 `/material-samples/promo-banner.jpeg` 的舊素材不會自動更新，要重新選圖。
- 本機的 API 來源是 `http://localhost:3001`，LINE 抓不到；本機通常沒有 LINE 渠道，儲存時不會驗證。
