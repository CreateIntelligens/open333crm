## ADDED Requirements

### Requirement: LINE 素材儲存時把示範圖換成公開網址

建立 LINE 素材、或更新 LINE 素材的 body 時，系統 SHALL 在送 LINE 驗證與存檔之前，把 body 裡以 `/material-samples/` 開頭的網址換成 `{WEB_BASE_URL}/material-samples/...`。`line_imagemap` 的 `baseImageUrl` 若是舊的示範底圖 `promo-banner.jpeg`，系統 SHALL 換成 `{API 公開網址}/line-imagemap/demo`。其他網址 SHALL 不變。FB 素材不做這個轉換。

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

#### Scenario: FB 素材不轉換
- **WHEN** 使用者儲存 `fb_generic`，卡片的 `image_url` 是 `/material-samples/product.jpeg`
- **THEN** 存進資料庫的仍是 `/material-samples/product.jpeg`

#### Scenario: 卡片訊息切換頁面類型時，完整網址的示範圖也換掉
- **WHEN** 卡片訊息某頁的圖片是 `https://uat.example.com/material-samples/product.jpeg`，使用者把這頁從商品切換成地點
- **THEN** 這頁的圖片換成地點的示範圖
