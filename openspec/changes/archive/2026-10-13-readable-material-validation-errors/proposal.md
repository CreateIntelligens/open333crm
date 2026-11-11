## Why

2026-10-13 UAT 素材欄位探測發現兩個問題：

- LINE 表單版型（純文字、圖片、影片、卡片、圖文）存檔被 LINE 擋下時，畫面顯示 LINE 的英文原文與 JSON 路徑，例如「The request body has 1 error(s) - messages[0].previewImageUrl: Must be a valid HTTPS URL」、「/contents/0/footer/contents/0/action/uri: invalid uri scheme」。表單上沒有這些路徑，使用者看不出要改哪個欄位。
- 卡片訊息用 API 存 13 頁可以存檔，發送時 `buildLineCarousel()` 的 `slice(0, 12)` 默默丟掉第 13 頁以後。

## What Changes

- LINE 驗證失敗時，表單版型的錯誤訊息改用編輯器的欄位名稱（例如「縮圖網址」「第 1 頁第 1 個按鈕的連結」），常見說明翻成中文（不可空白、必須是 https:// 開頭的公開網址等）。沒對應到的欄位或說明保留原文。
- Flex 版型（`line_flex_showcase`、`line_flex_template`）是直接編輯 JSON，維持 LINE 原文與屬性路徑。
- LINE 的原始回應照樣放在錯誤的 `details.line`。
- 卡片訊息的頁數加結尾頁超過 12 時回 400，不再發送時默默截斷。編輯器最多 10 頁加結尾頁，不受影響。

## Capabilities

### Modified Capabilities

- `material-system`：新增 LINE 表單版型錯誤訊息、卡片頁數上限、圖片縮圖預設使用圖片、FB 編輯器四條需求。

## Impact

- API：`apps/api/src/modules/marketing/line-validate-error.ts`（新）、`material.service.ts`
- 文件：`CHANGELOG.md`、`docs/ref/features/tenant/MARKETING.md`

## 附帶修正

- LINE 圖片編輯器的預設內容把縮圖設成示範圖：只換主圖時縮圖仍是示範圖（站內路徑），LINE 擋下存檔；縮圖清空時送出空字串，`previewUrl ?? mediaUrl` 不會改用主圖。改為預設不設縮圖，空白時用主圖。
- FB 編輯器漏掉會送出的欄位：商品輪播的卡片按鈕看不到也改不了、按鈕選單的新按鈕只能是網址按鈕、大圖廣告的媒體類型是自由輸入框、FB 影片沒有上傳鈕。預覽不顯示換行，FB 影片預覽把 mp4 當圖片載入而破圖。
