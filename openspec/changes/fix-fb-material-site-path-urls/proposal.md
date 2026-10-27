## Why

2026-10-27 UAT 驗收：FB「商品輪播」素材沿用編輯器預設的示範圖 `/material-samples/product.jpeg`，廣播時 Facebook 回
`[#100] name_placeholder[elements][0][image_url] should represent a valid URL`，整批失敗。LINE 素材用同一張示範圖卻能送出。

原因：主規格 `material-system` 的「LINE 素材儲存時把示範圖換成公開網址」只處理 LINE，並明文寫「FB 素材不做這個轉換」；
「FB Material URLs Use Safe Schemes」又允許 FB 素材存站內路徑。結果 FB 素材原樣存站內路徑，FB 外掛原樣送出，Facebook 不收。
這是規格寫明的行為，不是規格內的 bug，所以開 change 修改行為。

## What Changes

- FB 素材儲存時（建立、更新 body），網址欄位（欄位名稱以 `url` 結尾）裡所有站內路徑（`/` 開頭、不是 `//`）換成
  `{WEB_BASE_URL}{路徑}`，涵蓋 FB 所有版型（`fb_image`、`fb_video`、`fb_generic` 的卡片圖與按鈕網址、`fb_media`、`fb_coupon` 等）。
  不只示範圖：Facebook 對任何站內路徑都一律拒收，存檔就換成公開網址比存檔時擋下、要使用者自己改網址更直接。
- 已存成站內路徑的舊 FB 素材：FB 外掛在發送時把站內路徑換成 `{WEB_BASE_URL}{路徑}`。API（廣播、附券廣播、對話）與
  workers（自動化傳送素材、關鍵字回覆）都經過 FB 外掛，所以兩個行程都涵蓋（結構規則 5：渠道差異放在外掛）。
- 發送時有站內路徑但沒有設定 `WEB_BASE_URL`：FB 外掛不呼叫 Facebook，回傳指出是哪個網址、要怎麼修的錯誤，
  由呼叫端照既有方式寫進失敗原因（廣播的失敗原因、收件紀錄、自動化執行紀錄）。
- LINE 的行為不變（只換示範圖；其他站內路徑由 LINE validate 擋下）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `material-system`：移除「LINE 素材儲存時把示範圖換成公開網址」（它寫明「FB 素材不做這個轉換」，並有情境「FB 素材不轉換」；
  MODIFIED 不能拿掉既有情境），LINE 部分原樣改寫成新增的「LINE 素材儲存時只把示範圖換成公開網址」；
  新增「FB 素材儲存時把站內路徑換成公開網址」「FB 素材發送時把站內路徑換成公開網址」。

## Impact

- `apps/api/src/modules/marketing/material-sample-urls.ts`：`resolveLineSampleImageUrls()` 改名 `resolveSampleImageUrls()`，加上 FB。
- `packages/channel-plugins/src/site-path-urls.ts`（新增）、`packages/channel-plugins/src/facebook/index.ts`。
- `.env.workers.example` 加上 `WEB_BASE_URL`（workers 的關鍵字發券連結原本就讀它）。
- 不需要資料庫 migration；不回填既有資料（發送時轉換已涵蓋舊素材）。
- 移除的需求在 `openspec/specs/material-system/`；open change `add-material-coupon-url-insert` 也改 `material-system`，但不動這幾條需求，沒有歸檔順序依賴。
