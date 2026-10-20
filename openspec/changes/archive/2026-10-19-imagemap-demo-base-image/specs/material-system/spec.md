## ADDED Requirements

### Requirement: 圖文訊息的示範底圖符合 LINE imagemap 規格

新建 `line_imagemap` 素材時，編輯器預設帶入的底圖 SHALL 是 `{API 來源}/line-imagemap/demo`。API SHALL 公開提供 `GET /line-imagemap/demo/:width`，對 LINE 規定的五種寬度（240、300、460、700、1040）回傳 JPEG，比例與預設版型相同（1040:700）；其他寬度回 HTTP 400。預覽 SHALL 以 `/1040` 顯示示範底圖。

#### Scenario: 示範底圖提供 LINE 規定的五種寬度
- **WHEN** 不帶登入呼叫 `GET /line-imagemap/demo/460`，或帶副檔名的 `GET /line-imagemap/demo/1040.jpg`
- **THEN** 回 HTTP 200、`image/jpeg`，圖片寬度是請求的寬度，高度是寬度乘以 700/1040 四捨五入

#### Scenario: 其他寬度不提供
- **WHEN** 呼叫 `GET /line-imagemap/demo/500`
- **THEN** 回 HTTP 400

#### Scenario: 新建圖文訊息預設帶入公開的示範底圖
- **WHEN** API 來源是 `https://uat.example.com`，使用者新建 `line_imagemap` 素材
- **THEN** 預設 body 的 `baseImageUrl` 是 `https://uat.example.com/line-imagemap/demo`，`width` 是 1040、`height` 是 700

#### Scenario: 預覽示範底圖
- **WHEN** 預覽的 `baseImageUrl` 是 `https://uat.example.com/line-imagemap/demo`
- **THEN** 預覽圖網址是 `https://uat.example.com/line-imagemap/demo/1040`
