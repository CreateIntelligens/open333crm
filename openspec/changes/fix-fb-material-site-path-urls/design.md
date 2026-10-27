## Context

- 編輯器的預設 body（`apps/web/src/components/materials/default-bodies.ts`）用站內路徑 `/material-samples/...` 當示範圖，web 公開提供這些檔案。
- LINE 在 change `line-sample-images-public-url` 已改成存檔時換成 `{WEB_BASE_URL}/material-samples/...`，因為 LINE validate 只收 https。
- FB 沒有 validate API，`fb-material-validation.ts` 允許站內路徑，FB 外掛 `buildFbMessage()` 把欄位原樣送給 Graph API。
- 送 FB 素材的路徑有好幾條：一般廣播（`marketing.service.ts`）、附券廣播（`broadcast-coupon.flow.ts`）、對話送素材
  （`getMaterialForSend()`），以及 workers 的自動化（`automation-actions.ts`）。共同點只有 FB 外掛的 `sendMessage()`。

## Decisions

### D1 存檔時換所有站內路徑，不只示範圖

Facebook 對任何站內路徑都回「should represent a valid URL」。選項：

| 選項 | 結果 |
| ---- | ---- |
| 只換示範圖，其他站內路徑存檔時擋下 | 使用者要自己把 `/promo` 改成完整網址；但 web 本來就在 `WEB_BASE_URL` 公開提供這些路徑 |
| 換所有站內路徑（採用） | 存的是 Facebook 收得到的網址；與「FB Material URLs Use Safe Schemes」允許站內路徑的原意一致 |

只換網址欄位（欄位名稱以 `url` 結尾）裡「整個值就是站內路徑」的字串，文字欄位不換，與 LINE 相同。`//` 開頭是省略協定的外部網址，不算站內路徑。

### D2 舊素材在 FB 外掛發送時轉換

存檔轉換只影響之後存的素材。已存成站內路徑的 FB 素材（例如 UAT 上那則商品輪播）要在發送時換。放在 FB 外掛 `sendMessage()`：

- 所有送 FB 的路徑都經過它，API 與 workers 都涵蓋，不必在每個呼叫端各加一次（結構規則 5）。
- 外掛以建構參數 `siteBaseUrl` 取得公開網址，預設在發送當下讀 `process.env.WEB_BASE_URL`。workers 的
  `rule-coupon-issue.ts` 也讀同一個環境變數產生票券連結，所以 workers 環境原本就需要它；`.env.workers.example` 補上。
- 不做資料回填：發送時轉換已涵蓋，回填要在 UAT 另跑腳本，沒有額外好處。

### D3 沒有公開網址時不送出，錯誤看得到

有站內路徑但 `WEB_BASE_URL` 沒有設定時，外掛回 `{ success: false, error }`，不呼叫 Facebook。錯誤訊息寫出是哪個網址、
請改成完整網址或請管理員設定 `WEB_BASE_URL`。呼叫端照既有方式寫進廣播失敗原因、收件紀錄或自動化執行紀錄，後台看得到，不只寫 log。

### D4 `fb_media` 的限制不在本 change

Facebook 的 media template 只接受 `attachment_id` 或 Facebook 網址，外部網址（含換好的示範圖）仍可能被拒。這是 Facebook 的限制，
與站內路徑無關，本 change 不處理，只把站內路徑換成公開網址。

## Risks / Trade-offs

- `WEB_BASE_URL` 指向本機（`http://localhost:3000`）時，換出來的網址 Facebook 一樣讀不到；本機本來就收不到 FB webhook，只在 UAT 驗證。
- 版本還原（`restoreMaterialVersion()`）不做存檔轉換，舊版的站內路徑由發送時轉換涵蓋。
