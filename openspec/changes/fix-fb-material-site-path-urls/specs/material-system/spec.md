## REMOVED Requirements

### Requirement: LINE 素材儲存時把示範圖換成公開網址

**Reason**: 這條需求寫明「FB 素材不做這個轉換」，並有情境「FB 素材不轉換」。FB 素材因此原樣存站內路徑，Facebook 拒收，
廣播整批失敗（2026-10-27 UAT）。MODIFIED 不能拿掉既有情境，所以移除這條需求，LINE 的部分原樣改寫成新需求
「LINE 素材儲存時只把示範圖換成公開網址」，FB 的部分改由「FB 素材儲存時把站內路徑換成公開網址」描述。

**Migration**: LINE 的行為不變。FB 素材之後存檔時，網址欄位的站內路徑換成公開網址；已存的舊素材在發送時轉換。

## ADDED Requirements

### Requirement: LINE 素材儲存時只把示範圖換成公開網址

建立 LINE 素材、或更新 LINE 素材的 body 時，系統 SHALL 在送 LINE 驗證與存檔之前，把 body 中網址欄位（欄位名稱以 `url` 結尾）裡以 `/material-samples/` 開頭的值換成 `{WEB_BASE_URL}/material-samples/...`；文字欄位不換。`line_imagemap` 的 `baseImageUrl` 若是舊的示範底圖 `promo-banner.jpeg`，系統 SHALL 換成 `{API 公開網址}/line-imagemap/demo`。其他網址 SHALL 不變。

#### Scenario: 圖片、影片與卡片訊息的示範圖換成公開網址
- **WHEN** `WEB_BASE_URL` 是 `https://uat.example.com`，使用者儲存 `line_image`（`mediaUrl` 是 `/material-samples/cafe.jpeg`）、`line_video`（`previewImageUrl` 是 `/material-samples/promo-banner.jpeg`）或 `line_carousel`（某頁 `imageUrl` 是 `/material-samples/product.jpeg`）
- **THEN** 送給 LINE 驗證與存進資料庫的網址都是 `https://uat.example.com/material-samples/...`

#### Scenario: 圖文訊息的舊示範底圖換成示範底圖端點
- **WHEN** API 公開網址是 `https://uat.example.com`，使用者儲存 `baseImageUrl` 是 `/material-samples/promo-banner.jpeg` 的 `line_imagemap`
- **THEN** 存進資料庫的 `baseImageUrl` 是 `https://uat.example.com/line-imagemap/demo`

#### Scenario: 不是示範圖的網址不變
- **WHEN** LINE 素材的網址是使用者自己的 `https://` 網址，或不是 `/material-samples/` 開頭的站內路徑
- **THEN** 系統原樣送 LINE 驗證並存檔

#### Scenario: 更新素材時一樣轉換
- **WHEN** 使用者更新 LINE 素材的 body，body 仍有 `/material-samples/` 開頭的網址
- **THEN** 存進資料庫的是 `{WEB_BASE_URL}/material-samples/...`

#### Scenario: 卡片訊息切換頁面類型時，完整網址的示範圖也換掉
- **WHEN** 卡片訊息某頁的圖片是 `https://uat.example.com/material-samples/product.jpeg`，使用者把這頁從商品切換成地點
- **THEN** 這頁的圖片換成地點的示範圖

### Requirement: FB 素材儲存時把站內路徑換成公開網址

建立 FB 素材、或更新 FB 素材的 body 時，系統 SHALL 在檢查與存檔之前，把 body 中網址欄位（欄位名稱以 `url` 結尾，例如 `url`、`mediaUrl`、`image_url`、按鈕的 `url`）裡以單一 `/` 開頭的值換成 `{WEB_BASE_URL}{路徑}`。文字欄位、完整網址與 `//` 開頭的網址 SHALL 不變。

#### Scenario: FB 素材的示範圖換成公開網址
- **WHEN** `WEB_BASE_URL` 是 `https://uat.example.com`，使用者儲存 `fb_generic`（卡片 `image_url` 是 `/material-samples/product.jpeg`）、`fb_image`（`url` 是 `/material-samples/cafe.jpeg`）、`fb_media` 或 `fb_coupon`（圖片是示範圖）
- **THEN** 存進資料庫的網址都是 `https://uat.example.com/material-samples/...`

#### Scenario: FB 素材的其他站內路徑也換成公開網址
- **WHEN** `fb_generic` 卡片的 `image_url` 是 `/uploads/a.jpg`、按鈕 `url` 是 `/promo`，卡片標題是 `/material-samples/product.jpeg`
- **THEN** 存進資料庫的 `image_url` 是 `https://uat.example.com/uploads/a.jpg`、按鈕 `url` 是 `https://uat.example.com/promo`，標題不變

#### Scenario: 更新 FB 素材時一樣轉換
- **WHEN** 使用者更新 `fb_generic` 的 body，卡片 `image_url` 是 `/material-samples/product.jpeg`
- **THEN** 存進資料庫的是 `https://uat.example.com/material-samples/product.jpeg`

### Requirement: FB 素材發送時把站內路徑換成公開網址

FB 外掛送出訊息前 SHALL 把內容中網址欄位裡以單一 `/` 開頭的值換成 `{WEB_BASE_URL}{路徑}`，涵蓋 API 與 workers 送出的 FB 訊息（廣播、附券廣播、自動化傳送素材）。內容有站內路徑但沒有設定 `WEB_BASE_URL` 時，外掛 SHALL NOT 呼叫 Facebook，SHALL 回傳失敗，錯誤訊息寫出是哪個網址與修正方式。

#### Scenario: 已存成站內路徑的商品輪播發送成功
- **WHEN** `WEB_BASE_URL` 是 `https://uat.example.com`，送出 `fb_generic`，卡片 `image_url` 是 `/material-samples/product.jpeg`、按鈕 `url` 是 `/promo/autumn`
- **THEN** 送給 Facebook 的 `image_url` 是 `https://uat.example.com/material-samples/product.jpeg`，按鈕 `url` 是 `https://uat.example.com/promo/autumn`

#### Scenario: 公開網址與文字欄位不變
- **WHEN** 送出的卡片 `image_url` 是 `https://cdn.example.com/a.jpg`、按鈕 `url` 是 `//cdn.example.com/x`，標題是 `/material-samples/product.jpeg`
- **THEN** 這三個值原樣送給 Facebook

#### Scenario: 沒有設定網站公開網址
- **WHEN** 沒有設定 `WEB_BASE_URL`，送出卡片 `image_url` 是 `/material-samples/product.jpeg` 的 `fb_generic`
- **THEN** 外掛沒有呼叫 Facebook，回傳失敗，錯誤訊息含 `/material-samples/product.jpeg` 與 `WEB_BASE_URL`

### Requirement: 建立素材的版型清單不提供 FB 大圖／影片廣告

建立素材時的版型清單 SHALL NOT 列出 FB「大圖／影片廣告」（`fb_media`）。Facebook 的媒體範本只接受 Facebook 託管的素材（attachment_id 或 Facebook 網址），以一般網址發送一定會被拒收（`(#100)` 網址參數包含非 Facebook 網址，2026-10-27 UAT 實測）。已存在的 `fb_media` 素材 SHALL 仍可開啟與編輯。

#### Scenario: FB 版型清單沒有大圖／影片廣告
- **WHEN** 使用者在建立素材頁選擇 FB Messenger 平台
- **THEN** 版型清單列出商品輪播等其他 FB 版型，沒有「大圖／影片廣告」
